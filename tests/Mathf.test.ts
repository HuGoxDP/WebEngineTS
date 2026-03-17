// tests/Mathf.test.ts
// Run: npx tsx tests/Mathf.test.ts
import { Mathf } from "../src/engine/core/math/Mathf";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e: any) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}
function assert(c: boolean, m = "fail") { if (!c) throw new Error(m); }
function approx(a: number, b: number, e = 1e-5) { return Math.abs(a - b) < e; }

// ── Constants ──
console.log("--- Constants ---");
test("PI", () => assert(Mathf.PI === Math.PI));
test("Deg2Rad", () => assert(approx(Mathf.Deg2Rad, Math.PI / 180)));
test("Rad2Deg", () => assert(approx(Mathf.Rad2Deg, 180 / Math.PI)));
test("Epsilon > 0", () => assert(Mathf.Epsilon > 0 && Mathf.Epsilon < 0.001));

// ── Clamping ──
console.log("\n--- Clamping ---");
test("clamp mid", () => assert(Mathf.clamp(5, 0, 10) === 5));
test("clamp lo", () => assert(Mathf.clamp(-5, 0, 10) === 0));
test("clamp hi", () => assert(Mathf.clamp(15, 0, 10) === 10));
test("clamp01 mid", () => assert(Mathf.clamp01(0.5) === 0.5));
test("clamp01 lo", () => assert(Mathf.clamp01(-1) === 0));
test("clamp01 hi", () => assert(Mathf.clamp01(2) === 1));

// ── Interpolation ──
console.log("\n--- Interpolation ---");
test("lerp 0", () => assert(approx(Mathf.lerp(10, 20, 0), 10)));
test("lerp 0.5", () => assert(approx(Mathf.lerp(10, 20, 0.5), 15)));
test("lerp 1", () => assert(approx(Mathf.lerp(10, 20, 1), 20)));
test("lerp clamps t", () => assert(approx(Mathf.lerp(10, 20, 2), 20)));
test("lerpUnclamped >1", () => assert(approx(Mathf.lerpUnclamped(10, 20, 2), 30)));
test("inverseLerp", () => assert(approx(Mathf.inverseLerp(0, 100, 75), 0.75)));
test("inverseLerp same", () => assert(Mathf.inverseLerp(5, 5, 5) === 0));
test("remap", () => assert(approx(Mathf.remap(0, 10, 100, 200, 5), 150)));
test("smoothStep edges", () => {
    assert(approx(Mathf.smoothStep(0, 1, 0), 0));
    assert(approx(Mathf.smoothStep(0, 1, 1), 1));
});
test("smoothStep mid", () => assert(approx(Mathf.smoothStep(0, 1, 0.5), 0.5)));

// ── MoveTowards ──
console.log("\n--- MoveTowards ---");
test("moveTowards step", () => assert(approx(Mathf.moveTowards(0, 10, 3), 3)));
test("moveTowards overshoot", () => assert(approx(Mathf.moveTowards(9, 10, 5), 10)));
test("moveTowards negative", () => assert(approx(Mathf.moveTowards(5, 0, 2), 3)));

// ── SmoothDamp ──
console.log("\n--- SmoothDamp ---");
test("smoothDamp moves toward target", () => {
    let vel = 0;
    let pos = 0;
    for (let i = 0; i < 100; i++) {
        const [p, v] = Mathf.smoothDamp(pos, 10, vel, 0.3, Infinity, 1/60);
        pos = p; vel = v;
    }
    assert(approx(pos, 10, 0.1), `pos=${pos}`);
});

// ── Angles ──
console.log("\n--- Angles ---");
test("deltaAngle 0→90", () => assert(approx(Mathf.deltaAngle(0, 90), 90)));
test("deltaAngle 350→10", () => assert(approx(Mathf.deltaAngle(350, 10), 20)));
test("deltaAngle 10→350", () => assert(approx(Mathf.deltaAngle(10, 350), -20)));
test("lerpAngle 0→350 at 0.5", () => {
    const v = Mathf.lerpAngle(0, 350, 0.5);
    assert(approx(v, -5) || approx(v, 355), `v=${v}`);
});
test("moveTowardsAngle", () => {
    const v = Mathf.moveTowardsAngle(350, 10, 5);
    assert(approx(v, 355), `v=${v}`);
});

// ── Repeat / PingPong ──
console.log("\n--- Repeat / PingPong ---");
test("repeat", () => assert(approx(Mathf.repeat(5.5, 3), 2.5)));
test("repeat negative", () => assert(approx(Mathf.repeat(-0.5, 3), 2.5)));
test("pingPong up", () => assert(approx(Mathf.pingPong(0.5, 1), 0.5)));
test("pingPong down", () => assert(approx(Mathf.pingPong(1.5, 1), 0.5)));
test("pingPong cycle", () => assert(approx(Mathf.pingPong(3.5, 1), 0.5)));

