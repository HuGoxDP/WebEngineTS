// path: src/engine/core/assets/Resources.ts

import { Texture2D } from "../graphics/Texture2D.ts";
import { LoadHandle } from "./LoadHandle.ts";
import { JsonAsset, TextAsset, BinaryAsset } from "./AssetTypes.ts";
import { AudioClip } from "../audio/AudioClip.ts";
import { AudioManager } from "../audio/AudioManager.ts";

import { AssetDatabase } from "./AssetDatabase";

// ==================== ASSET SOURCE INTERFACE ====================

/**
 * Abstraction over where assets are stored.
 * Current implementation: ZIP archive via ScenarioAssets.
 * Future: HTTP fetch, IndexedDB, local filesystem.
 *
 * @internal — Engine-only. Scenario authors use Resources.
 */
export interface AssetReadOptions {
    /**
     * Whether this read is speculative — wanted ahead of time, but nothing is
     * waiting on it.
     *
     * @remarks
     * A source that schedules its own requests uses this to rank them: a
     * speculative read takes the asset's declared manifest priority, while a
     * real one outranks every speculation, because the declared priority is a
     * hint about *preloading* and an actual read is a demand. A source with
     * nothing to schedule — a ZIP, already in memory — ignores it.
     */
    speculative?: boolean;
}

export interface IAssetSource {
    /** Check if a path exists in the source. */
    has(path: string): boolean;

    /** List all paths, optionally filtered by prefix. */
    list(prefix?: string): string[];

    /** Read raw bytes for a path. */
    readBytes(path: string, options?: AssetReadOptions): Promise<Uint8Array>;

    /** Read as UTF-8 text. */
    readText(path: string): Promise<string>;

    /** Get a temporary blob URL (tracked for cleanup). */
    getBlobUrl(path: string): Promise<string>;
}

// ==================== DECODER TYPES ====================

/**
 * Function that decodes raw bytes into a typed asset.
 * @internal
 */
type AssetDecoder<T> = (
    bytes: Uint8Array,
    path: string,
    source: IAssetSource,
) => Promise<T>;

/** @internal */
interface DecoderEntry {
    decoder: AssetDecoder<unknown>;
    extensions: readonly string[];
}

// ==================== CACHE ENTRY ====================

/** @internal */
interface CacheEntry {
    asset: unknown;
    refCount: number;
    sizeEstimate: number;
    /**
     * Estimated GPU bytes, from the asset's own estimator. Zero for an asset
     * that has none — a JSON blob costs heap, not VRAM.
     */
    vramBytes: number;
    /** Monotonic counter, bumped on every load and cache hit, for LRU order. */
    lastUsed: number;
}

/** An asset that can estimate what it costs on the GPU. @internal */
interface VramEstimating {
    _estimateVramBytes(): number;
}

// ==================== RESOURCES ====================

/**
 * Static API for loading assets from the active scenario archive.
 *
 * Provides a Unity-like `Resources.Load<T>(path)` interface adapted
 * for the web platform: async-only, generic via class constructors
 * as type tokens, with reference-counted caching.
 *
 * @remarks
 * Equivalent to a hybrid of Unity's `Resources` and `Addressables`:
 * - Typed loading via class token: `Resources.load(Texture2D, "hero")`
 * - Batch loading with progress: `Resources.loadBatch([...])`
 * - No-extension paths with auto-resolution (tries .png, .jpg, etc.)
 * - Reference counting and explicit release
 *
 * **Lifecycle:** Initialized automatically when a scenario starts.
 * Cleared when the scenario unloads. Scenario authors never call
 * `_setSource` / `_clearSource` directly.
 *
 * @example
 * ```ts
 * import { Resources, Texture2D, GameObject, JsonAsset } from "WebEngineTS";
 *
 * async awake() {
 *     // Load a texture (auto-resolves extension)
 *     const earth = await Resources.load(Texture2D, "textures/earth");
 *
 *     // Load a 3D model
 *     const ship = await Resources.load(GameObject, "models/spaceship");
 *
 *     // Load JSON config
 *     const cfg = await Resources.load(JsonAsset, "data/levels");
 *
 *     // Batch load with progress
 *     const handle = Resources.loadBatch([
 *         [Texture2D, "textures/mars"],
 *         [Texture2D, "textures/jupiter"],
 *         [Texture2D, "textures/saturn"],
 *     ]);
 *     handle.onProgress(p => console.log(`Loading: ${(p*100)|0}%`));
 *     const [mars, jupiter, saturn] = await handle.promise;
 *
 *     // Load all textures in a folder
 *     const allPlanets = await Resources.loadAll(Texture2D, "textures/planets/");
 * }
 *
 * onDestroy() {
 *     // Release specific assets
 *     Resources.release(this._texture);
 *
 *     // Or unload everything not in use
 *     Resources.unloadUnused();
 * }
 * ```
 */
