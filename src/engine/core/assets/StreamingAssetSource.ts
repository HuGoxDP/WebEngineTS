import type { AssetReadOptions, IAssetSource } from "./Resources";
import {
    AssetPriority, normalizeAssetPath, normalizeScriptPath, parseStreamingManifest,
} from "./StreamingManifest";
import type {
    IStreamedAsset, IStreamedAssetLod, IStreamedScript, IStreamingManifest,
} from "./StreamingManifest";
import type { IScenarioAssetEntry } from "../scenario/ScenarioTypes";
import { mimeTypeForPath } from "./_AssetMime";

/** The subset of `fetch` this source uses, so a test can supply its own. */
export type FetchLike = (url: string) => Promise<Response>;

/** What a {@link StreamingAssetSource} can be built with. */
export interface StreamingAssetSourceOptions {
    /**
     * Base every asset URL is resolved against, overriding the manifest's own.
     *
     * @remarks
     * The manifest is content, the origin is deployment. A host that moved its
     * store should not have to reissue every manifest to say so.
     */
    baseUrl?: string;
    /** Fetch implementation. Defaults to the global one. */
    fetch?: FetchLike;
    /**
     * How many requests may be in flight at once. Defaults to 6.
     *
     * @remarks
     * The browser caps this per host anyway; setting it here is what gives the
     * source a *queue* to order, which is the point — without one, priority has
     * nothing to act on because every request has already been issued.
     */
    maxConcurrentRequests?: number;
}

/**
 * Where a queued request sits. Lower runs sooner.
 *
 * @remarks
 * `Demand` is above every declared priority on purpose: a manifest priority
 * says how eagerly to *preload*, while an actual read is something waiting.
 * A `lazy` asset the scenario just asked for must not queue behind two hundred
 * speculative `low` fetches.
 *
 * @internal
 */
const enum _Rank {
    Demand = 0,
    Critical = 1,
    High = 2,
    Low = 3,
    Lazy = 4,
}

const _RANK_BY_PRIORITY: Readonly<Record<AssetPriority, _Rank>> = Object.freeze({
    [AssetPriority.Critical]: _Rank.Critical,
    [AssetPriority.High]: _Rank.High,
    [AssetPriority.Low]: _Rank.Low,
    [AssetPriority.Lazy]: _Rank.Lazy,
});

/** One request waiting for a slot. */
interface _QueuedRequest {
    url: string;
    path: string;
    rank: _Rank;
    /** Submission order, so equal ranks stay first-in-first-out. */
    sequence: number;
    resolve: (bytes: ArrayBuffer) => void;
    reject: (error: unknown) => void;
}

/**
 * An {@link IAssetSource} that fetches assets individually, from a manifest.
 *
 * @remarks
 * The alternative to {@link ScenarioAssets}, which reads everything out of one
 * in-memory ZIP. Because both satisfy the same interface, scenario code —
 * `Resources.load`, `assets.loadTexture` — works unchanged against either;
 * that seam is the whole reason streaming is additive rather than a rewrite.
 * See `design/asset-streaming-proposal.md` §3.2.
 *
 * ```ts
 * const source = await StreamingAssetSource.fromUrl("/scenarios/solar/scenario.json");
 * Resources.useSource(source);
 * const earth = await Resources.load(Texture2D, "textures/earth");
 * ```
 *
 * **Requests are scheduled, not just issued.** At most
 * {@link maxConcurrentRequests} are in flight; the rest wait in a queue ordered
 * by priority — a read the scenario is actually waiting on outranks every
 * speculative preload, and a queued request is promoted when something asks for
 * it for real. Without a queue, priority would have nothing to act on, because
 * every request would already have been sent.
 *
 * **Detail levels are chosen per asset.** {@link setLodLevel} picks the level a
 * given path is served at, and {@link maxLodLevel} caps every one of them —
 * a per-asset request cannot exceed the global ceiling. What is still missing
 * is a *policy*: nothing yet decides that an asset should be upgraded because
 * the camera came closer, and re-reading a path only affects the next read,
 * since {@link Resources} caches the already-decoded asset.
 *
 * A manifest that also declares `scripts` and an `entry` describes a whole
 * scenario rather than just its assets, and {@link Scenario.loadFromManifest}
 * will run it: {@link listScripts} and {@link readScript} are what the loader
 * pre-links from, in place of reading the ZIP's `scripts/` directory.
 *
 * Assets are fetched **when first read**, not up front. From scenario code the
 * results are identical to the ZIP path; the timing is not, since each first
 * read is a round trip rather than a decompression. Concurrent reads of one
 * path share a single request, and the bytes are not retained here —
 * {@link Resources} already caches the decoded asset, and holding both would
 * double the cost of every texture.
 */
export class StreamingAssetSource implements IAssetSource {

