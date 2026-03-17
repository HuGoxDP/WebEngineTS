// tests/Coroutine.test.ts
// Run: npx tsx tests/Coroutine.test.ts
//
// This test patches Time's private fields directly. Coroutine.ts reads
// Time.deltaTime / Time.unscaledDeltaTime via the same static class.
import {
    Coroutine, CoroutineRunner,
    WaitForSeconds, WaitForSecondsRealtime,
    WaitUntil, WaitWhile,
    WaitForEndOfFrame, WaitForFixedUpdate,
    YieldInstruction
} from "../src/engine/core/Coroutine";

import { Time } from "../src/engine/core/Time";

/** Helper: set Time.deltaTime (scaled). */
function setDt(dt: number) { (Time as any)._deltaTime = dt; }
/** Helper: set Time.unscaledDeltaTime. */
function setUdt(udt: number) { (Time as any)._unscaledDeltaTime = udt; }
/** Helper: set both dt and udt. */
function setTime(dt: number, udt: number = dt) { setDt(dt); setUdt(udt); }

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e: any) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}
function assert(c: boolean, m = "fail") { if (!c) throw new Error(m); }

// ── Basic lifecycle ──
console.log("--- Basic Lifecycle ---");

test("coroutine runs to completion", () => {
    const runner = new CoroutineRunner();
    let step = 0;
    function* gen(): Generator<YieldInstruction> {
        step = 1;
        yield null;
        step = 2;
        yield null;
        step = 3;
    }
    const co = runner.startCoroutine(gen());
    assert(step === 1, `step=${step}, expected 1 after start`);
    assert(!co.isFinished, "not finished after start");

    setTime(1/60);
    runner.tickUpdate();
    assert(step === 2, `step=${step}, expected 2 after tick 1`);

    runner.tickUpdate();
    assert(step === 3, `step=${step}, expected 3 after tick 2`);
    assert(co.isFinished, "finished after all yields");
    assert(runner.count === 0, `count=${runner.count}`);
});

test("empty coroutine finishes immediately", () => {
    const runner = new CoroutineRunner();
    function* gen(): Generator<YieldInstruction> {}
    const co = runner.startCoroutine(gen());
    assert(co.isFinished, "finished");
    assert(runner.count === 0, "no active");
});

test("stopCoroutine cancels", () => {
    const runner = new CoroutineRunner();
    let reached = false;
    function* gen(): Generator<YieldInstruction> {
        yield null;
        reached = true;
    }
    const co = runner.startCoroutine(gen());
    runner.stopCoroutine(co);
    assert(co.isFinished, "marked finished");

    runner.tickUpdate();
    assert(!reached, "should not continue");
});

test("stopAllCoroutines", () => {
    const runner = new CoroutineRunner();
    function* gen(): Generator<YieldInstruction> { yield null; yield null; }
    runner.startCoroutine(gen());
    runner.startCoroutine(gen());
    assert(runner.count === 2, "2 active");
    runner.stopAllCoroutines();
    assert(runner.count === 0, "0 active");
});

// ── WaitForSeconds ──
console.log("\n--- WaitForSeconds ---");

test("WaitForSeconds waits correct duration", () => {
    const runner = new CoroutineRunner();
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitForSeconds(0.5);
        done = true;
    }
    runner.startCoroutine(gen());

    // 25 frames at 0.02 = 0.5s exactly
    for (let i = 0; i < 24; i++) {
        setDt(0.02);
        runner.tickUpdate();
    }
    assert(!done, "not done at 24 frames (0.48s)");

    setDt(0.02);
    runner.tickUpdate();
    assert(done, "done at 25 frames (0.50s)");
});

test("WaitForSeconds respects timeScale", () => {
    const runner = new CoroutineRunner();
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitForSeconds(1);
        done = true;
    }
    runner.startCoroutine(gen());

    // Half speed: dt = 0.01 per frame (simulating half speed), need 100 frames for 1s
    for (let i = 0; i < 99; i++) {
        setDt(0.01);
        runner.tickUpdate();
    }
    assert(!done, "not done at 99 frames (0.99s)");

    setDt(0.01);
    runner.tickUpdate();
    assert(done, "done at 100 frames (1.00s)");
});

// ── WaitForSecondsRealtime ──
console.log("\n--- WaitForSecondsRealtime ---");

test("WaitForSecondsRealtime uses unscaled time", () => {
    const runner = new CoroutineRunner();
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitForSecondsRealtime(0.5);
        done = true;
    }
    runner.startCoroutine(gen());

    // Scaled dt=0 (paused), but unscaled = 0.02
    for (let i = 0; i < 24; i++) {
        setDt(0);
        setUdt(0.02);
        runner.tickUpdate();
    }
    assert(!done, "not done yet (0.48s)");

    setDt(0);
    setUdt(0.02);
    runner.tickUpdate();
    assert(done, "done via unscaled time even though paused (0.50s)");
});

// ── WaitUntil / WaitWhile ──
console.log("\n--- WaitUntil / WaitWhile ---");