export class Resources {

    // ==================== PRIVATE STATE ====================

    /** The active asset source (set by Scenario on run, cleared on unload). */
    private static _source: IAssetSource | null = null;

    /** Decoder registry: class constructor → decoder function + extensions. */
    private static _decoders: Map<Function, DecoderEntry> = new Map();

    /** Asset cache with reference counting. */
    private static _cache: Map<string, CacheEntry> = new Map();

    /** In-flight requests — prevents duplicate loads of the same asset. */
    private static _inFlight: Map<string, Promise<unknown>> = new Map();

    /** Whether built-in decoders have been registered. */
    private static _initialized: boolean = false;

    /** Monotonic use counter behind the LRU order. */
    private static _useClock: number = 0;

    /**
     * Bumped whenever the active source changes. A load captures it when it
     * starts and checks it when it lands, so an asset decoded for a scenario
     * that has since unloaded is thrown away instead of cached under the next
     * one.
     */
    private static _sourceEpoch: number = 0;

    /**
     * Estimated GPU budget for cached assets, in bytes. `Infinity` — the
     * default — means no budget and no eviction.
     *
     * @remarks
     * When a load pushes the cache over this figure, the least recently used
     * **unreferenced** assets are destroyed until it fits again. Assets still
     * referenced are never evicted: destroying a texture a material is holding
     * would break rendering, not save memory. The budget is therefore a target
     * the engine honours as far as it honestly can, and a scene whose live set
     * alone exceeds it will stay over — {@link estimatedVramBytes} is what says
     * so.
     *
     * The figure is an estimate from the engine's own accounting
     * (`Texture._estimateVramBytes`, `Mesh._estimateVramBytes`), not a driver
     * query: WebGL cannot report real VRAM. It accounts for compressed formats,
     * so a KTX2 texture is charged what it actually costs on the GPU rather
     * than its uncompressed size.
     *
     * @example
     * ```ts
     * // A conservative budget for an integrated GPU.
     * Resources.vramBudgetBytes = 256 * 1024 * 1024;
     * ```
     */
    public static vramBudgetBytes: number = Number.POSITIVE_INFINITY;

    /**
     * When set to a registered extension (e.g. `".ktx2"`), path resolution tries
     * this extension first, before the default order — so a scenario that ships
     * both `foo.jpg` and `foo.ktx2` can switch to the compressed variant at load
     * time without changing any asset paths. `null` = default order.
     *
     * Set before loading. Used e.g. by the benchmark harness's `ktx2` toggle to
     * A/B compressed vs. uncompressed textures from a single archive.
     */
    public static preferExtension: string | null = null;

    // ==================== LIFECYCLE (INTERNAL) ====================

    /**
     * @internal
     * Sets the active asset source. Called by Scenario.run().
     */
    public static _setSource(source: IAssetSource): void {
        Resources._source = source;
        Resources._sourceEpoch++;
        if (!Resources._initialized) {
            Resources._registerBuiltinDecoders();
            Resources._initialized = true;
        }
    }

    /**
     * @internal
     * Clears the active source and cache. Called by Scenario.unload().
     */
    public static _clearSource(): void {
        AssetDatabase.clear();
        Resources._cache.forEach(entry => Resources._destroyAsset(entry.asset));
        Resources._cache.clear();
        Resources._inFlight.clear();
        Resources._source = null;
        Resources._sourceEpoch++;
    }

    /** Whether an asset source is installed and loading can happen. */
    public static get hasSource(): boolean {
        return Resources._source !== null;
    }

    /**
     * @internal
     * The installed asset source, for engine subsystems that need to ask it
     * something `Resources` does not relay — detail levels, say.
     *
     * **NEVER use in user-facing code.**
     */
    public static get _activeSource(): IAssetSource | null {
        return Resources._source;
    }

    /**
     * @internal
     * Every cached texture, with the path it came from and what it costs.
     *
     * @remarks
     * The path is recovered from the cache key, so it is the resolved one —
     * extension included — which is what the asset source indexes by.
     *
     * **NEVER use in user-facing code.**
     */
    public static _cachedTextures(): Array<{ path: string; vramBytes: number }> {
        const out: Array<{ path: string; vramBytes: number }> = [];
        const prefix = `${Texture2D.name}::`;
        for (const [key, entry] of Resources._cache) {
            if (!key.startsWith(prefix)) continue;
            out.push({ path: key.slice(prefix.length), vramBytes: entry.vramBytes });
        }
        return out;
    }

