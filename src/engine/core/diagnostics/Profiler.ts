// path: src/engine/core/diagnostics/Profiler.ts

/** Statistical summary of a frame-time sample, in milliseconds. */
export interface FrameTimeStats {
    /** Arithmetic mean frame time. */
    mean: number;
    /** 50th percentile (median). */
    median: number;
    /** 95th percentile. */
    p95: number;
    /** 99th percentile. */
    p99: number;
    /** Fastest frame. */
    min: number;
    /** Slowest frame — the metric most sensitive to stutter. */
    max: number;
    /** Population standard deviation (frame-time variability). */
    stdDev: number;
}

/** Main-thread (CPU) ms spent in each phase of one frame. */
export interface FramePhaseTimings {
    /** FixedUpdate phase, summed over its sub-steps. */
    fixedUpdate: number;
    /** Update phase, including animation and particle simulation. */
    update: number;
    /** LateUpdate phase, including audio, UI events and LOD selection. */
    lateUpdate: number;
    /** Rendering, including the UI canvas overlay. */
    render: number;
}

/** One aggregated sample for a named region within a frame. */
export interface ProfilerSample {
    /** Total inclusive ms spent in this named region during the frame. */
    totalMs: number;
    /** Number of begin/end pairs recorded for this name during the frame. */
    calls: number;
}

/** Rolling frame-time history length (frames) used by {@link Profiler.getFrameStats}. */
const HISTORY_SIZE = 240;

/**
 * The engine's profiling core — the single source of per-frame timing data.
 *
 * Two independent layers:
 *
 * 1. **Frame timings (always on).** `Application` reports each frame's
 *    main-thread cost and its per-phase split here, plus a rolling history of
 *    wall-clock frame intervals. {@link getFrameStats} summarises that history
 *    with the same statistics `Benchmark` reports for a measured run
 *    (mean/median/p95/p99/min/max/stdDev), so live and benchmark numbers are
 *    directly comparable. `MemoryProfiler` reads its stats from here.
 *    `Benchmark` samples its own frame intervals — it has to, since a measured
 *    run is a fixed window rather than a rolling one — but computes them with
 *    {@link computeStats} and takes the CPU and phase numbers from here, so the
 *    two never disagree about what a percentile means.
 *
 * 2. **Markers (opt-in).** Wrap any region in {@link beginSample}/{@link endSample}
 *    (or {@link sample}) to attribute time to your own labels. Disabled by
 *    default: when {@link enabled} is `false` these are no-ops, so instrumentation
 *    left in shipping code costs nothing.
 *
 * @example
 * ```ts
 * // Live stats, no setup needed:
 * const stats = Profiler.getFrameStats();
 * console.log(stats?.p99, Profiler.frameCpuMs, Profiler.phases.render);
 *
 * // Custom markers:
 * Profiler.enabled = true;
 * Profiler.sample("Pathfinding", () => this.path());
 * console.log(Profiler.getFrameSamples().get("Pathfinding"));
 * ```
 */
export class Profiler {

    /**
     * Master switch for {@link beginSample}/{@link endSample} markers. `false`
     * (default) makes them no-ops with no measurement overhead. Frame timings
     * and {@link getFrameStats} are unaffected — those are always recorded.
     */
    public static enabled: boolean = false;

    // ==================== MARKER STATE ====================

    // Sample stack — parallel arrays, so a begin/end pair allocates nothing.
    private static readonly _stackNames: string[] = [];
    private static readonly _stackStarts: number[] = [];
    private static _depth: number = 0;

    // Double-buffered per-frame accumulators, swapped each frame (no per-frame
    // Map allocation).
    private static _current: Map<string, ProfilerSample> = new Map();
    private static _last: Map<string, ProfilerSample> = new Map();

    // ==================== FRAME-TIMING STATE ====================

    /** Reused phase-timing record — never handed out as a fresh object. */
    private static readonly _phases: FramePhaseTimings = {
        fixedUpdate: 0, update: 0, lateUpdate: 0, render: 0,
    };

    private static _frameCpuMs: number = 0;
    private static _firstFrameCpuMs: number = 0;
    private static _firstFrameCaptured: boolean = false;

    /** Ring buffer of wall-clock frame intervals (ms). */
    private static readonly _history = new Float64Array(HISTORY_SIZE);
    private static _historyCount: number = 0;
    private static _historyIndex: number = 0;
    private static _prevFrameTime: number = 0;

    // ==================== MARKERS ====================

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
     * The previous frame's marker samples, keyed by name. Empty until a frame
     * has completed with {@link enabled} on. Do not retain the map — it is reused.
     */
    public static getFrameSamples(): ReadonlyMap<string, ProfilerSample> {
        return Profiler._last;
    }

    // ==================== FRAME TIMINGS ====================

    /**
     * Main-thread (CPU) ms spent in the last frame's loop body — the busy
     * portion, excluding idle/VSync wait. `0` before the first frame.
     */
    public static get frameCpuMs(): number {
        return Profiler._frameCpuMs;
    }

    /**
     * Main-thread (CPU) ms of the very first rendered frame after the loop
     * started — where an un-warmed shader-compilation stall lands. `0` until the
     * first frame has run.
     */
    public static get firstFrameCpuMs(): number {
        return Profiler._firstFrameCpuMs;
    }

