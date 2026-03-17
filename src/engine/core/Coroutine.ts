// path: src/engine/core/Coroutine.ts

import { Time } from "./Time.ts";

// ==================== YIELD INSTRUCTIONS ====================

/**
 * Suspends a coroutine for a given number of **scaled** seconds.
 *
 * @remarks Equivalent to Unity's `WaitForSeconds`.
 *
 * @example
 * ```ts
 * *myRoutine() {
 *     console.log("Start");
 *     yield new WaitForSeconds(2);
 *     console.log("2 seconds later");
 * }
 * ```
 */
export class WaitForSeconds {
    /** @internal */ public readonly _duration: number;
    /** @internal */ public _elapsed: number = 0;

    constructor(seconds: number) {
        this._duration = seconds;
    }
}

/**
 * Suspends a coroutine for a given number of **unscaled** (real-time) seconds.
 * Not affected by `Time.timeScale`.
 *
 * @remarks Equivalent to Unity's `WaitForSecondsRealtime`.
 */
export class WaitForSecondsRealtime {
    /** @internal */ public readonly _duration: number;
    /** @internal */ public _elapsed: number = 0;

    constructor(seconds: number) {
        this._duration = seconds;
    }
}

/**
 * Suspends a coroutine until a predicate returns `true`.
 *
 * The predicate is checked every frame.
 *
 * @remarks Equivalent to Unity's `WaitUntil`.
 *
 * @example
 * ```ts
 * yield new WaitUntil(() => this.health > 0);
 * ```
 */
export class WaitUntil {
    /** @internal */ public readonly _predicate: () => boolean;

    constructor(predicate: () => boolean) {
        this._predicate = predicate;
    }
}

/**
 * Suspends a coroutine while a predicate returns `true`.
 * Resumes when the predicate becomes `false`.
 *
 * @remarks Equivalent to Unity's `WaitWhile`.
 */
export class WaitWhile {
    /** @internal */ public readonly _predicate: () => boolean;

    constructor(predicate: () => boolean) {
        this._predicate = predicate;
    }
}

/**
 * Suspends a coroutine until the end of the current frame
 * (after all Update and LateUpdate calls).
 *
 * @remarks Equivalent to Unity's `WaitForEndOfFrame`.
 */
export class WaitForEndOfFrame {
    /** @internal */ public _done: boolean = false;
}

/**
 * Suspends a coroutine until the next FixedUpdate.
 *
 * @remarks Equivalent to Unity's `WaitForFixedUpdate`.
 */
export class WaitForFixedUpdate {
    /** @internal */ public _done: boolean = false;
}

// ==================== YIELD TYPE ====================

/**
 * All possible yield return types for a coroutine.
 */
export type YieldInstruction =
    | WaitForSeconds
    | WaitForSecondsRealtime
    | WaitUntil
    | WaitWhile
    | WaitForEndOfFrame
    | WaitForFixedUpdate
    | Coroutine           // yield another coroutine = wait for it to finish
    | null                // null / undefined = wait one frame
    | undefined;

// ==================== COROUTINE ====================

/**
 * Represents a running coroutine instance.
 *
 * Created by {@link CoroutineRunner.startCoroutine} and can be passed
 * to {@link CoroutineRunner.stopCoroutine} to cancel it.
 *
 * Coroutines can `yield` other coroutines to wait for their completion.
 *
 * @remarks Equivalent to Unity's `Coroutine`.
 */
export class Coroutine {
    /** @internal */ public readonly _iterator: Generator<YieldInstruction, void, void>;
    /** @internal */ public _currentYield: YieldInstruction = null;
    /** @internal */ public _isFinished: boolean = false;

    /** @internal */
    constructor(iterator: Generator<YieldInstruction, void, void>) {
        this._iterator = iterator;
    }

    /**
     * Whether this coroutine has finished executing.
     */
    public get isFinished(): boolean {
        return this._isFinished;
    }
}

// ==================== COROUTINE RUNNER ====================

/**
 * Manages coroutine lifecycle for a single owner (typically a ScriptableBehaviour).
 *
 * The engine calls the tick methods at appropriate lifecycle phases:
 * - {@link tickUpdate} — after Update, processes most yield instructions
 * - {@link tickLateUpdate} — after LateUpdate, resolves `WaitForEndOfFrame`
 * - {@link tickFixedUpdate} — during FixedUpdate, resolves `WaitForFixedUpdate`
 *
 * @internal Used by ScriptableBehaviour; not exposed to users directly.
 */
export class CoroutineRunner {

    /** Active coroutines. */
    private _coroutines: Coroutine[] = [];

