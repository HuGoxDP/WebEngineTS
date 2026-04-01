// path: src/engine/core/scenario/ScenarioTypes.ts

/**
 * Type definitions for the Scenario system.
 *
 * The Scenario system is the engine's runtime content pipeline — analogous
 * to Unity's AssetBundle / Addressables. A scenario is a ZIP archive
 * containing a manifest, pre-compiled scripts (ES modules), and assets.
 *
 * This file contains only pure interfaces and enums with **zero** runtime
 * dependencies. `import type` is used for engine types — TypeScript erases
 * these at compile time, so no circular dependency is created.
 */

import type { Texture2D } from "../graphics/Texture2D.ts";
import type { GameObject } from "../GameObject.ts";

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
     * The module must have a **default export** — a class that extends
     * {@link ScenarioBehaviour}.
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
 * Return types use engine types imported via `import type` — these are
 * erased at compile time and do not create circular runtime dependencies.
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
     * @param path — path relative to `assets/textures/`
     *               (e.g. `"brick.png"` or `"textures/brick.png"`).
     * @returns an engine Texture2D instance.
     */
    loadTexture(path: string): Promise<Texture2D>;

    /**
     * Loads a 3D model (GLB/GLTF) from the archive and converts it
     * to a GameObject hierarchy with MeshFilter + MeshRenderer.
     *
     * @param path — path relative to `assets/models/`
     *               (e.g. `"robot.glb"` or `"models/robot.glb"`).
     * @returns a root GameObject containing the full model hierarchy.
     */
    loadModel(path: string): Promise<GameObject>;

    /**
     * Releases all cached assets and revokes all blob URLs.
     *
     * Called automatically by `Scenario.unload()`. Scenario authors
     * should not normally call this directly.
     */
    dispose(): void;

    /**
     * Releases the in-memory archive to free decompressed asset data.
     *
     * Call this after all assets have been loaded (typically at the end
     * of `awake()` or `start()`). After calling this method, no further
     * asset loading is possible — {@link loadTexture}, {@link loadModel},
     * {@link getAsset}, and related methods will throw.
     *
     * For a typical scenario archive this can free tens to hundreds of
     * megabytes of decompressed data held in memory by the ZIP library.
     *
     * @remarks
     * This is an optimization for scenarios that load all assets upfront.
     * Scenarios that load assets lazily during gameplay should not call this.
     *
     * @example
     * ```ts
     * async awake() {
     *     const [earth, mars] = await Resources.loadBatch([
     *         [Texture2D, "textures/earth"],
     *         [Texture2D, "textures/mars"],
     *     ]).promise;
     *
     *     // Free the archive — no more loading needed
     *     this.context.assets.releaseArchive();
     * }
     * ```
     */
    releaseArchive(): void;

    /**
     * Whether the archive has been released via {@link releaseArchive}.
     *
     * When `true`, asset loading methods will throw if called.
     */
    readonly isArchiveReleased: boolean;
}

// ==================== SCENARIO CONTEXT ====================

/**
 * The context object available via `this.context` in {@link ScenarioBehaviour}.
 *
 * Provides everything the scenario needs to interact with the engine:
 * - The scenario manifest (read-only metadata)
 * - An asset provider for loading textures, models, and raw files
 * - A script importer for loading sub-modules from the ZIP
 *
 * @remarks
 * Engine core classes (GameObject, Vector3, Camera, etc.) are **not**
 * provided through this context — they are imported directly by the
 * scenario's ES modules via `import { GameObject } from "WebEngineTS"`.
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
     * async awake(): Promise<void> {
     *     const texture = await this.context.assets.loadTexture("brick.png");
     *     material.albedoTexture = texture;
     * }
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
     * async awake(): Promise<void> {
     *     const utils = await this.context.importScript("utils/GridBuilder.js");
     *     const grid = utils.createGrid(10, 10);
     * }
     * ```
     */
    importScript(path: string): Promise<Record<string, unknown>>;
}