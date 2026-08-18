import { describe, test, expect } from "vitest";
import { AnimationCurve, Keyframe, WeightedMode } from "../src/engine/core/math/AnimationCurve";

/**
 * `Keyframe.inWeight` and `outWeight` were public, documented, defaulted to
 * Unity's `1/3`, carried through `clone()` — and read by nothing. A curve
 * authored in Unity with weighted tangents loaded, kept its weights, and drew a
 * different shape, quietly, because every number was present and plausible.
 * Audit F50, open since part 8.
 */

/**
 * Two keys rising 0 → 1 over one second. `configure` runs before the curve is
 * built, because `AnimationCurve`'s constructor clones its keys — setting a
 * weight on the originals afterwards would reach nothing.
 */
function ramp(
    configure?: (a: Keyframe, b: Keyframe) => void,
    outTangent = 1,
    inTangent = 1,
): AnimationCurve {
    const a = new Keyframe(0, 0, 0, outTangent);
    const b = new Keyframe(1, 1, inTangent, 0);
    configure?.(a, b);
    return new AnimationCurve(a, b);
}

const SAMPLES = [0.1, 0.25, 0.5, 0.75, 0.9];

describe("Weighted tangents", () => {
    test("do nothing until a key asks for them", () => {
        // The compatibility guarantee: weights exist on every key and default to
        // 1/3, so a curve built in code is the curve it always was — even one
        // whose weights have been set, as long as the mode stays None.
        const plain = ramp();
        const set = ramp((a, b) => {
            a.outWeight = 0.9;
            b.inWeight = 0.05;
        });

        for (const t of SAMPLES) {
            expect(set.evaluate(t)).toBeCloseTo(plain.evaluate(t), 12);
        }
    });

    test("at the default weight, weighted and unweighted are the same curve", () => {
        // Why 1/3 is the default: it is the weight at which a cubic Bezier and
        // a Hermite spline describe the same segment. Turning weighting on for
        // an untouched key must therefore change nothing.
        const plain = ramp(undefined, 3, 2);
        const weighted = ramp((a, b) => {
            a.weightedMode = WeightedMode.Both;
            b.weightedMode = WeightedMode.Both;
        }, 3, 2);

        for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
            expect(weighted.evaluate(t)).toBeCloseTo(plain.evaluate(t), 6);
        }
    });

    test("change the shape once a weight moves", () => {
        // Flat tangents at both ends, so the segment is an S-curve rather than
        // a straight line. Weighting a straight line leaves a straight line —
        // the last test in this file relies on exactly that — so a line is the
        // one shape where this change is invisible.
        const plain = ramp(undefined, 0, 0);
        const weighted = ramp((a) => {
            a.weightedMode = WeightedMode.Out;
            a.outWeight = 0.9;
        }, 0, 0);

        expect(weighted.evaluate(0.5)).not.toBeCloseTo(plain.evaluate(0.5), 4);
    });

    test("a longer outgoing weight holds the curve near its start tangent", () => {
        // A flat start tangent with a long weight keeps the curve low for
        // longer than a short one does.
        const long = ramp((a) => {
            a.weightedMode = WeightedMode.Out;
            a.outWeight = 0.9;
        }, 0, 0);
        const short = ramp((a) => {
            a.weightedMode = WeightedMode.Out;
            a.outWeight = 0.05;
        }, 0, 0);

        expect(long.evaluate(0.4)).toBeLessThan(short.evaluate(0.4));
    });

    test("the endpoints are exact whatever the weights", () => {
        const curve = ramp((a, b) => {
            a.weightedMode = WeightedMode.Both;
            b.weightedMode = WeightedMode.Both;
            a.outWeight = 0.8;
            b.inWeight = 0.7;
        }, 4, 4);

        expect(curve.evaluate(0)).toBeCloseTo(0, 9);
        expect(curve.evaluate(1)).toBeCloseTo(1, 9);
    });

    test("the curve stays monotonic in time — one value per moment", () => {
        // Weights that reach past each other would fold the segment back on
        // itself, giving one moment two values. They are clamped so that cannot
        // happen, and the values rise steadily across a rising segment.
        const curve = ramp((a, b) => {
            a.weightedMode = WeightedMode.Both;
            b.weightedMode = WeightedMode.Both;
            a.outWeight = 5;
            b.inWeight = 5;
        });

        let previous = -Infinity;
        for (let t = 0; t <= 1.0001; t += 0.02) {
            const v = curve.evaluate(t);
            expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
            previous = v;
        }
    });

    test("negative weights are clamped rather than folding the curve", () => {
        const curve = ramp((a) => {
            a.weightedMode = WeightedMode.Out;
            a.outWeight = -3;
        });

        expect(Number.isFinite(curve.evaluate(0.5))).toBe(true);
        expect(curve.evaluate(0)).toBeCloseTo(0, 9);
        expect(curve.evaluate(1)).toBeCloseTo(1, 9);
    });

    test("one end weighted and the other not is still a valid segment", () => {
        // Unity's flags are per key and per side, so a segment can be weighted
        // at one end only — the other falls back to 1/3.
        const curve = ramp((a, b) => {
            a.weightedMode = WeightedMode.Out;
            a.outWeight = 0.7;
            b.weightedMode = WeightedMode.None;
        });

        expect(curve.evaluate(0)).toBeCloseTo(0, 9);
        expect(curve.evaluate(1)).toBeCloseTo(1, 9);
        expect(curve.evaluate(0.5)).toBeGreaterThan(0);
        expect(curve.evaluate(0.5)).toBeLessThan(1);
    });

    test("the In flag alone does not weight the outgoing side", () => {
        // The flags are directional. Setting In on the left-hand key of a
        // segment must not change it: what that segment uses is the key's
        // *outgoing* tangent.
        const plain = ramp();
        const flagged = ramp((a) => {
            a.weightedMode = WeightedMode.In;
            a.outWeight = 0.9;
        });

        expect(flagged.evaluate(0.5)).toBeCloseTo(plain.evaluate(0.5), 9);
    });

    test("clone carries the mode as well as the weights", () => {
        const k = new Keyframe(1, 2, 3, 4);
        k.inWeight = 0.2;
        k.outWeight = 0.8;
        k.weightedMode = WeightedMode.Both;

        const copy = k.clone();

        expect(copy.weightedMode).toBe(WeightedMode.Both);
        expect(copy.inWeight).toBe(0.2);
        expect(copy.outWeight).toBe(0.8);
    });

    test("a new key is unweighted, as Unity's is", () => {
        const k = new Keyframe(0, 0);

        expect(k.weightedMode).toBe(WeightedMode.None);
        expect(k.inWeight).toBeCloseTo(1 / 3);
        expect(k.outWeight).toBeCloseTo(1 / 3);
    });

    test("a flat segment stays flat however it is weighted", () => {
        // Both values equal and both tangents zero: no weighting can make the
        // curve leave the line.
        const a = new Keyframe(0, 5, 0, 0);
        const b = new Keyframe(2, 5, 0, 0);
        a.weightedMode = WeightedMode.Both;
        b.weightedMode = WeightedMode.Both;
        a.outWeight = 0.9;
        b.inWeight = 0.05;
        const curve = new AnimationCurve(a, b);

        for (const t of [0, 0.5, 1, 1.5, 2]) {
            expect(curve.evaluate(t)).toBeCloseTo(5, 9);
        }
    });

    test("the solve is accurate enough that x round-trips", () => {
        // The Bezier is parameterised by u, not time, so evaluating at a time
        // means solving for u first. If that solve were loose the curve would
        // be right in shape and wrong in timing — the hardest kind of animation
        // bug to see. A straight line with lopsided weights is still a straight
        // line, so any timing error shows up directly as a value error.
        const curve = ramp((a, b) => {
            a.weightedMode = WeightedMode.Both;
            b.weightedMode = WeightedMode.Both;
            a.outWeight = 0.9;
            b.inWeight = 0.05;
        }, 1, 1);

        for (const t of [0.05, 0.2, 0.37, 0.5, 0.63, 0.8, 0.95]) {
            expect(curve.evaluate(t)).toBeCloseTo(t, 6);
        }
    });
});