    /**
     * Installs an asset source directly, outside the scenario pipeline.
     *
     * @remarks
     * The host's entry point when assets do not come from a scenario ZIP — a
     * `StreamingAssetSource` built from a manifest, say. Loading a scenario
     * afterwards replaces the source, because a running scenario owns it.
     *
     * Releases whatever was installed before, destroying its cached assets, so
     * switching sources cannot leave the previous scenario's textures alive
     * behind the new one's paths.
     *
     * @param source - where assets are read from.
     *
     * @example
     * ```ts
     * const source = await StreamingAssetSource.fromUrl("/scenarios/solar/scenario.json");
     * AssetDatabase.setManifest(source.assetEntries());
     * Resources.useSource(source);
     * ```
     */
    public static useSource(source: IAssetSource): void {
        if (Resources._source !== null && Resources._source !== source) {
            Resources.releaseSource();
        }
        Resources._setSource(source);
    }

    /**
     * Removes the active source and destroys everything it loaded.
     *
     * @remarks
     * The counterpart to {@link useSource}. Scenario unloading does this on its
     * own; a host that installed a source itself has to say when it is done.
     */
    public static releaseSource(): void {
        Resources._clearSource();
    }

    // ==================== DECODER REGISTRATION ====================

    /**
     * Registers a decoder for an asset type.
     *
     * Built-in decoders (Texture2D, JsonAsset, TextAsset, BinaryAsset)
     * are registered automatically. Use this to add custom types or
     * override built-in decoders.
     *
     * @param type — the class constructor (used as type token).
     * @param extensions — file extensions this type handles (e.g. `[".png", ".jpg"]`).
     * @param decoder — async function that decodes raw bytes into the asset.
     *
     * @example
     * ```ts
     * // Register a custom asset type
     * Resources.registerDecoder(
     *     NavMeshAsset,
     *     [".nav", ".bin"],
     *     async (bytes) => new NavMeshAsset(parseNavMesh(bytes))
     * );
     * ```
     */
    public static registerDecoder<T>(
        type: new (...args: any[]) => T,
        extensions: readonly string[],
        decoder: AssetDecoder<T>,
    ): void {
        Resources._decoders.set(type, {
            decoder: decoder as AssetDecoder<unknown>,
            extensions,
        });
    }

    // ==================== CORE LOADING API ====================

    /**
     * Loads a single asset by type and path.
     *
     * Returns a cached instance if available (incrementing refcount),
     * otherwise decodes from the active asset source.
     *
     * Path follows Unity conventions:
     * - Forward slashes only (`"textures/earth"`, not `"textures\\earth"`)
     * - Extension is optional — auto-resolved from the type's registered extensions
     * - Relative to the archive root (`assets/` prefix is added automatically)
     *
     * @param type — the asset class (e.g. `Texture2D`, `JsonAsset`).
     * @param path — asset path (relative to `assets/`).
     * @returns the loaded and typed asset.
     *
     * @throws Error if no source is active or the asset is not found.
     *
     * @remarks Equivalent to Unity's `Resources.Load<T>(path)`.
     */
    public static async load<T>(
        type: new (...args: any[]) => T,
        path: string,
    ): Promise<T> {
        return Resources._load(type, path, false);
    }

    /**
     * The body of {@link load}, plus whether the read is speculative.
     *
     * Kept private because `speculative` is a scheduling hint between
     * {@link prefetch} and the source, not something a caller chooses: a
     * scenario asking for an asset is by definition demanding it.
     */
    private static async _load<T>(
        type: new (...args: any[]) => T,
        path: string,
        speculative: boolean,
    ): Promise<T> {
        Resources._ensureSource();

        const entry = Resources._getDecoder(type);
        const fullPath = Resources._resolvePath(path, entry.extensions);
        const cacheKey = Resources._cacheKey(type, fullPath);

        // 1. Check cache
        const cached = Resources._cache.get(cacheKey);
        if (cached) {
            cached.refCount++;
            cached.lastUsed = ++Resources._useClock;
            return cached.asset as T;
        }

        // 2. Deduplicate in-flight requests
        if (Resources._inFlight.has(cacheKey)) {
            const asset = await Resources._inFlight.get(cacheKey)!;
            // Bump refcount for this caller
            const ce = Resources._cache.get(cacheKey);
            if (ce) ce.refCount++;
            return asset as T;
        }

        // 3. Load and decode
        //
        // The source and the epoch are captured here, not read again when the
        // bytes arrive: a load is async, and the scenario that asked for it can
        // unload — or be replaced — while it is still in the air. Reading them
        // late meant decoding through whatever source was installed by then, or
        // through `null`.
        const source = Resources._source!;
        const epoch = Resources._sourceEpoch;

        const loadPromise = (async () => {
            const bytes = await source.readBytes(fullPath, { speculative });
            const asset = await entry.decoder(bytes, fullPath, source);

            if (epoch !== Resources._sourceEpoch) {
                // Nothing can use it: its source is gone, and caching it would
                // pin GPU memory under a scenario that never asked for it, at a
                // reference count `unloadUnused` and `evictToBudget` refuse to
                // touch.
                Resources._destroyAsset(asset);
                throw new Error(
                    `[Resources] "${fullPath}" finished loading after its asset ` +
                    `source was released — the result was discarded.`
                );
            }

            Resources._cache.set(cacheKey, {
                asset,
                refCount: 1,
                sizeEstimate: bytes.byteLength,
                vramBytes: Resources._estimateVram(asset),
                lastUsed: ++Resources._useClock,
            });

            // Give the decoded object a stable identity, so a serialized scene
            // can reference it by id rather than by the path it happens to be
            // at today.
            AssetDatabase._bind(fullPath, asset as object);

            // After binding, so an asset that is immediately over budget is
            // still identifiable; before returning, so the caller never sees a
            // cache it has already pushed past the limit.
            Resources.evictToBudget();

            return asset;
        })();

        Resources._inFlight.set(cacheKey, loadPromise);
        try {
            return (await loadPromise) as T;
        } finally {
            // Only if it is still this load's entry — `_clearSource` empties the
            // map, so by now the key may belong to a load the *new* source
            // started for the same path, and deleting that one would let a third
            // caller start a duplicate read.
            if (Resources._inFlight.get(cacheKey) === loadPromise) {
                Resources._inFlight.delete(cacheKey);
            }
        }
    }

