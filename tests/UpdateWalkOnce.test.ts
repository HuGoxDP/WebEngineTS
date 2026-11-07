import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { ExecutionOrder, _resetExecutionOrders } from "../src/engine/core/reflection/Decorators";

/**
 * M0.3a: a behaviour runs each per-frame callback at most once per pass, even
 * when the hierarchy changes under the walk. The walk visits objects through
 * their parents, so an object that had already run and then moved under a
 * parent walked later used to be visited — and run — a second time. Unity's
 * update does not follow the hierarchy and never does that.
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

describe.each(scenePhases)("an object that already ran during the %s pass", (_name, run, count) => {
    const counts = (cs: Counter[]): number[] => cs.map(count);

    test("a child that moves itself under a later sibling runs once", () => {
        const top = new GameObject("top");
        const p1 = new GameObject("p1");
        const p2 = new GameObject("p2");
        p1.transform.setParent(top.transform);
        p2.transform.setParent(top.transform);
        const k = counter("k", p1);
        const after = counter("after", p2);
        settle([k, after]);
        k.onTick = () => k.transform.setParent(p2.transform);

        run();
        expect(k.transform.parent).toBe(p2.transform);
        expect(counts([k, after])).toEqual([1, 1]);

        run();
        expect(counts([k, after])).toEqual([2, 2]);
    });

    test("a child moved by a later sibling under a later parent runs once", () => {
        const top = new GameObject("top");
        const p1 = new GameObject("p1");
        const p2 = new GameObject("p2");
        p1.transform.setParent(top.transform);
        p2.transform.setParent(top.transform);
        const first = counter("first", p1);
        const mover = counter("mover", p1);
        const other = counter("other", p2);
        settle([first, mover, other]);
        mover.onTick = () => first.transform.setParent(p2.transform);

        run();
        expect(counts([first, mover, other])).toEqual([1, 1, 1]);
    });

    test("the moved object's own children run once too", () => {
        const top = new GameObject("top");
        const p1 = new GameObject("p1");
        const p2 = new GameObject("p2");
        p1.transform.setParent(top.transform);
        p2.transform.setParent(top.transform);
        const k = counter("k", p1);
        const grandchild = counter("grandchild", k.gameObject);
        settle([k, grandchild]);
        k.onTick = () => k.transform.setParent(p2.transform);

        run();
        expect(counts([k, grandchild])).toEqual([1, 1]);
    });

    test("a root that moves itself under a later root runs once, and the root between still runs", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        settle([a, b, c]);
        a.onTick = () => a.transform.setParent(c.transform);

        run();
        expect(a.transform.parent).toBe(c.transform);
        expect(counts([a, b, c])).toEqual([1, 1, 1]);

        run();
        expect(counts([a, b, c])).toEqual([2, 2, 2]);
    });

    test("a root that moves itself deep into a later root's subtree runs once", () => {
        const a = counter("A", null);
        const c = counter("C", null);
        const leaf = counter("leaf", c.gameObject);
        settle([a, c, leaf]);
        a.onTick = () => a.transform.setParent(leaf.transform);

        run();
        expect(counts([a, c, leaf])).toEqual([1, 1, 1]);
    });

    test("a root moved by a later root under a still later one runs once", () => {
        const a = counter("A", null);
        const b = counter("B", null);
        const c = counter("C", null);
        settle([a, b, c]);
        b.onTick = () => a.transform.setParent(c.transform);

        run();
        expect(counts([a, b, c])).toEqual([1, 1, 1]);
    });

    test("a child that makes itself a root runs once", () => {
        const top = counter("top", null);
        const k = counter("k", top.gameObject);
        const later = counter("later", null);
        settle([top, k, later]);
        k.onTick = () => k.transform.setParent(null);

        run();
        expect(k.transform.parent).toBeNull();
        expect(counts([top, k, later])).toEqual([1, 1, 1]);
    });
});

describe("the once-per-pass rule with execution orders", () => {
    test("each order is its own pass: an object that moved in an early pass still runs in the later one, once", () => {
        @ExecutionOrder(-10)
        class Early extends Counter {}

        const a = new GameObject("A");
        const early = a.addComponent(Early);
        const normal = a.addComponent(Counter);
        const c = counter("C", null);
        settle([early, normal, c]);
        early.onTick = () => a.transform.setParent(c.transform);

        SceneManager.activeScene._update();
        expect([early.updates, normal.updates, c.updates]).toEqual([1, 1, 1]);
    });
});

describe("walking a GameObject directly", () => {
    test("each direct call is a pass of its own", () => {
        const go = new GameObject("solo");
        const c = go.addComponent(Counter);
        go._systemUpdate();
        c.reset();

        go._systemUpdate();
        go._systemUpdate();
        go._systemFixedUpdate();
        go._systemLateUpdate();
        expect([c.updates, c.fixedUpdates, c.lateUpdates]).toEqual([2, 1, 1]);
    });
});
