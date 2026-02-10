// path: src/engine/core/scenario/ScenarioBehaviour.ts

import type { IScenarioContext } from "./ScenarioTypes.ts";

/**
 * Base class for scenario entry points.
 *
 * Scenario authors extend this class and override lifecycle methods to
 * build their interactive scene. The pattern mirrors
 * {@link ScriptableBehaviour} but without enable/disable semantics —
 * a scenario entry point is always active while the scenario is running.
 *
 * **Not a Component.** ScenarioBehaviour is not attached to a GameObject
 * and has no Transform. It is a standalone lifecycle host that the engine
 * instantiates once per scenario run.
 *
 * **Lifecycle (Unity-compatible order):**
 * 1. {@link awake} — called once after the entry point is instantiated.
 *    May be async to allow asset loading and scene construction.
 * 2. {@link start} — called once before the first frame update.
 * 3. Per-frame loop:
 *    a. {@link fixedUpdate} — 0–N times per frame (fixed timestep).
 *    b. {@link update} — once per frame.
 *    c. {@link lateUpdate} — once per frame, after all updates.
 * 4. {@link onDestroy} — called once when the scenario is unloaded.
 *
 * **Context:** The {@link context} property provides access to the
 * scenario manifest, asset loader, and script importer. It is available
 * from within {@link awake} onwards.
 *
 * @remarks
 * The entry point module must have a **default export** that extends
 * this class. The engine instantiates it with `new` (no constructor args).
 *
 * @example
 * ```ts
 * import {
 *     ScenarioBehaviour, GameObject, Camera,
 *     MeshFilter, MeshRenderer, Mesh, StandardMaterial,
 *     Vector3, Quaternion, DirectionalLight, Time,
 * } from "WebEngineTS";
 *
 * export default class MyScenario extends ScenarioBehaviour {
 *
 *     async awake(): Promise<void> {
 *         // Load assets, build the scene
 *         const camGo = new GameObject("Main Camera");
 *         camGo.tag = "MainCamera";
 *         const cam = camGo.addComponent(Camera);
 *         cam.fieldOfView = 60;
 *         camGo.transform.position = new Vector3(0, 2, 5);
 *         camGo.transform.lookAt(Vector3.zero);
 *
 *         const lightGo = new GameObject("Sun");
 *         lightGo.addComponent(DirectionalLight);
 *         lightGo.transform.rotation = Quaternion.euler(50, -30, 0);
 *
 *         const cube = new GameObject("Cube");
 *         cube.addComponent(MeshFilter).sharedMesh = Mesh.createCube();
 *         cube.addComponent(MeshRenderer).sharedMaterial = new StandardMaterial();
 *     }
 *
 *     update(): void {
 *         // Per-frame scenario-level logic
 *     }
 *
 *     onDestroy(): void {
 *         console.log("Scenario ended!");
 *     }
 * }
 * ```
 */
export class ScenarioBehaviour {

    /**
     * Brand marker for cross-bundle duck-type detection.
     *
     * When the engine runs in a browser with import maps, the scenario's
     * ScenarioBehaviour class may come from a different bundle than the
     * engine's own copy. `instanceof` fails across bundles, so we use
     * this static brand to reliably identify ScenarioBehaviour subclasses.
     *
     * @internal
     */
    static readonly __scenarioBehaviour: true = true;

    // ==================== PRIVATE STATE ====================

    /**
     * The scenario context, set by the engine before {@link awake}.
     * @internal
     */
    private _context: IScenarioContext | null = null;

    /**
     * Whether {@link start} has been called.
     * Ensures `start()` runs exactly once before the first `update()`.
     * @internal
     */
    private _started: boolean = false;

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The scenario context — provides access to the manifest, asset
     * loader, and script importer.
     *
     * Available from within {@link awake} onwards. Accessing before
     * awake throws an error.
     *
     * @example
     * ```ts
     * async awake(): Promise<void> {
     *     console.log(this.context.manifest.name);
     *     const tex = await this.context.assets.loadTexture("earth.png");
     *     const utils = await this.context.importScript("helpers/utils.js");
     * }
     * ```
     */
    public get context(): IScenarioContext {
        if (!this._context) {
            throw new Error(
                "[ScenarioBehaviour] Context is not available yet. " +
                "It is set by the engine before awake() is called."
            );
        }
        return this._context;
    }

