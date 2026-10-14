import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";

/**
 * A13: the destroy path survives user code. A throwing onDestroy used to leave
 * a zombie (listed nowhere, yet exists() and found by FindObjectsOfType), a
 * component destroying itself from its own onDestroy recursed without bound,
 * and a child destroyed inside its parent's update loop made the loop throw.
 */

class Tag extends Behaviour {}

class Fragile extends ScriptableBehaviour {
    public calls = 0;
    public override onDestroy(): void {
        this.calls++;
        throw new Error("cleanup failed");
    }
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) {
        try { root.destroyImmediate(); } catch { /* a test that provoked it has already asserted on it */ }
    }
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    clear();
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    errors.mockRestore();
    EngineObject._clearPendingDestroys();
});

describe("a component whose onDestroy throws still ends destroyed", () => {
    test("destroyImmediate rethrows, and the component is gone from every place that could find it", () => {
        const go = new GameObject("go");
        const fragile = go.addComponent(Fragile);
        const objectsBefore = EngineObject.getObjectCount();

        expect(() => fragile.destroyImmediate()).toThrow("cleanup failed");

        expect(fragile.calls).toBe(1);
        expect(fragile.exists()).toBe(false);
        expect(EngineObject.FindObjectsOfType(Fragile, true)).not.toContain(fragile);
        expect(EngineObject.getObjectByInstanceID(fragile.getInstanceID())).toBeNull();
        expect(EngineObject.getObjectCount()).toBe(objectsBefore - 1);
        expect(go.getAllComponents()).not.toContain(fragile);
    });

    test("destroying its GameObject afterwards does not throw and leaves nothing alive", () => {
        const go = new GameObject("go");
        const fragile = go.addComponent(Fragile);
        const sibling = go.addComponent(Tag);
        expect(() => fragile.destroyImmediate()).toThrow("cleanup failed");

        expect(() => go.destroyImmediate()).not.toThrow();

        expect(fragile.calls).toBe(1);
        expect(go.exists()).toBe(false);
        expect(sibling.exists()).toBe(false);
        expect(EngineObject.FindObjectsOfType(Fragile, true)).not.toContain(fragile);
        expect(EngineObject.FindObjectsOfType(Tag, true)).not.toContain(sibling);
        expect(go.getAllComponents()).toEqual([]);
    });

    test("a persistent mark is dropped with it", () => {
        const go = new GameObject("go");
        const fragile = go.addComponent(Fragile);
        EngineObject.DontDestroyOnLoad(fragile);
        expect(fragile._isPersistent()).toBe(true);

        expect(() => fragile.destroyImmediate()).toThrow("cleanup failed");

        expect(fragile._isPersistent()).toBe(false);
    });

    test("a throwing onDisable does not stop the component being destroyed", () => {
        class Unplugs extends ScriptableBehaviour {
            public destroyed = 0;
            public override onDisable(): void { throw new Error("unplug failed"); }
            public override onDestroy(): void { this.destroyed++; }
        }
        const go = new GameObject("go");
        const unplugs = go.addComponent(Unplugs);

        expect(() => unplugs.destroyImmediate()).toThrow("unplug failed");

        expect(unplugs.destroyed).toBe(1);
        expect(unplugs.exists()).toBe(false);
        expect(go.getAllComponents()).not.toContain(unplugs);
    });

    test("destroying a GameObject whose component throws still destroys the rest, and logs it", () => {
        const go = new GameObject("go");
        const child = new GameObject("child");
        child.transform.setParent(go.transform);
        const before = go.addComponent(Tag);
        const fragile = go.addComponent(Fragile);
        const after = go.addComponent(Tag);
        const childComponent = child.addComponent(Tag);

        expect(() => go.destroyImmediate()).not.toThrow();

        expect(errors).toHaveBeenCalled();
        expect(fragile.calls).toBe(1);
        for (const object of [go, child, before, fragile, after, childComponent]) expect(object.exists()).toBe(false);
        expect(go.transform.exists()).toBe(false);
        expect(SceneManager.activeScene.getRootGameObjects()).not.toContain(go);
    });

    test("a timed destroy that throws does not strand the objects due after it", () => {
        const first = new GameObject("first").addComponent(Fragile);
        const second = new GameObject("second").addComponent(Tag);
        const third = new GameObject("third").addComponent(Fragile);
        for (const component of [first, second, third]) component.destroy(1);

        expect(() => EngineObject._updatePendingDestroys(2)).not.toThrow();

        for (const component of [first, second, third]) expect(component.exists()).toBe(false);
        expect(errors).toHaveBeenCalled();
    });
});

