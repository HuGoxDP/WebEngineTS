import { describe, test, expect, afterEach, vi } from "vitest";
import { Benchmark } from "../src/engine/core/diagnostics/Benchmark";
import type { BenchmarkResult } from "../src/engine/core/diagnostics/Benchmark";
import { Profiler } from "../src/engine/core/diagnostics/Profiler";

/**
 * The harness that produces the paper's Section 5 numbers had no tests. These
 * pin the run loop's frame accounting and the CSV shape — a column that drifts
 * out of step with its header mislabels every figure downstream, and nothing
 * about the file would look wrong. Audit part 10, F73.
 */

/** Drives rAF by hand so a run completes in a controlled number of frames. */
function fakeFrames() {
    const queue: FrameRequestCallback[] = [];
    let clock = 0;

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    return {
        get pending() { return queue.length; },
        /** Runs one queued callback after advancing the clock by `dtMs`. */
        step(dtMs = 16): boolean {
            const cb = queue.shift();
            if (!cb) return false;
            clock += dtMs;
            cb(clock);
            return true;
        },
        /** Runs up to `n` callbacks; returns how many actually ran. */
        run(n: number, dtMs = 16): number {
            let ran = 0;
            for (let i = 0; i < n; i++) {
                if (!this.step(dtMs)) break;
                ran++;
            }
            return ran;
        },
    };
}

const RESULT: BenchmarkResult = {
    label: "Solar System, baseline",
    timestamp: "2026-08-17T00:00:00.000Z",
    warmupFrames: 120,
    sampleFrames: 600,
    loadTimeMs: 1234.5,
    frameTimeMs: { mean: 16.7, median: 16.6, p95: 18, p99: 24, min: 15, max: 60, stdDev: 2.5 },
    fps: 59.88,
    cpuFrameMsMean: 9.1,
    phaseMsMean: { fixedUpdate: 1, update: 3, lateUpdate: 0.5, render: 4.6 },
    firstRenderCpuMs: 420,
    maxFirst10Ms: 480,
    gpu: "NVIDIA GeForce RTX 3060",
    memory: {
        jsHeapUsedBytes: 100, gpuTextures: 12, gpuGeometries: 30,
        estimatedTextureVramBytes: 4096, estimatedGeometryVramBytes: 2048,
        estimatedRenderTargetVramBytes: 512, estimatedUICanvasBytes: 64,
        estimatedUITintCacheBytes: 32, drawCalls: 7, triangles: 900,
    },
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Profiler._reset();
});

describe("CSV export", () => {
    test("every row has exactly as many cells as the header names", () => {
        // The failure this guards is silent: one extra value and every column
        // after it is reported under the wrong name.
        //
        // A comma-free label, so a naive split counts fields honestly — the
        // quoting of labels that do contain one is the next test's business.
        const plain = { ...RESULT, label: "solar-baseline" };
        const csv = Benchmark.toCSV([plain, plain]);
        const [header, ...rows] = csv.split("\n");
        const columns = header.split(",").length;

        expect(rows).toHaveLength(2);
        for (const row of rows) expect(row.split(",")).toHaveLength(columns);
    });

    test("a label containing a comma is quoted, not spread over two columns", () => {
        const csv = Benchmark.toCSV(RESULT);
        const [header, row] = csv.split("\n");

        expect(row.startsWith('"Solar System, baseline"')).toBe(true);
        // Quoted, so a parser reads one field where a naive split sees two.
        expect(row.split(",")).toHaveLength(header.split(",").length + 1);
    });

    test("a quote inside a label is doubled", () => {
        const csv = Benchmark.toCSV({ ...RESULT, label: 'the "fast" path' });

        expect(csv.split("\n")[1].startsWith('"the ""fast"" path"')).toBe(true);
    });

    test("the header still names the columns the runbook reads", () => {
        const header = Benchmark.toCSV(RESULT).split("\n")[0].split(",");

        expect(header[0]).toBe("label");
        expect(header).toContain("mean_ms");
        expect(header).toContain("p99_ms");
        expect(header).toContain("load_ms");
        expect(header).toContain("estimatedTextureVramBytes");
    });

    test("missing memory numbers are blank cells, not the string null", () => {
        const bare = { ...RESULT, gpu: null, memory: { ...RESULT.memory, jsHeapUsedBytes: null } };

        const row = Benchmark.toCSV(bare).split("\n")[1];

        expect(row).not.toContain("null");
        expect(row).toContain(",,");
    });

    test("a single result and an array of one agree", () => {
        expect(Benchmark.toCSV(RESULT)).toBe(Benchmark.toCSV([RESULT]));
        expect(Benchmark.toJSON(RESULT)).toBe(Benchmark.toJSON([RESULT]));
    });

    test("JSON round-trips to the same numbers", () => {
        const back = JSON.parse(Benchmark.toJSON(RESULT)) as BenchmarkResult[];

        expect(back).toHaveLength(1);
        expect(back[0].frameTimeMs.p99).toBe(24);
        expect(back[0].memory.estimatedTextureVramBytes).toBe(4096);
    });
});

