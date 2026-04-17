import { describe, test, expect } from "vitest";
import { AnimationCurve, Keyframe, WrapMode } from "../src/engine/core/math/AnimationCurve";

function approx(a: number, b: number, eps = 1e-5): boolean {
    return Math.abs(a - b) < eps;
}

describe("Keyframe", () => {
    test("constructor defaults", () => {
        const k = new Keyframe(1, 2);
        expect(k.time).toBe(1);
        expect(k.value).toBe(2);
        expect(k.inTangent).toBe(0);
        expect(k.outTangent).toBe(0);
        expect(approx(k.inWeight, 1 / 3)).toBe(true);
        expect(approx(k.outWeight, 1 / 3)).toBe(true);
    });

    test("constructor with tangents", () => {
        const k = new Keyframe(0, 5, -1, 2);
        expect(k.inTangent).toBe(-1);
        expect(k.outTangent).toBe(2);
    });

    test("clone is independent", () => {
        const k = new Keyframe(1, 2, 3, 4);
        const c = k.clone();
        c.time = 99;
        expect(k.time).toBe(1);
        expect(c.time).toBe(99);
    });
});

describe("Empty & Single Key", () => {
    test("empty curve evaluates to 0", () => {
        const curve = new AnimationCurve();
        expect(curve.evaluate(0)).toBe(0);
        expect(curve.evaluate(5)).toBe(0);
        expect(curve.length).toBe(0);
    });

    test("single key returns constant", () => {
        const curve = new AnimationCurve(new Keyframe(1, 7));
        expect(curve.evaluate(0)).toBe(7);
        expect(curve.evaluate(1)).toBe(7);
        expect(curve.evaluate(99)).toBe(7);
    });
});

describe("Linear", () => {
    test("Linear factory", () => {
        const curve = AnimationCurve.linear(0, 0, 1, 1);
        expect(approx(curve.evaluate(0), 0)).toBe(true);
        expect(approx(curve.evaluate(0.25), 0.25)).toBe(true);
        expect(approx(curve.evaluate(0.5), 0.5)).toBe(true);
        expect(approx(curve.evaluate(0.75), 0.75)).toBe(true);
        expect(approx(curve.evaluate(1), 1)).toBe(true);
    });

    test("Linear non-zero start", () => {
        const curve = AnimationCurve.linear(2, 10, 4, 20);
        expect(approx(curve.evaluate(2), 10)).toBe(true);
        expect(approx(curve.evaluate(3), 15)).toBe(true);
        expect(approx(curve.evaluate(4), 20)).toBe(true);
    });

    test("Linear descending", () => {
        const curve = AnimationCurve.linear(0, 100, 1, 0);
        expect(approx(curve.evaluate(0.5), 50)).toBe(true);
    });
});

describe("EaseInOut", () => {
    test("endpoints", () => {
        const curve = AnimationCurve.easeInOut(0, 0, 1, 1);
        expect(approx(curve.evaluate(0), 0)).toBe(true);
        expect(approx(curve.evaluate(1), 1)).toBe(true);
    });

    test("midpoint is 0.5", () => {
        const curve = AnimationCurve.easeInOut(0, 0, 1, 1);
        expect(approx(curve.evaluate(0.5), 0.5, 0.001)).toBe(true);
    });

    test("slow start/end, fast middle", () => {
        const curve = AnimationCurve.easeInOut(0, 0, 1, 1);
        const v1 = curve.evaluate(0.1);
        const v9 = curve.evaluate(0.9);
        expect(v1).toBeLessThan(0.1);
        expect(v9).toBeGreaterThan(0.9);
    });
});

describe("Constant", () => {
    test("Constant factory", () => {
        const curve = AnimationCurve.constant(0, 5, 42);
        expect(curve.evaluate(0)).toBe(42);
        expect(curve.evaluate(2.5)).toBe(42);
        expect(curve.evaluate(5)).toBe(42);
    });
});

describe("Hermite Interpolation", () => {
    test("custom tangents create overshoot", () => {
        const curve = new AnimationCurve(
            new Keyframe(0, 0, 0, 10),
            new Keyframe(1, 0, 0, 0),
        );
        expect(curve.evaluate(0.25)).toBeGreaterThan(0.5);
    });

    test("negative tangents create undershoot", () => {
        const curve = new AnimationCurve(
            new Keyframe(0, 0, 0, -10),
            new Keyframe(1, 0, 0, 0),
        );
        expect(curve.evaluate(0.25)).toBeLessThan(-0.5);
    });

    test("multi-segment curve", () => {
        const curve = new AnimationCurve(
            new Keyframe(0, 0, 0, 0),
            new Keyframe(1, 1, 0, 0),
            new Keyframe(2, 0, 0, 0),
        );
        expect(approx(curve.evaluate(0), 0)).toBe(true);
        expect(approx(curve.evaluate(1), 1)).toBe(true);
        expect(approx(curve.evaluate(2), 0)).toBe(true);
        const v05 = curve.evaluate(0.5);
        expect(v05).toBeGreaterThan(0);
        expect(v05).toBeLessThan(1);
    });
});

