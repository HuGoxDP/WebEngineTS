import { Time } from "../Time";
import { Mathf } from "../math/Mathf";
import { Color } from "../math/Color";
import { Vector2 } from "../math/Vector2";
import { UIEvent } from "./UIEvent";
import type { RectTransform } from "./RectTransform";

/** Shape of the easing applied to a tween's normalized progress. */
export enum UIEase {
    /** Constant speed. */
    Linear = "Linear",
    /** Starts slow. */
    In = "In",
    /** Ends slow — the default, and what most UI motion wants. */
    Out = "Out",
    /** Slow at both ends. */
    InOut = "InOut",
    /** Overshoots the target and settles back. */
    Back = "Back",
}

/** Anything with an `alpha` — a `CanvasGroup` or a `Canvas`. */
export interface IFadeable {
    alpha: number;
}

/** Anything with a `color` — every built-in graphic. */
export interface ITintable {
    color: Color;
}

/** How far a `Back` ease overshoots. The usual constant. */
const BACK_OVERSHOOT = 1.70158;

/**
 * A running tween, and the way to stop one.
 *
 * @remarks
 * Returned by every {@link UITween} method. Holding it is optional — a tween
 * runs to completion on its own — but it is how a scenario interrupts one, and
 * how it learns the motion finished.
 */
export class UITweenHandle {

    /** Raised once when the tween reaches its end. Not raised on {@link cancel}. */
    public readonly onComplete: UIEvent<void> = new UIEvent<void>();

    /** @internal */
    public _elapsed: number = 0;

    /** @internal */
    public _done: boolean = false;

    /**
     * @internal
     * The target's own liveness test, when it has one.
     *
     * @remarks
     * Every real target is an `EngineObject` — a `RectTransform`, a `UIImage`, a
     * `CanvasGroup` — so this is duck-typed rather than imported, and a target
     * that has no `exists()` simply never expires.
     */
    public _alive: { exists(): boolean } | null = null;

    /** @internal */
    constructor(
        /** @internal */ public readonly _duration: number,
        /** @internal */ public readonly _ease: UIEase,
        /** @internal */ public readonly _unscaled: boolean,
        /** @internal */ public readonly _apply: (t: number) => void,
    ) {}

    /** Whether the tween is still running. */
    public get isPlaying(): boolean { return !this._done; }

    /** Progress from 0 to 1, before easing. */
    public get progress(): number {
        return this._duration > 0 ? Mathf.clamp01(this._elapsed / this._duration) : 1;
    }

    /**
     * Stops the tween where it is.
     *
     * @remarks
     * The target keeps whatever value it had reached — the point of cancelling
     * is usually that something else is about to drive it.
     * {@link onComplete} does **not** fire, since the motion did not finish.
     */
    public cancel(): void {
        this._done = true;
    }

    /** Jumps to the end value immediately and raises {@link onComplete}. */
    public complete(): void {
        if (this._done) return;
        this._elapsed = this._duration;
        this._apply(1);
        this._done = true;
        this.onComplete.invoke(undefined);
    }
}

/**
 * Short animations for UI properties — fades, colour changes, moves, scales.
 *
 * @remarks
 * Deliberately small: this is the "juice" layer, not an animation system. A
 * button that pops when pressed, a panel that slides in, a hint that fades out
 * — each is one call, and each returns a {@link UITweenHandle} to interrupt it.
 * Anything richer belongs in an `AnimationCurve` driven by scenario code.
 *
 * ```ts
 * UITween.fade(panelGroup, 0, 0.25);                    // fade a panel out
 * UITween.scale(icon.rectTransform, Vector2.one, 0.2, UIEase.Back);
 * ```
 *
 * **Unscaled by default.** A pause menu fading in while `Time.timeScale` is 0
 * has to keep moving, and that is the common case for UI. Pass
 * `unscaled = false` for motion that should stop with the game.
 *
 * Tweens are driven once per frame from `Application._loop`, before the layout
 * pass, so a tweened size or position is laid out and drawn on the same frame.
 */
export class UITween {

    private static _active: UITweenHandle[] = [];

    /**
     * @internal
     * Advances every running tween. Called from Application._loop ahead of the
     * layout pass.
     */
    public static _updateAll(): void {
        const active = UITween._active;
        if (active.length === 0) return;

        const scaled = Time.deltaTime;
        const unscaled = Time.unscaledDeltaTime;

        // Backwards, so completing or cancelling one mid-pass cannot skip its
        // neighbour — handlers routinely start the next tween in a sequence.
        for (let i = active.length - 1; i >= 0; i--) {
            const t = active[i];
            if (t._done) { active.splice(i, 1); continue; }

            // A tween outliving its target writes to a destroyed component
            // every frame and, being held in a static list, keeps it alive.
            // Asking costs nothing here — the tween is already being visited.
            if (t._alive !== null && !t._alive.exists()) {
                t.cancel();
                active.splice(i, 1);
                continue;
            }

            t._elapsed += t._unscaled ? unscaled : scaled;
            const raw = t.progress;
            t._apply(UITween._ease(t._ease, raw));

            if (raw >= 1) {
                t._done = true;
                active.splice(i, 1);
                t.onComplete.invoke(undefined);
            }
        }
    }

    /** Number of tweens currently running. */
    public static get activeCount(): number { return UITween._active.length; }

    /**
     * Cancels every running tween.
     *
     * @remarks
     * Targets keep the values they had reached. Worth calling when a scenario
     * tears down its UI, so nothing keeps writing to discarded components.
     */
    public static cancelAll(): void {
        for (const t of UITween._active) t._done = true;
        UITween._active.length = 0;
    }

    /** @internal */
    public static _reset(): void {
        UITween._active.length = 0;
    }

