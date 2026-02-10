// path: src/engine/core/scenario/Scenario.ts

import JSZip from "jszip";
import { EngineObject } from "../EngineObject.ts";
import { ScenarioAssets } from "./ScenarioAssets.ts";
import { SceneManager } from "../SceneManager.ts";
import { ScenarioBehaviour } from "./ScenarioBehaviour.ts";
import type {
    IScenarioManifest,
    IScenarioContext,
    IScenarioEntryPoint,
    IScenarioLoadProgress,
} from "./ScenarioTypes.ts";
import { ScenarioLoadState } from "./ScenarioTypes.ts";

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
 * Represents a ZIP archive parsed in memory. Manages the full lifecycle:
 * download → parse → execute entry point → teardown → release resources.
 *
 * Equivalent to Unity's AssetBundle — lives in RAM and is cleaned up
 * completely when unloaded, leaving no leaked textures, blob URLs,
 * GameObjects, or Scenes.
 *
 * **Script execution & import resolution:**
 * Scripts in the ZIP are pre-compiled ES modules (.js). Before execution,
 * the engine pre-links ALL scripts in the `scripts/` directory:
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

    /** Parsed manifest from the ZIP root. */
    private _manifest: IScenarioManifest | null = null;

    /** In-memory ZIP archive. Null after unload. */
    private _zip: JSZip | null = null;

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
            this._zip = await JSZip.loadAsync(data);

            this._updateProgress(ScenarioLoadState.Loading, 0.6, "Reading manifest...");

            // Read and validate manifest
            const manifestFile = this._zip.file("manifest.json");
            if (!manifestFile) {
                throw new Error("manifest.json not found in ZIP archive");
            }

            const manifestJson = await manifestFile.async("string");
            this._manifest = JSON.parse(manifestJson) as IScenarioManifest;
            Scenario._validateManifest(this._manifest);

            this._updateProgress(ScenarioLoadState.Loading, 0.8, "Preparing assets...");

            // Update object name from manifest
            this.name = this._manifest.name;

            // Create asset provider
            this._assets = new ScenarioAssets(this._zip);

            this._updateProgress(ScenarioLoadState.Ready, 1, "Ready");

            console.log(
                `[Scenario] Loaded: ${this._manifest.name} v${this._manifest.version}`
            );

        } catch (error) {
            this._updateProgress(ScenarioLoadState.Error, 0, "Failed to parse", String(error));
            throw error;
        }
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
        if (!this.isLoaded || !this._manifest || !this._zip) {
            throw new Error(
                "[Scenario] Not loaded. Call loadFromUrl() or loadFromData() first."
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

        try {
            // Create a dedicated scene for this scenario
            SceneManager.createScene(this._manifest.name);

            // Pre-link all scripts — rewrites relative imports to Blob URLs
            await this._prelinkAllScripts();

            // Build the context that the entry point receives
            const context = this._createContext();

            // Load and instantiate the entry point
            this._entryPoint = await this._loadEntryPoint(context);

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

    // ==================== PUBLIC: UNLOADING ====================

    /**
     * Unloads the scenario and releases **all** resources.
     *
     * Cleanup order:
     * 1. Call `ScenarioBehaviour._systemDestroy()` (invokes `onDestroy()`).
     * 2. Destroy the scenario's Scene (destroys all GameObjects).
     * 3. Dispose ScenarioAssets (textures, models, blob URLs).
     * 4. Revoke script blob URLs.
     * 5. Release ZIP reference.
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
            this._assets.dispose();
            this._assets = null;
        }

        // 4. Revoke script blob URLs
        for (const url of this._scriptBlobUrls) {
            URL.revokeObjectURL(url);
        }
        this._scriptBlobUrls = [];
        this._scriptBlobUrlMap.clear();

        // 5. Release ZIP and manifest
        this._zip = null;
        this._manifest = null;

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
     * Pre-links all `.js` scripts in the ZIP's `scripts/` directory.
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
        const zip = this._zip!;

        // 1. Enumerate all .js files under scripts/
        const scriptFiles: Map<string, string> = new Map(); // zipPath → source code

        zip.forEach((relativePath, file) => {
            if (
                !file.dir &&
                relativePath.startsWith("scripts/") &&
                relativePath.endsWith(".js")
            ) {
                // Normalize separators (Windows ZIP tools may use backslashes)
                const normalized = relativePath.replace(/\\/g, "/");
                scriptFiles.set(normalized, ""); // source loaded below
            }
        });

        // Read all source files in parallel
        const readPromises: Promise<void>[] = [];
        for (const [path] of scriptFiles) {
            const file = zip.file(path);
            if (file) {
                readPromises.push(
                    file.async("string").then(code => {
                        scriptFiles.set(path, code);
                    })
                );
            }
        }
        await Promise.all(readPromises);

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
     *
     * @param context — the scenario context (passed to legacy adapter if needed).
     * @returns the ScenarioBehaviour instance.
     */
    private async _loadEntryPoint(
        context: IScenarioContext
    ): Promise<ScenarioBehaviour> {
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

        // Legacy fallback: check for IScenarioEntryPoint shape
        const legacy = instance as Partial<IScenarioEntryPoint>;
        if (typeof legacy.onSetup === "function") {
            console.warn(
                `[Scenario] Entry point uses deprecated IScenarioEntryPoint interface. ` +
                `Migrate to ScenarioBehaviour. See ScenarioTypes.ts for migration guide.`
            );
            return Scenario._createLegacyAdapter(legacy as IScenarioEntryPoint, context);
        }

        throw new Error(
            `[Scenario] Entry point must extend ScenarioBehaviour. ` +
            `Got an object that is neither a ScenarioBehaviour nor a legacy IScenarioEntryPoint.`
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
     * Wraps a legacy IScenarioEntryPoint in a ScenarioBehaviour adapter.
     *
     * @internal
     */
    private static _createLegacyAdapter(
        legacy: IScenarioEntryPoint,
        context: IScenarioContext
    ): ScenarioBehaviour {
        const adapter = new ScenarioBehaviour();

        adapter.awake = () => legacy.onSetup(context);

        if (legacy.onUpdate) {
            adapter.update = () => legacy.onUpdate!();
        }

        if (legacy.onTeardown) {
            adapter.onDestroy = () => legacy.onTeardown!();
        }

        return adapter;
    }

    /**
     * Loads an ES module from the pre-linked registry or directly from ZIP.
     *
     * Used by `context.importScript()` for on-demand loading.
     *
     * @param scriptPath — full path inside the ZIP (e.g. "scripts/helpers/utils.js").
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

        // Fallback: load directly from ZIP (e.g. dynamically loaded scripts)
        const zip = this._zip!;
        const file = zip.file(scriptPath);

        if (!file) {
            throw new Error(`[Scenario] Script not found in ZIP: ${scriptPath}`);
        }

        const code = await file.async("string");
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
        if (!this._zip) {
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