    // ==================== USER LIFECYCLE HOOKS ====================

    /**
     * Called once when the scenario entry point is initialized.
     *
     * Use `awake` to load assets, import sub-scripts, and build the
     * scene. The {@link context} is available at this point.
     *
     * May return a Promise for async operations (asset loading, etc.).
     * The engine will await the Promise before proceeding to the
     * game loop.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.Awake()`, but supports
     * async for scenario setup (scene construction, asset loading).
     *
     * Called before {@link start} and before the first frame.
     *
     * @virtual Override in scenario entry points.
     */
    public awake(): void | Promise<void> {
        // Override in scenario entry points
    }

    /**
     * Called once before the first frame update.
     *
     * Use `start` for initialization that depends on all GameObjects
     * and components being ready (since scene construction happens
     * in {@link awake}).
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.Start()`.
     * Guaranteed to run after {@link awake} has completed.
     *
     * @virtual Override in scenario entry points.
     */
    public start(): void {
        // Override in scenario entry points
    }

    /**
     * Called every frame.
     *
     * Use for scenario-level per-frame logic. Most per-object logic
     * should live in {@link ScriptableBehaviour} subclasses on
     * individual GameObjects instead.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.Update()`.
     * Runs after all component `update()` calls for the frame.
     * Use `Time.deltaTime` for frame-rate independent calculations.
     *
     * @virtual Override in scenario entry points.
     */
    public update(): void {
        // Override in scenario entry points
    }

    /**
     * Called at a fixed time interval, independent of frame rate.
     *
     * Use for physics calculations and other fixed-timestep logic
     * at the scenario level.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.FixedUpdate()`.
     * May run 0–N times per frame depending on the accumulator.
     *
     * @virtual Override in scenario entry points.
     */
    public fixedUpdate(): void {
        // Override in scenario entry points
    }

    /**
     * Called every frame after all {@link update} calls have finished.
     *
     * Use for logic that must happen after movement/animation at the
     * scenario level, such as camera adjustments or post-processing.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.LateUpdate()`.
     *
     * @virtual Override in scenario entry points.
     */
    public lateUpdate(): void {
        // Override in scenario entry points
    }

    /**
     * Called once when the scenario is unloaded.
     *
     * Use for cleanup that goes beyond what the engine handles
     * automatically (e.g., closing WebSocket connections, stopping
     * custom audio, saving user progress to a server).
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.OnDestroy()`.
     *
     * The engine automatically handles: destroying all GameObjects,
     * releasing textures/materials, revoking blob URLs, clearing the
     * Scene. You only need onDestroy for non-engine resources.
     *
     * @virtual Override in scenario entry points.
     */
    public onDestroy(): void {
        // Override in scenario entry points
    }

    // ==================== INTERNAL SYSTEM METHODS ====================

    /**
     * @internal
     * Called by the Scenario loader to inject the context and run awake().
     *
     * @param context — the scenario context with manifest, assets, importScript.
     * @returns void or a Promise (if awake is async).
     */
    public _systemInit(context: IScenarioContext): void | Promise<void> {
        this._context = context;
        return this.awake();
    }

    /**
     * @internal
     * Called by the game loop each frame (via Scenario._onUpdate).
     *
     * Handles the start-before-first-update guarantee, then calls update().
     */
    public _systemUpdate(): void {
        if (!this._started) {
            this.start();
            this._started = true;
        }
        this.update();
    }

    /**
     * @internal
     * Called by the game loop at fixed intervals (via Scenario._onFixedUpdate).
     *
     * Only fires after {@link start} has been called (matches ScriptableBehaviour).
     */
    public _systemFixedUpdate(): void {
        if (this._started) {
            this.fixedUpdate();
        }
    }

    /**
     * @internal
     * Called by the game loop each frame after update (via Scenario._onLateUpdate).
     *
     * Only fires after {@link start} has been called (matches ScriptableBehaviour).
     */
    public _systemLateUpdate(): void {
        if (this._started) {
            this.lateUpdate();
        }
    }

    /**
     * @internal
     * Called by Scenario.unload() before the scene is destroyed.
     */
    public _systemDestroy(): void {
        this.onDestroy();
    }
}