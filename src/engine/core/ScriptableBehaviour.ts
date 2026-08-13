// path: src/engine/core/ScriptableBehaviour.ts

import { Behaviour } from "./Behaviour.ts";
import { Coroutine, CoroutineRunner, YieldInstruction } from "./Coroutine.ts";
import type { GameObject } from "./GameObject.ts";

/**
 * Base class for all user scripts.
 *
 * Adds Unity-style lifecycle hooks: {@link awake}, {@link start},
 * {@link update}, {@link lateUpdate}, {@link fixedUpdate},
 * and {@link onDestroy}.
 *
 * Also provides the coroutine API: {@link startCoroutine},
 * {@link stopCoroutine}, and {@link stopAllCoroutines}.
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
 *         this.startCoroutine(this.spawnEffect());
 *     }
 *
 *     public update(): void {
 *         this.transform.translate(new Vector3(0, 0, this.speed * Time.deltaTime));
 *     }
 *
 *     private *spawnEffect(): Generator<YieldInstruction> {
 *         console.log("Spawning...");
 *         yield new WaitForSeconds(1);
 *         console.log("Ready!");
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

    /**
     * Coroutine runner for this behaviour instance.
     * Lazy-initialized on first `startCoroutine()` call to avoid
     * allocation overhead for behaviours that never use coroutines.
     * @internal
     */
    private _coroutineRunner: CoroutineRunner | null = null;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== COROUTINE API ====================

    /**
     * Starts a coroutine.
     *
     * The generator function is advanced once immediately (up to the first yield).
     * Subsequent yields are processed by the engine each frame.
     *
     * @param generator — the generator (result of calling a `function*`).
     * @returns a {@link Coroutine} handle that can be yielded (to wait for it)
     *          or passed to {@link stopCoroutine}.
     *
     * @remarks Equivalent to Unity's `MonoBehaviour.StartCoroutine()`.
     *
     * @example
     * ```ts
     * const co = this.startCoroutine(this.fadeOut());
     * // later:
     * this.stopCoroutine(co);
     * ```
     */
    public startCoroutine(generator: Generator<YieldInstruction, void, void>): Coroutine {
        if (!this._coroutineRunner) {
            this._coroutineRunner = new CoroutineRunner();
        }
        return this._coroutineRunner.startCoroutine(generator);
    }

    /**
     * Stops a specific coroutine.
     *
     * @param coroutine — the handle returned by {@link startCoroutine}.
     *
     * @remarks Equivalent to Unity's `MonoBehaviour.StopCoroutine()`.
     */
    public stopCoroutine(coroutine: Coroutine): void {
        this._coroutineRunner?.stopCoroutine(coroutine);
    }

    /**
     * Stops all coroutines running on this behaviour.
     *
     * @remarks Equivalent to Unity's `MonoBehaviour.StopAllCoroutines()`.
     */
    public stopAllCoroutines(): void {
        this._coroutineRunner?.stopAllCoroutines();
    }

    /**
     * @internal
     * Stops coroutines when the GameObject is deactivated.
     *
     * @remarks
     * Unity draws a line the engine previously did not: deactivating a
     * GameObject **stops** its coroutines for good, and reactivating it does
     * not resume them. Merely disabling the behaviour does not stop them at
     * all. Without this, a deactivate/reactivate cycle resumed a coroutine
     * mid-flight — the object came back and finished a sequence the scene had
     * moved on from.
     *
     * The `enabled = false` half of Unity's rule is not implemented; see F5 in
     * `design/audit/findings.md`. Coroutines still pause while a behaviour is
     * disabled, because the update dispatch skips disabled behaviours entirely.
     *
     * **NEVER use in user-facing code.**
     */
    public override _onEnabledChanged(): void {
        super._onEnabledChanged();

        if (!this.gameObject.activeInHierarchy) {
            this._coroutineRunner?.stopAllCoroutines();
        }
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
     * @virtual Override in user scripts.
     */
    protected override onDestroy(): void {
        // Stop all coroutines on destroy
        this._coroutineRunner?.stopAllCoroutines();
        // Override in user scripts for additional cleanup
    }

    // ==================== INTERNAL SYSTEM METHODS ====================

    /**
     * @internal
     * Called by `GameObject.addComponent()` immediately after the component
     * is constructed and added to the components list.
     *
     * Invokes the user-facing {@link awake} callback.
     */
    public _systemAwake(): void {
        this.awake();
    }

    /**
     * @internal
     * Called by the engine's update loop (via `GameObject._systemUpdate`).
     *
     * Handles the Start-before-first-Update guarantee, then runs Update,
     * then ticks coroutines (Update phase).
     */
    public _systemUpdate(): void {
        if (!this.isActiveAndEnabled) return;

        if (!this._started) {
            this.start();
            this._started = true;
        }

        this.update();

        // Tick coroutines after user Update (Unity order)
        this._coroutineRunner?.tickUpdate();
    }

    /**
     * @internal
     * Called by the engine's late update loop (via `GameObject._systemLateUpdate`).
     *
     * Runs LateUpdate, then ticks coroutines (LateUpdate phase — resolves WaitForEndOfFrame).
     */
    public _systemLateUpdate(): void {
        if (this.isActiveAndEnabled && this._started) {
            this.lateUpdate();
            // Resolve WaitForEndOfFrame
            this._coroutineRunner?.tickLateUpdate();
        }
    }

    /**
     * @internal
     * Called by the engine's fixed update loop (via `GameObject._systemFixedUpdate`).
     *
     * Runs FixedUpdate, then ticks coroutines (FixedUpdate phase — resolves WaitForFixedUpdate).
     */
    public _systemFixedUpdate(): void {
        if (this.isActiveAndEnabled && this._started) {
            this.fixedUpdate();
            // Resolve WaitForFixedUpdate
            this._coroutineRunner?.tickFixedUpdate();
        }
    }
}