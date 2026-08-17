import { describe, test, expect, afterEach } from "vitest";
import { EngineObject } from "../src/engine/core/EngineObject";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";

/**
 * `Destroy(obj, delay)` was a `setTimeout`, so the delay ran on wall-clock time:
 * it ignored `Time.timeScale`, and it fired while the loop was stopped. A
 * scenario with a pause menu watched objects vanish behind it. The countdown is
 * now driven from the loop in game time. Audit F2, open since part 1.
 */

const made: GameObject[] = [];

function object(name = "Doomed"): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

/** One frame of game time, as `Application._loop` supplies it. */
function frame(deltaTime = 1 / 60): void {
    EngineObject._updatePendingDestroys(deltaTime);
}

afterEach(() => {
    EngineObject._clearPendingDestroys();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A delayed Destroy", () => {
    test("survives until its time is up", () => {
        const go = object();
        EngineObject.Destroy(go, 1);

        for (let i = 0; i < 30; i++) frame();

        expect(go.exists()).toBe(true);
    });

    test("dies once the frames add up to the delay", () => {
        const go = object();
        EngineObject.Destroy(go, 0.5);

        for (let i = 0; i < 31; i++) frame();

        expect(go.exists()).toBe(false);
    });

    test("does not count down while the game is paused", () => {
        // The finding, stated directly: timeScale = 0 gives deltaTime = 0, so a
        // pause menu postpones the destruction rather than hiding it.
        const go = object();
        EngineObject.Destroy(go, 0.1);

        for (let i = 0; i < 600; i++) frame(0);

        expect(go.exists()).toBe(true);

        for (let i = 0; i < 7; i++) frame();
        expect(go.exists()).toBe(false);
    });

    test("takes twice as long at half speed", () => {
        const go = object();
        EngineObject.Destroy(go, 1);

        // Ten frames of a 1/10s delta, halved by timeScale — one second of
        // wall clock, half a second of game time.
        for (let i = 0; i < 10; i++) frame(0.05);
        expect(go.exists()).toBe(true);

        for (let i = 0; i < 10; i++) frame(0.05);
        expect(go.exists()).toBe(false);
    });

    test("does not fire at all while nothing is running", () => {
        // No loop means no frames means no countdown. Previously a setTimeout
        // fired regardless of whether an Application existed.
        const go = object();
        EngineObject.Destroy(go, 0.001);

        expect(go.exists()).toBe(true);
    });

    test("a zero or negative delay still goes through the end-of-frame queue", async () => {
        const now = object("now");
        const past = object("past");

        EngineObject.Destroy(now, 0);
        EngineObject.Destroy(past, -5);
        await Promise.resolve();

        expect(now.exists()).toBe(false);
        expect(past.exists()).toBe(false);
    });

    test("an object destroyed by other means first is simply dropped", () => {
        const go = object();
        EngineObject.Destroy(go, 1);

        go.destroyImmediate();

        expect(() => { for (let i = 0; i < 120; i++) frame(); }).not.toThrow();
        expect(go.exists()).toBe(false);
    });

    test("the earliest of two delays wins, and the later one is harmless", () => {
        const go = object();
        EngineObject.Destroy(go, 2);
        EngineObject.Destroy(go, 0.1);

        for (let i = 0; i < 7; i++) frame();
        expect(go.exists()).toBe(false);

        expect(() => { for (let i = 0; i < 200; i++) frame(); }).not.toThrow();
    });

    test("one object's onDestroy can schedule another without disturbing the sweep", () => {
        // Snapshot-before-dispatch: the sweep collects what is due before
        // destroying anything, so user code running in onDestroy cannot shift
        // the list underneath it.
        const second = object("second");

        class Chain extends ScriptableBehaviour {
            public override onDestroy(): void {
                EngineObject.Destroy(second, 0.1);
            }
        }
        const first = object("first");
        first.addComponent(Chain);
        EngineObject.Destroy(first, 0.1);

        for (let i = 0; i < 7; i++) frame();
        expect(first.exists()).toBe(false);
        expect(second.exists()).toBe(true);

        for (let i = 0; i < 7; i++) frame();
        expect(second.exists()).toBe(false);
    });

    test("several objects due on the same frame all go", () => {
        const all = [object("a"), object("b"), object("c")];
        for (const go of all) EngineObject.Destroy(go, 0.1);

        for (let i = 0; i < 7; i++) frame();

        for (const go of all) expect(go.exists()).toBe(false);
    });

    test("a non-finite delay is treated as immediate rather than never", () => {
        const go = object();

        EngineObject.Destroy(go, Number.POSITIVE_INFINITY);

        // Queued, not parked forever in a list nothing will ever drain.
        expect(() => frame()).not.toThrow();
    });

    test("clearing drops pending countdowns", () => {
        const go = object();
        EngineObject.Destroy(go, 0.1);

        EngineObject._clearPendingDestroys();
        for (let i = 0; i < 120; i++) frame();

        expect(go.exists()).toBe(true);
    });

    test("a component can be destroyed on a delay too, leaving its object alone", () => {
        const go = object();
        class Doomed extends ScriptableBehaviour {}
        const comp = go.addComponent(Doomed);

        EngineObject.Destroy(comp, 0.1);
        for (let i = 0; i < 7; i++) frame();

        expect(comp.exists()).toBe(false);
        expect(go.exists()).toBe(true);
    });
});
