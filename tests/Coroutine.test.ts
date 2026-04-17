import { describe, test, expect } from "vitest";
import {
    Coroutine, CoroutineRunner,
    WaitForSeconds, WaitForSecondsRealtime,
    WaitUntil, WaitWhile,
    WaitForEndOfFrame, WaitForFixedUpdate,
    YieldInstruction
} from "../src/engine/core/Coroutine";
import { Time } from "../src/engine/core/Time";

function setDt(dt: number) { (Time as any)._deltaTime = dt; }
function setUdt(udt: number) { (Time as any)._unscaledDeltaTime = udt; }
function setTime(dt: number, udt: number = dt) { setDt(dt); setUdt(udt); }

describe("Coroutine", () => {
    describe("Basic Lifecycle", () => {
        test("coroutine runs to completion", () => {
            const runner = new CoroutineRunner();
            let step = 0;
            function* gen(): Generator<YieldInstruction> {
                step = 1; yield null; step = 2; yield null; step = 3;
            }
            const co = runner.startCoroutine(gen());
            expect(step).toBe(1);
            expect(co.isFinished).toBe(false);

            setTime(1/60);
            runner.tickUpdate();
            expect(step).toBe(2);

            runner.tickUpdate();
            expect(step).toBe(3);
            expect(co.isFinished).toBe(true);
            expect(runner.count).toBe(0);
        });

        test("empty coroutine finishes immediately", () => {
            const runner = new CoroutineRunner();
            function* gen(): Generator<YieldInstruction> {}
            const co = runner.startCoroutine(gen());
            expect(co.isFinished).toBe(true);
            expect(runner.count).toBe(0);
        });

        test("stopCoroutine cancels", () => {
            const runner = new CoroutineRunner();
            let reached = false;
            function* gen(): Generator<YieldInstruction> { yield null; reached = true; }
            const co = runner.startCoroutine(gen());
            runner.stopCoroutine(co);
            expect(co.isFinished).toBe(true);
            runner.tickUpdate();
            expect(reached).toBe(false);
        });

        test("stopAllCoroutines", () => {
            const runner = new CoroutineRunner();
            function* gen(): Generator<YieldInstruction> { yield null; yield null; }
            runner.startCoroutine(gen());
            runner.startCoroutine(gen());
            expect(runner.count).toBe(2);
            runner.stopAllCoroutines();
            expect(runner.count).toBe(0);
        });
    });

    describe("WaitForSeconds", () => {
        test("waits correct duration", () => {
            const runner = new CoroutineRunner();
            let done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitForSeconds(0.5); done = true; }
            runner.startCoroutine(gen());

            for (let i = 0; i < 24; i++) { setDt(0.02); runner.tickUpdate(); }
            expect(done).toBe(false);

            setDt(0.02); runner.tickUpdate();
            expect(done).toBe(true);
        });

        test("respects timeScale", () => {
            const runner = new CoroutineRunner();
            let done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitForSeconds(1); done = true; }
            runner.startCoroutine(gen());

            for (let i = 0; i < 99; i++) { setDt(0.01); runner.tickUpdate(); }
            expect(done).toBe(false);

            setDt(0.01); runner.tickUpdate();
            expect(done).toBe(true);
        });
    });

    describe("WaitForSecondsRealtime", () => {
        test("uses unscaled time", () => {
            const runner = new CoroutineRunner();
            let done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitForSecondsRealtime(0.5); done = true; }
            runner.startCoroutine(gen());

            for (let i = 0; i < 24; i++) { setDt(0); setUdt(0.02); runner.tickUpdate(); }
            expect(done).toBe(false);

            setDt(0); setUdt(0.02); runner.tickUpdate();
            expect(done).toBe(true);
        });
    });

    describe("WaitUntil / WaitWhile", () => {
        test("WaitUntil resumes when true", () => {
            const runner = new CoroutineRunner();
            let flag = false, done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitUntil(() => flag); done = true; }
            runner.startCoroutine(gen());
            runner.tickUpdate();
            expect(done).toBe(false);
            flag = true;
            runner.tickUpdate();
            expect(done).toBe(true);
        });

        test("WaitWhile resumes when false", () => {
            const runner = new CoroutineRunner();
            let loading = true, done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitWhile(() => loading); done = true; }
            runner.startCoroutine(gen());
            runner.tickUpdate();
            expect(done).toBe(false);
            loading = false;
            runner.tickUpdate();
            expect(done).toBe(true);
        });
    });

    describe("WaitForEndOfFrame", () => {
        test("resolves in lateUpdate", () => {
            const runner = new CoroutineRunner();
            let done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitForEndOfFrame(); done = true; }
            runner.startCoroutine(gen());
            runner.tickUpdate();
            expect(done).toBe(false);
            runner.tickLateUpdate();
            expect(done).toBe(true);
        });
    });

    describe("WaitForFixedUpdate", () => {
        test("resolves in fixedUpdate", () => {
            const runner = new CoroutineRunner();
            let done = false;
            function* gen(): Generator<YieldInstruction> { yield new WaitForFixedUpdate(); done = true; }
            runner.startCoroutine(gen());
            runner.tickUpdate();
            expect(done).toBe(false);
            runner.tickFixedUpdate();
            expect(done).toBe(true);
        });
    });

    describe("Nested Coroutine", () => {
        test("yield Coroutine waits for child", () => {
            const runner = new CoroutineRunner();
            let childDone = false, parentDone = false;
            function* child(): Generator<YieldInstruction> { yield null; yield null; childDone = true; }
            function* parent(): Generator<YieldInstruction> {
                const childCo = runner.startCoroutine(child());
                yield childCo;
                parentDone = true;
            }
            runner.startCoroutine(parent());
            setDt(1/60);
            runner.tickUpdate();
            expect(childDone).toBe(false);
            expect(parentDone).toBe(false);
            runner.tickUpdate();
            expect(childDone).toBe(true);
            expect(parentDone).toBe(false);
            runner.tickUpdate();
            expect(parentDone).toBe(true);
        });
    });

    describe("Sequential Yields", () => {
        test("multiple yield types in sequence", () => {
            const runner = new CoroutineRunner();
            const log: string[] = [];
            function* gen(): Generator<YieldInstruction> {
                log.push("start"); yield null;
                log.push("after null"); yield new WaitForSeconds(0.1);
                log.push("after wait");
            }
            runner.startCoroutine(gen());
            expect(log).toEqual(["start"]);
            setDt(0.02); runner.tickUpdate();
            expect(log).toEqual(["start", "after null"]);
            for (let i = 0; i < 4; i++) runner.tickUpdate();
            expect(log.length).toBe(2);
            runner.tickUpdate();
            expect(log).toEqual(["start", "after null", "after wait"]);
        });
    });

    describe("Error Handling", () => {
        test("error in coroutine stops it gracefully", () => {
            const runner = new CoroutineRunner();
            const origError = console.error;
            let errorCaught = false;
            console.error = () => { errorCaught = true; };
            function* gen(): Generator<YieldInstruction> { yield null; throw new Error("test error"); }
            const co = runner.startCoroutine(gen());
            setDt(1/60);
            runner.tickUpdate();
            expect(co.isFinished).toBe(true);
            expect(errorCaught).toBe(true);
            console.error = origError;
        });
    });

    describe("Concurrent", () => {
        test("multiple coroutines run independently", () => {
            const runner = new CoroutineRunner();
            let a = 0, b = 0;
            function* genA(): Generator<YieldInstruction> { yield null; a = 1; yield null; a = 2; }
            function* genB(): Generator<YieldInstruction> { yield null; b = 10; }
            runner.startCoroutine(genA());
            runner.startCoroutine(genB());
            expect(runner.count).toBe(2);
            setDt(1/60);
            runner.tickUpdate();
            expect(a).toBe(1);
            expect(b).toBe(10);
            expect(runner.count).toBe(1);
            runner.tickUpdate();
            expect(a).toBe(2);
            expect(runner.count).toBe(0);
        });
    });
});