describe("A measurement run", () => {
    test("discards the warmup and samples exactly what was asked", async () => {
        const frames = fakeFrames();
        const promise = Benchmark.run({
            warmupFrames: 2, sampleFrames: 3, captureMemory: false, label: "t",
        });

        // One priming frame, then warmup, then the samples.
        expect(frames.run(20)).toBe(1 + 2 + 3);
        const result = await promise;

        expect(result.warmupFrames).toBe(2);
        expect(result.sampleFrames).toBe(3);
        expect(result.label).toBe("t");
    });

    test("reports the frame interval it was fed", async () => {
        const frames = fakeFrames();
        const promise = Benchmark.run({ warmupFrames: 0, sampleFrames: 4, captureMemory: false });

        frames.run(5, 20);
        const result = await promise;

        expect(result.frameTimeMs.mean).toBeCloseTo(20);
        expect(result.fps).toBeCloseTo(50);
    });

    test("coldStart keeps the first frame's stall instead of warming it away", async () => {
        // The documented purpose of the flag, and what the paper's startup
        // column depends on.
        const frames = fakeFrames();
        const promise = Benchmark.run({
            coldStart: true, warmupFrames: 120, sampleFrames: 3, captureMemory: false,
        });

        frames.step();        // priming
        frames.step(500);     // the first rendered frame, stalling on shader compile
        frames.run(2, 16);
        const result = await promise;

        expect(result.warmupFrames).toBe(0);
        expect(result.maxFirst10Ms).toBe(500);
        expect(result.frameTimeMs.max).toBe(500);
    });

    test("carries the caller's load time through verbatim", async () => {
        const frames = fakeFrames();
        const promise = Benchmark.run({
            warmupFrames: 0, sampleFrames: 1, captureMemory: false, loadTimeMs: 987.6,
        });

        frames.run(2);
        const result = await promise;

        expect(result.loadTimeMs).toBe(987.6);
    });

    test("averages the phase split over the sample, not the warmup", async () => {
        const frames = fakeFrames();
        Profiler._recordFrame(10, 1, 2, 3, 4);

        const promise = Benchmark.run({
            warmupFrames: 1, sampleFrames: 2, captureMemory: false,
        });
        frames.run(4);
        const result = await promise;

        expect(result.cpuFrameMsMean).toBeCloseTo(10);
        expect(result.phaseMsMean.update).toBeCloseTo(2);
        expect(result.phaseMsMean.render).toBeCloseTo(4);
    });

    test("a zero sample count is clamped to one rather than resolving with nothing", async () => {
        const frames = fakeFrames();
        const promise = Benchmark.run({ warmupFrames: 0, sampleFrames: 0, captureMemory: false });

        frames.run(3);
        const result = await promise;

        expect(result.sampleFrames).toBe(1);
        expect(result.frameTimeMs.mean).toBeGreaterThan(0);
    });
});

describe("timeAsync", () => {
    test("measures the elapsed wall clock of an async operation", async () => {
        let clock = 0;
        vi.spyOn(performance, "now").mockImplementation(() => clock);

        const ms = await Benchmark.timeAsync(async () => { clock += 250; });

        expect(ms).toBe(250);
    });

    test("accepts a synchronous function too", async () => {
        const ms = await Benchmark.timeAsync(() => 1 + 1);

        expect(ms).toBeGreaterThanOrEqual(0);
    });
});
