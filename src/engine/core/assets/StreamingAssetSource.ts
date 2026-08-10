import type { IAssetSource } from "./Resources";
import {
    AssetPriority, normalizeAssetPath, parseStreamingManifest,
} from "./StreamingManifest";
import type { IStreamedAsset, IStreamedAssetLod, IStreamingManifest } from "./StreamingManifest";
import type { IScenarioAssetEntry } from "../scenario/ScenarioTypes";

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
 * **What this stage does and does not do.** The manifest's LOD lists are read
 * and indexed, and {@link maxLodLevel} selects which one a read returns — but
 * nothing yet *upgrades* an asset from one level to the next as the camera
 * approaches; that is Stage 3. Priorities are parsed and exposed and nothing
 * orders fetches by them yet; that is Stage 2. Both are recorded rather than
 * invented later so a manifest written today stays correct.
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
    private readonly _fetch: FetchLike;
    private readonly _baseUrl: string | undefined;

    /** In-flight fetches by resolved URL, so a repeated read is one request. */
    private readonly _inFlight: Map<string, Promise<ArrayBuffer>> = new Map();

    private readonly _blobUrls: string[] = [];

    private _bytesFetched: number = 0;
    private _requestCount: number = 0;

    /**
     * Highest detail level a read may return.
     *
     * @remarks
     * `Infinity` — the default — means the best level the manifest offers,
     * which is what makes this source behave like the ZIP it replaces. Lower it
     * to cap quality globally: a stand-in for the per-asset, per-frame budget
     * Stage 3 will bring, and useful on its own for a low-memory device.
     */
    public maxLodLevel: number = Number.POSITIVE_INFINITY;

    constructor(manifest: IStreamingManifest, options: StreamingAssetSourceOptions = {}) {
        this._manifest = manifest;
        this._baseUrl = options.baseUrl ?? manifest.baseUrl;
        this._fetch = options.fetch ?? ((url: string) => globalThis.fetch(url));

        for (const asset of manifest.assets) {
            this._byPath.set(asset.path, asset);
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
    public async readBytes(path: string): Promise<Uint8Array> {
        return new Uint8Array(await this._read(path));
    }

    /** @internal */
    public async readText(path: string): Promise<string> {
        return new TextDecoder().decode(await this._read(path));
    }

    /** @internal */
    public async getBlobUrl(path: string): Promise<string> {
        const bytes = await this._read(path);
        const blob = new Blob([bytes], { type: StreamingAssetSource._mimeType(path) });
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

    private async _read(path: string): Promise<ArrayBuffer> {
        const normalized = normalizeAssetPath(path);
        const lod = this._selectLod(normalized);
        if (!lod) {
            throw new Error(`[StreamingAssetSource] Not in the manifest: ${normalized}`);
        }

        const url = this._resolveUrl(lod.url);
        const pending = this._inFlight.get(url);
        if (pending) return pending;

        const request = this._fetchBytes(url, normalized);
        this._inFlight.set(url, request);
        try {
            return await request;
        } finally {
            this._inFlight.delete(url);
        }
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

    /** The most detailed level at or below {@link maxLodLevel}. */
    private _selectLod(normalizedPath: string): IStreamedAssetLod | null {
        const asset = this._byPath.get(normalizedPath);
        if (!asset) return null;

        // Sorted ascending at parse time, so the last one in range is the best
        // one available; falling back to the coarsest keeps a low cap usable
        // even for an asset whose only level is above it.
        let chosen = asset.lods[0];
        for (const lod of asset.lods) {
            if (lod.level <= this.maxLodLevel) chosen = lod;
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

    private static _mimeType(path: string): string {
        const dot = path.lastIndexOf(".");
        switch (dot < 0 ? "" : path.slice(dot).toLowerCase()) {
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".ktx2": return "image/ktx2";
            case ".json": return "application/json";
            case ".js": return "text/javascript";
            case ".glb": return "model/gltf-binary";
            case ".gltf": return "model/gltf+json";
            case ".mp3": return "audio/mpeg";
            case ".ogg": return "audio/ogg";
            case ".wav": return "audio/wav";
            default: return "application/octet-stream";
        }
    }
}