// ── Approximately ──
console.log("\n--- Approximately ---");
test("approx true", () => assert(Mathf.approximately(1.0, 1.0 + 1e-7)));
test("approx false", () => assert(!Mathf.approximately(1.0, 1.1)));
test("approx zero", () => assert(Mathf.approximately(0, 0)));

// ── Sign / Abs / Min / Max ──
console.log("\n--- Sign / Abs / Min / Max ---");
test("sign positive", () => assert(Mathf.sign(5) === 1));
test("sign negative", () => assert(Mathf.sign(-3) === -1));
test("abs", () => assert(Mathf.abs(-7) === 7));
test("min", () => assert(Mathf.min(3, 7) === 3));
test("max", () => assert(Mathf.max(3, 7) === 7));
test("min variadic", () => assert(Mathf.min(5, 2, 8, 1) === 1));

// ── Power / Root / Log ──
console.log("\n--- Power / Root / Log ---");
test("pow", () => assert(approx(Mathf.pow(2, 10), 1024)));
test("sqrt", () => assert(approx(Mathf.sqrt(144), 12)));
test("log", () => assert(approx(Mathf.log(Math.E), 1)));
test("log10", () => assert(approx(Mathf.log10(1000), 3)));
test("exp", () => assert(approx(Mathf.exp(1), Math.E)));

// ── Rounding ──
console.log("\n--- Rounding ---");
test("floor", () => assert(Mathf.floor(2.7) === 2));
test("floorToInt", () => assert(Mathf.floorToInt(2.7) === 2));
test("ceil", () => assert(Mathf.ceil(2.1) === 3));
test("ceilToInt", () => assert(Mathf.ceilToInt(2.1) === 3));
test("round", () => assert(Mathf.round(2.5) === 3));
test("roundToInt", () => assert(Mathf.roundToInt(2.4) === 2));

// ── Trig ──
console.log("\n--- Trigonometry ---");
test("sin", () => assert(approx(Mathf.sin(Math.PI / 2), 1)));
test("cos", () => assert(approx(Mathf.cos(0), 1)));
test("tan", () => assert(approx(Mathf.tan(Math.PI / 4), 1)));
test("asin", () => assert(approx(Mathf.asin(1), Math.PI / 2)));
test("atan2", () => assert(approx(Mathf.atan2(1, 1), Math.PI / 4)));

// ── Power of Two ──
console.log("\n--- Power of Two ---");
test("nextPowerOfTwo 5", () => assert(Mathf.nextPowerOfTwo(5) === 8));
test("nextPowerOfTwo 8", () => assert(Mathf.nextPowerOfTwo(8) === 8));
test("closestPowerOfTwo 6", () => assert(Mathf.closestPowerOfTwo(6) === 8));
test("closestPowerOfTwo 5", () => assert(Mathf.closestPowerOfTwo(5) === 4));
test("isPowerOfTwo true", () => assert(Mathf.isPowerOfTwo(64)));
test("isPowerOfTwo false", () => assert(!Mathf.isPowerOfTwo(65)));

// ── Perlin Noise ──
console.log("\n--- Perlin Noise ---");
test("perlinNoise range [0,1]", () => {
    for (let i = 0; i < 100; i++) {
        const v = Mathf.perlinNoise(i * 0.1, i * 0.2);
        assert(v >= -0.01 && v <= 1.01, `out of range: ${v}`);
    }
});
test("perlinNoise deterministic", () => {
    assert(Mathf.perlinNoise(1.5, 2.5) === Mathf.perlinNoise(1.5, 2.5));
});

// ── Gamma/Linear ──
console.log("\n--- Gamma/Linear ---");
test("gamma roundtrip", () => {
    const v = 0.5;
    assert(approx(Mathf.linearToGammaSpace(Mathf.gammaToLinearSpace(v)), v, 1e-4));
});

// ── SmoothDampAngle ──
console.log("\n--- SmoothDampAngle ---");
test("smoothDampAngle wraps", () => {
    let vel = 0, angle = 350;
    for (let i = 0; i < 100; i++) {
        const [a, v] = Mathf.smoothDampAngle(angle, 10, vel, 0.3, Infinity, 1/60);
        angle = a; vel = v;
    }
    // Should be near 10 (went through 360, not backward through 180)
    const delta = Math.abs(((angle - 10) % 360 + 540) % 360 - 180);
    assert(delta < 1, `angle=${angle}`);
});

console.log(`\n========================================`);
console.log(`Mathf tests: ${passed} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0) process.exit(1);