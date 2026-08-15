import { describe, test, expect } from "vitest";
import { AnimationCurve, Keyframe, WrapMode } from "../src/engine/core/math/AnimationCurve";
import { Mathf } from "../src/engine/core/math/Mathf";

/**
 * Part 8's pass over AnimationCurve. The wrap modes are the part with a
 * reference to check against — `Mathf.repeat` and `Mathf.pingPong` answer the
 * same question, so the curve's own wrapping can be compared with them rather
 * than with itself. The weights are recorded as inert in F50.
 */

/** A saw from (0, 0) to (2, 2), linear so evaluation is easy to predict. */
function saw(): AnimationCurve {
    return AnimationCurve.linear(0, 0, 2, 2);
}

describe("AnimationCurve wrapping", () => {
    test("clamps outside the range by default", () => {
        const curve = saw();

        expect(curve.evaluate(-5)).toBe(0);
        expect(curve.evaluate(7)).toBe(2);
    });

    test("looping agrees with Mathf.repeat", () => {
        const curve = saw();
        curve.postWrapMode = WrapMode.Loop;
        curve.preWrapMode = WrapMode.Loop;

        for (const t of [2.5, 3, 4.25, 6, -0.5, -3.25]) {
            expect(curve.evaluate(t)).toBeCloseTo(Mathf.repeat(t, 2), 6);
        }
    });

    test("ping-pong agrees with Mathf.pingPong, forwards and backwards", () => {
        const curve = saw();
        curve.postWrapMode = WrapMode.PingPong;
        curve.preWrapMode = WrapMode.PingPong;

        // Backwards is where a cycle count can go wrong: floor of a negative
        // ratio, and a parity test that has to survive it.
        for (const t of [2.5, 3, 4, 5, 6, -1, -2, -3, -3.5]) {
            expect(curve.evaluate(t)).toBeCloseTo(Mathf.pingPong(t, 2), 6);
        }
    });

    test("a single key answers everywhere", () => {
        const curve = new AnimationCurve(new Keyframe(1, 5));

        expect(curve.evaluate(-10)).toBe(5);
        expect(curve.evaluate(1)).toBe(5);
        expect(curve.evaluate(10)).toBe(5);
    });

    test("an empty curve answers zero rather than throwing", () => {
        const curve = new AnimationCurve();

        expect(curve.evaluate(0)).toBe(0);
    });

    test("weights do not change what evaluate returns", () => {
        // F50: they are stored for round-tripping and never applied. Pinned so
        // that implementing them later is a deliberate change, not a surprise.
        const plain = saw();
        const weighted = saw();
        weighted.getKey(0).outWeight = 0.9;
        weighted.getKey(1).inWeight = 0.1;

        for (const t of [0.25, 0.5, 1, 1.75]) {
            expect(weighted.evaluate(t)).toBe(plain.evaluate(t));
        }
    });

    test("but they survive a clone, which is what they are kept for", () => {
        const key = new Keyframe(0, 0);
        key.inWeight = 0.2;
        key.outWeight = 0.8;

        const copy = key.clone();

        expect(copy.inWeight).toBe(0.2);
        expect(copy.outWeight).toBe(0.8);
    });
});
