import { describe, test, expect } from "vitest";
import { Mathf } from "../src/engine/core/math/Mathf";

function approx(a: number, b: number, e = 1e-5) { return Math.abs(a - b) < e; }

describe("Mathf", () => {
    // ── Constants ──
    describe("Constants", () => {
        test("PI", () => expect(Mathf.PI).toBe(Math.PI));
        test("Deg2Rad", () => expect(approx(Mathf.Deg2Rad, Math.PI / 180)).toBe(true));
        test("Rad2Deg", () => expect(approx(Mathf.Rad2Deg, 180 / Math.PI)).toBe(true));
        test("Epsilon > 0", () => expect(Mathf.Epsilon > 0 && Mathf.Epsilon < 0.001).toBe(true));
    });

    // ── Clamping ──
    describe("Clamping", () => {
        test("clamp mid", () => expect(Mathf.clamp(5, 0, 10)).toBe(5));
        test("clamp lo", () => expect(Mathf.clamp(-5, 0, 10)).toBe(0));
        test("clamp hi", () => expect(Mathf.clamp(15, 0, 10)).toBe(10));
        test("clamp01 mid", () => expect(Mathf.clamp01(0.5)).toBe(0.5));
        test("clamp01 lo", () => expect(Mathf.clamp01(-1)).toBe(0));
        test("clamp01 hi", () => expect(Mathf.clamp01(2)).toBe(1));
    });

    // ── Interpolation ──
    describe("Interpolation", () => {
        test("lerp 0", () => expect(Mathf.lerp(10, 20, 0)).toBeCloseTo(10));
        test("lerp 0.5", () => expect(Mathf.lerp(10, 20, 0.5)).toBeCloseTo(15));
        test("lerp 1", () => expect(Mathf.lerp(10, 20, 1)).toBeCloseTo(20));
        test("lerp clamps t", () => expect(Mathf.lerp(10, 20, 2)).toBeCloseTo(20));
        test("lerpUnclamped >1", () => expect(Mathf.lerpUnclamped(10, 20, 2)).toBeCloseTo(30));
        test("inverseLerp", () => expect(Mathf.inverseLerp(0, 100, 75)).toBeCloseTo(0.75));
        test("inverseLerp same", () => expect(Mathf.inverseLerp(5, 5, 5)).toBe(0));
        test("remap", () => expect(Mathf.remap(0, 10, 100, 200, 5)).toBeCloseTo(150));
        test("smoothStep edges", () => {
            expect(Mathf.smoothStep(0, 1, 0)).toBeCloseTo(0);
            expect(Mathf.smoothStep(0, 1, 1)).toBeCloseTo(1);
        });
        test("smoothStep mid", () => expect(Mathf.smoothStep(0, 1, 0.5)).toBeCloseTo(0.5));
    });

    // ── MoveTowards ──
    describe("MoveTowards", () => {
        test("moveTowards step", () => expect(Mathf.moveTowards(0, 10, 3)).toBeCloseTo(3));
        test("moveTowards overshoot", () => expect(Mathf.moveTowards(9, 10, 5)).toBeCloseTo(10));
        test("moveTowards negative", () => expect(Mathf.moveTowards(5, 0, 2)).toBeCloseTo(3));
    });

    // ── SmoothDamp ──
    describe("SmoothDamp", () => {
        test("smoothDamp moves toward target", () => {
            let vel = 0;
            let pos = 0;
            for (let i = 0; i < 100; i++) {
                const [p, v] = Mathf.smoothDamp(pos, 10, vel, 0.3, Infinity, 1/60);
                pos = p; vel = v;
            }
            expect(approx(pos, 10, 0.1)).toBe(true);
        });
    });

    // ── Angles ──
    describe("Angles", () => {
        test("deltaAngle 0→90", () => expect(Mathf.deltaAngle(0, 90)).toBeCloseTo(90));
        test("deltaAngle 350→10", () => expect(Mathf.deltaAngle(350, 10)).toBeCloseTo(20));
        test("deltaAngle 10→350", () => expect(Mathf.deltaAngle(10, 350)).toBeCloseTo(-20));
        test("lerpAngle 0→350 at 0.5", () => {
            const v = Mathf.lerpAngle(0, 350, 0.5);
            expect(approx(v, -5) || approx(v, 355)).toBe(true);
        });
        test("moveTowardsAngle", () => {
            const v = Mathf.moveTowardsAngle(350, 10, 5);
            expect(approx(v, 355)).toBe(true);
        });
    });

    // ── Repeat / PingPong ──
    describe("Repeat / PingPong", () => {
        test("repeat", () => expect(Mathf.repeat(5.5, 3)).toBeCloseTo(2.5));
        test("repeat negative", () => expect(Mathf.repeat(-0.5, 3)).toBeCloseTo(2.5));
        test("pingPong up", () => expect(Mathf.pingPong(0.5, 1)).toBeCloseTo(0.5));
        test("pingPong down", () => expect(Mathf.pingPong(1.5, 1)).toBeCloseTo(0.5));
        test("pingPong cycle", () => expect(Mathf.pingPong(3.5, 1)).toBeCloseTo(0.5));
    });

    // ── Approximately ──
    describe("Approximately", () => {
        test("approx true", () => expect(Mathf.approximately(1.0, 1.0 + 1e-7)).toBe(true));
        test("approx false", () => expect(Mathf.approximately(1.0, 1.1)).toBe(false));
        test("approx zero", () => expect(Mathf.approximately(0, 0)).toBe(true));
    });

    // ── Sign / Abs / Min / Max ──
    describe("Sign / Abs / Min / Max", () => {
        test("sign positive", () => expect(Mathf.sign(5)).toBe(1));
        test("sign negative", () => expect(Mathf.sign(-3)).toBe(-1));
        test("abs", () => expect(Mathf.abs(-7)).toBe(7));
        test("min", () => expect(Mathf.min(3, 7)).toBe(3));
        test("max", () => expect(Mathf.max(3, 7)).toBe(7));
        test("min variadic", () => expect(Mathf.min(5, 2, 8, 1)).toBe(1));
    });

    // ── Power / Root / Log ──
    describe("Power / Root / Log", () => {
        test("pow", () => expect(Mathf.pow(2, 10)).toBeCloseTo(1024));
        test("sqrt", () => expect(Mathf.sqrt(144)).toBeCloseTo(12));
        test("log", () => expect(Mathf.log(Math.E)).toBeCloseTo(1));
        test("log10", () => expect(Mathf.log10(1000)).toBeCloseTo(3));
        test("exp", () => expect(Mathf.exp(1)).toBeCloseTo(Math.E));
    });

    // ── Rounding ──
    describe("Rounding", () => {
        test("floor", () => expect(Mathf.floor(2.7)).toBe(2));
        test("floorToInt", () => expect(Mathf.floorToInt(2.7)).toBe(2));
        test("ceil", () => expect(Mathf.ceil(2.1)).toBe(3));
        test("ceilToInt", () => expect(Mathf.ceilToInt(2.1)).toBe(3));
        // 2.5 rounds to 2, not 3: halves go to the even neighbour, as Unity's
        // Mathf.Round does. This assertion said 3 until audit F48 — it was
        // pinning JavaScript's Math.round, which is what the method used to
        // call. See tests/MathfRounding.test.ts for the full contract.
        test("round", () => expect(Mathf.round(2.5)).toBe(2));
        test("roundToInt", () => expect(Mathf.roundToInt(2.4)).toBe(2));
    });

    // ── Trig ──
    describe("Trigonometry", () => {
        test("sin", () => expect(Mathf.sin(Math.PI / 2)).toBeCloseTo(1));
        test("cos", () => expect(Mathf.cos(0)).toBeCloseTo(1));
        test("tan", () => expect(Mathf.tan(Math.PI / 4)).toBeCloseTo(1));
        test("asin", () => expect(Mathf.asin(1)).toBeCloseTo(Math.PI / 2));
        test("atan2", () => expect(Mathf.atan2(1, 1)).toBeCloseTo(Math.PI / 4));
    });

    // ── Power of Two ──
    describe("Power of Two", () => {
        test("nextPowerOfTwo 5", () => expect(Mathf.nextPowerOfTwo(5)).toBe(8));
        test("nextPowerOfTwo 8", () => expect(Mathf.nextPowerOfTwo(8)).toBe(8));
        test("closestPowerOfTwo 6", () => expect(Mathf.closestPowerOfTwo(6)).toBe(8));
        test("closestPowerOfTwo 5", () => expect(Mathf.closestPowerOfTwo(5)).toBe(4));
        test("isPowerOfTwo true", () => expect(Mathf.isPowerOfTwo(64)).toBe(true));
        test("isPowerOfTwo false", () => expect(Mathf.isPowerOfTwo(65)).toBe(false));
    });

    // ── Perlin Noise ──
    describe("Perlin Noise", () => {
        test("perlinNoise range [0,1]", () => {
            for (let i = 0; i < 100; i++) {
                const v = Mathf.perlinNoise(i * 0.1, i * 0.2);
                expect(v).toBeGreaterThanOrEqual(-0.01);
                expect(v).toBeLessThanOrEqual(1.01);
            }
        });
        test("perlinNoise deterministic", () => {
            expect(Mathf.perlinNoise(1.5, 2.5)).toBe(Mathf.perlinNoise(1.5, 2.5));
        });
    });

    // ── Gamma/Linear ──
    describe("Gamma/Linear", () => {
        test("gamma roundtrip", () => {
            const v = 0.5;
            expect(Mathf.linearToGammaSpace(Mathf.gammaToLinearSpace(v))).toBeCloseTo(v, 4);
        });
    });

    // ── SmoothDampAngle ──
    describe("SmoothDampAngle", () => {
        test("smoothDampAngle wraps", () => {
            let vel = 0, angle = 350;
            for (let i = 0; i < 100; i++) {
                const [a, v] = Mathf.smoothDampAngle(angle, 10, vel, 0.3, Infinity, 1/60);
                angle = a; vel = v;
            }
            const delta = Math.abs(((angle - 10) % 360 + 540) % 360 - 180);
            expect(delta).toBeLessThan(1);
        });
    });
});