    /**
     * Starts a coroutine from a generator function.
     *
     * @param generator — the generator (result of calling a `function*`).
     * @returns the Coroutine handle, which can be yielded or stopped.
     */
    public startCoroutine(generator: Generator<YieldInstruction, void, void>): Coroutine {
        const co = new Coroutine(generator);
        // Advance to first yield immediately (Unity behaviour)
        this._advance(co);
        if (!co._isFinished) {
            this._coroutines.push(co);
        }
        return co;
    }

    /**
     * Stops a specific coroutine.
     *
     * @param coroutine — the handle returned by {@link startCoroutine}.
     */
    public stopCoroutine(coroutine: Coroutine): void {
        coroutine._isFinished = true;
        const idx = this._coroutines.indexOf(coroutine);
        if (idx !== -1) this._coroutines.splice(idx, 1);
    }

    /**
     * Stops all coroutines owned by this runner.
     */
    public stopAllCoroutines(): void {
        for (const co of this._coroutines) {
            co._isFinished = true;
        }
        this._coroutines.length = 0;
    }

    /**
     * Returns the number of active coroutines.
     */
    public get count(): number {
        return this._coroutines.length;
    }

    // ==================== PHASE TICKS ====================

    /**
     * Called during Update phase. Processes:
     * - `null` / `undefined` (wait one frame)
     * - `WaitForSeconds` (scaled time)
     * - `WaitForSecondsRealtime` (unscaled time)
     * - `WaitUntil` / `WaitWhile`
     * - Nested `Coroutine` (wait for child)
     *
     * @internal
     */
    public tickUpdate(): void {
        const dt = Time.deltaTime;
        const udt = Time.unscaledDeltaTime;

        for (let i = this._coroutines.length - 1; i >= 0; i--) {
            const co = this._coroutines[i];
            if (co._isFinished) {
                this._coroutines.splice(i, 1);
                continue;
            }

            const y = co._currentYield;

            // null / undefined → waited one frame, advance
            if (y === null || y === undefined) {
                this._advance(co);
                if (co._isFinished) this._coroutines.splice(i, 1);
                continue;
            }

            // WaitForSeconds (scaled)
            if (y instanceof WaitForSeconds) {
                y._elapsed += dt;
                if (y._elapsed >= y._duration) {
                    this._advance(co);
                    if (co._isFinished) this._coroutines.splice(i, 1);
                }
                continue;
            }

            // WaitForSecondsRealtime (unscaled)
            if (y instanceof WaitForSecondsRealtime) {
                y._elapsed += udt;
                if (y._elapsed >= y._duration) {
                    this._advance(co);
                    if (co._isFinished) this._coroutines.splice(i, 1);
                }
                continue;
            }

            // WaitUntil
            if (y instanceof WaitUntil) {
                if (y._predicate()) {
                    this._advance(co);
                    if (co._isFinished) this._coroutines.splice(i, 1);
                }
                continue;
            }

            // WaitWhile
            if (y instanceof WaitWhile) {
                if (!y._predicate()) {
                    this._advance(co);
                    if (co._isFinished) this._coroutines.splice(i, 1);
                }
                continue;
            }

            // Nested Coroutine — wait for it to finish
            if (y instanceof Coroutine) {
                if (y._isFinished) {
                    this._advance(co);
                    if (co._isFinished) this._coroutines.splice(i, 1);
                }
                continue;
            }

            // WaitForEndOfFrame / WaitForFixedUpdate — handled by other tick methods
        }
    }

    /**
     * Called during LateUpdate phase. Resolves `WaitForEndOfFrame`.
     *
     * @internal
     */
    public tickLateUpdate(): void {
        for (let i = this._coroutines.length - 1; i >= 0; i--) {
            const co = this._coroutines[i];
            if (co._isFinished) {
                this._coroutines.splice(i, 1);
                continue;
            }

            if (co._currentYield instanceof WaitForEndOfFrame) {
                this._advance(co);
                if (co._isFinished) this._coroutines.splice(i, 1);
            }
        }
    }

    /**
     * Called during FixedUpdate phase. Resolves `WaitForFixedUpdate`.
     *
     * @internal
     */
    public tickFixedUpdate(): void {
        for (let i = this._coroutines.length - 1; i >= 0; i--) {
            const co = this._coroutines[i];
            if (co._isFinished) {
                this._coroutines.splice(i, 1);
                continue;
            }

            if (co._currentYield instanceof WaitForFixedUpdate) {
                this._advance(co);
                if (co._isFinished) this._coroutines.splice(i, 1);
            }
        }
    }

    // ==================== PRIVATE ====================

    /**
     * Advances the coroutine by one step.
     * Sets `_currentYield` to the next yielded value, or marks as finished.
     */
    private _advance(co: Coroutine): void {
        try {
            const result = co._iterator.next();
            if (result.done) {
                co._isFinished = true;
            } else {
                co._currentYield = result.value;
            }
        } catch (err) {
            console.error("[Coroutine] Error in coroutine:", err);
            co._isFinished = true;
        }
    }
}