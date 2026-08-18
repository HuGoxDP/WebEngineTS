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
 * 1. `Awake()` — called once when the component is created, or, if the
 *    GameObject is inactive, when it is first activated.
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
     * Whether {@link awake} has been called. A script added to an inactive
     * GameObject waits here until the object is activated — Unity's rule — and
     * the flag makes the deferred call idempotent.
     * @internal
     */
    private _awakeCalled: boolean = false;

    /**
     * Coroutine runner for this behaviour instance.
     * Lazy-initialized on first `startCoroutine()` call to avoid
     * allocation overhead for behaviours that never use coroutines.
     * @internal
     */
    private _coroutineRunner: CoroutineRunner | null = null;

    /**
     * How many consecutive failures a script may have before it is disabled.
     * Applies per script instance and resets on the first callback that
     * returns normally. `0` disables the policy and lets a script throw
     * forever.
     */
    public static callbackFailureLimit: number = 3;

    /**
     * Whether one script's exception is contained to that script.
     *
     * @remarks
     * `true` (default) is Unity's behaviour and the platform's requirement: a
     * throw in one `update` is logged, the script that threw is skipped, and
     * every other component, the scenario, the animation, the particles, the
     * UI and the input still run. One broken script in one lesson must not
     * freeze the lesson.
     *
     * Set it to `false` while debugging to get the old hard stop, where the
     * exception reaches `Application._loop` and the frame ends at the throw.
     * The engine stays consistent either way — the loop body is wrapped in a
     * `try`/`finally` so the frame's bookkeeping always completes.
     *
     * **Isolation does not mean silence.** Every failure is logged with the
     * script, its GameObject and the phase, and a script that fails
     * {@link callbackFailureLimit} times in a row is disabled with a line
     * saying so. A script that is broken stops running and says why, which is
     * louder than a stack trace scrolling past sixty times a second.
     */
    public static isolateCallbackErrors: boolean = true;

    /** Consecutive failed callbacks, reset by the first one that succeeds. */
    private _consecutiveFailures: number = 0;

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
     * The other half of Unity's rule is the opposite one, and is implemented in
     * `_systemUpdate`: setting `enabled = false` does **not** stop or pause a
     * coroutine. The runner is ticked whenever the GameObject is active, so
     * disabling the script pauses the script and leaves the sequence running.
     *
     * **NEVER use in user-facing code.**
     */
    public override _onEnabledChanged(): void {
        // Awake before the first onEnable, whatever did the enabling.
        // `GameObject` wakes a whole object's deferred scripts before notifying
        // any of them, which is the ordering Unity gives; this is the guarantee
        // underneath it. Every route that can turn a script on ends here —
        // setActive, a parent's propagation, `enabled = true` — so none of them
        // can fire onEnable on a script that has never woken. `_systemAwake` is
        // idempotent, so the two never collide.
        if (!this._awakeCalled && this.isActiveAndEnabled) this._systemAwake();

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
     * any other methods are called. A script whose `enabled` is `false` still
     * wakes; a script on an **inactive GameObject** does not, and waits until
     * the object is activated — Unity's rule, so `awake` always runs shortly
     * before the first `onEnable` rather than during a build-hidden phase.
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
        if (this._awakeCalled) return;
        this._awakeCalled = true;
        this.awake();
    }

    /**
     * @internal
     * Whether {@link awake} has run. `false` on a script added to an inactive
     * GameObject that has not been activated since.
     */
    public get _hasAwoken(): boolean {
        return this._awakeCalled;
    }

    /**
     * @internal
     * Skips {@link onDestroy} on a script that never woke.
     *
     * @remarks
     * Unity's rule: *"OnDestroy will only be called on game objects that have
     * previously been active."* A script added to an inactive object and
     * destroyed without ever being activated never ran `awake`, so it never set
     * anything up and its cleanup has nothing to undo — calling it would hand
     * user code an object in a state it has never seen. Engine-side teardown
     * still happens; only the user callback is skipped.
     */
    protected override _invokeOnDestroy(): void {
        if (!this._awakeCalled) {
            this._coroutineRunner?.stopAllCoroutines();
            return;
        }
        super._invokeOnDestroy();
    }

    /**
     * @internal
     * Called by the engine's update loop (via `GameObject._systemUpdate`).
     *
     * Handles the Start-before-first-Update guarantee, then runs Update,
     * then ticks coroutines (Update phase).
     */
    public _systemUpdate(): void {
        // Unity splits the two flags, and so does this. A behaviour whose
        // GameObject is inactive does nothing at all. A behaviour that is
        // merely `enabled = false` runs no callbacks — but its coroutines keep
        // going, which is the rule that makes a coroutine a useful place to put
        // a sequence: disabling the script pauses the script, not the sequence.
        if (!this.exists() || !this.gameObject.activeInHierarchy) return;

        this._guard("update", () => {
            if (this.enabled) {
                if (!this._started) {
                    this.start();
                    this._started = true;
                }

                this.update();
            }

            // Ticked whatever `enabled` says, after user Update (Unity order).
            this._coroutineRunner?.tickUpdate();
        });
    }

    /**
     * @internal
     * Called by the engine's late update loop (via `GameObject._systemLateUpdate`).
     *
     * Runs LateUpdate, then ticks coroutines (LateUpdate phase — resolves WaitForEndOfFrame).
     */
    public _systemLateUpdate(): void {
        if (!this.exists() || !this.gameObject.activeInHierarchy) return;

        this._guard("lateUpdate", () => {
            if (this.enabled && this._started) this.lateUpdate();

            // Resolve WaitForEndOfFrame — for a disabled behaviour too, or a
            // coroutine still running on it would wait forever.
            this._coroutineRunner?.tickLateUpdate();
        });
    }

    /**
     * @internal
     * Called by the engine's fixed update loop (via `GameObject._systemFixedUpdate`).
     *
     * Runs FixedUpdate, then ticks coroutines (FixedUpdate phase — resolves WaitForFixedUpdate).
     */
    public _systemFixedUpdate(): void {
        if (!this.exists() || !this.gameObject.activeInHierarchy) return;

        this._guard("fixedUpdate", () => {
            if (this.enabled && this._started) this.fixedUpdate();

            // Resolve WaitForFixedUpdate — same reason as above.
            this._coroutineRunner?.tickFixedUpdate();
        });
    }

    /**
     * Runs one lifecycle callback under the isolation policy.
     *
     * @remarks
     * The whole of F22 lives here. When {@link isolateCallbackErrors} is off
     * the callback is invoked directly, so the exception reaches the loop and
     * the behaviour is exactly what it was before the policy existed.
     *
     * @param phase - the callback's name, for the log line.
     * @param body - the callback and whatever must run with it.
     */
    private _guard(phase: string, body: () => void): void {
        if (!ScriptableBehaviour.isolateCallbackErrors) {
            body();
            return;
        }

        try {
            body();
            this._consecutiveFailures = 0;
        } catch (error) {
            this._consecutiveFailures++;
            const who = `${this.constructor.name} on "${this.gameObject.name}"`;
            console.error(`[Engine] ${who} threw in ${phase}():`, error);

            const limit = ScriptableBehaviour.callbackFailureLimit;
            if (limit > 0 && this._consecutiveFailures >= limit) {
                this.enabled = false;
                console.error(
                    `[Engine] ${who} disabled after ${this._consecutiveFailures} ` +
                    `consecutive failures. Fix the error and re-enable it, or set ` +
                    `ScriptableBehaviour.callbackFailureLimit = 0 to keep it running.`,
                );
            }
        }
    }
}