    /**
     * Loads a single asset, returning `null` if not found (instead of throwing).
     *
     * This is the recommended method for optional assets where missing files
     * are expected (e.g. normal maps, optional models).
     *
     * @param type — the asset class (e.g. `Texture2D`, `GameObject`).
     * @param path — asset path (relative to `assets/`).
     * @returns the loaded asset, or `null` if not found.
     *
     * @example
     * ```ts
     * const normal = await Resources.tryLoad(Texture2D, "textures/earth_normal");
     * if (normal) mat.normalTexture = normal;
     * ```
     */
    public static async tryLoad<T>(
        type: new (...args: any[]) => T,
        path: string,
    ): Promise<T | null> {
        try {
            return await Resources.load(type, path);
        } catch {
            return null;
        }
    }

    /**
     * Loads all assets of a given type under a path prefix.
     *
     * @param type — the asset class.
     * @param prefix — folder prefix (e.g. `"textures/planets/"`).
     * @returns array of loaded assets.
     *
     * @remarks Equivalent to Unity's `Resources.LoadAll<T>(path)`.
     *
     * @example
     * ```ts
     * const allPlanets = await Resources.loadAll(Texture2D, "textures/planets/");
     * ```
     */
    public static async loadAll<T>(
        type: new (...args: any[]) => T,
        prefix: string,
    ): Promise<T[]> {
        Resources._ensureSource();

        const entry = Resources._getDecoder(type);
        const extSet = new Set(entry.extensions.map(e => e.toLowerCase()));

        // Prefix with assets/ for source lookup
        const sourcePrefix = prefix.startsWith("assets/") ? prefix : `assets/${prefix}`;
        const allPaths = Resources._source!.list(sourcePrefix);

        // Filter by matching extensions
        const matching = allPaths.filter(p => {
            const ext = Resources._extname(p).toLowerCase();
            return extSet.has(ext);
        });

        return Promise.all(
            matching.map(p => {
                // Remove "assets/" prefix for the load() call
                const loadPath = p.startsWith("assets/") ? p.slice(7) : p;
                return Resources.load(type, loadPath);
            })
        );
    }

    /**
     * Loads an asset with a progress-tracking handle.
     *
     * @param type — the asset class.
     * @param path — asset path.
     * @returns a {@link LoadHandle} with progress callbacks.
     *
     * @remarks Equivalent to Unity's `Resources.LoadAsync<T>(path)`.
     *
     * @example
     * ```ts
     * const handle = Resources.loadAsync(Texture2D, "textures/boss");
     * handle.onProgress(p => loadingBar.fillAmount = p);
     * const boss = await handle.promise;
     * ```
     */
    public static loadAsync<T>(
        type: new (...args: any[]) => T,
        path: string,
    ): LoadHandle<T> {
        return new LoadHandle<T>((reportProgress, resolve, reject) => {
            reportProgress(0);

            Resources.load(type, path)
                .then(asset => {
                    reportProgress(1);
                    resolve(asset);
                })
                .catch(reject);
        });
    }

    /**
     * Loads multiple assets in parallel with aggregate progress tracking.
     *
     * @param requests — array of `[Type, path]` tuples.
     * @returns a {@link LoadHandle} that resolves to an array of assets.
     *
     * @example
     * ```ts
     * const handle = Resources.loadBatch([
     *     [Texture2D, "textures/earth"],
     *     [Texture2D, "textures/mars"],
     *     [Texture2D, "textures/jupiter"],
     * ]);
     * handle.onProgress(p => console.log(`${(p * 100) | 0}%`));
     * const [earth, mars, jupiter] = await handle.promise;
     * ```
     */
    public static loadBatch(
        requests: Array<[new (...args: any[]) => any, string]>,
    ): LoadHandle<unknown[]> {
        return new LoadHandle<unknown[]>((reportProgress, resolve, reject) => {
            const total = requests.length;
            if (total === 0) { resolve([]); return; }

            let completed = 0;
            const results: unknown[] = new Array(total);

            Promise.all(
                requests.map(([type, path], i) =>
                    Resources.load(type, path).then(asset => {
                        results[i] = asset;
                        completed++;
                        reportProgress(completed / total);
                    })
                )
            ).then(() => resolve(results)).catch(reject);
        });
    }