describe("Key Management", () => {
    test("addKey sorts correctly", () => {
        const curve = new AnimationCurve();
        curve.addKey(new Keyframe(3, 30));
        curve.addKey(new Keyframe(1, 10));
        curve.addKey(new Keyframe(2, 20));
        expect(curve.length).toBe(3);
        expect(curve.getKey(0).time).toBe(1);
        expect(curve.getKey(1).time).toBe(2);
        expect(curve.getKey(2).time).toBe(3);
    });

    test("addKey replaces at same time", () => {
        const curve = new AnimationCurve(new Keyframe(1, 10));
        curve.addKey(new Keyframe(1, 99));
        expect(curve.length).toBe(1);
        expect(curve.getKey(0).value).toBe(99);
    });

    test("addKey(time, value) overload", () => {
        const curve = new AnimationCurve();
        curve.addKey(0, 0);
        curve.addKey(1, 1);
        expect(curve.length).toBe(2);
        const v = curve.evaluate(0.5);
        expect(v).toBeGreaterThan(0.1);
        expect(v).toBeLessThan(0.9);
    });

    test("removeKey", () => {
        const curve = new AnimationCurve(
            new Keyframe(0, 0),
            new Keyframe(1, 1),
            new Keyframe(2, 2),
        );
        curve.removeKey(1);
        expect(curve.length).toBe(2);
        expect(curve.getKey(1).time).toBe(2);
    });

    test("moveKey re-sorts", () => {
        const curve = new AnimationCurve(
            new Keyframe(0, 0),
            new Keyframe(1, 1),
            new Keyframe(2, 2),
        );
        const newIdx = curve.moveKey(0, new Keyframe(3, 30));
        expect(newIdx).toBe(2);
        expect(curve.getKey(2).value).toBe(30);
    });

    test("getKey throws on out of range", () => {
        const curve = new AnimationCurve(new Keyframe(0, 0));
        expect(() => curve.getKey(5)).toThrow();
    });

    test("clear removes all keys", () => {
        const curve = AnimationCurve.linear(0, 0, 1, 1);
        curve.clear();
        expect(curve.length).toBe(0);
    });
});

describe("Properties", () => {
    test("startTime / endTime / duration", () => {
        const curve = new AnimationCurve(
            new Keyframe(2, 0),
            new Keyframe(5, 1),
        );
        expect(curve.startTime).toBe(2);
        expect(curve.endTime).toBe(5);
        expect(curve.duration).toBe(3);
    });
});

describe("Wrap Modes", () => {
    test("Clamp (default) holds edge values", () => {
        const curve = AnimationCurve.linear(0, 0, 1, 10);
        expect(approx(curve.evaluate(-1), 0)).toBe(true);
        expect(approx(curve.evaluate(2), 10)).toBe(true);
    });

    test("Loop wraps around", () => {
        const curve = AnimationCurve.linear(0, 0, 1, 1);
        curve.postWrapMode = WrapMode.Loop;
        expect(approx(curve.evaluate(1.25), 0.25, 0.01)).toBe(true);
        expect(approx(curve.evaluate(2.5), 0.5, 0.01)).toBe(true);
    });

    test("Loop pre-wrap", () => {
        const curve = AnimationCurve.linear(0, 0, 1, 1);
        curve.preWrapMode = WrapMode.Loop;
        expect(approx(curve.evaluate(-0.25), 0.75, 0.01)).toBe(true);
    });

    test("PingPong", () => {
        const curve = AnimationCurve.linear(0, 0, 1, 1);
        curve.postWrapMode = WrapMode.PingPong;
        expect(approx(curve.evaluate(1.25), 0.75, 0.01)).toBe(true);
        expect(approx(curve.evaluate(2.25), 0.25, 0.01)).toBe(true);
    });
});

describe("Clone", () => {
    test("clone is independent", () => {
        const original = AnimationCurve.easeInOut(0, 0, 1, 1);
        original.postWrapMode = WrapMode.Loop;
        const cloned = original.clone();
        cloned.addKey(new Keyframe(0.5, 0.5));
        expect(original.length).toBe(2);
        expect(cloned.length).toBe(3);
        expect(cloned.postWrapMode).toBe(WrapMode.Loop);
    });
});

describe("Edge Cases", () => {
    test("keys at same time handles gracefully", () => {
        const curve = new AnimationCurve(
            new Keyframe(1, 10),
            new Keyframe(1, 20),
        );
        expect(curve.length === 2 || curve.evaluate(1) !== 0).toBe(true);
    });

    test("very small dt between keys", () => {
        const curve = new AnimationCurve(
            new Keyframe(0, 0),
            new Keyframe(0.0001, 1),
        );
        expect(approx(curve.evaluate(0), 0, 0.01)).toBe(true);
        expect(approx(curve.evaluate(0.0001), 1, 0.01)).toBe(true);
    });

    test("binary search correctness with many keys", () => {
        const curve = new AnimationCurve();
        for (let i = 0; i <= 20; i++) {
            curve.addKey(new Keyframe(i, i * 10, 10, 10));
        }
        expect(approx(curve.evaluate(10.5), 105, 0.1)).toBe(true);
        expect(approx(curve.evaluate(0), 0)).toBe(true);
        expect(approx(curve.evaluate(20), 200)).toBe(true);
    });
});