    /**
     * The last frame's per-phase CPU split. The returned object is **reused**
     * every frame — copy the fields if you need to retain them.
     */
    public static get phases(): Readonly<FramePhaseTimings> {
        return Profiler._phases;
    }

    /** Number of frames currently held in the rolling history. */
    public static get historyLength(): number {
        return Profiler._historyCount;
    }

    /**
     * Whether at least one frame has been recorded since the loop started —
     * i.e. whether the timing getters hold real measurements. `false` when no
     * `Application` is running.
     */
    public static get hasFrameData(): boolean {
        return Profiler._firstFrameCaptured;
    }

    /**
     * Summarises the rolling wall-clock frame-time history (the last
     * {@link historyLength} frames, up to 240) using the same statistics
     * `Benchmark` reports for a measured run. `null` until at least one frame
     * interval has been recorded.
     *
     * Sorts a copy of the history, so call it at UI cadence (a few times per
     * second) — not from per-frame code.
     */
    public static getFrameStats(): FrameTimeStats | null {
        const n = Profiler._historyCount;
        if (n === 0) return null;
        // A view, not a copy: computeStats sorts a copy of its own and never
        // writes through what it was given. Ring order is not chronological,
        // which none of these statistics care about.
        return Profiler.computeStats(Profiler._history.subarray(0, n));
    }

    /**
     * Computes frame-time statistics over a set of samples in ms. Shared by the
     * live profiler and `Benchmark` so both report identical maths.
     *
     * @param samples - frame times in ms. Not modified (a copy is sorted).
     */
    public static computeStats(samples: ArrayLike<number>): FrameTimeStats {
        const n = samples.length;
        if (n === 0) {
            return { mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0 };
        }

        const sorted = Float64Array.from(samples as ArrayLike<number>).sort();

        let sum = 0;
        for (let i = 0; i < n; i++) sum += samples[i];
        const mean = sum / n;

        let varSum = 0;
        for (let i = 0; i < n; i++) {
            const d = samples[i] - mean;
            varSum += d * d;
        }

        return {
            mean,
            median: Profiler._percentile(sorted, 50),
            p95: Profiler._percentile(sorted, 95),
            p99: Profiler._percentile(sorted, 99),
            min: sorted[0],
            max: sorted[n - 1],
            stdDev: Math.sqrt(varSum / n),
        };
    }

    // ==================== INTERNAL (ENGINE LOOP) ====================

    /**
     * @internal
     * Rolls marker accumulators over to a new frame: the just-finished frame's
     * samples become {@link getFrameSamples}, and a fresh (reused) map starts
     * collecting. Called at the top of the loop by `Application`.
     */
    public static _beginFrame(): void {
        if (!Profiler.enabled) return;
        const tmp = Profiler._last;
        Profiler._last = Profiler._current;
        Profiler._current = tmp;
        Profiler._current.clear();
        Profiler._depth = 0;
    }

    /**
     * @internal
     * Records the finished frame's main-thread cost and phase split, and appends
     * the wall-clock interval since the previous frame to the rolling history.
     * Always active (not gated by {@link enabled}). Called by `Application` at
     * the end of the loop body.
     */
    public static _recordFrame(
        cpuMs: number,
        fixedUpdate: number,
        update: number,
        lateUpdate: number,
        render: number,
    ): void {
        Profiler._frameCpuMs = cpuMs;

        const p = Profiler._phases;
        p.fixedUpdate = fixedUpdate;
        p.update = update;
        p.lateUpdate = lateUpdate;
        p.render = render;

        if (!Profiler._firstFrameCaptured) {
            Profiler._firstFrameCpuMs = cpuMs;
            Profiler._firstFrameCaptured = true;
        }

        // Wall-clock interval between consecutive frames — the same quantity
        // Benchmark samples, so live and benchmark stats are comparable.
        const now = performance.now();
        if (Profiler._prevFrameTime > 0) {
            Profiler._history[Profiler._historyIndex] = now - Profiler._prevFrameTime;
            Profiler._historyIndex = (Profiler._historyIndex + 1) % HISTORY_SIZE;
            if (Profiler._historyCount < HISTORY_SIZE) Profiler._historyCount++;
        }
        Profiler._prevFrameTime = now;
    }

    /**
     * @internal
     * Clears frame timings, history and markers. Called by `Application.run()`
     * so a restarted loop re-captures its first frame.
     */
    public static _reset(): void {
        Profiler._frameCpuMs = 0;
        Profiler._firstFrameCpuMs = 0;
        Profiler._firstFrameCaptured = false;

        const p = Profiler._phases;
        p.fixedUpdate = 0;
        p.update = 0;
        p.lateUpdate = 0;
        p.render = 0;

        Profiler._historyCount = 0;
        Profiler._historyIndex = 0;
        Profiler._prevFrameTime = 0;

        Profiler._depth = 0;
        Profiler._current.clear();
        Profiler._last.clear();
    }

    // ==================== PRIVATE ====================

    /** Nearest-rank percentile over an already-sorted array. */
    private static _percentile(sorted: Float64Array, p: number): number {
        const n = sorted.length;
        if (n === 0) return 0;
        const rank = Math.ceil((p / 100) * n) - 1;
        const idx = Math.min(n - 1, Math.max(0, rank));
        return sorted[idx];
    }

    private constructor() {}
}