    /**
     * Re-decodes a cached asset from its source, in place.
     *
     * @param type — the asset class it was loaded as.
     * @param path — asset path (relative to `assets/`).
     * @returns the **same** instance, now carrying the freshly read content.
     *
     * @throws if the asset is not cached, or if its type cannot be updated in
     *         place.
     *
     * @remarks
     * The point is that the instance does not change: every material, component
     * and field already holding the texture keeps working and shows the new
     * content. That is what makes a streamed detail-level upgrade expressible —
     * change the level on the source, reload, and the scene follows.
     *
     * Refusing types that cannot adopt is deliberate. Replacing the cache entry
     * instead would leave every existing reference pointing at the old content,
     * which is worse than an error because it looks like it worked. Today
     * {@link Texture2D} is the type that can; the rest have no detail levels to
     * upgrade between.
     *
     * The reference count is untouched — this reloads an asset, it does not
     * hand out another claim on it. Concurrent reloads of one path are not
     * deduplicated; the last to finish wins.
     *
     * @example
     * ```ts
     * source.setLodLevel("textures/terrain.ktx2", 2);
     * await Resources.reload(Texture2D, "textures/terrain.ktx2");
     * // every material using it now draws level 2
     * ```
     */
    public static async reload<T>(
        type: new (...args: any[]) => T,
        path: string,
    ): Promise<T> {
        Resources._ensureSource();

        const entry = Resources._getDecoder(type);
        const fullPath = Resources._resolvePath(path, entry.extensions);
        const cacheKey = Resources._cacheKey(type, fullPath);

        const cached = Resources._cache.get(cacheKey);
        if (!cached) {
            throw new Error(
                `[Resources] Cannot reload "${fullPath}" — it is not loaded. ` +
                `Use Resources.load() first.`
            );
        }

        if (!(cached.asset instanceof Texture2D)) {
            throw new Error(
                `[Resources] "${type.name}" cannot be reloaded in place. ` +
                `Only assets that can adopt new content without changing identity ` +
                `support this; everything else would leave existing references ` +
                `pointing at the old content.`
            );
        }

        const bytes = await Resources._source!.readBytes(fullPath);
        const fresh = await entry.decoder(bytes, fullPath, Resources._source!);

        if (!(fresh instanceof Texture2D)) {
            throw new Error(
                `[Resources] Reloading "${fullPath}" produced a ${typeof fresh}, ` +
                `not a Texture2D — the decoder for "${type.name}" changed under it.`
            );
        }

        // The freshly decoded shell is deliberately not destroyed: its Three.js
        // texture now belongs to the cached instance, and destroying the shell
        // would dispose the very resource that was just handed over.
        cached.asset._adoptThreeTexture(
            fresh._internalThreeTexture, fresh.width, fresh.height,
        );

        cached.sizeEstimate = bytes.byteLength;
        cached.vramBytes = Resources._estimateVram(cached.asset);
        cached.lastUsed = ++Resources._useClock;
        Resources.evictToBudget();

        return cached.asset as T;
    }

