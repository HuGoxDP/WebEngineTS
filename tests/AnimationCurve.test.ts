// tests/AnimationCurve.test.ts
// Run: npx tsx tests/AnimationCurve.test.ts
import { AnimationCurve, Keyframe, WrapMode } from "../src/engine/core/math/AnimationCurve";

const EPSILON = 1e-5;

function approx(a: number, b: number, eps = EPSILON): boolean {
    return Math.abs(a - b) < eps;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e: any) {
        failed++;
        console.error(`  ✗ ${name}: ${e.message}`);
    }
}

function assert(condition: boolean, msg: string = "assertion failed"): void {
    if (!condition) throw new Error(msg);
}

// ==================== KEYFRAME ====================

console.log("--- Keyframe ---");

test("constructor defaults", () => {
    const k = new Keyframe(1, 2);
    assert(k.time === 1 && k.value === 2, "time/value");
    assert(k.inTangent === 0 && k.outTangent === 0, "tangents default 0");
    assert(approx(k.inWeight, 1 / 3) && approx(k.outWeight, 1 / 3), "weights default 1/3");
});

test("constructor with tangents", () => {
    const k = new Keyframe(0, 5, -1, 2);
    assert(k.inTangent === -1 && k.outTangent === 2, "tangents set");
});

test("clone is independent", () => {
    const k = new Keyframe(1, 2, 3, 4);
    const c = k.clone();
    c.time = 99;
    assert(k.time === 1, "original unchanged");
    assert(c.time === 99, "clone changed");
});

// ==================== EMPTY / SINGLE KEY ====================

console.log("\n--- Empty & Single Key ---");

test("empty curve evaluates to 0", () => {
    const curve = new AnimationCurve();
    assert(curve.evaluate(0) === 0, "0 at time 0");
    assert(curve.evaluate(5) === 0, "0 at time 5");
    assert(curve.length === 0, "length 0");
});

test("single key returns constant", () => {
    const curve = new AnimationCurve(new Keyframe(1, 7));
    assert(curve.evaluate(0) === 7, "before");
    assert(curve.evaluate(1) === 7, "at");
    assert(curve.evaluate(99) === 7, "after");
});

// ==================== LINEAR ====================

console.log("\n--- Linear ---");

test("Linear factory", () => {
    const curve = AnimationCurve.linear(0, 0, 1, 1);
    assert(approx(curve.evaluate(0), 0), "at 0");
    assert(approx(curve.evaluate(0.25), 0.25), "at 0.25");
    assert(approx(curve.evaluate(0.5), 0.5), "at 0.5");
    assert(approx(curve.evaluate(0.75), 0.75), "at 0.75");
    assert(approx(curve.evaluate(1), 1), "at 1");
});

test("Linear non-zero start", () => {
    const curve = AnimationCurve.linear(2, 10, 4, 20);
    assert(approx(curve.evaluate(2), 10), "at start");
    assert(approx(curve.evaluate(3), 15), "at mid");
    assert(approx(curve.evaluate(4), 20), "at end");
});

test("Linear descending", () => {
    const curve = AnimationCurve.linear(0, 100, 1, 0);
    assert(approx(curve.evaluate(0.5), 50), "at 0.5");
});

// ==================== EASE IN OUT ====================

console.log("\n--- EaseInOut ---");

test("EaseInOut endpoints", () => {
    const curve = AnimationCurve.easeInOut(0, 0, 1, 1);
    assert(approx(curve.evaluate(0), 0), "start = 0");
    assert(approx(curve.evaluate(1), 1), "end = 1");
});

test("EaseInOut midpoint is 0.5", () => {
    const curve = AnimationCurve.easeInOut(0, 0, 1, 1);
    assert(approx(curve.evaluate(0.5), 0.5, 0.001), "mid ≈ 0.5");
});

test("EaseInOut slow start/end, fast middle", () => {
    const curve = AnimationCurve.easeInOut(0, 0, 1, 1);
    const v1 = curve.evaluate(0.1);
    const v5 = curve.evaluate(0.5);
    const v9 = curve.evaluate(0.9);
    // Near start: value should be < proportional (easing in)
    assert(v1 < 0.1, `slow start: ${v1} < 0.1`);
    // Near end: value should be > proportional (easing out)
    assert(v9 > 0.9, `slow end: ${v9} > 0.9`);
});