    private constructor() {}

    // ── the tweens ───────────────────────────────────────────────────

    /**
     * Fades a {@link CanvasGroup} or {@link Canvas} to `to`.
     *
     * @param target - anything exposing `alpha`.
     * @param to - target alpha, 0–1.
     * @param duration - seconds.
     * @param ease - easing shape. Defaults to {@link UIEase.Out}.
     * @param unscaled - whether to ignore `Time.timeScale`. Defaults to true.
     * @returns the running tween.
     */
    public static fade(
        target: IFadeable,
        to: number,
        duration: number,
        ease: UIEase = UIEase.Out,
        unscaled: boolean = true,
    ): UITweenHandle {
        const from = target.alpha;
        return UITween._start(target, duration, ease, unscaled, (t) => {
            target.alpha = from + (to - from) * t;
        });
    }

    /**
     * Tints a graphic to `to`, alpha included.
     *
     * @param target - anything exposing a `color`, such as a `UIImage`.
     * @param to - target colour. Copied, so the caller may reuse it.
     * @param duration - seconds.
     * @param ease - easing shape. Defaults to {@link UIEase.Out}.
     * @param unscaled - whether to ignore `Time.timeScale`. Defaults to true.
     * @returns the running tween.
     */
    public static color(
        target: ITintable,
        to: Color,
        duration: number,
        ease: UIEase = UIEase.Out,
        unscaled: boolean = true,
    ): UITweenHandle {
        const from = target.color.clone();
        const end = to.clone();
        return UITween._start(target, duration, ease, unscaled, (t) => {
            target.color.set(
                from.r + (end.r - from.r) * t,
                from.g + (end.g - from.g) * t,
                from.b + (end.b - from.b) * t,
                from.a + (end.a - from.a) * t,
            );
        });
    }

    /**
     * Scales a RectTransform about its pivot.
     *
     * @param target - the element to scale.
     * @param to - target scale. Copied, so the caller may reuse it.
     * @param duration - seconds.
     * @param ease - easing shape. Defaults to {@link UIEase.Out}.
     * @param unscaled - whether to ignore `Time.timeScale`. Defaults to true.
     * @returns the running tween.
     */
    public static scale(
        target: RectTransform,
        to: Vector2,
        duration: number,
        ease: UIEase = UIEase.Out,
        unscaled: boolean = true,
    ): UITweenHandle {
        const fromX = target.localScale.x;
        const fromY = target.localScale.y;
        const toX = to.x;
        const toY = to.y;
        return UITween._start(target, duration, ease, unscaled, (t) => {
            target.localScale.set(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
        });
    }

    /**
     * Moves a RectTransform's {@link RectTransform.anchoredPosition}.
     *
     * @remarks
     * Because Y points down, a larger `to.y` slides the element *downward*.
     *
     * @param target - the element to move.
     * @param to - target anchored position. Copied, so the caller may reuse it.
     * @param duration - seconds.
     * @param ease - easing shape. Defaults to {@link UIEase.Out}.
     * @param unscaled - whether to ignore `Time.timeScale`. Defaults to true.
     * @returns the running tween.
     */
    public static move(
        target: RectTransform,
        to: Vector2,
        duration: number,
        ease: UIEase = UIEase.Out,
        unscaled: boolean = true,
    ): UITweenHandle {
        const fromX = target.anchoredPosition.x;
        const fromY = target.anchoredPosition.y;
        const toX = to.x;
        const toY = to.y;
        return UITween._start(target, duration, ease, unscaled, (t) => {
            target.anchoredPosition.set(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
        });
    }

    /**
     * Rotates a RectTransform about its pivot, in degrees.
     *
     * @remarks
     * Because Y points down, a positive angle turns **clockwise** on screen.
     *
     * @param target - the element to rotate.
     * @param to - target angle in degrees.
     * @param duration - seconds.
     * @param ease - easing shape. Defaults to {@link UIEase.Out}.
     * @param unscaled - whether to ignore `Time.timeScale`. Defaults to true.
     * @returns the running tween.
     */
    public static rotate(
        target: RectTransform,
        to: number,
        duration: number,
        ease: UIEase = UIEase.Out,
        unscaled: boolean = true,
    ): UITweenHandle {
        const from = target.localRotation;
        return UITween._start(target, duration, ease, unscaled, (t) => {
            target.localRotation = from + (to - from) * t;
        });
    }

    // ── private ──────────────────────────────────────────────────────

    private static _start(
        target: unknown,
        duration: number,
        ease: UIEase,
        unscaled: boolean,
        apply: (t: number) => void,
    ): UITweenHandle {
        const handle = new UITweenHandle(Math.max(0, duration), ease, unscaled, apply);
        handle._alive = UITween._liveness(target);

        // A zero-length tween is a plain assignment, and callers rely on it
        // landing before the next line rather than a frame later.
        if (handle._duration <= 0) {
            handle.complete();
            return handle;
        }

        UITween._active.push(handle);
        return handle;
    }

    /** A target's `exists()`, when it is an engine object that has one. */
    private static _liveness(target: unknown): { exists(): boolean } | null {
        const exists = (target as { exists?: () => boolean } | null)?.exists;
        return typeof exists === "function" ? (target as { exists(): boolean }) : null;
    }

    private static _ease(kind: UIEase, t: number): number {
        switch (kind) {
            case UIEase.In:
                return t * t;
            case UIEase.Out:
                return 1 - (1 - t) * (1 - t);
            case UIEase.InOut:
                return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
            case UIEase.Back: {
                const s = BACK_OVERSHOOT;
                const u = t - 1;
                return u * u * ((s + 1) * u + s) + 1;
            }
            default:
                return t;
        }
    }
}
