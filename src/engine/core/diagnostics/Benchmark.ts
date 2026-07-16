// path: src/engine/core/diagnostics/Benchmark.ts

import { MemoryProfiler } from "./MemoryProfiler.ts";

// ==================== TYPES ====================

/** Configuration for a {@link Benchmark.run} measurement session. */
export interface BenchmarkOptions {
    /** Human-readable label for the result row (e.g. scene / config name). */
    label?: string;
    /** Frames to render and discard before sampling begins. Default `120`. */
    warmupFrames?: number;
    /** Frames to sample after warmup. Default `600`. */
    sampleFrames?: number;
    /** Whether to capture a memory snapshot at the end. Default `true`. */
    captureMemory?: boolean;
}

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

/** The result of one {@link Benchmark.run} measurement session. */
export interface BenchmarkResult {
    /** The label passed in {@link BenchmarkOptions}. */
    label: string;
    /** ISO timestamp of when sampling completed. */
    timestamp: string;
    /** Warmup frame count used. */
    warmupFrames: number;
    /** Sample frame count used. */
    sampleFrames: number;
    /** Frame-time statistics in milliseconds. */
    frameTimeMs: FrameTimeStats;
    /** Average frames per second, derived from {@link FrameTimeStats.mean}. */
    fps: number;
    /** Memory snapshot captured at the end of sampling (`null` fields if unavailable). */
    memory: {
        jsHeapUsedBytes: number | null;
        gpuTextures: number | null;
        gpuGeometries: number | null;
        estimatedTextureVramBytes: number | null;
        drawCalls: number | null;
        triangles: number | null;
    };
}

// ==================== BENCHMARK ====================

/**
 * Reproducible performance-measurement harness.
 *
 * Runs a fixed warmup then samples per-frame timings by piggybacking on
 * `requestAnimationFrame` — the same cadence the engine loop renders at — so
 * the recorded frame time reflects the real frame interval including engine
 * work. After sampling it computes mean/median/p95/p99/max/stdDev and captures
 * a memory snapshot (JS heap, GPU resource counts, estimated texture VRAM,
 * draw calls, triangles) via {@link MemoryProfiler}.
 *
 * Results can be exported to JSON or CSV for offline analysis and to make
 * reported numbers reproducible.
 *
 * @example
 * ```ts
 * import { Benchmark } from "WebEngineTS";
 *
 * const app = new Application(canvas);
 * await app.loadScenarioFromUrl("solar-system.zip");
 *
 * const results = [];
 * results.push(await Benchmark.run({ label: "Solar System — baseline" }));
 * // ...toggle an optimization, reload...
 * results.push(await Benchmark.run({ label: "Solar System — full stack" }));
 *
 * Benchmark.downloadCSV(results, "solar-system.csv");
 * ```
 */
export class Benchmark {

    /**
     * Runs a single measurement session and resolves with its result.
     *
     * The returned promise settles only after `warmupFrames + sampleFrames`
     * animation frames have elapsed, so the engine loop must be running
     * (`Application.run()`), otherwise frames never tick and it never resolves.
     *
     * @param options - warmup/sample counts and label (see {@link BenchmarkOptions}).
     * @returns the computed {@link BenchmarkResult}.
     */
    public static run(options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
        const label = options.label ?? "benchmark";
        const warmupFrames = Math.max(0, Math.floor(options.warmupFrames ?? 120));
        const sampleFrames = Math.max(1, Math.floor(options.sampleFrames ?? 600));
        const captureMemory = options.captureMemory ?? true;

        return new Promise<BenchmarkResult>((resolve) => {
            const samples = new Float64Array(sampleFrames);
            let warmupLeft = warmupFrames;
            let sampleIndex = 0;
            let prev = 0;

            const tick = (): void => {
                const now = performance.now();
                const dt = now - prev;
                prev = now;

                if (warmupLeft > 0) {
                    warmupLeft--;
                    requestAnimationFrame(tick);
                    return;
                }

                samples[sampleIndex++] = dt;
                if (sampleIndex < sampleFrames) {
                    requestAnimationFrame(tick);
                    return;
                }

                resolve(Benchmark._finalize(
                    label, warmupFrames, sampleFrames, samples, captureMemory,
                ));
            };

            // Prime `prev` on the first frame so the first measured delta is a
            // real frame interval, not the gap since the promise was created.
            requestAnimationFrame(() => {
                prev = performance.now();
                requestAnimationFrame(tick);
            });
        });
    }

    /**
     * Measures how long an async operation takes, in milliseconds.
     *
     * Useful for the "loading time" metric — wrap a scenario load and record
     * the elapsed wall-clock time.
     *
     * @param fn - the operation to time (sync or async).
     * @returns elapsed milliseconds.
     *
     * @example
     * ```ts
     * const loadMs = await Benchmark.timeAsync(
     *     () => app.loadScenarioFromUrl("solar-system.zip"),
     * );
     * ```
     */
    public static async timeAsync(fn: () => Promise<unknown> | unknown): Promise<number> {
        const start = performance.now();
        await fn();
        return performance.now() - start;
    }

    // ==================== EXPORT ====================

    /**
     * Serializes one or more results to a pretty-printed JSON string.
     *
     * @param results - a single result or an array of results.
     */
    public static toJSON(results: BenchmarkResult | BenchmarkResult[]): string {
        const arr = Array.isArray(results) ? results : [results];
        return JSON.stringify(arr, null, 2);
    }

