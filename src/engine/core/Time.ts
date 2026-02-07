// path: src/engine/core/Time.ts

import { EngineSettings } from "./EngineSettings.ts";

/**
 * Provides time-related information for the engine.
 *
 * All public properties are **read-only** from user scripts.
 * The engine updates them internally via {@link _update}.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Time`.
 *
 * Key properties:
 * - {@link deltaTime} — scaled frame time (affected by {@link timeScale})
 * - {@link unscaledDeltaTime} — raw frame time (unaffected by timeScale)
 * - {@link time} — total scaled time since startup
 * - {@link timeScale} — time multiplier (0 = paused, 1 = normal, 2 = fast)
 *
 * @example
 * ```ts
 * // Frame-rate-independent movement
 * this.transform.translate(direction.scale(speed * Time.deltaTime));
 *
 * // Pause-safe UI animation
 * opacity = Math.sin(Time.unscaledTime * 2);
 * ```
 */
export class Time {
    // ==================== INTERNAL STATE ====================

    /** Scaled delta time for the current frame. */
    private static _deltaTime: number = 0;

    /** Raw (unscaled) delta time for the current frame. */
    private static _unscaledDeltaTime: number = 0;

    /** Total elapsed scaled time. */
    private static _time: number = 0;

    /** Total elapsed unscaled time. */
    private static _unscaledTime: number = 0;

    /** Wall-clock time since application start (unaffected by timeScale or capping). */
    private static _realtimeSinceStartup: number = 0;

    /** Total number of frames rendered. */
    private static _frameCount: number = 0;

    /** Time scale multiplier. Writable by user. */
    private static _timeScale: number = 1.0;

    /** Fixed timestep for physics. Writable by user. */
    private static _fixedDeltaTime: number = EngineSettings.Time.FIXED_TIMESTEP;

    /** Maximum delta time cap. */
    private static _maximumDeltaTime: number = EngineSettings.Time.MAX_DELTA_TIME;

    /** Smoothed delta time (exponential moving average). */
    private static _smoothDeltaTime: number = 0;

    /** Smoothing factor for smoothDeltaTime (lower = smoother, slower to react). */
    private static readonly _SMOOTH_FACTOR: number = 0.1;

    /** Timestamp of engine start for realtimeSinceStartup. */
    private static _startTime: number = 0;

    /** Whether the start time has been recorded. */
    private static _initialized: boolean = false;


    // ==================== PUBLIC READ-ONLY PROPERTIES ====================

    /**
     * The interval in seconds from the last frame to the current one,
     * scaled by {@link timeScale}.
     *
     * @remarks
     * Equivalent to Unity's `Time.deltaTime`.
     * Use this for all gameplay movement and logic.
     */
    public static get deltaTime(): number {
        return Time._deltaTime;
    }

    /**
     * The timeScale-independent interval in seconds from the last frame
     * to the current one.
     *
     * @remarks
     * Equivalent to Unity's `Time.unscaledDeltaTime`.
     * Use for UI animations, pause menus, and anything that should
     * continue during slow-motion or pause.
     */
    public static get unscaledDeltaTime(): number {
        return Time._unscaledDeltaTime;
    }

    /**
     * The total elapsed scaled time since the start of the game.
     *
     * @remarks
     * Equivalent to Unity's `Time.time`.
     * Affected by {@link timeScale}.
     */
    public static get time(): number {
        return Time._time;
    }

    /**
     * The total elapsed unscaled time since the start of the game.
     *
     * @remarks
     * Equivalent to Unity's `Time.unscaledTime`.
     * Not affected by timeScale. Useful for fixed-rate animations.
     */
    public static get unscaledTime(): number {
        return Time._unscaledTime;
    }

    /**
     * The real time in seconds since the game started.
     *
     * @remarks
     * Equivalent to Unity's `Time.realtimeSinceStartup`.
     * Uses `performance.now()` — unaffected by timeScale or frame capping.
     */
    public static get realtimeSinceStartup(): number {
        return Time._realtimeSinceStartup;
    }

