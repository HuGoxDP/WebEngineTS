import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager, LoadSceneMode } from "../src/engine/core/SceneManager";

/**
 * M0.3c: with `isolateCallbackErrors = false` the first component error raised
 * while a GameObject is destroyed is rethrown, but only once the destruction is
 * complete. The default mode only logs (pinned in DestroyRobustness.test.ts).
 */

const order: string[] = [];

class Boom extends ScriptableBehaviour {
    public constructor(...args: ConstructorParameters<typeof ScriptableBehaviour>) {
        super(...args);
    }
    public override onDestroy(): void {
        order.push(`destroy:${this.gameObject.name}`);
        throw new Error(`boom:${this.gameObject.name}`);
    }
}
class Quiet extends ScriptableBehaviour {
    public override onDestroy(): void {
        order.push(`destroy:${this.gameObject.name}:quiet`);
    }
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) {
        try { root.destroyImmediate(); } catch { /* ignored */ }
    }
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    ScriptableBehaviour.isolateCallbackErrors = true;
    clear();
    order.length = 0;
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    ScriptableBehaviour.isolateCallbackErrors = true;
    errors.mockRestore();
    EngineObject._clearPendingDestroys();
});

function build() {
    const parent = new GameObject("parent");
    const first = parent.addComponent(Boom);
    const second = parent.addComponent(Quiet);
    const child = new GameObject("child");
    child.transform.setParent(parent.transform);
    const childBoom = child.addComponent(Boom);
    const childQuiet = child.addComponent(Quiet);
    return { parent, first, second, child, childBoom, childQuiet };
}

describe("hard stop: destroyImmediate", () => {
    test("rethrows the first error only after every component and child is destroyed", () => {
        const t = build();
        ScriptableBehaviour.isolateCallbackErrors = false;

        expect(() => t.parent.destroyImmediate()).toThrow("boom:parent");

        expect(t.parent.exists()).toBe(false);
        expect(t.first.exists()).toBe(false);
        expect(t.second.exists()).toBe(false);
        expect(t.child.exists()).toBe(false);
        expect(t.childBoom.exists()).toBe(false);
        expect(t.childQuiet.exists()).toBe(false);
        expect(order).toEqual([
            "destroy:parent", "destroy:parent:quiet", "destroy:child", "destroy:child:quiet",
        ]);
        expect(SceneManager.activeScene.getRootGameObjects()).not.toContain(t.parent);
    });

    test("an error only in a child still surfaces from the parent's destruction", () => {
        const parent = new GameObject("p");
        const child = new GameObject("c");
        child.transform.setParent(parent.transform);
        child.addComponent(Boom);
        ScriptableBehaviour.isolateCallbackErrors = false;

        expect(() => parent.destroyImmediate()).toThrow("boom:c");
        expect(parent.exists()).toBe(false);
        expect(child.exists()).toBe(false);
    });

    test("the remaining errors are logged, the first is not logged twice", () => {
        build();
        ScriptableBehaviour.isolateCallbackErrors = false;
        const parent = SceneManager.activeScene.getRootGameObjects().find(g => g.name === "parent")!;

        expect(() => parent.destroyImmediate()).toThrow("boom:parent");
        expect(errors).toHaveBeenCalledTimes(1);
        expect(String(errors.mock.calls[0][1])).toContain("boom:child");
    });

    test("default mode only logs and does not throw", () => {
        const t = build();

        expect(() => t.parent.destroyImmediate()).not.toThrow();
        expect(t.child.exists()).toBe(false);
        expect(errors).toHaveBeenCalledTimes(2);
    });
});

describe("hard stop: deferred destroy", () => {
    test("a microtask destroy completes, then the error is thrown unhandled", async () => {
        const t = build();
        ScriptableBehaviour.isolateCallbackErrors = false;
        const seen: unknown[] = [];
        const onUnhandled = (e: unknown) => { seen.push(e); };
        process.on("uncaughtException", onUnhandled);
        const listeners = process.listeners("uncaughtException");
        try {
            t.parent.destroy();
            await new Promise(r => setTimeout(r, 0));
        } finally {
            process.off("uncaughtException", onUnhandled);
        }
        void listeners;

        expect(t.child.exists()).toBe(false);
        expect(t.childQuiet.exists()).toBe(false);
        expect(seen.map(e => (e as Error).message)).toEqual(["boom:parent"]);
    });

    test("a timed destroy finishes every due object, then rethrows the first error", () => {
        const a = new GameObject("a"); a.addComponent(Boom);
        const b = new GameObject("b"); b.addComponent(Boom);
        const c = new GameObject("c"); c.addComponent(Quiet);
        a.destroy(0.5); b.destroy(0.5); c.destroy(0.5);
        ScriptableBehaviour.isolateCallbackErrors = false;

        let thrown: unknown;
        try { EngineObject._updatePendingDestroys(1); } catch (e) { thrown = e; }

        expect((thrown as Error).message).toMatch(/^boom:/);
        expect(a.exists()).toBe(false);
        expect(b.exists()).toBe(false);
        expect(c.exists()).toBe(false);
    });

    test("a timed destroy in default mode only logs", () => {
        const a = new GameObject("a"); a.addComponent(Boom);
        a.destroy(0.5);
        expect(() => EngineObject._updatePendingDestroys(1)).not.toThrow();
        expect(a.exists()).toBe(false);
        expect(errors).toHaveBeenCalledTimes(1);
    });
});

describe("hard stop: scene unload", () => {
    test("unloadScene destroys every root, finishes the unload, then rethrows", () => {
        const keep = SceneManager.activeScene;
        SceneManager.loadScene("hs-extra", LoadSceneMode.Additive);
        const scene = SceneManager.getSceneByName("hs-extra")!;
        const a = new GameObject("a"); a.addComponent(Boom);
        const b = new GameObject("b"); b.addComponent(Quiet);
        SceneManager.moveGameObjectToScene(a, scene);
        SceneManager.moveGameObjectToScene(b, scene);
        ScriptableBehaviour.isolateCallbackErrors = false;

        expect(() => SceneManager.unloadScene(scene)).toThrow("boom:a");

        expect(a.exists()).toBe(false);
        expect(b.exists()).toBe(false);
        expect(SceneManager.getSceneByName("hs-extra")).toBeNull();
        expect(SceneManager.activeScene).toBe(keep);
    });
});