describe("destroying an object that is already being destroyed does nothing", () => {
    test("destroyImmediate(this) inside onDestroy runs onDestroy once", () => {
        class Selfish extends ScriptableBehaviour {
            public calls = 0;
            public override onDestroy(): void {
                this.calls++;
                if (this.calls < 50) this.destroyImmediate();
            }
        }
        const go = new GameObject("go");
        const selfish = go.addComponent(Selfish);

        selfish.destroyImmediate();

        expect(selfish.calls).toBe(1);
        expect(selfish.exists()).toBe(false);
        expect(go.getAllComponents()).toEqual([]);
    });

    test("the static forms and destroy() are no-ops too", () => {
        class Selfish extends ScriptableBehaviour {
            public calls = 0;
            public override onDestroy(): void {
                this.calls++;
                EngineObject.DestroyImmediate(this);
                EngineObject.Destroy(this);
                this.destroy(5);
            }
        }
        const selfish = new GameObject("go").addComponent(Selfish);

        selfish.destroyImmediate();
        EngineObject._updatePendingDestroys(10);

        expect(selfish.calls).toBe(1);
    });

    test("two components destroying each other in onDestroy each run once", () => {
        class Partner extends ScriptableBehaviour {
            public calls = 0;
            public other: Partner | null = null;
            public override onDestroy(): void {
                this.calls++;
                if (this.calls < 50) this.other?.destroyImmediate();
            }
        }
        const go = new GameObject("go");
        const a = go.addComponent(Partner);
        const b = go.addComponent(Partner);
        a.other = b;
        b.other = a;

        a.destroyImmediate();

        expect([a.calls, b.calls]).toEqual([1, 1]);
        expect(a.exists()).toBe(false);
        expect(b.exists()).toBe(false);
        expect(go.getAllComponents()).toEqual([]);
    });

    test("a component destroying its own GameObject during that object's teardown does not re-enter it", () => {
        class Reaper extends ScriptableBehaviour {
            public calls = 0;
            public override onDestroy(): void {
                this.calls++;
                if (this.calls < 50) this.gameObject.destroyImmediate();
            }
        }
        const go = new GameObject("go");
        const first = go.addComponent(Reaper);
        const second = go.addComponent(Reaper);

        go.destroyImmediate();

        expect([first.calls, second.calls]).toEqual([1, 1]);
        expect(go.exists()).toBe(false);
    });

    test("a component stays in its object's list until its own onDestroy has returned", () => {
        class Probe extends ScriptableBehaviour {
            public listedAtStart = false;
            public listedAfterSelfDestroy = false;
            public override onDestroy(): void {
                this.listedAtStart = this.gameObject.getAllComponents().includes(this);
                this.destroyImmediate();
                this.listedAfterSelfDestroy = this.gameObject.getAllComponents().includes(this);
            }
        }
        const probe = new GameObject("go").addComponent(Probe);

        probe.destroyImmediate();

        expect([probe.listedAtStart, probe.listedAfterSelfDestroy]).toEqual([true, true]);
    });
});

describe("what onDestroy can still see", () => {
    test("its GameObject, its own fields, and that it exists, until it returns", () => {
        class Reader extends ScriptableBehaviour {
            public value = 42;
            public sawObject: GameObject | null = null;
            public sawName = "";
            public sawValue = 0;
            public sawExists: boolean | null = null;
            public override onDestroy(): void {
                this.sawObject = this.gameObject;
                this.sawName = this.gameObject.name;
                this.sawValue = this.value;
                this.sawExists = this.exists();
            }
        }
        const go = new GameObject("Holder");
        const reader = go.addComponent(Reader);

        reader.destroyImmediate();

        expect(reader.sawObject).toBe(go);
        expect(reader.sawName).toBe("Holder");
        expect(reader.sawValue).toBe(42);
        expect(reader.sawExists).toBe(true);
        expect(reader.exists()).toBe(false);
    });

    test("the same holds when the whole GameObject is being destroyed", () => {
        class Reader extends ScriptableBehaviour {
            public sawName = "";
            public sawExists: boolean | null = null;
            public override onDestroy(): void {
                this.sawName = this.gameObject.name;
                this.sawExists = this.exists();
            }
        }
        const go = new GameObject("Holder");
        const reader = go.addComponent(Reader);

        go.destroyImmediate();

        expect(reader.sawName).toBe("Holder");
        expect(reader.sawExists).toBe(true);
    });
});
