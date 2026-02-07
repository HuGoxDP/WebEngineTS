// path: src/engine/core/ScriptableBehaviour.ts

import { Behaviour } from "./Behaviour.ts";
import type { GameObject } from "./GameObject.ts";

/**
 * Base class for all user scripts.
 *
 * Adds Unity-style lifecycle hooks: {@link awake}, {@link start},
 * {@link update}, {@link lateUpdate}, {@link fixedUpdate},
 * and {@link onDestroy}.
 *
 * Hierarchy: {@link EngineObject} → {@link Component} → {@link Behaviour} → ScriptableBehaviour
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.MonoBehaviour`.
 *
 * **Lifecycle order** (per Unity specification):
 * 1. `Awake()` — called once immediately when the component is created,
 *    even if the GameObject is inactive.
 * 2. `OnEnable()` — called when the component becomes active
 *    (inherited from {@link Behaviour}).
 * 3. `Start()` — called once before the first `Update`, only if enabled.
 * 4. `FixedUpdate()` — called at fixed intervals (physics).
 * 5. `Update()` — called every frame.
 * 6. `LateUpdate()` — called every frame after all `Update` calls.
 * 7. `OnDisable()` — called when the component becomes inactive
 *    (inherited from {@link Behaviour}; also fires before destruction).
 * 8. `OnDestroy()` — called when the component is destroyed.
 *
 * @example
 * ```ts
 * class PlayerController extends ScriptableBehaviour {
 *     private speed: number = 5;
 *
 *     public start(): void {
 *         console.log("Player ready!");
 *     }
 *
 *     public update(): void {
 *         // Move the player every frame
 *         const dt = Time.deltaTime;
 *         this.transform.translate(new Vector3(0, 0, this.speed * dt));
 *     }
 * }
 * ```
 */
export class ScriptableBehaviour extends Behaviour {

    // ==================== FIELDS ====================

    /**
     * Whether {@link start} has been called.
     * Ensures `start()` runs exactly once before the first `update()`.
     * @internal
     */
    private _started: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== USER LIFECYCLE HOOKS ====================

    /**
     * Called once when the script instance is being loaded.
     *
     * Use `awake` to initialize variables or references before
     * any other methods are called. `awake` is called even if the
     * script/GameObject is disabled.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.Awake()`.
     * Called before {@link start}, before `OnEnable`, and only once.
     *
     * @virtual Override in user scripts.
     */
    public awake(): void {
        // Override in user scripts
    }

    /**
     * Called once before the first frame update, but only if the
     * script is enabled.
     *
     * Use `start` for initialization that depends on other components
     * being ready (since `awake` runs on all components first).
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.Start()`.
     * Guaranteed to run after all `awake()` calls have completed.
     *
     * @virtual Override in user scripts.
     */
    public start(): void {
        // Override in user scripts
    }

    /**
     * Called every frame.
     *
     * This is the main game loop callback. Put per-frame game logic here.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.Update()`.
     * Only called when {@link isActiveAndEnabled} is `true`.
     * Use `Time.deltaTime` for frame-rate independent movement.
     *
     * @virtual Override in user scripts.
     */
    public update(): void {
        // Override in user scripts
    }

    /**
     * Called every frame after all {@link update} calls have finished.
     *
     * Use for logic that must happen after movement/animation,
     * such as camera follow or post-processing calculations.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.LateUpdate()`.
     * Only called when {@link isActiveAndEnabled} is `true` and
     * after {@link start} has run.
     *
     * @virtual Override in user scripts.
     */
    public lateUpdate(): void {
        // Override in user scripts
    }

    /**
     * Called at a fixed time interval, independent of frame rate.
     *
     * Use for physics calculations and other fixed-timestep logic.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.FixedUpdate()`.
     * Only called when {@link isActiveAndEnabled} is `true` and
     * after {@link start} has run.
     *
     * @virtual Override in user scripts.
     */
    public fixedUpdate(): void {
        // Override in user scripts
    }

    /**
     * Called when the script or its GameObject is being destroyed.
     *
     * Use for final cleanup: releasing resources, unsubscribing from
     * events, nulling references, etc.
     *
     * @remarks
     * Equivalent to Unity's `MonoBehaviour.OnDestroy()`.
     * Always called after {@link onDisable} (handled automatically by
     * {@link Behaviour._destroyImmediate}).
     *
     * It is safe to override this without calling `super.onDestroy()` —
     * the engine handles `onDisable` independently before this is called.
     *
     * @virtual Override in user scripts.
     */
    protected override onDestroy(): void {
        // Override in user scripts for cleanup
    }

    // ==================== INTERNAL SYSTEM METHODS ====================
    /**
     * @internal
     * Called by `GameObject.addComponent()` immediately after the component
     * is constructed and added to the components list.
     *
     * Invokes the user-facing {@link awake} callback.
     *
     * @remarks
     * In Unity, Awake is called even on disabled GameObjects.
     * It runs before OnEnable and before Start.
     */
    public _systemAwake(): void {
        this.awake();
    }

    /**
     * @internal
     * Called by the engine's update loop (via `GameObject._systemUpdate`).
     *
     * Handles the Start-before-first-Update guarantee:
     * - If this is the first update and the component is active, {@link start} is called.
     * - Then {@link update} is called every frame while active.
     */
    public _systemUpdate(): void {
        if (!this.isActiveAndEnabled) return;

        if (!this._started) {
            this.start();
            this._started = true;
        }

        this.update();
    }

    /**
     * @internal
     * Called by the engine's late update loop (via `GameObject._systemLateUpdate`).
     *
     * Only fires after {@link start} has been called.
     */
    public _systemLateUpdate(): void {
        if (this.isActiveAndEnabled && this._started) {
            this.lateUpdate();
        }
    }

    /**
     * @internal
     * Called by the engine's fixed update loop (via `GameObject._systemFixedUpdate`).
     *
     * Used for physics and other fixed-timestep processing.
     * Only fires after {@link start} has been called.
     */
    public _systemFixedUpdate(): void {
        if (this.isActiveAndEnabled && this._started) {
            this.fixedUpdate();
        }
    }
}