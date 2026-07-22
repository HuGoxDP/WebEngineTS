// path: src/engine/core/diagnostics/Profiler.ts

/** One aggregated sample for a named region within a frame. */
export interface ProfilerSample {
    /** Total inclusive ms spent in this named region during the frame. */
    totalMs: number;
    /** Number of begin/end pairs recorded for this name during the frame. */
    calls: number;
}

/**
 * Lightweight per-frame CPU marker profiler — Unity-style
 * {@link beginSample}/{@link endSample}.
 *
 * Wrap any region of code in matching begin/end calls (or use {@link sample});
 * each frame the engine rolls the accumulators over, and {@link getFrameSamples}
 * returns the previous frame's per-name totals. Regions may nest — each is
 * measured inclusively (wall time between its own begin and end).
 *
 * Disabled by default: when {@link enabled} is `false`, begin/end return
 * immediately, so instrumentation left in shipping code costs nothing. Turn it
 * on only for a profiling session. Complements the built-in loop-phase breakdown
 * (`Application.updateTime` etc. / `MemoryReport.cpuPhasesMs`), which is always on.
 *
 * @example
 * ```ts
 * Profiler.enabled = true;
 * // ...in some update:
 * Profiler.beginSample("AI");
 * this.think();
 * Profiler.endSample();
 * // or, exception-safe:
 * Profiler.sample("Pathfinding", () => this.path());
 * ```
 */
export class Profiler {

    /**
     * Master switch. `false` (default) makes {@link beginSample}/{@link endSample}
     * no-ops with no measurement overhead. Set `true` for a profiling session.
     */
    public static enabled: boolean = false;

    // Sample stack — parallel arrays, so a begin/end pair allocates nothing.
    private static readonly _stackNames: string[] = [];
    private static readonly _stackStarts: number[] = [];
    private static _depth: number = 0;

    // Double-buffered per-frame accumulators, swapped each frame (no per-frame
    // Map allocation).
    private static _current: Map<string, ProfilerSample> = new Map();
    private static _last: Map<string, ProfilerSample> = new Map();

    /**
     * Opens a named CPU sample. Must be matched by an {@link endSample}. No-op
     * when {@link enabled} is `false`.
     *
     * @param name - region label; keep it stable to aggregate across frames.
     */
    public static beginSample(name: string): void {
        if (!Profiler.enabled) return;
        Profiler._stackNames[Profiler._depth] = name;
        Profiler._stackStarts[Profiler._depth] = performance.now();
        Profiler._depth++;
    }

    /**
     * Closes the most recently opened sample and adds its inclusive time to the
     * current frame. No-op when {@link enabled} is `false` or unmatched.
     */
    public static endSample(): void {
        if (!Profiler.enabled || Profiler._depth === 0) return;
        Profiler._depth--;
        const elapsed = performance.now() - Profiler._stackStarts[Profiler._depth];
        const name = Profiler._stackNames[Profiler._depth];
        let s = Profiler._current.get(name);
        if (s === undefined) {
            s = { totalMs: 0, calls: 0 };
            Profiler._current.set(name, s);
        }
        s.totalMs += elapsed;
        s.calls++;
    }

    /**
     * Measures a synchronous function as a named sample and returns its result,
     * closing the sample even if it throws.
     *
     * @param name - region label.
     * @param fn - the function to measure.
     */
    public static sample<T>(name: string, fn: () => T): T {
        Profiler.beginSample(name);
        try {
            return fn();
        } finally {
            Profiler.endSample();
        }
    }

    /**
     * The previous frame's samples, keyed by name. Empty until a frame has
     * completed with {@link enabled} on. Do not retain the map — it is reused.
     */
    public static getFrameSamples(): ReadonlyMap<string, ProfilerSample> {
        return Profiler._last;
    }

    /**
     * @internal
     * Rolls the accumulator over to a new frame: the just-finished frame's
     * samples become {@link getFrameSamples}, and a fresh (reused) map starts
     * collecting. Called once per frame by `Application`.
     */
    public static _beginFrame(): void {
        if (!Profiler.enabled) return;
        const tmp = Profiler._last;
        Profiler._last = Profiler._current;
        Profiler._current = tmp;
        Profiler._current.clear();
        Profiler._depth = 0;
    }

    private constructor() {}
}
