// path: src/engine/core/scenario/Scenario.ts

import JSZip from "jszip";
import { EngineObject } from "../EngineObject.ts";
import { ScenarioAssets } from "./ScenarioAssets.ts";
import { SceneManager } from "../SceneManager.ts";
import { ScenarioBehaviour } from "./ScenarioBehaviour.ts";
import type {
    IScenarioManifest,
    IScenarioContext,
    IScenarioLoadProgress,
    IScenarioScriptSource,
} from "./ScenarioTypes.ts";
import { ScenarioLoadState } from "./ScenarioTypes.ts";
import { Resources, type IAssetSource } from "../assets/Resources.ts";
import { ZipAssetSource } from "../assets/ZipAssetSource.ts";
import { StreamingAssetSource } from "../assets/StreamingAssetSource.ts";
import type { StreamingAssetSourceOptions } from "../assets/StreamingAssetSource.ts";
import { AssetPriority, toScenarioManifest } from "../assets/StreamingManifest.ts";
/**
 * Regex to match ES module import/export specifiers.
 *
 * Captures relative specifiers (starting with `./ or ../`) from:
 * - `import { X } from "./path"`
 * - `import X from "./path"`
 * - `import "./path"` (side-effect)
 * - `export { X } from "./path"`
 * - `export * from "./path"`
 *
 * Group 1 = the full `from "..."` or just `import "..."` portion with quotes.
 * Group 2 = the relative specifier itself (without quotes).
 *
 * @internal
 */
