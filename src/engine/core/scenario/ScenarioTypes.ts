// path: src/engine/core/scenario/ScenarioTypes.ts

/**
 * Type definitions for the Scenario system.
 *
 * The Scenario system is the engine's runtime content pipeline — analogous
 * to Unity's AssetBundle / Addressables. A scenario is a ZIP archive
 * containing a manifest, pre-compiled scripts (ES modules), and assets.
 *
 * This file contains only pure interfaces and enums with **zero** runtime
 * dependencies. Every other scenario file imports from here.
 */

// ==================== MANIFEST ====================

/**
 * Category tag for classifying scenarios.
 *
 * Used by the host application for filtering and display — the engine
 * itself does not change behavior based on category.
 */
export enum ScenarioCategory {
    /** Educational scenario. */
    Education = "education",
    /** Technology demo. */
    Demo = "demo",
    /** Interactive experience. */
    Interactive = "interactive",
    /** Physics / system simulation. */
    Simulation = "simulation",
    /** Developer test scenario. */
    Test = "test",
}

/**
 * Author information embedded in the manifest.
 */
export interface IScenarioAuthor {
    /** Display name. */
    name: string;
    /** Contact email (optional). */
    email?: string;
    /** Profile / portfolio URL (optional). */
    url?: string;
}

/**
 * The scenario manifest — parsed from `manifest.json` at the ZIP root.
 *
 * Describes the scenario's identity, entry point, and metadata.
 * The engine uses this to locate and launch the scenario.
 *
 * @example
 * ```json
 * {
 *   "manifestVersion": "1.0",
 *   "id": "com.example.demo-cube",
 *   "name": "Spinning Cube Demo",
 *   "version": "1.0.0",
 *   "entryPoint": "Scenario.js",
 *   "author": { "name": "HuGo" }
 * }
 * ```
 */
export interface IScenarioManifest {
    /** Manifest format version (for forward compatibility). */
    manifestVersion: string;

    /** Unique scenario identifier (reverse-domain style recommended). */
    id: string;

    /** Human-readable scenario name for display. */
    name: string;

    /** Scenario version (semver recommended). */
    version: string;

    /** Short description of the scenario. */
    description?: string;

    /** Classification tag. */
    category?: ScenarioCategory;

    /** Author information. */
    author?: IScenarioAuthor;

    /** Minimum engine version required to run this scenario. */
    engineVersion?: string;

    /**
     * Path to the entry point module, relative to `scripts/`.
     *
     * The module must have a **default export** that implements
     * {@link IScenarioEntryPoint}.
     *
     * @example `"Scenario.js"` → loaded from `scripts/Scenario.js`
     */
    entryPoint: string;

    /**
     * Path to a serialized scene to load before executing the entry point.
     *
     * @remarks Reserved for future use — scene serialization is not yet implemented.
     */
    entryScene?: string;

    /** IDs of other scenarios this one depends on (reserved for future use). */
    dependencies?: string[];

    /** Arbitrary key-value metadata for host application use. */
    metadata?: Record<string, unknown>;
}

// ==================== LOAD STATE ====================

/**
 * Lifecycle state of a scenario instance.
 *
 * State transitions:
 * ```
 * Unloaded → Loading → Ready → Running → Unloaded
 *                  ↘ Error ↗
 * ```
 */
export enum ScenarioLoadState {
    /** Not loaded — initial state and state after unload. */
    Unloaded = "unloaded",
    /** ZIP is being downloaded / parsed. */
    Loading = "loading",
    /** Parsed and ready to run — entry point has not been called yet. */
    Ready = "ready",
    /** Entry point has been executed — scenario is actively running. */
    Running = "running",
    /** An error occurred during loading or execution. */
    Error = "error",
}

/**
 * Progress report emitted during scenario loading.
 *
 * The host application can use this to drive a loading UI.
 */
export interface IScenarioLoadProgress {
    /** Current lifecycle state. */
    state: ScenarioLoadState;
    /** Progress fraction in the range [0, 1]. */
    progress: number;
    /** Human-readable description of the current operation. */
    currentOperation: string;
    /** Error message (present only when `state === Error`). */
    error?: string;
}

