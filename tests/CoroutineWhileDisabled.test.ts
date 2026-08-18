import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import type { YieldInstruction } from "../src/engine/core/Coroutine";

/**
 * Unity's two rules pull in opposite directions: deactivating a GameObject
 * **stops** its coroutines for good, while disabling a behaviour does **not**
 * — they keep running. Both merely paused here, because the coroutine tick sat
 * behind the same `isActiveAndEnabled` guard as the callbacks. The deactivation
 * half was fixed when the finding was written; this is the other half.
 * Audit F5, open since part 1.
 */

const made: GameObject[] = [];

class Counter extends ScriptableBehaviour {
    public updates = 0;
    public steps = 0;

    public override update(): void { this.updates++; }

    public *count(): Generator<YieldInstruction, void, void> {
        for (;;) {
            this.steps++;
            yield null as unknown as YieldInstruction;
        }
    }
}

function counter(name = "Runner"): Counter {
    const go = new GameObject(name);
    made.push(go);
    return go.addComponent(Counter);
}

/** One Update pass over one object, as the loop runs it. */
function frame(c: Counter): void {
    c.gameObject._systemUpdate();
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A coroutine on a disabled behaviour", () => {
    test("keeps running, as Unity's does", () => {
        const c = counter();
        c.startCoroutine(c.count());
        frame(c);
        const before = c.steps;

        c.enabled = false;
        frame(c);
        frame(c);

        expect(c.steps).toBeGreaterThan(before);
    });

    test("while the behaviour's own callbacks stop", () => {
        // The distinction: disabling the script pauses the script, not the
        // sequence it started.
        const c = counter();
        c.startCoroutine(c.count());
        frame(c);
        const updatesBefore = c.updates;
        const stepsBefore = c.steps;

        c.enabled = false;
        frame(c);
        frame(c);

        expect(c.updates).toBe(updatesBefore);
        expect(c.steps).toBe(stepsBefore + 2);
    });

    test("and picks up its callbacks again when re-enabled", () => {
        const c = counter();
        c.startCoroutine(c.count());
        c.enabled = false;
        frame(c);

        c.enabled = true;
        frame(c);

        expect(c.updates).toBe(1);
    });

    test("does not start the behaviour while it is disabled", () => {
        // `start` belongs to the callback half, not the coroutine half.
        class Starter extends ScriptableBehaviour {
            public starts = 0;
            public override start(): void { this.starts++; }
        }
        const go = new GameObject("Starter");
        made.push(go);
        const s = go.addComponent(Starter);
        s.enabled = false;

        go._systemUpdate();
        go._systemUpdate();

        expect(s.starts).toBe(0);
    });
});

describe("A coroutine on a deactivated GameObject", () => {
    test("is stopped for good, which is the opposite rule", () => {
        const c = counter();
        c.startCoroutine(c.count());
        frame(c);
        const before = c.steps;

        c.gameObject.setActive(false);
        frame(c);

        expect(c.steps).toBe(before);
    });

    test("and does not resume when the object comes back", () => {
        // The reason the two rules differ: a reactivated object must not finish
        // a sequence the scene has moved on from.
        const c = counter();
        c.startCoroutine(c.count());
        frame(c);
        const before = c.steps;

        c.gameObject.setActive(false);
        c.gameObject.setActive(true);
        frame(c);
        frame(c);

        expect(c.steps).toBe(before);
    });
});

describe("The ordinary case", () => {
    test("an enabled behaviour runs both, in Unity's order", () => {
        const c = counter();
        c.startCoroutine(c.count());

        frame(c);

        expect(c.updates).toBe(1);
        // Two, not one: startCoroutine advances the generator to its first
        // yield straight away, as Unity's does, and the frame ticks it again.
        expect(c.steps).toBe(2);
    });

    test("a behaviour with no coroutine is unaffected by any of this", () => {
        const c = counter();

        frame(c);
        c.enabled = false;
        frame(c);
        c.enabled = true;
        frame(c);

        expect(c.updates).toBe(2);
        expect(c.steps).toBe(0);
    });
});