test("WaitUntil resumes when true", () => {
    const runner = new CoroutineRunner();
    let flag = false;
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitUntil(() => flag);
        done = true;
    }
    runner.startCoroutine(gen());

    runner.tickUpdate();
    assert(!done, "flag=false, still waiting");

    flag = true;
    runner.tickUpdate();
    assert(done, "flag=true, resumed");
});

test("WaitWhile resumes when false", () => {
    const runner = new CoroutineRunner();
    let loading = true;
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitWhile(() => loading);
        done = true;
    }
    runner.startCoroutine(gen());

    runner.tickUpdate();
    assert(!done, "loading=true, still waiting");

    loading = false;
    runner.tickUpdate();
    assert(done, "loading=false, resumed");
});

// ── WaitForEndOfFrame ──
console.log("\n--- WaitForEndOfFrame ---");

test("WaitForEndOfFrame resolves in lateUpdate", () => {
    const runner = new CoroutineRunner();
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitForEndOfFrame();
        done = true;
    }
    runner.startCoroutine(gen());

    runner.tickUpdate();  // Should NOT advance — wrong phase
    assert(!done, "not in update phase");

    runner.tickLateUpdate();
    assert(done, "resolved in lateUpdate");
});

// ── WaitForFixedUpdate ──
console.log("\n--- WaitForFixedUpdate ---");

test("WaitForFixedUpdate resolves in fixedUpdate", () => {
    const runner = new CoroutineRunner();
    let done = false;
    function* gen(): Generator<YieldInstruction> {
        yield new WaitForFixedUpdate();
        done = true;
    }
    runner.startCoroutine(gen());

    runner.tickUpdate();
    assert(!done, "not in update");

    runner.tickFixedUpdate();
    assert(done, "resolved in fixedUpdate");
});

// ── Nested Coroutine ──
console.log("\n--- Nested Coroutine ---");

test("yield Coroutine waits for child", () => {
    const runner = new CoroutineRunner();
    let childDone = false;
    let parentDone = false;

    function* child(): Generator<YieldInstruction> {
        yield null;
        yield null;
        childDone = true;
    }

    function* parent(): Generator<YieldInstruction> {
        const childCo = runner.startCoroutine(child());
        yield childCo;
        parentDone = true;
    }
    runner.startCoroutine(parent());

    setDt(1/60);
    runner.tickUpdate(); // child: yield 1 → yield 2
    assert(!childDone && !parentDone, "frame 1: both waiting");

    runner.tickUpdate(); // child: finishes
    assert(childDone, "child done");
    assert(!parentDone, "parent still waiting for child's isFinished check");

    runner.tickUpdate(); // parent: sees child finished, advances
    assert(parentDone, "parent done after child finished");
});

// ── Sequential yields ──
console.log("\n--- Sequential Yields ---");

test("multiple yield types in sequence", () => {
    const runner = new CoroutineRunner();
    const log: string[] = [];

    function* gen(): Generator<YieldInstruction> {
        log.push("start");
        yield null;
        log.push("after null");
        yield new WaitForSeconds(0.1);
        log.push("after wait");
    }
    runner.startCoroutine(gen());

    assert(log.length === 1 && log[0] === "start", "initial");

    setDt(0.02);
    runner.tickUpdate();
    assert(log[1] === "after null", "after null yield");

    // Need 5 frames at 0.02 for 0.1s
    for (let i = 0; i < 4; i++) runner.tickUpdate();
    assert(log.length === 2, "still waiting at 0.08s");

    runner.tickUpdate();
    assert(log[2] === "after wait", "after WaitForSeconds (0.10s)");
});

// ── Error handling ──
console.log("\n--- Error Handling ---");

test("error in coroutine stops it gracefully", () => {
    const runner = new CoroutineRunner();
    const origError = console.error;
    let errorCaught = false;
    console.error = () => { errorCaught = true; };

    function* gen(): Generator<YieldInstruction> {
        yield null;
        throw new Error("test error");
    }
    const co = runner.startCoroutine(gen());

    setDt(1/60);
    runner.tickUpdate();
    assert(co.isFinished, "marked finished after error");
    assert(errorCaught, "error was logged");
    console.error = origError;
});

// ── Multiple concurrent coroutines ──
console.log("\n--- Concurrent ---");

test("multiple coroutines run independently", () => {
    const runner = new CoroutineRunner();
    let a = 0, b = 0;

    function* genA(): Generator<YieldInstruction> {
        yield null; a = 1;
        yield null; a = 2;
    }
    function* genB(): Generator<YieldInstruction> {
        yield null; b = 10;
    }

    runner.startCoroutine(genA());
    runner.startCoroutine(genB());
    assert(runner.count === 2, "2 active");

    setDt(1/60);
    runner.tickUpdate();
    assert(a === 1 && b === 10, `a=${a} b=${b}`);
    assert(runner.count === 1, "B finished, 1 remaining");

    runner.tickUpdate();
    assert(a === 2, "A finished");
    assert(runner.count === 0, "all done");
});

console.log(`\n========================================`);
console.log(`Coroutine tests: ${passed} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0) process.exit(1);