    /**
     * Serializes one or more results to a CSV string with a header row.
     *
     * @param results - a single result or an array of results.
     */
    public static toCSV(results: BenchmarkResult | BenchmarkResult[]): string {
        const arr = Array.isArray(results) ? results : [results];
        const header = [
            "label", "timestamp", "warmupFrames", "sampleFrames",
            "mean_ms", "median_ms", "p95_ms", "p99_ms", "min_ms", "max_ms", "stdDev_ms",
            "fps", "jsHeapUsedBytes", "gpuTextures", "gpuGeometries",
            "estimatedTextureVramBytes", "drawCalls", "triangles",
        ];
        const rows = arr.map((r) => [
            Benchmark._csvCell(r.label),
            r.timestamp,
            r.warmupFrames,
            r.sampleFrames,
            Benchmark._num(r.frameTimeMs.mean),
            Benchmark._num(r.frameTimeMs.median),
            Benchmark._num(r.frameTimeMs.p95),
            Benchmark._num(r.frameTimeMs.p99),
            Benchmark._num(r.frameTimeMs.min),
            Benchmark._num(r.frameTimeMs.max),
            Benchmark._num(r.frameTimeMs.stdDev),
            Benchmark._num(r.fps),
            r.memory.jsHeapUsedBytes ?? "",
            r.memory.gpuTextures ?? "",
            r.memory.gpuGeometries ?? "",
            r.memory.estimatedTextureVramBytes ?? "",
            r.memory.drawCalls ?? "",
            r.memory.triangles ?? "",
        ].join(","));
        return [header.join(","), ...rows].join("\n");
    }

    /**
     * Triggers a browser download of the results as a JSON file.
     *
     * @param results - a single result or an array of results.
     * @param filename - download filename. Default `"benchmark.json"`.
     */
    public static downloadJSON(
        results: BenchmarkResult | BenchmarkResult[],
        filename: string = "benchmark.json",
    ): void {
        Benchmark._download(Benchmark.toJSON(results), filename, "application/json");
    }

    /**
     * Triggers a browser download of the results as a CSV file.
     *
     * @param results - a single result or an array of results.
     * @param filename - download filename. Default `"benchmark.csv"`.
     */
    public static downloadCSV(
        results: BenchmarkResult | BenchmarkResult[],
        filename: string = "benchmark.csv",
    ): void {
        Benchmark._download(Benchmark.toCSV(results), filename, "text/csv");
    }

    // ==================== PRIVATE ====================

    private static _finalize(
        label: string,
        warmupFrames: number,
        sampleFrames: number,
        samples: Float64Array,
        captureMemory: boolean,
    ): BenchmarkResult {
        const stats = Benchmark._computeStats(samples);

        let memory: BenchmarkResult["memory"] = {
            jsHeapUsedBytes: null,
            gpuTextures: null,
            gpuGeometries: null,
            estimatedTextureVramBytes: null,
            drawCalls: null,
            triangles: null,
        };

        if (captureMemory) {
            const snap = MemoryProfiler.snapshot();
            memory = {
                jsHeapUsedBytes: snap.jsHeap?.used ?? null,
                gpuTextures: snap.renderer?.textures ?? null,
                gpuGeometries: snap.renderer?.geometries ?? null,
                estimatedTextureVramBytes: snap.renderer?.estimatedTextureVramBytes ?? null,
                drawCalls: snap.renderStats?.drawCalls ?? null,
                triangles: snap.renderStats?.triangles ?? null,
            };
        }

        return {
            label,
            timestamp: new Date().toISOString(),
            warmupFrames,
            sampleFrames,
            frameTimeMs: stats,
            fps: stats.mean > 0 ? 1000 / stats.mean : 0,
            memory,
        };
    }

    private static _computeStats(samples: Float64Array): FrameTimeStats {
        const n = samples.length;
        const sorted = Float64Array.from(samples).sort();

        let sum = 0;
        for (let i = 0; i < n; i++) sum += samples[i];
        const mean = sum / n;

        let varSum = 0;
        for (let i = 0; i < n; i++) {
            const d = samples[i] - mean;
            varSum += d * d;
        }
        const stdDev = Math.sqrt(varSum / n);

        return {
            mean,
            median: Benchmark._percentile(sorted, 50),
            p95: Benchmark._percentile(sorted, 95),
            p99: Benchmark._percentile(sorted, 99),
            min: sorted[0],
            max: sorted[n - 1],
            stdDev,
        };
    }

    /** Nearest-rank percentile over an already-sorted array. */
    private static _percentile(sorted: Float64Array, p: number): number {
        const n = sorted.length;
        if (n === 0) return 0;
        const rank = Math.ceil((p / 100) * n) - 1;
        const idx = Math.min(n - 1, Math.max(0, rank));
        return sorted[idx];
    }

    private static _num(value: number): string {
        return Number.isFinite(value) ? value.toFixed(3) : "";
    }

    /** Quotes a CSV cell if it contains a comma, quote, or newline. */
    private static _csvCell(value: string): string {
        if (/[",\n]/.test(value)) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private static _download(content: string, filename: string, mime: string): void {
        if (typeof document === "undefined") {
            console.warn("[Benchmark] download is only available in a browser context.");
            return;
        }
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private constructor() {}
}