// ==================== ASSET PROVIDER ====================

/**
 * Typed interface for loading assets from the scenario archive.
 *
 * Passed to the entry point via {@link IScenarioContext.assets}.
 * All assets are loaded from the in-memory ZIP — nothing touches disk.
 * Blob URLs are tracked and released on scenario unload.
 *
 * @remarks
 * Concrete implementation lives in `ScenarioAssets.ts`.
 * This interface ensures Scenario.ts depends on the contract, not the class.
 *
 * **Type parameters in return values are engine types, not Three.js types.**
 * - `Texture2D` — from the engine's graphics module
 * - `GameObject` — from the engine's core module
 */
export interface IAssetProvider {
    /**
     * Loads a raw binary asset from the archive.
     *
     * @param path — path relative to `assets/` (e.g. `"data/config.json"`).
     * @returns a Blob containing the raw file data.
     */
    getAsset(path: string): Promise<Blob>;

    /**
     * Returns a revocable blob URL for an asset.
     *
     * The URL is cached and automatically revoked on scenario unload.
     *
     * @param path — path relative to `assets/` (e.g. `"textures/brick.png"`).
     */
    getAssetUrl(path: string): Promise<string>;

    /**
     * Loads a texture from the archive.
     *
     * Returned as an engine `Texture2D` instance (not a Three.js texture).
     *
     * @param path — path relative to `assets/textures/`
     *               (e.g. `"brick.png"` or `"textures/brick.png"`).
     *
     * @remarks Return type is `Promise<unknown>` at the interface level
     * to avoid a circular dependency on Texture2D in this pure-types file.
     * Scenario.ts will cast internally; scenario authors receive the real type
     * via `ScenarioContext.assets.loadTexture()`.
     */
    loadTexture(path: string): Promise<unknown>;

    /**
     * Loads a 3D model (GLB/GLTF) from the archive and converts it
     * to a GameObject hierarchy.
     *
     * @param path — path relative to `assets/models/`
     *               (e.g. `"robot.glb"` or `"models/robot.glb"`).
     *
     * @remarks Return type is `Promise<unknown>` at the interface level
     * for the same reason as loadTexture. The runtime type is `GameObject`.
     */
    loadModel(path: string): Promise<unknown>;

    /**
     * Releases all cached assets and revokes all blob URLs.
     *
     * Called automatically by `Scenario.unload()`. Scenario authors
     * should not normally call this directly.
     */
    dispose(): void;
}

// ==================== SCENARIO CONTEXT ====================

/**
 * The context object passed to the scenario entry point's `onSetup()`.
 *
 * Provides everything the scenario needs to interact with the engine:
 * - The scenario manifest (read-only metadata)
 * - An asset provider for loading textures, models, and raw files
 * - A scene reference for the scenario's dedicated scene
 *
 * @remarks
 * Engine core classes (GameObject, Vector3, Camera, etc.) are **not**
 * provided through this context — they are imported directly by the
 * scenario's ES modules via `import { GameObject } from "webunity"`.
 *
 * The context provides only **runtime-specific** services that can't
 * be statically imported (manifest data, asset loading from the ZIP).
 */
export interface IScenarioContext {
    /** Read-only manifest of the currently running scenario. */
    readonly manifest: Readonly<IScenarioManifest>;

    /**
     * Asset provider for loading resources from the scenario ZIP.
     *
     * @example
     * ```ts
     * const texture = await context.assets.loadTexture("brick.png");
     * material.albedoTexture = texture;
     * ```
     */
    readonly assets: IAssetProvider;

    /**
     * Imports another ES module from the scenario's `scripts/` directory.
     *
     * This is the runtime equivalent of a dynamic `import()` scoped to
     * the scenario archive. The returned module's exports are accessible
     * as properties on the resolved object.
     *
     * @param path — path relative to `scripts/` (e.g. `"helpers/math.js"`).
     * @returns the module's namespace object.
     *
     * @example
     * ```ts
     * const utils = await context.importScript("utils/GridBuilder.js");
     * const grid = utils.createGrid(10, 10);
     * ```
     */
    importScript(path: string): Promise<Record<string, unknown>>;
}

