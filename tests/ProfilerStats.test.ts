import { describe, test, expect, afterEach, vi } from "vitest";
import { Profiler } from "../src/engine/core/diagnostics/Profiler";

/**
 * `Profiler` and `Benchmark` compute every number the paper's Section 5
 * reports, and neither had a single test. These pin the statistics against
 * values worked out by hand, so a change to the percentile rule or the standard
 * deviation cannot pass quietly. Audit part 10, F73.
 */

/** 1..100, whose statistics are all known in closed form. */
const ONE_TO_100 = Array.from({ length: 100 }, (_, i) => i + 1);

afterEach(() => {
    Profiler._reset();
    Profiler.enabled = false;
    vi.restoreAllMocks();
});

describe("computeStats", () => {
    test("matches the hand-computed answer for 1..100", () => {
        const s = Profiler.computeStats(ONE_TO_100);

        expect(s.mean).toBeCloseTo(50.5, 10);
        // Nearest rank: the smallest value at or above the requested share.
        expect(s.median).toBe(50);
        expect(s.p95).toBe(95);
        expect(s.p99).toBe(99);
        expect(s.min).toBe(1);
        expect(s.max).toBe(100);
        // Population sd of 1..n is sqrt((n^2 - 1) / 12).
        expect(s.stdDev).toBeCloseTo(Math.sqrt((100 * 100 - 1) / 12), 9);
    });

    test("sorts numerically, not as text", () => {
        // The trap a plain Array.prototype.sort would fall into: "100" < "9".
        const s = Profiler.computeStats([9, 100, 10, 1000, 1]);

        expect(s.min).toBe(1);
        expect(s.max).toBe(1000);
        expect(s.median).toBe(10);
    });

    test("leaves its input alone, as it documents", () => {
        const input = [5, 3, 1, 4, 2];

        Profiler.computeStats(input);

        expect(input).toEqual([5, 3, 1, 4, 2]);
    });

    test("an empty sample is all zeros rather than NaN", () => {
        const s = Profiler.computeStats([]);

        expect(s).toEqual({ mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0 });
    });

    test("one sample is every statistic", () => {
        const s = Profiler.computeStats([16.7]);

        expect(s.mean).toBeCloseTo(16.7);
        expect(s.median).toBeCloseTo(16.7);
        expect(s.p99).toBeCloseTo(16.7);
        expect(s.min).toBeCloseTo(16.7);
        expect(s.max).toBeCloseTo(16.7);
        expect(s.stdDev).toBe(0);
    });

    test("p99 is the tail, not the mean wearing a hat", () => {
        // 99 frames at 16ms and one at 500: the stutter must survive into p99
        // and max while barely moving the median. This is the whole reason the
        // paper reports percentiles.
        const frames = [...Array.from({ length: 99 }, () => 16), 500];

        const s = Profiler.computeStats(frames);

        expect(s.median).toBe(16);
        expect(s.p95).toBe(16);
        expect(s.p99).toBe(16);
        expect(s.max).toBe(500);
        expect(s.mean).toBeCloseTo(20.84, 2);
    });

    test("accepts a Float64Array, which is what Benchmark hands it", () => {
        const s = Profiler.computeStats(Float64Array.from(ONE_TO_100));

        expect(s.mean).toBeCloseTo(50.5, 10);
        expect(s.p95).toBe(95);
    });
});

