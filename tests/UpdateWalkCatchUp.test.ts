import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { ExecutionOrder, _resetExecutionOrders } from "../src/engine/core/reflection/Decorators";

/**
 * M0.3d: the converse of M0.3a. The walk reaches objects through their
 * parents, so an object moved — before its turn — under a parent the walk has
 * already left was never reached, and missed the pass. Unity's update does not
 * follow the hierarchy: a behaviour that existed when the pass began runs in
 * it once, wherever it has been moved to. An object created during the pass
 * still starts next frame.
 */

class Counter extends ScriptableBehaviour {
    public updates = 0;
    public fixedUpdates = 0;
    public lateUpdates = 0;
    public onTick: (() => void) | null = null;

    public override update(): void { this.updates++; this.fire(); }
    public override fixedUpdate(): void { this.fixedUpdates++; this.fire(); }
    public override lateUpdate(): void { this.lateUpdates++; this.fire(); }

    public reset(): void { this.updates = this.fixedUpdates = this.lateUpdates = 0; }

    /** Runs the hook once: moving things is only interesting the first time. */
    private fire(): void {
        const run = this.onTick;
        this.onTick = null;
        run?.();
    }
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

/** A GameObject carrying a Counter, under `parent` (a root when `null`). */
function counter(name: string, parent: GameObject | null): Counter {
    const go = new GameObject(name);
    if (parent) go.transform.setParent(parent.transform);
    return go.addComponent(Counter);
}

/** Runs one Update so every Counter has started, then zeroes the counts. */
function settle(counters: Counter[]): void {
    SceneManager.activeScene._update();
    for (const c of counters) c.reset();
}

const scenePhases: [string, () => void, (c: Counter) => number][] = [
    ["update", () => SceneManager.activeScene._update(), c => c.updates],
    ["fixedUpdate", () => SceneManager.activeScene._fixedUpdate(), c => c.fixedUpdates],
    ["lateUpdate", () => SceneManager.activeScene._lateUpdate(), c => c.lateUpdates],
];

beforeEach(clear);
afterEach(() => {
    clear();
    _resetExecutionOrders();
});

describe.each(scenePhases)("an object moved before its turn during the %s pass", (_name, run, count) => {
    const counts = (cs: Counter[]): number[] => cs.map(count);

    test("a root moved under an earlier, already-walked root still runs once", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        settle([a, b, c]);
        b.onTick = () => c.transform.setParent(a.transform);

        run();
        expect(c.transform.parent).toBe(a.transform);
        expect(counts([a, b, c])).toEqual([1, 1, 1]);

        run();
        expect(counts([a, b, c])).toEqual([2, 2, 2]);
    });

    test("a child moved under an already-walked parent still runs once", () => {
        const top = new GameObject("top");
        const p1 = new GameObject("p1");
        const p2 = new GameObject("p2");
        p1.transform.setParent(top.transform);
        p2.transform.setParent(top.transform);
        const done = counter("done", p1);
        const mover = counter("mover", p2);
        const k = counter("k", p2);
        settle([done, mover, k]);
        mover.onTick = () => k.transform.setParent(p1.transform);

        run();
        expect(k.transform.parent).toBe(p1.transform);
        expect(counts([done, mover, k])).toEqual([1, 1, 1]);

        run();
        expect(counts([done, mover, k])).toEqual([2, 2, 2]);
    });

    test("a child moved by its own parent under an already-walked parent still runs once", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const k = counter("k", b.gameObject);
        settle([a, b, k]);
        b.onTick = () => k.transform.setParent(a.transform);

        run();
        expect(counts([a, b, k])).toEqual([1, 1, 1]);
    });

    test("the moved object's own children run once too", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        const d = counter("D", c.gameObject);
        settle([a, b, c, d]);
        b.onTick = () => c.transform.setParent(a.transform);

        run();
        expect(counts([a, b, c, d])).toEqual([1, 1, 1, 1]);
    });

    test("a child made a root before its turn still runs once", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const k = counter("k", b.gameObject);
        settle([a, b, k]);
        a.onTick = () => k.transform.setParent(null);

        run();
        expect(k.transform.parent).toBeNull();
        expect(counts([a, b, k])).toEqual([1, 1, 1]);
    });

    test("children detached by their parent before their turn still run once", () => {
        const p = counter("P", null);
        const k1 = counter("k1", p.gameObject);
        const k2 = counter("k2", p.gameObject);
        settle([p, k1, k2]);
        p.onTick = () => p.transform.detachChildren();

        run();
        expect(counts([p, k1, k2])).toEqual([1, 1, 1]);
    });

    test("moved twice — under a walked parent, then under a later one — runs once", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        const d = counter("D", null);
        settle([a, b, c, d]);
        b.onTick = () => {
            c.transform.setParent(a.transform);
            c.transform.setParent(d.transform);
        };

        run();
        expect(counts([a, b, c, d])).toEqual([1, 1, 1, 1]);
    });

    test("an object that moves itself again while catching up runs once", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        settle([a, b, c]);
        b.onTick = () => c.transform.setParent(a.transform);
        c.onTick = () => c.transform.setParent(b.transform);

        run();
        expect(counts([a, b, c])).toEqual([1, 1, 1]);
    });

    test("an object moved under an inactive parent does not run", () => {
        const a = counter("A", null);
        a.gameObject.setActive(false);
        const b = counter("B", null);
        const c = counter("C", null);
        settle([a, b, c]);
        b.onTick = () => c.transform.setParent(a.transform);

        run();
        expect(counts([a, b, c])).toEqual([0, 1, 0]);
    });

    test("an object moved and then destroyed before the pass ends does not run", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        settle([a, b, c]);
        b.onTick = () => {
            c.transform.setParent(a.transform);
            c.gameObject.destroyImmediate();
        };

        run();
        expect(counts([a, b])).toEqual([1, 1]);
        expect(count(c)).toBe(0);
    });

    test("an object created during the pass under an already-walked parent starts next frame", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        settle([a, b]);
        let born: Counter | null = null;
        b.onTick = () => {
            born = counter("born", null);
            born.transform.setParent(a.transform);
        };

        run();
        expect(born).not.toBeNull();
        expect(count(born!)).toBe(0);
    });
});

describe.each(scenePhases)("catch-up with execution orders during the %s pass", (_name, run, count) => {
    test("an object moved in an early order pass runs in that pass and in the later one, once each", () => {
        @ExecutionOrder(-10)
        class Early extends Counter {}

        const a = counter("A", null);
        const bGo = new GameObject("B");
        const bEarly = bGo.addComponent(Early);
        const cGo = new GameObject("C");
        const cEarly = cGo.addComponent(Early);
        const cNormal = cGo.addComponent(Counter);
        settle([a, bEarly, cEarly, cNormal]);
        bEarly.onTick = () => cGo.transform.setParent(a.transform);

        run();
        expect([a, bEarly, cEarly, cNormal].map(count)).toEqual([1, 1, 1, 1]);
    });

    test("an object moved in a late order pass runs in it once", () => {
        @ExecutionOrder(10)
        class Late extends Counter {}

        const aGo = new GameObject("A");
        const aLate = aGo.addComponent(Late);
        const bGo = new GameObject("B");
        const bLate = bGo.addComponent(Late);
        const cGo = new GameObject("C");
        const cNormal = cGo.addComponent(Counter);
        const cLate = cGo.addComponent(Late);
        settle([aLate, bLate, cNormal, cLate]);
        bLate.onTick = () => cGo.transform.setParent(aGo.transform);

        run();
        expect([aLate, bLate, cNormal, cLate].map(count)).toEqual([1, 1, 1, 1]);
    });
});