// ==================== ENTRY POINT CONTRACT ====================

/**
 * The contract that a scenario's entry point module must fulfill.
 *
 * The entry point JS file (specified in `manifest.entryPoint`) must
 * have a **default export** — either a class or a plain object — that
 * implements this interface.
 *
 * @remarks
 * Equivalent pattern to a Unity MonoBehaviour on a "bootstrap" GameObject,
 * but without requiring the full component lifecycle since the entry point
 * is not attached to a Transform.
 *
 * **Lifecycle:**
 * 1. Engine loads the module via `Blob URL + dynamic import()`.
 * 2. Engine reads `module.default`.
 *    - If it's a class (has `.prototype`), the engine instantiates it with `new`.
 *    - If it's a plain object, it's used directly.
 * 3. `onSetup(context)` is called once — the scenario builds its scene here.
 * 4. `onUpdate()` (if defined) is called every frame while the scenario runs.
 * 5. `onTeardown()` is called once before the scenario is unloaded.
 *
 * @example
 * ```ts
 * // scripts/Scenario.ts (compiled to Scenario.js)
 * import { GameObject, Camera, MeshFilter, MeshRenderer,
 *          Mesh, StandardMaterial, Vector3, Quaternion,
 *          DirectionalLight, ScriptableBehaviour } from "webunity";
 * import type { IScenarioContext } from "webunity";
 *
 * class RotateCube extends ScriptableBehaviour {
 *     onUpdate(): void {
 *         this.transform.rotate(Vector3.up, 90 * Time.deltaTime);
 *     }
 * }
 *
 * export default class MyScenario {
 *     async onSetup(context: IScenarioContext): Promise<void> {
 *         // Camera
 *         const camGo = new GameObject("Main Camera");
 *         camGo.tag = "MainCamera";
 *         const cam = camGo.addComponent(Camera);
 *         cam.fieldOfView = 60;
 *         camGo.transform.position = new Vector3(0, 2, 5);
 *         camGo.transform.lookAt(Vector3.zero);
 *
 *         // Light
 *         const lightGo = new GameObject("Sun");
 *         lightGo.addComponent(DirectionalLight);
 *         lightGo.transform.rotation = Quaternion.euler(50, -30, 0);
 *
 *         // Cube with rotation script
 *         const cube = new GameObject("Cube");
 *         cube.addComponent(MeshFilter).sharedMesh = Mesh.createCube();
 *         cube.addComponent(MeshRenderer).sharedMaterial = new StandardMaterial();
 *         cube.addComponent(RotateCube);
 *     }
 *
 *     onTeardown(): void {
 *         console.log("Scenario ended!");
 *     }
 * }
 * ```
 */
export interface IScenarioEntryPoint {
    /**
     * Called once when the scenario starts.
     *
     * This is where the scenario creates its scene — cameras, lights,
     * GameObjects, scripts, and any async asset loading.
     *
     * @param context — provides manifest info, asset loading, and script importing.
     */
    onSetup(context: IScenarioContext): void | Promise<void>;

    /**
     * Called every frame while the scenario is running (optional).
     *
     * Use this for scenario-level logic that doesn't belong to any
     * specific GameObject / component. Most per-object logic should
     * live in ScriptableBehaviour subclasses instead.
     *
     * @remarks
     * This runs AFTER all component Update() calls for the frame.
     */
    onUpdate?(): void;

    /**
     * Called once before the scenario is unloaded (optional).
     *
     * Use this for cleanup that goes beyond what the engine handles
     * automatically (e.g., closing WebSocket connections, stopping
     * custom audio, saving user progress to a server).
     *
     * @remarks
     * The engine automatically handles: destroying all GameObjects,
     * releasing textures/materials, revoking blob URLs, clearing the
     * Scene. You only need onTeardown for non-engine resources.
     */
    onTeardown?(): void;
}