    /**
     * Warms the cache for a set of paths without claiming the assets.
     *
     * Each path's decoder is chosen by extension, so no type token is needed —
     * which is what lets a manifest's asset list be preloaded directly.
     *
     * @param paths — asset paths, with or without the `assets/` prefix.
     * @param options — concurrency cap and progress callback.
     * @returns how many assets were successfully warmed.
     *
     * @remarks
     * **A prefetch is not a use.** Each asset's own reference is released again
     * once decoded, so it sits in the cache at zero references: a later
     * {@link load} finds it warm, and {@link unloadUnused} can still reclaim it
     * if nothing ever asked. Preloading would otherwise pin every optimistically
     * fetched asset for the lifetime of the scenario.
     *
     * Failures are per-asset, not per-batch — the same reason {@link tryLoad}
     * exists. One missing texture must not cancel the other forty.
     *
     * Paths are fetched in the order given, `concurrency` at a time. That order
     * is the caller's; the priority *queue* that reorders in-flight work, and
     * `lazy` handling, are Stage 2 of `design/asset-streaming-proposal.md`.
     *
     * @example
     * ```ts
     * // Warm everything the first frame needs before building the scene.
     * await Resources.prefetch(source.pathsByPriority(AssetPriority.Critical));
     * ```
     */
    public static async prefetch(
        paths: readonly string[],
        options: {
            /** Maximum simultaneous loads. Defaults to 6. */
            concurrency?: number;
            /** Called after each path settles, successfully or not. */
            onProgress?: (completed: number, total: number) => void;
        } = {},
    ): Promise<number> {
        Resources._ensureSource();

        const total = paths.length;
        if (total === 0) return 0;

        const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, total));
        let next = 0;
        let completed = 0;
        let warmed = 0;

        const worker = async (): Promise<void> => {
            while (next < total) {
                // A background prefetch outlives nothing: if the scenario that
                // asked for it unloaded, stop rather than failing per asset.
                if (!Resources.hasSource) return;

                const path = paths[next++];
                const type = Resources._decoderTypeForPath(path);

                if (type === null) {
                    console.warn(
                        `[Resources] Prefetch skipped "${path}" — no decoder is ` +
                        `registered for its extension.`
                    );
                } else {
                    try {
                        // Speculative: nothing is waiting on it, so a source
                        // that schedules its own requests may rank it behind
                        // anything the scenario actually asks for.
                        await Resources._load(type, path, true);
                        Resources.releaseByPath(type, path);
                        warmed++;
                    } catch (error) {
                        console.warn(`[Resources] Prefetch failed for "${path}":`, error);
                    }
                }

                completed++;
                options.onProgress?.(completed, total);
            }
        };

        await Promise.all(Array.from({ length: concurrency }, worker));
        return warmed;
    }

    // ==================== MEMORY MANAGEMENT ====================

    /**
     * Decrements the reference count of a loaded asset.
     *
     * The asset is not immediately destroyed — it stays in cache
     * until {@link unloadUnused} is called. This matches Unity's
     * `Addressables.Release()` behavior.
     *
     * @param asset — the asset to release.
     *
     * @remarks Equivalent to Unity's `Addressables.Release(handle)`.
     */
    public static release(asset: unknown): void {
        for (const [, entry] of Resources._cache) {
            if (entry.asset === asset) {
                entry.refCount = Math.max(0, entry.refCount - 1);
                Resources._evictIfBudgeted(entry);
                return;
            }
        }
    }

    /**
     * Releases an asset by type and path.
     * More efficient than {@link release} if you track paths.
     */
    public static releaseByPath<T>(
        type: new (...args: any[]) => T,
        path: string,
    ): void {
        const entry = Resources._decoders.get(type);
        if (!entry) return;
        const fullPath = Resources._resolvePath(path, entry.extensions);
        const cacheKey = Resources._cacheKey(type, fullPath);
        const cached = Resources._cache.get(cacheKey);
        if (cached) {
            cached.refCount = Math.max(0, cached.refCount - 1);
            Resources._evictIfBudgeted(cached);
        }
    }

    /**
     * Estimated GPU bytes held by everything currently cached.
     *
     * @remarks
     * The engine's own accounting, not a driver query — WebGL cannot report
     * real VRAM. Assets with no GPU footprint (JSON, text) contribute nothing.
     * Compare against {@link vramBudgetBytes} to see whether the live set alone
     * is over budget, which is the case eviction cannot fix.
     */
    public static get estimatedVramBytes(): number {
        let total = 0;
        for (const entry of Resources._cache.values()) total += entry.vramBytes;
        return total;
    }

    /**
     * Estimated GPU bytes held by assets nothing is referencing.
     *
     * @remarks
     * How much {@link evictToBudget} could reclaim if it had to. The difference
     * between this and {@link estimatedVramBytes} is the live set — the floor
     * no budget can push below.
     */
    public static get evictableVramBytes(): number {
        let total = 0;
        for (const entry of Resources._cache.values()) {
            if (entry.refCount <= 0) total += entry.vramBytes;
        }
        return total;
    }

    /**
     * Destroys least-recently-used unreferenced assets until the cache fits
     * {@link vramBudgetBytes}.
     *
     * Called automatically after each load when a budget is set; call it
     * directly to reclaim at a moment of your choosing — after a scene
     * transition, say, when a lot has just become unreferenced.
     *
     * @returns the estimated GPU bytes reclaimed.
     *
     * @remarks
     * **Referenced assets are never evicted.** Destroying a texture a material
     * is holding would break rendering rather than save memory, so an over-budget
     * live set stays over budget. Least-recently-used counts a cache hit as a
     * use, so an asset loaded once at startup and never asked for again is
     * evicted before one the scene keeps re-requesting.
     */
    public static evictToBudget(): number {
        const budget = Resources.vramBudgetBytes;
        if (!Number.isFinite(budget) || budget < 0) return 0;

        let current = Resources.estimatedVramBytes;
        if (current <= budget) return 0;

        // Oldest first, and only what nothing is holding.
        const candidates = [...Resources._cache.entries()]
            .filter(([, entry]) => entry.refCount <= 0 && entry.vramBytes > 0)
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

        let freed = 0;
        for (const [key, entry] of candidates) {
            if (current <= budget) break;
            Resources._destroyAsset(entry.asset);
            Resources._cache.delete(key);
            current -= entry.vramBytes;
            freed += entry.vramBytes;
        }

        if (freed > 0) {
            console.log(
                `[Resources] Evicted ~${(freed / 1048576).toFixed(1)} MB of estimated VRAM ` +
                `to fit a ${(budget / 1048576).toFixed(1)} MB budget.`
            );
        }
        return freed;
    }

    /**
     * Destroys and removes all assets with zero references.
     *
     * @returns the number of assets unloaded.
     *
     * @remarks Equivalent to Unity's `Resources.UnloadUnusedAssets()`.
     */
    public static unloadUnused(): number {
        let freed = 0;
        for (const [key, entry] of Resources._cache) {
            if (entry.refCount <= 0) {
                Resources._destroyAsset(entry.asset);
                Resources._cache.delete(key);
                freed++;
            }
        }
        if (freed > 0) {
            console.log(`[Resources] Unloaded ${freed} unused assets`);
        }
        return freed;
    }

    /**
     * Releases the CPU-side source image of every cached texture (`Texture2D`,
     * `Cubemap`), freeing decoded pixel data once it has been uploaded to the GPU.
     * The per-texture two-frame upload countdown still applies, so this is safe to
     * call right after loading.
     *
     * @returns the number of textures whose source image was released.
     *
     * @remarks
     * Frees heap/native memory held by decoded images without touching VRAM —
     * useful once a scenario has finished loading and no texture needs re-reading
     * on the CPU.
     */
    public static releaseAllSourceImages(): number {
        let released = 0;
        for (const entry of Resources._cache.values()) {
            const asset = entry.asset as { releaseSourceImage?: () => void };
            if (typeof asset?.releaseSourceImage === "function") {
                asset.releaseSourceImage();
                released++;
            }
        }
        return released;
    }

    /**
     * Checks if an asset path exists in the active source.
     *
     * @param path — path relative to `assets/`.
     */
    public static exists(path: string): boolean {
        if (!Resources._source) return false;
        const fullPath = path.startsWith("assets/") ? path : `assets/${path}`;
        return Resources._source.has(fullPath);
    }

    /**
     * Returns a blob URL for a raw asset. Useful for Cubemap/Skybox loading.
     *
     * @param path — path relative to `assets/`.
     * @returns a blob URL string.
     */
    public static async getUrl(path: string): Promise<string> {
        Resources._ensureSource();
        const fullPath = path.startsWith("assets/") ? path : `assets/${path}`;
        return Resources._source!.getBlobUrl(fullPath);
    }

    // ==================== DIAGNOSTICS ====================

    /** Number of cached assets. */
    public static get cacheSize(): number {
        return Resources._cache.size;
    }

    /** Total estimated memory usage of cached assets in bytes. */
    public static get estimatedMemory(): number {
        let total = 0;
        for (const entry of Resources._cache.values()) {
            total += entry.sizeEstimate;
        }
        return total;
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Runs eviction after a reference was dropped.
     *
     * Dropping the last reference is the moment a new eviction candidate
     * appears, so it is the moment worth re-checking the budget — waiting for
     * the next load would keep a prefetched asset alive one load too long.
     * Costs nothing when no budget is set.
     */
    private static _evictIfBudgeted(entry: CacheEntry): void {
        if (entry.refCount > 0) return;
        if (!Number.isFinite(Resources.vramBudgetBytes)) return;
        Resources.evictToBudget();
    }

    /** What an asset costs on the GPU, or 0 when it has no opinion. */
    private static _estimateVram(asset: unknown): number {
        const estimator = (asset as VramEstimating | null)?._estimateVramBytes;
        if (typeof estimator !== "function") return 0;
        try {
            const bytes = estimator.call(asset);
            return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
        } catch {
            // An estimate is diagnostics, not correctness — a decoder whose
            // asset cannot measure itself must still load.
            return 0;
        }
    }

    /** Destroys an asset if it knows how, and drops its identity binding. */
    private static _destroyAsset(asset: unknown): void {
        // Before destroying: AssetDatabase maps a guid to the live instance, and
        // a destroyed one left in that map makes `isLoaded` report memory that
        // is gone and `get` hand back a disposed object.
        AssetDatabase._unbind(asset as object);

        const destroy = (asset as { destroy?: () => void } | null)?.destroy;
        if (typeof destroy === "function") destroy.call(asset);
    }

    /** Throws if no source is set. */
    private static _ensureSource(): void {
        if (!Resources._source) {
            throw new Error(
                "[Resources] No asset source is active. " +
                "Resources are available inside scenario lifecycle methods (awake, start, update)."
            );
        }
    }

    /** Returns the decoder entry for a type, or throws. */
    private static _getDecoder(type: Function): DecoderEntry {
        const entry = Resources._decoders.get(type);
        if (!entry) {
            throw new Error(
                `[Resources] No decoder registered for type "${type.name}". ` +
                `Use Resources.registerDecoder() to add support.`
            );
        }
        return entry;
    }

    /**
     * Resolves a path by trying each registered extension.
     * If the path already has a matching extension, uses it directly.
     * Otherwise tries each extension in order (Unity-like convention).
     */
    private static _resolvePath(path: string, extensions: readonly string[]): string {
        // Always prefix with assets/ for source lookups
        const basePath = path.startsWith("assets/") ? path : `assets/${path}`;

        // If path already has a matching extension, check directly
        const currentExt = Resources._extname(basePath).toLowerCase();
        if (extensions.some(e => e.toLowerCase() === currentExt)) {
            if (Resources._source!.has(basePath)) return basePath;
        }

        // Preferred-extension override (e.g. ".ktx2"): try it first if registered
        // and present, so a dual-format archive can switch variants at load time.
        const prefer = Resources.preferExtension;
        if (prefer && extensions.some(e => e.toLowerCase() === prefer.toLowerCase())) {
            const preferred = basePath + prefer;
            if (Resources._source!.has(preferred)) return preferred;
        }

        // Try each registered extension (no-extension convention)
        for (const ext of extensions) {
            const candidate = basePath + ext;
            if (Resources._source!.has(candidate)) return candidate;
        }

        // Fallback to exact path (will error at readBytes if missing)
        return basePath;
    }

    /**
     * The asset type whose decoder claims a path's extension.
     *
     * When two decoders claim one extension the most recently registered wins,
     * which is also how {@link registerDecoder} lets a custom decoder override
     * a built-in one.
     */
    private static _decoderTypeForPath(path: string): (new (...args: any[]) => unknown) | null {
        const ext = Resources._extname(path).toLowerCase();
        if (ext === "") return null;

        let match: Function | null = null;
        for (const [type, entry] of Resources._decoders) {
            if (entry.extensions.some(e => e.toLowerCase() === ext)) match = type;
        }
        return match as (new (...args: any[]) => unknown) | null;
    }

    /** Extracts file extension (including dot). */
    private static _extname(path: string): string {
        const dot = path.lastIndexOf(".");
        const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        return dot > slash ? path.slice(dot) : "";
    }

    /** Builds a cache key: "TypeName::fullPath". */
    private static _cacheKey(type: Function, fullPath: string): string {
        return `${type.name}::${fullPath}`;
    }

    // ==================== BUILT-IN DECODERS ====================

    /**
     * @internal
     * Registers decoders for all built-in asset types.
     * Called once on first _setSource().
     */
    private static _registerBuiltinDecoders(): void {
        // ── Texture2D ──
        Resources.registerDecoder(
            Texture2D,
            [".png", ".jpg", ".jpeg", ".webp", ".gif", ".ktx2"],
            async (bytes: Uint8Array, path: string) => {
                const ab = bytes.slice().buffer;
                if (path.endsWith(".ktx2")) {
                    return Texture2D.fromKTX2ArrayBuffer(ab);
                }
                return Texture2D.fromArrayBuffer(ab);
            },
        );

        // ── JsonAsset ──
        Resources.registerDecoder(
            JsonAsset,
            [".json"],
            async (bytes: Uint8Array) => {
                const text = new TextDecoder().decode(bytes);
                const data = JSON.parse(text);
                const asset = new JsonAsset(data);
                asset.name = "JsonAsset";
                return asset;
            },
        );

        // ── TextAsset ──
        Resources.registerDecoder(
            TextAsset,
            [".txt", ".csv", ".xml", ".html", ".md", ".yaml", ".yml"],
            async (bytes: Uint8Array) => {
                const text = new TextDecoder().decode(bytes);
                const asset = new TextAsset(text);
                asset.name = "TextAsset";
                return asset;
            },
        );

        // ── BinaryAsset ──
        Resources.registerDecoder(
            BinaryAsset,
            [".bin", ".dat", ".bytes"],
            async (bytes: Uint8Array) => {
                const asset = new BinaryAsset(new Uint8Array(bytes));
                asset.name = "BinaryAsset";
                return asset;
            },
        );

        // ── AudioClip ──
        Resources.registerDecoder(
            AudioClip,
            [".mp3", ".ogg", ".wav", ".webm", ".flac"],
            async (bytes: Uint8Array, path: string) => {
                const ctx = AudioManager.context;
                const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                const buffer = await ctx.decodeAudioData(ab as ArrayBuffer);
                const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
                return new AudioClip(buffer, name);
            },
        );

        // NOTE: GameObject (model) decoder is registered by ScenarioAssets
        // because it requires Three.js GLTFLoader (engine-internal).
    }

    // ==================== PRIVATE CONSTRUCTOR ====================

    /** @internal Static-only class. */
    private constructor() {}
}