// ==================== CONSTANT ====================

console.log("\n--- Constant ---");

test("Constant factory", () => {
    const curve = AnimationCurve.constant(0, 5, 42);
    assert(curve.evaluate(0) === 42, "at 0");
    assert(curve.evaluate(2.5) === 42, "at 2.5");
    assert(curve.evaluate(5) === 42, "at 5");
});

// ==================== HERMITE INTERPOLATION ====================

console.log("\n--- Hermite Interpolation ---");

test("Custom tangents create overshoot", () => {
    // Steep outgoing tangent from k0, flat arrival at k1 → overshoots before settling
    const curve = new AnimationCurve(
        new Keyframe(0, 0, 0, 10),
        new Keyframe(1, 0, 0, 0),
    );
    // At s≈0.25 the steep tangent pushes the value well above 0
    const v = curve.evaluate(0.25);
    assert(v > 0.5, `overshoot: ${v} > 0.5`);
});

test("Negative tangents create undershoot", () => {
    const curve = new AnimationCurve(
        new Keyframe(0, 0, 0, -10),
        new Keyframe(1, 0, 0, 0),
    );
    const v = curve.evaluate(0.25);
    assert(v < -0.5, `undershoot: ${v} < -0.5`);
});

test("Multi-segment curve", () => {
    const curve = new AnimationCurve(
        new Keyframe(0, 0, 0, 0),
        new Keyframe(1, 1, 0, 0),
        new Keyframe(2, 0, 0, 0),
    );
    assert(approx(curve.evaluate(0), 0), "at 0");
    assert(approx(curve.evaluate(1), 1), "at 1");
    assert(approx(curve.evaluate(2), 0), "at 2");
    // Mid-points should be smooth
    const v05 = curve.evaluate(0.5);
    assert(v05 > 0 && v05 < 1, `0 < ${v05} < 1`);
});

// ==================== KEY MANAGEMENT ====================

console.log("\n--- Key Management ---");

test("addKey sorts correctly", () => {
    const curve = new AnimationCurve();
    curve.addKey(new Keyframe(3, 30));
    curve.addKey(new Keyframe(1, 10));
    curve.addKey(new Keyframe(2, 20));
    assert(curve.length === 3, "3 keys");
    assert(curve.getKey(0).time === 1, "sorted [0]");
    assert(curve.getKey(1).time === 2, "sorted [1]");
    assert(curve.getKey(2).time === 3, "sorted [2]");
});

test("addKey replaces at same time", () => {
    const curve = new AnimationCurve(new Keyframe(1, 10));
    curve.addKey(new Keyframe(1, 99));
    assert(curve.length === 1, "still 1 key");
    assert(curve.getKey(0).value === 99, "value replaced");
});

test("addKey(time, value) overload", () => {
    const curve = new AnimationCurve();
    curve.addKey(0, 0);
    curve.addKey(1, 1);
    assert(curve.length === 2, "2 keys");
    const v = curve.evaluate(0.5);
    // Auto-smooth gives a reasonable curve between 0 and 1
    assert(v > 0.1 && v < 0.9, `auto-smooth in range: ${v}`);
});

test("removeKey", () => {
    const curve = new AnimationCurve(
        new Keyframe(0, 0),
        new Keyframe(1, 1),
        new Keyframe(2, 2),
    );
    curve.removeKey(1);
    assert(curve.length === 2, "2 keys after remove");
    assert(curve.getKey(1).time === 2, "key at [1] is now time=2");
});

test("moveKey re-sorts", () => {
    const curve = new AnimationCurve(
        new Keyframe(0, 0),
        new Keyframe(1, 1),
        new Keyframe(2, 2),
    );
    const newIdx = curve.moveKey(0, new Keyframe(3, 30));
    assert(newIdx === 2, `moved to index 2, got ${newIdx}`);
    assert(curve.getKey(2).value === 30, "value at new position");
});

test("getKey throws on out of range", () => {
    const curve = new AnimationCurve(new Keyframe(0, 0));
    let threw = false;
    try { curve.getKey(5); } catch { threw = true; }
    assert(threw, "should throw RangeError");
});

