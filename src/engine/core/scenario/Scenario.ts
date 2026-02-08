// path: src/engine/core/scenario/Scenario.ts

import JSZip from "jszip";
import { EngineObject } from "../EngineObject.ts";
import { ScenarioAssets } from "./ScenarioAssets.ts";
import { SceneManager } from "../SceneManager.ts";
import type {
    IScenarioManifest,
    IScenarioContext,
    IScenarioEntryPoint,
    IScenarioLoadProgress,
} from "./ScenarioTypes.ts";
import { ScenarioLoadState } from "./ScenarioTypes.ts";

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
 * **Lifecycle:**
 * ```
 * loadFromUrl / loadFromData / loadFromFile
 *   → ZIP parsed in memory
 *   → manifest.json read + validated
 *   → ScenarioAssets created
 *   → state = Ready
 *
 * run()
 *   → Scene created for the scenario
 *   → entry point loaded via Blob URL + dynamic import()
 *   → entryPoint.onSetup(context) called
 *   → state = Running
 *   → entryPoint.onUpdate() called each frame (if defined)
 *
 * unload()
 *   → entryPoint.onTeardown() called (if defined)
 *   → Scene destroyed (all GameObjects destroyed)
 *   → ScenarioAssets disposed (textures, models, blob URLs)
 *   → script blob URLs revoked
 *   → ZIP reference released
 *   → state = Unloaded
 * ```
 *
 * **Script execution:**
 * Scripts in the ZIP are pre-compiled ES modules (.js). The entry point
 * is loaded via `Blob URL + dynamic import()` — no eval(). Engine classes
 * (GameObject, Vector3, etc.) are imported by the script from the engine
 * library (e.g. `import { GameObject } from "webunity"`), resolved at
 * runtime through the host page's import map.
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

    /** The entry point instance (class or plain object). */
    private _entryPoint: IScenarioEntryPoint | null = null;

    /** Blob URLs created for script modules — revoked on unload. */
    private _scriptBlobUrls: string[] = [];

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
     * `context.assets` in their entry point, not directly.
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
     *
     * @example
     * ```ts
     * const scenario = new Scenario();
     * scenario.onProgress(p => updateUI(p.progress, p.currentOperation));
     * await scenario.loadFromUrl("/scenarios/demo.zip");
     * ```
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
     * Use this when the host application has already downloaded the ZIP
     * (e.g. from Angular HttpClient or a File input).
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
     * 3. Loads the entry point module via `Blob URL + dynamic import()`.
     * 4. Calls `entryPoint.onSetup(context)`.
     *
     * After this call, the scenario is in the `Running` state and
     * {@link _onUpdate} should be called each frame by Application.
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

            // Build the context that the entry point receives
            const context = this._createContext();

            // Load and instantiate the entry point
            this._entryPoint = await this._loadEntryPoint();

            // Call onSetup — the scenario builds its world here
            await this._entryPoint.onSetup(context);

            console.log(`[Scenario] Running: ${this._manifest.name}`);

        } catch (error) {
            this._loadState = ScenarioLoadState.Error;
            console.error("[Scenario] Failed to run:", error);
            throw error;
        }
    }

    /**
     * Called every frame by Application while the scenario is running.
     *
     * Delegates to the entry point's `onUpdate()` if defined.
     *
     * @internal — called by the game loop, not by scenario authors.
     */
    public _onUpdate(): void {
        if (this._entryPoint?.onUpdate) {
            this._entryPoint.onUpdate();
        }
    }

    // ==================== PUBLIC: UNLOADING ====================

    /**
     * Unloads the scenario and releases **all** resources.
     *
     * Cleanup order:
     * 1. Call `entryPoint.onTeardown()` (if defined).
     * 2. Destroy the scenario's Scene (destroys all GameObjects).
     * 3. Dispose ScenarioAssets (textures, models, blob URLs).
     * 4. Revoke script blob URLs.
     * 5. Release ZIP reference.
     *
     * After this call, the scenario is in the `Unloaded` state and
     * cannot be re-run. Create a new Scenario instance to reload.
     */
    public unload(): void {
        if (this._loadState === ScenarioLoadState.Unloaded) return;

        console.log(`[Scenario] Unloading: ${this.name}`);

        // 1. Entry point teardown
        if (this._entryPoint?.onTeardown) {
            try {
                this._entryPoint.onTeardown();
            } catch (error) {
                console.error("[Scenario] Error in onTeardown:", error);
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

    // ==================== PRIVATE: ENTRY POINT LOADING ====================

    /**
     * Loads the entry point module from the ZIP using Blob URL + dynamic import().
     *
     * The module must have a default export that implements IScenarioEntryPoint.
     * If the default export is a class (has .prototype), it is instantiated with new.
     * If it is a plain object, it is used directly.
     *
     * @returns the entry point instance.
     */
    private async _loadEntryPoint(): Promise<IScenarioEntryPoint> {
        const manifest = this._manifest!;
        const zip = this._zip!;

        const entryPath = `scripts/${manifest.entryPoint}`;
        const entryFile = zip.file(entryPath);

        if (!entryFile) {
            throw new Error(`[Scenario] Entry point not found in ZIP: ${entryPath}`);
        }

        const module = await this._importScriptModule(entryPath);

        // Validate default export
        const defaultExport = module.default;
        if (!defaultExport) {
            throw new Error(
                `[Scenario] Entry point "${manifest.entryPoint}" has no default export. ` +
                "The entry point module must export a default class or object implementing IScenarioEntryPoint."
            );
        }

        // Instantiate if it's a class, use directly if it's an object
        let entryPoint: IScenarioEntryPoint;

        if (typeof defaultExport === "function" && defaultExport.prototype) {
            // It's a class — instantiate
            // Cast is safe: the typeof + .prototype guard above proves constructability.
            const EntryClass = defaultExport as new () => IScenarioEntryPoint;
            entryPoint = new EntryClass();
        } else if (typeof defaultExport === "object") {
            // It's a plain object
            entryPoint = defaultExport as IScenarioEntryPoint;
        } else {
            throw new Error(
                `[Scenario] Entry point default export must be a class or object, got: ${typeof defaultExport}`
            );
        }

        // Validate onSetup
        if (typeof entryPoint.onSetup !== "function") {
            throw new Error(
                `[Scenario] Entry point must implement onSetup(context). ` +
                `Found: ${typeof entryPoint.onSetup}`
            );
        }

        return entryPoint;
    }

    /**
     * Loads an ES module from the ZIP's scripts/ directory via Blob URL + dynamic import().
     *
     * The blob URL is tracked and revoked on unload.
     *
     * @param scriptPath — full path inside the ZIP (e.g. "scripts/Scenario.js").
     * @returns the module namespace object.
     */
    private async _importScriptModule(
        scriptPath: string
    ): Promise<Record<string, unknown>> {
        const zip = this._zip!;
        const file = zip.file(scriptPath);

        if (!file) {
            throw new Error(`[Scenario] Script not found in ZIP: ${scriptPath}`);
        }

        const code = await file.async("string");

        // Create a Blob URL so the browser treats this as an ES module
        const blob = new Blob([code], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        this._scriptBlobUrls.push(blobUrl);

        try {
            // Dynamic import — the browser's native ES module loader handles this.
            // Bare specifiers like `from "webunity"` are resolved via the host page's import map.
            const module = await import(/* @vite-ignore */ blobUrl);
            return module as Record<string, unknown>;
        } catch (error) {
            throw new Error(
                `[Scenario] Failed to import script "${scriptPath}": ${error}`
            );
        }
    }

    // ==================== PRIVATE: CONTEXT ====================

    /**
     * Builds the IScenarioContext passed to the entry point's onSetup().
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
     *
     * Normalizes the path and delegates to _importScriptModule().
     *
     * @param path — path relative to scripts/ (e.g. "helpers/math.js").
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
     * This is the primary entry point for Angular integration where
     * the host downloads the ZIP via HttpClient.
     *
     * @param data — the ZIP file as an ArrayBuffer.
     * @param name — optional name (overridden by manifest.name after parsing).
     * @returns a loaded Scenario in the `Ready` state.
     *
     * @example
     * ```ts
     * // Angular component
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
     * Convenient for `<input type="file">` upload flows.
     *
     * @param file — a File object containing the ZIP.
     * @returns a loaded Scenario in the `Ready` state.
     */
    public static async loadFromFile(file: File): Promise<Scenario> {
        const data = await file.arrayBuffer();
        return Scenario.loadFromBuffer(data, file.name);
    }
}