    /**
     * The total number of frames that have been rendered.
     *
     * @remarks
     * Equivalent to Unity's `Time.frameCount`.
     */
    public static get frameCount(): number {
        return Time._frameCount;
    }

    /**
     * A smoothed-out delta time, useful for display purposes
     * or when raw deltaTime jitter is undesirable.
     *
     * @remarks
     * Equivalent to Unity's `Time.smoothDeltaTime`.
     * Computed as an exponential moving average of deltaTime.
     */
    public static get smoothDeltaTime(): number {
        return Time._smoothDeltaTime;
    }

    // ==================== PUBLIC WRITABLE PROPERTIES ====================

    /**
     * The scale at which time passes. Default is `1.0`.
     *
     * - `1.0` — normal speed
     * - `0.5` — half speed (slow motion)
     * - `0.0` — paused (deltaTime becomes 0, but unscaledDeltaTime still updates)
     * - `2.0` — double speed
     *
     * @remarks
     * Equivalent to Unity's `Time.timeScale`.
     */
    public static get timeScale(): number {
        return Time._timeScale;
    }

    public static set timeScale(value: number) {
        Time._timeScale = Math.max(0, value);
    }

    /**
     * The interval in seconds at which physics (FixedUpdate) runs.
     * Default is `0.02` (50 Hz).
     *
     * @remarks
     * Equivalent to Unity's `Time.fixedDeltaTime`.
     */
    public static get fixedDeltaTime(): number {
        return Time._fixedDeltaTime;
    }

    public static set fixedDeltaTime(value: number) {
        Time._fixedDeltaTime = Math.max(0.001, value);
    }

    /**
     * The maximum value that {@link unscaledDeltaTime} can report.
     * Prevents physics death spiral during lag spikes.
     *
     * @remarks
     * Equivalent to Unity's `Time.maximumDeltaTime`.
     * Default: `0.1` seconds (from EngineSettings).
     */
    public static get maximumDeltaTime(): number {
        return Time._maximumDeltaTime;
    }

    public static set maximumDeltaTime(value: number) {
        Time._maximumDeltaTime = Math.max(0.01, value);
    }

    // ==================== INTERNAL METHODS ====================

    /**
     * @internal
     * Updates all time values. Called once per frame by Application.
     *
     * @param rawDeltaSeconds - Wall-clock time elapsed since last frame, in seconds.
     *        Already capped by {@link maximumDeltaTime} by the caller (Application).
     */
    public static _update(rawDeltaSeconds: number): void {
        // Initialize start time on first call
        if (!Time._initialized) {
            Time._startTime = performance.now() / 1000;
            Time._initialized = true;
        }
        // Cap raw delta
        const cappedDelta = Math.min(rawDeltaSeconds, Time._maximumDeltaTime);

        // Unscaled values (raw, before timeScale)
        Time._unscaledDeltaTime = cappedDelta;
        Time._unscaledTime += cappedDelta;

        // Scaled values (affected by timeScale)
        Time._deltaTime = cappedDelta * Time._timeScale;
        Time._time += Time._deltaTime;

        // Real time (pure wall clock — not capped)
        Time._realtimeSinceStartup = (performance.now() / 1000) - Time._startTime;

        // Smooth delta time (exponential moving average)
        if (Time._frameCount === 0) {
            Time._smoothDeltaTime = Time._deltaTime;
        } else {
            Time._smoothDeltaTime += (Time._deltaTime - Time._smoothDeltaTime) * Time._SMOOTH_FACTOR;
        }

        // Frame counter
        Time._frameCount++;
    }

    /**
     * @internal
     * Resets all time state. Useful for testing or scene reloads.
     */
    public static _reset(): void {
        Time._deltaTime = 0;
        Time._unscaledDeltaTime = 0;
        Time._time = 0;
        Time._unscaledTime = 0;
        Time._realtimeSinceStartup = 0;
        Time._frameCount = 0;
        Time._smoothDeltaTime = 0;
        Time._timeScale = 1.0;
        Time._fixedDeltaTime = EngineSettings.Time.FIXED_TIMESTEP;
        Time._maximumDeltaTime = EngineSettings.Time.MAX_DELTA_TIME;
        Time._initialized = false;
    }
}