    private readonly _manifest: IStreamingManifest;
    private readonly _byPath: Map<string, IStreamedAsset> = new Map();
    private readonly _byScript: Map<string, IStreamedScript> = new Map();
    private readonly _fetch: FetchLike;
    private readonly _baseUrl: string | undefined;

    /** In-flight fetches by resolved URL, so a repeated read is one request. */
    private readonly _inFlight: Map<string, Promise<ArrayBuffer>> = new Map();

    /** Per-asset detail level requests, by normalized path. */
    private readonly _desiredLod: Map<string, number> = new Map();

    /** Requests waiting for a slot, by resolved URL. */
    private readonly _queued: Map<string, _QueuedRequest> = new Map();

    private readonly _blobUrls: string[] = [];

    private _activeRequests: number = 0;
    private _sequence: number = 0;
    private _maxConcurrentRequests: number;

    private _bytesFetched: number = 0;
    private _requestCount: number = 0;

    /**
     * Highest detail level any read may return, across every asset.
     *
     * @remarks
     * `Infinity` — the default — means the best level the manifest offers,
     * which is what makes this source behave like the ZIP it replaces. Lower it
     * to cap quality globally, which is useful on its own for a low-memory
     * device.
     *
     * This is a **ceiling**, not a default: a per-asset request made through
     * {@link setLodLevel} is clamped by it, so lowering it cannot be undone
     * asset by asset. Raising it lets earlier per-asset requests through again.
     */
    public maxLodLevel: number = Number.POSITIVE_INFINITY;

    constructor(manifest: IStreamingManifest, options: StreamingAssetSourceOptions = {}) {
        this._manifest = manifest;
        this._baseUrl = options.baseUrl ?? manifest.baseUrl;
        this._fetch = options.fetch ?? ((url: string) => globalThis.fetch(url));
        this._maxConcurrentRequests = Math.max(1, options.maxConcurrentRequests ?? 6);

        for (const asset of manifest.assets) {
            this._byPath.set(asset.path, asset);
        }
        for (const script of manifest.scripts ?? []) {
            this._byScript.set(script.path, script);
        }
    }

    /**
     * Fetches and parses a manifest, then builds a source from it.
     *
     * @remarks
     * The manifest's own URL becomes the default base, so a manifest sitting
     * beside its assets needs no `baseUrl` at all.
     *
     * @param url - where the manifest lives.
     * @param options - overrides; `baseUrl` wins over both defaults.
     */
    public static async fromUrl(
        url: string,
        options: StreamingAssetSourceOptions = {},
    ): Promise<StreamingAssetSource> {
        const doFetch = options.fetch ?? ((u: string) => globalThis.fetch(u));
        const response = await doFetch(url);
        if (!response.ok) {
            throw new Error(
                `[StreamingAssetSource] Manifest fetch failed: ${response.status} ${url}`
            );
        }

        const manifest = parseStreamingManifest(await response.json());
        return new StreamingAssetSource(manifest, {
            fetch: options.fetch,
            baseUrl: options.baseUrl ?? manifest.baseUrl ?? url,
        });
    }

    /** The manifest this source reads. */
    public get manifest(): Readonly<IStreamingManifest> { return this._manifest; }

    /** Total bytes fetched so far. */
    public get bytesFetched(): number { return this._bytesFetched; }

    /** How many requests have been issued. */
    public get requestCount(): number { return this._requestCount; }

    /** How many requests are in flight right now. */
    public get activeRequestCount(): number { return this._activeRequests; }

    /** How many requests are waiting for a slot. */
    public get pendingRequestCount(): number { return this._queued.size; }

    /**
     * How many requests may be in flight at once.
     *
     * @remarks
     * Raising it mid-run starts whatever the extra slots can take; lowering it
     * does not cancel anything already sent, since a request in flight cannot
     * be usefully un-sent and its bytes are wanted either way.
     */
    public get maxConcurrentRequests(): number { return this._maxConcurrentRequests; }
    public set maxConcurrentRequests(value: number) {
        this._maxConcurrentRequests = Math.max(1, Math.floor(value));
        this._pump();
    }

    /**
     * The asset identities this manifest declares.
     *
     * @remarks
     * The shape `AssetDatabase.setManifest` takes, so a streamed scenario gets
     * the same durable asset ids a packaged one does. Assets without a `guid`
     * are omitted rather than given a minted one — a made-up id that does not
     * survive a reload is worse than none, because it looks stable.
     */
    public assetEntries(): IScenarioAssetEntry[] {
        const entries: IScenarioAssetEntry[] = [];
        for (const asset of this._manifest.assets) {
            if (asset.guid) entries.push({ guid: asset.guid, path: asset.path });
        }
        return entries;
    }

    // ==================== SCRIPTS ====================

