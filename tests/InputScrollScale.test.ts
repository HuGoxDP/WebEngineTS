import { describe, test, expect } from "vitest";
import { Input } from "../src/engine/core/Input";

/**
 * `Input.mouseScrollDelta` claims Unity's semantics, where one wheel notch is
 * about one unit. The handler passed `WheelEvent.deltaY` through raw, and a
 * browser reports the distance it would have scrolled — ~100 px per notch in the
 * default pixel mode. Every consumer was therefore ~100x too sensitive, which is
 * why one notch zoomed a scenario to its limit. `deltaMode` was ignored too, so
 * the same gesture behaved differently in Firefox, which reports lines.
 */

const notches = (delta: number, mode: number): number =>
    (Input as any)._notches(delta, mode);

describe("wheel input is normalised to Unity's scale", () => {
    test("one notch in pixel mode is about one unit", () => {
        expect(notches(100, 0)).toBeCloseTo(1, 5);
        expect(notches(-100, 0)).toBeCloseTo(-1, 5);
    });

    test("line mode lands in the same range rather than 100x smaller", () => {
        // Firefox reports ~3 lines per notch.
        const oneNotch = notches(3, 1);
        expect(oneNotch).toBeGreaterThan(0.2);
        expect(oneNotch).toBeLessThan(2);
    });

    test("page mode is a large scroll, not a hundredfold one", () => {
        expect(notches(1, 2)).toBeCloseTo(8, 5);
    });

    test("zero stays zero in every mode", () => {
        for (const mode of [0, 1, 2]) expect(notches(0, mode)).toBe(0);
    });
});