describe("The rolling frame history", () => {
    /** Feeds recorded frames at a controlled clock. */
    function record(intervalsMs: number[]): void {
        let clock = 1000;
        const now = vi.spyOn(performance, "now");
        now.mockImplementation(() => clock);

        // The first call only primes the previous-frame stamp.
        Profiler._recordFrame(0, 0, 0, 0, 0);
        for (const dt of intervalsMs) {
            clock += dt;
            Profiler._recordFrame(0, 0, 0, 0, 0);
        }
    }

    test("is null until a frame interval exists", () => {
        expect(Profiler.getFrameStats()).toBeNull();
        expect(Profiler.historyLength).toBe(0);
    });

    test("one recorded frame is still no interval", () => {
        // An interval needs two frames. Reporting after one would report zero.
        record([]);

        expect(Profiler.historyLength).toBe(0);
        expect(Profiler.getFrameStats()).toBeNull();
    });

    test("summarises the intervals it was given", () => {
        record([16, 16, 16, 48]);

        const s = Profiler.getFrameStats()!;
        expect(Profiler.historyLength).toBe(4);
        expect(s.min).toBe(16);
        expect(s.max).toBe(48);
        expect(s.mean).toBeCloseTo(24);
    });

    test("caps at 240 frames and keeps the most recent", () => {
        // 300 frames: the first 60 are 100ms, the rest 10ms. Once the ring has
        // wrapped, the slow ones must be gone.
        record([...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 240 }, () => 10)]);

        expect(Profiler.historyLength).toBe(240);
        const s = Profiler.getFrameStats()!;
        expect(s.max).toBe(10);
        expect(s.mean).toBeCloseTo(10);
    });

    test("_reset forgets the history, so a restarted loop starts clean", () => {
        record([16, 16, 16]);
        expect(Profiler.historyLength).toBe(3);

        Profiler._reset();

        expect(Profiler.historyLength).toBe(0);
        expect(Profiler.getFrameStats()).toBeNull();
        expect(Profiler.hasFrameData).toBe(false);
    });
});

describe("Frame timings", () => {
    test("the first frame's CPU cost is captured once and kept", () => {
        Profiler._recordFrame(40, 1, 2, 3, 4);
        Profiler._recordFrame(8, 1, 1, 1, 1);
        Profiler._recordFrame(8, 1, 1, 1, 1);

        expect(Profiler.firstFrameCpuMs).toBe(40);
        expect(Profiler.frameCpuMs).toBe(8);
        expect(Profiler.hasFrameData).toBe(true);
    });

    test("the phase record is reused, as its docs warn", () => {
        Profiler._recordFrame(10, 1, 2, 3, 4);
        const held = Profiler.phases;

        Profiler._recordFrame(10, 5, 6, 7, 8);

        expect(held.update).toBe(6);
        expect(Profiler.phases).toBe(held);
    });
});

describe("Markers", () => {
    test("cost nothing and record nothing while disabled", () => {
        Profiler.enabled = false;

        Profiler._beginFrame();
        Profiler.beginSample("Pathfinding");
        Profiler.endSample();
        Profiler._beginFrame();

        expect(Profiler.getFrameSamples().size).toBe(0);
    });

    test("aggregate calls of the same name within a frame", () => {
        Profiler.enabled = true;
        Profiler._beginFrame();

        for (let i = 0; i < 3; i++) {
            Profiler.beginSample("Pathfinding");
            Profiler.endSample();
        }
        Profiler._beginFrame();

        const s = Profiler.getFrameSamples().get("Pathfinding")!;
        expect(s.calls).toBe(3);
        expect(s.totalMs).toBeGreaterThanOrEqual(0);
    });

    test("nest, with the outer region including the inner", () => {
        Profiler.enabled = true;
        Profiler._beginFrame();

        Profiler.beginSample("Outer");
        Profiler.beginSample("Inner");
        Profiler.endSample();
        Profiler.endSample();
        Profiler._beginFrame();

        const seen = Profiler.getFrameSamples();
        expect(seen.get("Outer")!.calls).toBe(1);
        expect(seen.get("Inner")!.calls).toBe(1);
        expect(seen.get("Outer")!.totalMs).toBeGreaterThanOrEqual(seen.get("Inner")!.totalMs);
    });

    test("sample() closes the region when the body throws", () => {
        Profiler.enabled = true;
        Profiler._beginFrame();

        expect(() => Profiler.sample("Risky", () => { throw new Error("boom"); })).toThrow("boom");

        // The proof it closed: a second region on the same frame is recorded
        // under its own name rather than nested inside the abandoned one.
        Profiler.sample("After", () => 1);
        Profiler._beginFrame();

        expect(Profiler.getFrameSamples().get("Risky")!.calls).toBe(1);
        expect(Profiler.getFrameSamples().get("After")!.calls).toBe(1);
    });

    test("an unmatched endSample is ignored rather than corrupting the stack", () => {
        Profiler.enabled = true;
        Profiler._beginFrame();

        Profiler.endSample();
        Profiler.beginSample("Real");
        Profiler.endSample();
        Profiler._beginFrame();

        expect(Profiler.getFrameSamples().get("Real")!.calls).toBe(1);
    });

    test("sample() returns the body's value", () => {
        Profiler.enabled = true;

        expect(Profiler.sample("Compute", () => 6 * 7)).toBe(42);
    });
});