const _RELATIVE_IMPORT_RE =
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+|)(["'])(\.\.?\/[^"']+)\1/g;

/**
 * A loaded scenario instance.
 *
 * Manages the full lifecycle: download → parse → execute entry point →
 * teardown → release resources.
 *
 * Equivalent to Unity's AssetBundle — lives in RAM and is cleaned up
 * completely when unloaded, leaving no leaked textures, blob URLs,
 * GameObjects, or Scenes.
 *
 * **Two content shapes, one loader.** A scenario is either a ZIP archive
 * parsed in memory ({@link loadFromData}) or a streaming manifest whose
 * scripts and assets are fetched individually ({@link loadFromManifestUrl}).
 * They differ only in where bytes come from: the pre-linking, the context the
 * entry point receives and every `Resources` call from scenario code are the
 * same either way.
 *
 * **Script execution & import resolution:**
 * A scenario's scripts are pre-compiled ES modules (.js). Before execution,
 * the engine pre-links ALL of them:
 * 1. Enumerates all `.js` files.
 * 2. Builds a dependency graph from relative imports.
 * 3. Processes files in dependency order (leaves first).
 * 4. Rewrites relative import specifiers to Blob URLs.
 * 5. Creates Blob URLs from rewritten code.
 *
 * This means scenario authors write **standard ES imports** between
 * their modules — the engine handles the Blob URL indirection transparently.
 *
 * Bare specifiers like `from "WebEngineTS"` are resolved by the host
 * page's import map and are NOT rewritten.
 *
 * @example
 * ```ts
 * // Scenario author writes normal imports:
 * import { ScenarioBehaviour } from "WebEngineTS";
 * import { CameraOrbit } from "./components/CameraOrbit";
 * import { createPlanet } from "./helpers/PlanetFactory";
 *
 * export default class MyScenario extends ScenarioBehaviour { ... }
 * ```
 *
 * @example
 * ```ts
 * // Angular host — loading a scenario:
 * const response = await fetch("/scenarios/demo.zip");
 * const data = await response.arrayBuffer();
 *
 * const scenario = await Scenario.loadFromBuffer(data);
 * await scenario.run();
 *
 * // Later, to stop:
 * scenario.unload();
 * ```
 */
export class Scenario extends EngineObject {

    // ==================== STATIC ====================

    /** The currently active scenario (only one can be active at a time). */
    private static _current: Scenario | null = null;

    /** Returns the currently running scenario, or null. */
    public static get current(): Scenario | null {
        return Scenario._current;
    }

    // ==================== INSTANCE STATE ====================

    /** Parsed manifest — from the ZIP root, or converted from a streaming one. */
    private _manifest: IScenarioManifest | null = null;

    /** Where script modules are read from. Null until loaded, and after unload. */
    private _scripts: IScenarioScriptSource | null = null;

    /**
     * The streaming source, when this scenario came from a manifest.
     *
     * Null for a ZIP, which is what switches off progressive loading: an
     * archive is already in memory, so there is nothing to defer.
     */
    private _streaming: StreamingAssetSource | null = null;

    /** When {@link run} began, for {@link timeToFirstFrame}. */
    private _runStartTime: number = 0;

    /** Milliseconds from {@link run} to the first rendered frame; -1 until then. */
    private _timeToFirstFrame: number = -1;

    /** Whether the post-first-frame loading pass has been kicked off. */
    private _deferredLoadStarted: boolean = false;

    /** Current lifecycle state. */
    private _loadState: ScenarioLoadState = ScenarioLoadState.Unloaded;

    /** Asset provider — loads textures/models from the ZIP. */
    private _assets: ScenarioAssets | null = null;

    /** The entry point instance (extends ScenarioBehaviour). */
    private _entryPoint: ScenarioBehaviour | null = null;

    /** Blob URLs created for script modules — revoked on unload. */
    private _scriptBlobUrls: string[] = [];

    /**
     * Pre-linked script registry: normalized ZIP path → Blob URL.
     * Built by {@link _prelinkAllScripts} before the entry point runs.
     * @internal
     */
    private _scriptBlobUrlMap: Map<string, string> = new Map();

    /** Progress callback. */
    private _onProgressCallback?: (progress: IScenarioLoadProgress) => void;

    // ==================== CONSTRUCTOR ====================

    constructor(name: string = "Scenario") {
        super(name);
    }

    // ==================== PUBLIC PROPERTIES ====================

    /** The scenario manifest (null until loaded). */
    public get manifest(): Readonly<IScenarioManifest> | null {
        return this._manifest;
    }

    /** Current lifecycle state. */
    public get loadState(): ScenarioLoadState {
        return this._loadState;
    }

    /** Whether the scenario is loaded and ready or already running. */
    public get isLoaded(): boolean {
        return this._loadState === ScenarioLoadState.Ready ||
            this._loadState === ScenarioLoadState.Running;
    }

    /** Whether the scenario entry point has been executed. */
    public get isRunning(): boolean {
        return this._loadState === ScenarioLoadState.Running;
    }

    /**
     * The asset provider for this scenario.
     *
     * Available after loading. Scenario authors access this through
     * `this.context.assets` in their ScenarioBehaviour, not directly.
     */
    public get assets(): ScenarioAssets | null {
        return this._assets;
    }

    /**
     * Milliseconds from {@link run} to the first frame that reached the screen,
     * or `-1` before that has happened.
     *
     * @remarks
     * The number progressive loading exists to move: with a manifest, only the
     * scripts and the assets marked `critical` stand between `run()` and the
     * first paint, and everything else is fetched afterwards. Measuring it here
     * rather than in the host means a ZIP run and a streamed run of the same
     * content report it the same way, which is what makes the two comparable.
     */
    public get timeToFirstFrame(): number {
        return this._timeToFirstFrame;
    }

    // ==================== PUBLIC: PROGRESS ====================

    /**
     * Registers a callback to receive loading progress updates.
     *
     * @param callback — called with progress info during load.
     * @returns `this` for chaining.
     */
    public onProgress(callback: (progress: IScenarioLoadProgress) => void): this {
        this._onProgressCallback = callback;
        return this;
    }

    // ==================== PUBLIC: LOADING ====================

    /**
     * Downloads and parses a scenario from a URL.
     *
     * The ZIP is streamed into memory with progress reporting.
     * After parsing, the scenario is in the `Ready` state.
     *
     * @param url — URL to the ZIP archive.
     */
    public async loadFromUrl(url: string): Promise<void> {
        this._updateProgress(ScenarioLoadState.Loading, 0, "Downloading scenario...");

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(
                    `Failed to download scenario: ${response.status} ${response.statusText}`
                );
            }

            const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
            const reader = response.body?.getReader();

            if (!reader) {
                throw new Error("Failed to get response body reader");
            }

            // Stream chunks with progress
            const chunks: Uint8Array[] = [];
            let receivedSize = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                receivedSize += value.length;

                if (totalSize > 0) {
                    const progress = (receivedSize / totalSize) * 0.5; // 0–50% for download
                    this._updateProgress(ScenarioLoadState.Loading, progress, "Downloading...");
                }
            }

            // Merge chunks into a single ArrayBuffer
            const data = new Uint8Array(receivedSize);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.length;
            }

            await this.loadFromData(data.buffer);

        } catch (error) {
            this._updateProgress(ScenarioLoadState.Error, 0, "Download failed", String(error));
            throw error;
        }
    }

    /**
     * Parses a scenario from a raw ArrayBuffer (the ZIP contents).
     *
     * @param data — the ZIP file as an ArrayBuffer.
     */
    public async loadFromData(data: ArrayBuffer): Promise<void> {
        this._updateProgress(ScenarioLoadState.Loading, 0.5, "Parsing ZIP archive...");

        try {
            // Parse ZIP in memory
            const zip = await JSZip.loadAsync(data);
            const source = new ZipAssetSource(zip);

            this._updateProgress(ScenarioLoadState.Loading, 0.6, "Reading manifest...");

            if (!source.has("manifest.json")) {
                throw new Error("manifest.json not found in ZIP archive");
            }

            const manifestJson = await source.readText("manifest.json");
            this._manifest = JSON.parse(manifestJson) as IScenarioManifest;
            Scenario._validateManifest(this._manifest);

            this._updateProgress(ScenarioLoadState.Loading, 0.8, "Preparing assets...");

            this._adopt(source, source);

            this._updateProgress(ScenarioLoadState.Ready, 1, "Ready");

            console.log(
                `[Scenario] Loaded: ${this._manifest.name} v${this._manifest.version}`
            );

        } catch (error) {
            this._updateProgress(ScenarioLoadState.Error, 0, "Failed to parse", String(error));
            throw error;
        }
    }

    /**
     * Loads a scenario from a streaming manifest instead of a ZIP archive.
     *
     * @remarks
     * The manifest-driven counterpart to {@link loadFromData}: scripts and
     * assets are fetched individually by URL rather than unpacked from one
     * archive. Everything after this point is identical — the same pre-linking,
     * the same `context`, the same `Resources` calls from scenario code — which
     * is the property that makes streaming additive rather than a second engine.
     *
     * The manifest must declare `entry` and `scripts`; one that lists only
     * assets describes content with nothing to run, and says so.
     *
     * @param source — a source built from an already-fetched manifest.
     *
     * @example
     * ```ts
     * const source = await StreamingAssetSource.fromUrl("/scenarios/solar/scenario.json");
     * const scenario = new Scenario();
     * await scenario.loadFromManifest(source);
     * await scenario.run();
     * ```
     */
    public async loadFromManifest(source: StreamingAssetSource): Promise<void> {
        this._updateProgress(ScenarioLoadState.Loading, 0.6, "Reading manifest...");

        try {
            this._manifest = toScenarioManifest(source.manifest);
            Scenario._validateManifest(this._manifest);

            this._updateProgress(ScenarioLoadState.Loading, 0.8, "Preparing assets...");

            this._adopt(source, source);
            this._streaming = source;

            this._updateProgress(ScenarioLoadState.Ready, 1, "Ready");

            console.log(
                `[Scenario] Loaded from manifest: ${this._manifest.name} ` +
                `v${this._manifest.version} ` +
                `(${source.listScripts().length} scripts, ${source.manifest.assets.length} assets)`
            );

        } catch (error) {
            this._updateProgress(
                ScenarioLoadState.Error, 0, "Failed to read manifest", String(error),
            );
            throw error;
        }
    }

    /**
     * Fetches a streaming manifest and loads the scenario it describes.
     *
     * @param url — URL of the manifest document (`scenario.json`).
     * @param options — base URL override and fetch implementation.
     */
    public async loadFromManifestUrl(
        url: string,
        options?: StreamingAssetSourceOptions,
    ): Promise<void> {
        this._updateProgress(ScenarioLoadState.Loading, 0.2, "Downloading manifest...");

        let source: StreamingAssetSource;
        try {
            source = await StreamingAssetSource.fromUrl(url, options);
        } catch (error) {
            this._updateProgress(
                ScenarioLoadState.Error, 0, "Manifest download failed", String(error),
            );
            throw error;
        }

        await this.loadFromManifest(source);
    }

    /**
     * Takes ownership of a loaded scenario's byte sources.
     *
     * Shared by both load paths so that the object name, the asset provider and
     * the script source are always established together — a half-adopted
     * scenario would pass `isLoaded` and then fail inside `run()`.
     */
    private _adopt(scripts: IScenarioScriptSource, assets: IAssetSource): void {
        this.name = this._manifest!.name;
        this._scripts = scripts;
        this._assets = new ScenarioAssets(assets);
    }

    // ==================== PUBLIC: EXECUTION ====================

    /**
     * Starts the scenario.
     *
     * 1. Unloads any previously running scenario.
     * 2. Creates a dedicated Scene for this scenario.
     * 3. Pre-links all scripts (rewrites relative imports → Blob URLs).
     * 4. Loads the entry point module.
     * 5. Calls `ScenarioBehaviour._systemInit(context)` (which invokes `awake()`).
     */
    public async run(): Promise<void> {
        if (!this.isLoaded || !this._manifest || !this._scripts) {
            throw new Error(
                "[Scenario] Not loaded. Call loadFromUrl(), loadFromData() or " +
                "loadFromManifestUrl() first."
            );
        }

        if (this.isRunning) {
            console.warn("[Scenario] Already running.");
            return;
        }

        // Unload the previous scenario (if any)
        if (Scenario._current && Scenario._current !== this) {
            Scenario._current.unload();
        }

        Scenario._current = this;
        this._loadState = ScenarioLoadState.Running;
        this._runStartTime = performance.now();
        this._timeToFirstFrame = -1;
        this._deferredLoadStarted = false;

        try {
            // Create a dedicated scene for this scenario
            SceneManager.createScene(this._manifest.name);

            // Pre-link all scripts — rewrites relative imports to Blob URLs
            await this._prelinkAllScripts();

            // Activate asset source for Resources API
            this._assets!._activateAsResourceSource(this._manifest.assets);

            // Warm what the first frame needs, before the entry point asks for
            // it — so awake()'s own loads hit a cache instead of the network.
            await this._preloadCriticalAssets();

            // Build the context that the entry point receives
            const context = this._createContext();

            // Load and instantiate the entry point
            this._entryPoint = await this._loadEntryPoint();

            // Awake — the scenario builds its world here (may be async)
            await this._entryPoint._systemInit(context);

            console.log(`[Scenario] Running: ${this._manifest.name}`);

        } catch (error) {
            this._loadState = ScenarioLoadState.Error;
            console.error("[Scenario] Failed to run:", error);
            throw error;
        }
    }

    /**
     * @internal — called by the game loop.
     */
    public _onFixedUpdate(): void {
        if (this._entryPoint) {
            this._entryPoint._systemFixedUpdate();
        }
    }

    /**
     * @internal — called by the game loop.
     */
    public _onUpdate(): void {
        if (this._entryPoint) {
            this._entryPoint._systemUpdate();
        }
    }

    /**
     * @internal — called by the game loop.
     */
    public _onLateUpdate(): void {
        if (this._entryPoint) {
            this._entryPoint._systemLateUpdate();
        }
    }

    /**
     * @internal — called by the game loop after a frame has been drawn.
     *
     * Idempotent: only the first call does anything. The loop reports every
     * frame and the decision of what "first" means lives here, so the loop
     * stays free of scenario state.
     */
    public _onFrameRendered(): void {
        if (this._timeToFirstFrame >= 0) return;

        this._timeToFirstFrame = performance.now() - this._runStartTime;
        this._startDeferredLoading();
    }

    // ==================== PRIVATE: PROGRESSIVE LOADING ====================

    /**
     * Loads the assets marked `critical` before the entry point runs.
     *
     * @remarks
     * Only streamed scenarios have anything to do here: a ZIP is already in
     * memory, so its assets cost a decompression whenever they are asked for
     * and nothing is gained by asking earlier.
     */
    private async _preloadCriticalAssets(): Promise<void> {
        if (!this._streaming) return;

        const paths = this._streaming.pathsByPriority(AssetPriority.Critical);
        if (paths.length === 0) return;

        this._reportProgress(0, `Loading ${paths.length} critical asset(s)...`);

        const warmed = await Resources.prefetch(paths, {
            onProgress: (completed, total) => this._reportProgress(
                completed / total, `Loading critical assets (${completed}/${total})...`,
            ),
        });

        console.log(`[Scenario] Critical assets ready: ${warmed}/${paths.length}`);
    }

    /**
     * Starts fetching everything that was deferred past the first frame.
     *
     * @remarks
     * Fire-and-forget by design: the scene is already on screen and correct
     * without these, so a failure degrades quality rather than breaking the
     * run — which is why it logs instead of throwing.
     *
     * `lazy` assets are deliberately excluded. They are the ones declared as
     * "fetch only if something actually asks", and reading one already fetches
     * it; preloading them here would make the declaration meaningless.
     */
    private _startDeferredLoading(): void {
        if (this._deferredLoadStarted || !this._streaming) return;
        this._deferredLoadStarted = true;

        const paths = [
            ...this._streaming.pathsByPriority(AssetPriority.High),
            ...this._streaming.pathsByPriority(AssetPriority.Low),
        ];
        if (paths.length === 0) return;

        console.log(
            `[Scenario] First frame at ${this._timeToFirstFrame.toFixed(1)} ms; ` +
            `loading ${paths.length} deferred asset(s).`
        );

        void Resources.prefetch(paths)
            .then(warmed => console.log(
                `[Scenario] Deferred assets ready: ${warmed}/${paths.length}`
            ))
            .catch(error => console.warn("[Scenario] Deferred loading failed:", error));
    }

    // ==================== PUBLIC: UNLOADING ====================

    /**
     * Unloads the scenario and releases **all** resources.
     *
     * Cleanup order:
     * 1. Call `ScenarioBehaviour._systemDestroy()` (invokes `onDestroy()`).
     * 2. Destroy the scenario's Scene (destroys all GameObjects).
     * 3. Dispose ScenarioAssets (textures, models, blob URLs).
     * 4. Revoke script blob URLs.
     * 5. Release the manifest and the script source.
     */
    public unload(): void {
        if (this._loadState === ScenarioLoadState.Unloaded) return;

        console.log(`[Scenario] Unloading: ${this.name}`);

        // 1. Entry point teardown
        if (this._entryPoint) {
            try {
                this._entryPoint._systemDestroy();
            } catch (error) {
                console.error("[Scenario] Error in onDestroy:", error);
            }
        }
        this._entryPoint = null;

        // 2. Destroy the scenario's scene (all GameObjects, Three.js objects)
        const scene = SceneManager.getSceneByName(this.name);
        if (scene) {
            scene.destroy();
        }

        // 3. Dispose asset provider (textures, models, blob URLs)
        if (this._assets) {
            Resources._clearSource();
            this._assets.dispose();
            this._assets = null;
        }

        // 4. Revoke script blob URLs
        for (const url of this._scriptBlobUrls) {
            URL.revokeObjectURL(url);
        }
        this._scriptBlobUrls = [];
        this._scriptBlobUrlMap.clear();

        // 5. Release the script source and manifest. The asset source behind it
        //    was already disposed with the provider in step 3.
        this._scripts = null;
        this._streaming = null;
        this._manifest = null;
        this._timeToFirstFrame = -1;
        this._deferredLoadStarted = false;

        // 6. Update state
        this._loadState = ScenarioLoadState.Unloaded;

        if (Scenario._current === this) {
            Scenario._current = null;
        }
    }

    // ==================== PROTECTED ====================

    /**
     * Called by EngineObject.Destroy() — ensures cleanup.
     */
    protected override onDestroy(): void {
        this.unload();
    }

    // ==================== PRIVATE: SCRIPT PRE-LINKING ====================

    /**
     * Pre-links every `.js` module the script source offers.
     *
     * **Algorithm (dependency-order Blob URL creation):**
     * 1. Enumerate all `.js` files under `scripts/`.
     * 2. Read source code and extract relative import targets for each.
     * 3. Process files in dependency order (leaves first):
     *    - Files with no relative imports (or all deps already resolved)
     *      are processed first.
     *    - For each file: rewrite relative specifiers → Blob URLs of
     *      already-processed dependencies, then create a Blob URL.
     * 4. Repeat until all files are processed (or cycle detected).
     *
     * After this method completes, {@link _scriptBlobUrlMap} contains
     * the Blob URL for every script, and the entry point can be
     * dynamically imported with all cross-module imports pre-resolved.
     *
     * @internal
     */
    private async _prelinkAllScripts(): Promise<void> {
        const source = this._scripts!;

        // 1. Enumerate, then read every module in parallel. Both paths fetch
        //    everything here: a module cannot be deferred, because the import
        //    graph has to be fully rewritten before any of it runs.
        const scriptFiles: Map<string, string> = new Map(); // script path → source code

        await Promise.all(
            source.listScripts().map(async path => {
                scriptFiles.set(path, await source.readScript(path));
            })
        );

        console.log(`[Scenario] Pre-linking ${scriptFiles.size} script(s)...`);

        // 2. Extract dependency info for each file
        //    deps = set of normalized ZIP paths this file imports from
        const fileDeps: Map<string, Set<string>> = new Map();

        for (const [zipPath, code] of scriptFiles) {
            const deps = new Set<string>();

            // Find all relative import specifiers
            let match: RegExpExecArray | null;
            _RELATIVE_IMPORT_RE.lastIndex = 0;

            while ((match = _RELATIVE_IMPORT_RE.exec(code)) !== null) {
                const specifier = match[2]; // e.g. "./components/CameraOrbit"
                const resolved = Scenario._resolveRelativeImport(zipPath, specifier);
                if (resolved && scriptFiles.has(resolved)) {
                    deps.add(resolved);
                }
            }

            fileDeps.set(zipPath, deps);
        }

        // 3. Process in dependency order (iterative topological sort)
        const resolved = this._scriptBlobUrlMap;
        const remaining = new Set(scriptFiles.keys());
        let lastSize = -1;

        while (remaining.size > 0) {
            if (remaining.size === lastSize) {
                // No progress — circular dependency detected.
                // Process remaining files anyway (browser may handle cycles).
                console.warn(
                    `[Scenario] Circular dependency detected among: ${[...remaining].join(", ")}. ` +
                    `Processing anyway — runtime behavior may vary.`
                );
                for (const path of remaining) {
                    this._createRewrittenBlobUrl(path, scriptFiles.get(path)!, resolved);
                }
                remaining.clear();
                break;
            }

            lastSize = remaining.size;

            for (const path of remaining) {
                const deps = fileDeps.get(path)!;
                const allDepsResolved = [...deps].every(d => resolved.has(d));

                if (allDepsResolved) {
                    this._createRewrittenBlobUrl(path, scriptFiles.get(path)!, resolved);
                    remaining.delete(path);
                }
            }
        }

        console.log(`[Scenario] Pre-linked ${resolved.size} script(s).`);
    }

    /**
     * Rewrites relative imports in source code to Blob URLs, then
     * creates and registers a Blob URL for the file.
     *
     * @param zipPath — normalized path in the ZIP (e.g. "scripts/Scenario.js").
     * @param code — original source code.
     * @param resolved — map of already-resolved zipPath → blobURL.
     *
     * @internal
     */
    private _createRewrittenBlobUrl(
        zipPath: string,
        code: string,
        resolved: Map<string, string>
    ): void {
        // Rewrite relative imports to Blob URLs
        _RELATIVE_IMPORT_RE.lastIndex = 0;

        const rewritten = code.replace(
            _RELATIVE_IMPORT_RE,
            (fullMatch: string, quote: string, specifier: string) => {
                const target = Scenario._resolveRelativeImport(zipPath, specifier);

                if (target && resolved.has(target)) {
                    // Replace the specifier with the Blob URL
                    return fullMatch.replace(
                        `${quote}${specifier}${quote}`,
                        `${quote}${resolved.get(target)!}${quote}`
                    );
                }

                // Leave unchanged (bare specifier or unresolved)
                return fullMatch;
            }
        );

        // Create Blob URL
        const blob = new Blob([rewritten], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        this._scriptBlobUrls.push(blobUrl);
        resolved.set(zipPath, blobUrl);
    }

    /**
     * Resolves a relative import specifier to a normalized ZIP path.
     *
     * Handles:
     * - `./components/CameraOrbit` → `scripts/components/CameraOrbit.js`
     * - `./components/CameraOrbit.js` → `scripts/components/CameraOrbit.js`
     * - `../helpers/utils` → `scripts/helpers/utils.js` (from scripts/sub/)
     *
     * @param fromPath — the importing file's ZIP path (e.g. "scripts/Scenario.js").
     * @param specifier — the relative specifier (e.g. "./components/CameraOrbit").
     * @returns normalized ZIP path, or null if resolution fails.
     *
     * @internal
     */
    private static _resolveRelativeImport(
        fromPath: string,
        specifier: string
    ): string | null {
        // Get the directory of the importing file
        const lastSlash = fromPath.lastIndexOf("/");
        const fromDir = lastSlash >= 0 ? fromPath.substring(0, lastSlash) : "";

        // Resolve relative to the importing file's directory
        const parts = `${fromDir}/${specifier}`.split("/");
        const resolved: string[] = [];

        for (const part of parts) {
            if (part === "." || part === "") continue;
            if (part === "..") {
                resolved.pop();
            } else {
                resolved.push(part);
            }
        }

        let result = resolved.join("/");

        // Ensure .js extension
        if (!result.endsWith(".js")) {
            result += ".js";
        }

        return result;
    }

    // ==================== PRIVATE: ENTRY POINT LOADING ====================

    /**
     * Loads the entry point module from the pre-linked script registry.
     * @returns the ScenarioBehaviour instance.
     */
    private async _loadEntryPoint(): Promise<ScenarioBehaviour> {
        const manifest = this._manifest!;
        const entryPath = `scripts/${manifest.entryPoint}`;

        // Look up in pre-linked registry
        const blobUrl = this._scriptBlobUrlMap.get(entryPath);
        if (!blobUrl) {
            throw new Error(
                `[Scenario] Entry point not found: "${entryPath}". ` +
                `Available scripts: ${[...this._scriptBlobUrlMap.keys()].join(", ")}`
            );
        }

        let module: Record<string, unknown>;
        try {
            module = await import(/* @vite-ignore */ blobUrl) as Record<string, unknown>;
        } catch (error) {
            throw new Error(
                `[Scenario] Failed to import entry point "${manifest.entryPoint}": ${error}`
            );
        }

        // Validate default export
        const defaultExport = module.default;
        if (!defaultExport) {
            throw new Error(
                `[Scenario] Entry point "${manifest.entryPoint}" has no default export. ` +
                "The entry point module must export a default class extending ScenarioBehaviour."
            );
        }

        // Instantiate if it's a class
        let instance: unknown;

        if (typeof defaultExport === "function" && defaultExport.prototype) {
            const EntryClass = defaultExport as new () => unknown;
            instance = new EntryClass();
        } else if (typeof defaultExport === "object") {
            instance = defaultExport;
        } else {
            throw new Error(
                `[Scenario] Entry point default export must be a class or object, got: ${typeof defaultExport}`
            );
        }

        // Check if it's a ScenarioBehaviour (preferred path)
        // NOTE: We use a brand check instead of `instanceof` because
        // the scenario's module may come from a different bundle (standalone
        // import map build) where ScenarioBehaviour is a separate class instance.
        if (Scenario._isScenarioBehaviour(instance)) {
            return instance as ScenarioBehaviour;
        }

        throw new Error(
          `[Scenario] Entry point must extend ScenarioBehaviour.`
        );
    }

    /**
     * Duck-type check for ScenarioBehaviour instances across bundle boundaries.
     *
     * When the scenario loads `from "WebEngineTS"` via import map, it gets
     * classes from the standalone bundle — a different copy than what the
     * Angular host uses. `instanceof` fails across copies, so we check
     * for the `__scenarioBehaviour` brand marker on the constructor.
     *
     * @internal
     */
    private static _isScenarioBehaviour(obj: unknown): boolean {
        if (!obj || typeof obj !== "object") return false;

        const ctor = (obj as Record<string, unknown>).constructor;
        if (!ctor || typeof ctor !== "function") return false;

        // Brand check: ScenarioBehaviour.__scenarioBehaviour === true
        if ((ctor as unknown as Record<string, unknown>).__scenarioBehaviour === true) {
            return true;
        }

        return false;
    }

    /**
     * Loads an ES module from the pre-linked registry, or reads it fresh.
     *
     * Used by `context.importScript()` for on-demand loading.
     *
     * @param scriptPath — full script path (e.g. "scripts/helpers/utils.js").
     * @returns the module namespace object.
     */
    private async _importScriptModule(
        scriptPath: string
    ): Promise<Record<string, unknown>> {
        // Try pre-linked registry first
        const blobUrl = this._scriptBlobUrlMap.get(scriptPath);
        if (blobUrl) {
            try {
                const module = await import(/* @vite-ignore */ blobUrl);
                return module as Record<string, unknown>;
            } catch (error) {
                throw new Error(
                    `[Scenario] Failed to import script "${scriptPath}": ${error}`
                );
            }
        }

        // Fallback for a module the pre-linker did not see. Its own relative
        // imports are left alone, so this only works for a self-contained one.
        const code = await this._scripts!.readScript(scriptPath);
        const blob = new Blob([code], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        this._scriptBlobUrls.push(url);

        try {
            const module = await import(/* @vite-ignore */ url);
            return module as Record<string, unknown>;
        } catch (error) {
            throw new Error(
                `[Scenario] Failed to import script "${scriptPath}": ${error}`
            );
        }
    }

    // ==================== PRIVATE: CONTEXT ====================

    /**
     * Builds the IScenarioContext passed to ScenarioBehaviour.
     */
    private _createContext(): IScenarioContext {
        return {
            manifest: Object.freeze({ ...this._manifest! }),
            assets: this._assets!,
            importScript: (path: string) => this._importScriptFromContext(path),
        };
    }

    /**
     * Implementation of context.importScript() — loads a module from scripts/.
     */
    private async _importScriptFromContext(
        path: string
    ): Promise<Record<string, unknown>> {
        if (!this._scripts) {
            throw new Error("[Scenario] Cannot import script — scenario is not loaded.");
        }

        const scriptPath = path.startsWith("scripts/") ? path : `scripts/${path}`;
        return this._importScriptModule(scriptPath);
    }

    // ==================== PRIVATE: PROGRESS ====================

    /**
     * Updates the load state and notifies the progress callback.
     */
    private _updateProgress(
        state: ScenarioLoadState,
        progress: number,
        operation: string,
        error?: string
    ): void {
        this._loadState = state;

        if (this._onProgressCallback) {
            this._onProgressCallback({
                state,
                progress,
                currentOperation: operation,
                error,
            });
        }
    }

    /**
     * Reports progress without moving the lifecycle state.
     *
     * Used by the asset passes inside {@link run}: the scenario genuinely is
     * `Running` while it warms its critical assets, and reporting `Loading`
     * again would make `isLoaded` briefly disagree with itself.
     */
    private _reportProgress(progress: number, operation: string): void {
        this._onProgressCallback?.({
            state: this._loadState,
            progress,
            currentOperation: operation,
        });
    }

    // ==================== PRIVATE: VALIDATION ====================

    /**
     * Validates that all required manifest fields are present.
     */
    private static _validateManifest(manifest: IScenarioManifest): void {
        const required: (keyof IScenarioManifest)[] = [
            "manifestVersion", "id", "name", "version", "entryPoint",
        ];

        for (const field of required) {
            if (!manifest[field]) {
                throw new Error(`[Scenario] Manifest is missing required field: '${field}'`);
            }
        }
    }

    // ==================== STATIC FACTORIES ====================

    /**
     * Creates and loads a scenario from a URL.
     *
     * @param url — URL to the ZIP archive.
     * @returns a loaded Scenario in the `Ready` state.
     */
    public static async load(url: string): Promise<Scenario> {
        const scenario = new Scenario();
        await scenario.loadFromUrl(url);
        return scenario;
    }

    /**
     * Creates and loads a scenario from a raw ArrayBuffer.
     *
     * @param data — the ZIP file as an ArrayBuffer.
     * @param name — optional name (overridden by manifest.name after parsing).
     * @returns a loaded Scenario in the `Ready` state.
     *
     * @example
     * ```ts
     * const data = await this.http.get(url, { responseType: 'arraybuffer' })
     *     .toPromise();
     * const scenario = await Scenario.loadFromBuffer(data);
     * await scenario.run();
     * ```
     */
    public static async loadFromBuffer(
        data: ArrayBuffer,
        name?: string
    ): Promise<Scenario> {
        const scenario = new Scenario(name);
        await scenario.loadFromData(data);
        return scenario;
    }

    /**
     * Creates and loads a scenario from a streaming manifest URL.
     *
     * @param url — URL of the manifest document (`scenario.json`).
     * @param options — base URL override and fetch implementation.
     * @returns a loaded Scenario in the `Ready` state.
     *
     * @example
     * ```ts
     * const scenario = await Scenario.loadFromManifestUrl(
     *     "/scenarios/solar/scenario.json",
     * );
     * await scenario.run();
     * ```
     */
    public static async loadFromManifestUrl(
        url: string,
        options?: StreamingAssetSourceOptions,
    ): Promise<Scenario> {
        const scenario = new Scenario();
        await scenario.loadFromManifestUrl(url, options);
        return scenario;
    }

    /**
     * Creates and loads a scenario from a File object.
     *
     * @param file — a File object containing the ZIP.
     * @returns a loaded Scenario in the `Ready` state.
     */
    public static async loadFromFile(file: File): Promise<Scenario> {
        const data = await file.arrayBuffer();
        return Scenario.loadFromBuffer(data, file.name);
    }
}