    /**
     * Every script module the manifest declares, in the order it listed them.
     *
     * @remarks
     * Scripts are deliberately **not** part of the {@link IAssetSource} face —
     * {@link has} and {@link list} answer for assets only. `Resources` decodes
     * assets into engine objects; a module is neither decodable that way nor
     * something scenario code should be able to reach by path. The scenario
     * loader reads them through here instead, pre-links them into Blob URLs,
     * and only then runs any of them.
     */
    public listScripts(): readonly string[] {
        return [...this._byScript.keys()];
    }

    /**
     * Reads one script module's source.
     *
     * @param path - a script path, with or without the `scripts/` prefix.
     * @returns the module source text.
     * @throws if the manifest does not list the script.
     */
    public async readScript(path: string): Promise<string> {
        const normalized = normalizeScriptPath(path);
        const script = this._byScript.get(normalized);
        if (!script) {
            throw new Error(`[StreamingAssetSource] Script not in the manifest: ${normalized}`);
        }
        // Demand rank always: pre-linking blocks the entry point, so nothing
        // about a module is speculative.
        const bytes = await this._shared(
            this._resolveUrl(script.url), normalized, _Rank.Demand,
        );
        return new TextDecoder().decode(bytes);
    }

    /**
     * The paths this source can serve at a given priority.
     *
     * @param priority - the priority to filter by.
     */
    public pathsByPriority(priority: AssetPriority): string[] {
        return this._manifest.assets
            .filter(a => a.priority === priority)
            .map(a => a.path);
    }

    // ==================== DETAIL LEVELS ====================

    /**
     * Requests the detail level one asset is served at.
     *
     * @param path - an asset path, with or without the `assets/` prefix.
     * @param level - the wanted level; `Infinity` asks for the best available.
     * @throws if the manifest does not list the path.
     *
     * @remarks
     * The request is a *wish*, resolved against what the manifest actually
     * offers and against {@link maxLodLevel}: asking for a level an asset does
     * not have gives its nearest lower one, and no request can exceed the
     * global ceiling.
     *
     * **This affects the next read, not what is already loaded.** `Resources`
     * caches the decoded asset, so a level changed after loading takes effect
     * when something reads the path afresh. Swapping an already-decoded texture
     * is a separate step.
     *
     * @example
     * ```ts
     * // Keep one heavy texture coarse without capping the whole scene.
     * source.setLodLevel("textures/terrain.ktx2", 0);
     * ```
     */
    public setLodLevel(path: string, level: number): void {
        const normalized = normalizeAssetPath(path);
        if (!this._byPath.has(normalized)) {
            throw new Error(`[StreamingAssetSource] Not in the manifest: ${normalized}`);
        }
        this._desiredLod.set(normalized, level);
    }

    /**
     * Drops a per-asset request, returning the path to the global ceiling.
     *
     * @param path - an asset path, with or without the `assets/` prefix.
     */
    public clearLodLevel(path: string): void {
        this._desiredLod.delete(normalizeAssetPath(path));
    }

    /**
     * The detail level a read of this path would currently return.
     *
     * @param path - an asset path, with or without the `assets/` prefix.
     * @returns the resolved level, or null when the manifest does not list it.
     *
     * @remarks
     * The *resolved* level, not the requested one — what the asset offers and
     * {@link maxLodLevel} have both already been applied, so this is what a
     * fetch would actually bring back.
     */
    public getLodLevel(path: string): number | null {
        const lod = this._selectLod(normalizeAssetPath(path));
        return lod ? lod.level : null;
    }

    /**
     * The absolute URL a path currently resolves to.
     *
     * @param path - an asset path, with or without the `assets/` prefix.
     * @returns the URL, or null when the manifest does not list the path.
     */
    public urlFor(path: string): string | null {
        const lod = this._selectLod(normalizeAssetPath(path));
        return lod ? this._resolveUrl(lod.url) : null;
    }

    // ==================== IAssetSource ====================

    /** @internal */
    public has(path: string): boolean {
        return this._byPath.has(normalizeAssetPath(path));
    }

    /** @internal */
    public list(prefix?: string): string[] {
        const paths = [...this._byPath.keys()];
        if (!prefix) return paths;
        const normalized = normalizeAssetPath(prefix);
        return paths.filter(p => p.startsWith(normalized));
    }

    /** @internal */
    public async readBytes(path: string, options?: AssetReadOptions): Promise<Uint8Array> {
        return new Uint8Array(await this._read(path, options?.speculative === true));
    }

    /** @internal */
    public async readText(path: string, options?: AssetReadOptions): Promise<string> {
        return new TextDecoder().decode(
            await this._read(path, options?.speculative === true),
        );
    }

    /** @internal */
    public async getBlobUrl(path: string): Promise<string> {
        const bytes = await this._read(path, false);
        const blob = new Blob([bytes], { type: mimeTypeForPath(path) });
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        return url;
    }