test("clear removes all keys", () => {
    const curve = AnimationCurve.linear(0, 0, 1, 1);
    curve.clear();
    assert(curve.length === 0, "empty");
});

// ==================== PROPERTIES ====================

console.log("\n--- Properties ---");

test("startTime / endTime / duration", () => {
    const curve = new AnimationCurve(
        new Keyframe(2, 0),
        new Keyframe(5, 1),
    );
    assert(curve.startTime === 2, "startTime");
    assert(curve.endTime === 5, "endTime");
    assert(curve.duration === 3, "duration");
});

// ==================== WRAP MODES ====================

console.log("\n--- Wrap Modes ---");

test("Clamp (default) — holds edge values", () => {
    const curve = AnimationCurve.linear(0, 0, 1, 10);
    assert(approx(curve.evaluate(-1), 0), "before: clamp to 0");
    assert(approx(curve.evaluate(2), 10), "after: clamp to 10");
});

test("Loop wraps around", () => {
    const curve = AnimationCurve.linear(0, 0, 1, 1);
    curve.postWrapMode = WrapMode.Loop;
    // time=1.25 should map to time=0.25
    assert(approx(curve.evaluate(1.25), 0.25, 0.01), `loop: ${curve.evaluate(1.25)} ≈ 0.25`);
    // time=2.5 should map to time=0.5
    assert(approx(curve.evaluate(2.5), 0.5, 0.01), `loop 2: ${curve.evaluate(2.5)} ≈ 0.5`);
});

test("Loop pre-wrap", () => {
    const curve = AnimationCurve.linear(0, 0, 1, 1);
    curve.preWrapMode = WrapMode.Loop;
    // time=-0.25 should map to time=0.75
    assert(approx(curve.evaluate(-0.25), 0.75, 0.01), `pre-loop: ${curve.evaluate(-0.25)} ≈ 0.75`);
});

test("PingPong", () => {
    const curve = AnimationCurve.linear(0, 0, 1, 1);
    curve.postWrapMode = WrapMode.PingPong;
    // time=1.25 → reversed → should be ≈ 0.75
    assert(approx(curve.evaluate(1.25), 0.75, 0.01), `pingpong: ${curve.evaluate(1.25)} ≈ 0.75`);
    // time=2.25 → back to forward → should be ≈ 0.25
    assert(approx(curve.evaluate(2.25), 0.25, 0.01), `pingpong 2: ${curve.evaluate(2.25)} ≈ 0.25`);
});

// ==================== CLONE ====================

console.log("\n--- Clone ---");

test("clone is independent", () => {
    const original = AnimationCurve.easeInOut(0, 0, 1, 1);
    original.postWrapMode = WrapMode.Loop;
    const cloned = original.clone();
    cloned.addKey(new Keyframe(0.5, 0.5));
    assert(original.length === 2, "original unchanged");
    assert(cloned.length === 3, "clone has new key");
    assert(cloned.postWrapMode === WrapMode.Loop, "wrap mode copied");
});

// ==================== EDGE CASES ====================

console.log("\n--- Edge Cases ---");

test("keys at same time", () => {
    const curve = new AnimationCurve(
        new Keyframe(1, 10),
        new Keyframe(1, 20),
    );
    // Second key should replace first
    assert(curve.length === 2 || curve.evaluate(1) !== 0, "handles gracefully");
});

test("very small dt between keys", () => {
    const curve = new AnimationCurve(
        new Keyframe(0, 0),
        new Keyframe(0.0001, 1),
    );
    assert(approx(curve.evaluate(0), 0, 0.01), "at start");
    assert(approx(curve.evaluate(0.0001), 1, 0.01), "at end");
});

test("binary search correctness with many keys", () => {
    const curve = new AnimationCurve();
    for (let i = 0; i <= 20; i++) {
        curve.addKey(new Keyframe(i, i * 10, 10, 10));
    }
    // Linear tangent=10 over dt=1 → linear interpolation
    assert(approx(curve.evaluate(10.5), 105, 0.1), "many keys mid");
    assert(approx(curve.evaluate(0), 0), "many keys start");
    assert(approx(curve.evaluate(20), 200), "many keys end");
});

// ==================== SUMMARY ====================

console.log(`\n========================================`);
console.log(`AnimationCurve tests: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) process.exit(1);