    /**
     * Revokes every blob URL this source handed out.
     *
     * @remarks
     * Mirrors `ScenarioAssets.dispose`. In-flight reads are left to settle —
     * cancelling them would reject callers that are mid-decode, and their bytes
     * are dropped anyway once nothing holds the result.
     */
    public dispose(): void {
        for (const url of this._blobUrls) URL.revokeObjectURL(url);
        this._blobUrls.length = 0;
        this._inFlight.clear();
    }

    // ==================== PRIVATE ====================

    private async _read(path: string, speculative: boolean): Promise<ArrayBuffer> {
        const normalized = normalizeAssetPath(path);
        const asset = this._byPath.get(normalized);
        const lod = this._selectLod(normalized);
        if (!asset || !lod) {
            throw new Error(`[StreamingAssetSource] Not in the manifest: ${normalized}`);
        }

        // A speculative read takes the asset's declared priority; a real one
        // outranks every speculation regardless of what the manifest says.
        const rank = speculative ? _RANK_BY_PRIORITY[asset.priority] : _Rank.Demand;

        return this._shared(this._resolveUrl(lod.url), normalized, rank);
    }

    /**
     * One request per URL, however many callers are waiting on it, and never
     * more than {@link maxConcurrentRequests} in flight.
     *
     * A URL already queued but not yet started is **promoted** when asked for
     * again at a better rank — that is what lets a scenario's own read overtake
     * the speculative queue it is sitting in. A request already in flight is
     * left alone: it cannot be usefully un-sent, and its bytes are wanted.
     */
    private _shared(url: string, path: string, rank: _Rank): Promise<ArrayBuffer> {
        // Queued is checked before in-flight: a queued URL is present in both,
        // and it is the only one still worth re-ranking.
        const queued = this._queued.get(url);
        if (queued) {
            if (rank < queued.rank) queued.rank = rank;
            return this._inFlight.get(url)!;
        }

        const pending = this._inFlight.get(url);
        if (pending) return pending;

        const promise = new Promise<ArrayBuffer>((resolve, reject) => {
            this._queued.set(url, {
                url, path, rank, sequence: this._sequence++, resolve, reject,
            });
        });
        this._inFlight.set(url, promise);
        this._pump();
        return promise;
    }

    /** Starts as many queued requests as there are free slots, best rank first. */
    private _pump(): void {
        while (
            this._activeRequests < this._maxConcurrentRequests &&
            this._queued.size > 0
        ) {
            const next = this._takeBest();
            if (!next) return;

            this._activeRequests++;
            this._fetchBytes(next.url, next.path)
                .then(next.resolve, next.reject)
                .finally(() => {
                    this._activeRequests--;
                    this._inFlight.delete(next.url);
                    this._pump();
                });
        }
    }

    /** Removes and returns the best-ranked queued request, FIFO within a rank. */
    private _takeBest(): _QueuedRequest | null {
        let best: _QueuedRequest | null = null;
        for (const request of this._queued.values()) {
            if (
                best === null ||
                request.rank < best.rank ||
                (request.rank === best.rank && request.sequence < best.sequence)
            ) {
                best = request;
            }
        }
        if (best) this._queued.delete(best.url);
        return best;
    }

    private async _fetchBytes(url: string, path: string): Promise<ArrayBuffer> {
        this._requestCount++;
        const response = await this._fetch(url);
        if (!response.ok) {
            throw new Error(
                `[StreamingAssetSource] Fetch failed for "${path}": ${response.status} ${url}`
            );
        }
        const buffer = await response.arrayBuffer();
        this._bytesFetched += buffer.byteLength;
        return buffer;
    }

    /**
     * The most detailed level at or below both the per-asset request and
     * {@link maxLodLevel}.
     */
    private _selectLod(normalizedPath: string): IStreamedAssetLod | null {
        const asset = this._byPath.get(normalizedPath);
        if (!asset) return null;

        const requested = this._desiredLod.get(normalizedPath) ?? Number.POSITIVE_INFINITY;
        const ceiling = Math.min(requested, this.maxLodLevel);

        // Sorted ascending at parse time, so the last one in range is the best
        // one available; falling back to the coarsest keeps a low ceiling usable
        // even for an asset whose only level is above it.
        let chosen = asset.lods[0];
        for (const lod of asset.lods) {
            if (lod.level <= ceiling) chosen = lod;
        }
        return chosen;
    }

    private _resolveUrl(url: string): string {
        if (!this._baseUrl) return url;
        try {
            return new URL(url, this._baseUrl).toString();
        } catch {
            // A relative base (a path on the same origin) is not a valid URL to
            // resolve against; joining textually is the right answer there.
            return this._baseUrl.replace(/[^/]*$/, "") + url;
        }
    }
}
