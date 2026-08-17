import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Camera } from "../src/engine/core/components/Camera";
import { EngineObject } from "../src/engine/core/EngineObject";

/**
 * `Awake` ran the moment a component was added, whatever the object's state.
 * Unity's rule is the opposite: "if a GameObject is inactive during start up,
 * Awake is not called until it is made active" — so a script assembled under a
 * hidden root woke long before its first `onEnable`, in an order it would never
 * see in Unity. Audit F4, open since part 1.
 */

const log: string[] = [];
const made: GameObject[] = [];

class Recorder extends ScriptableBehaviour {
    public label = "?";
    public override awake(): void { log.push(`awake:${this.label}`); }
    public override onEnable(): void { log.push(`enable:${this.label}`); }
    public override onDisable(): void { log.push(`disable:${this.label}`); }
    public override onDestroy(): void { log.push(`destroy:${this.label}`); }
}

function object(name: string, active = true): GameObject {
    const go = new GameObject(name);
    made.push(go);
    if (!active) go.setActive(false);
    return go;
}

function script(go: GameObject, label: string): Recorder {
    const s = go.addComponent(Recorder);
    s.label = label;
    return s;
}

afterEach(() => {
    // Destroy first, then clear: tearing down fires onDisable and onDestroy,
    // and clearing before that leaves the previous test's teardown in the log
    // for the next one to trip over.
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    log.length = 0;
});

describe("Awake on an inactive GameObject", () => {
    test("waits instead of firing on addComponent", () => {
        const go = object("hidden", false);

        script(go, "a");

        expect(log).toEqual([]);
    });

    test("fires when the object is activated, immediately before onEnable", () => {
        const go = object("hidden", false);
        script(go, "a");

        go.setActive(true);

        expect(log).toEqual(["awake:a", "enable:a"]);
    });

    test("still fires immediately on an active object", () => {
        const go = object("visible");

        script(go, "a");

        // The label is still "?" because awake ran *inside* addComponent,
        // before the helper could set it — which is the assertion. On the
        // inactive object above, the label is set by the time awake runs.
        expect(log).toEqual(["awake:?", "enable:?"]);
    });

    test("a disabled component on an active object still wakes at once", () => {
        // Unity's rule is about the GameObject, not the component's `enabled`.
        const go = object("visible");
        const s = go.addComponent(Recorder);
        s.label = "a";
        log.length = 0;

        s.enabled = false;
        s.enabled = true;

        expect(log[0]).toBe("disable:a");
    });

    test("runs once, not once per activation", () => {
        const go = object("hidden", false);
        script(go, "a");

        go.setActive(true);
        go.setActive(false);
        go.setActive(true);

        expect(log.filter(e => e === "awake:a")).toHaveLength(1);
    });

    test("every script on the object wakes before any of them is enabled", () => {
        // Unity's ordering: all Awakes for the object, then all OnEnables. A
        // script's onEnable may look at a sibling, and finding it un-woken
        // would be worse than the deferral itself.
        const go = object("hidden", false);
        script(go, "a");
        script(go, "b");

        go.setActive(true);

        expect(log).toEqual(["awake:a", "awake:b", "enable:a", "enable:b"]);
    });

    test("a child under an inactive parent waits for the parent", () => {
        const parent = object("parent", false);
        const child = object("child");
        child.transform.parent = parent.transform;
        script(child, "c");

        expect(log).toEqual([]);

        parent.setActive(true);

        expect(log).toEqual(["awake:c", "enable:c"]);
    });

    test("activating the parent wakes the whole subtree", () => {
        const parent = object("parent", false);
        const child = object("child");
        child.transform.parent = parent.transform;
        script(parent, "p");
        script(child, "c");

        parent.setActive(true);

        expect(log.indexOf("awake:p")).toBeLessThan(log.indexOf("awake:c"));
        expect(log).toContain("enable:c");
    });

    test("a script that never woke does not get onDestroy either", () => {
        // Unity: "OnDestroy will only be called on game objects that have
        // previously been active." Cleanup that pairs with initialisation must
        // not run when the initialisation did not — it would hand user code an
        // object in a state it has never seen.
        const go = object("hidden", false);
        script(go, "a");

        go.destroyImmediate();

        expect(log).toEqual([]);
    });

    test("a script that did wake gets its onDestroy as always", () => {
        const go = object("visible");
        script(go, "a");
        log.length = 0;

        go.destroyImmediate();

        expect(log).toContain("destroy:a");
    });

    test("waking is reported by the internal flag", () => {
        const go = object("hidden", false);
        const s = script(go, "a");

        expect(s._hasAwoken).toBe(false);
        go.setActive(true);
        expect(s._hasAwoken).toBe(true);
    });
});

describe("Built-in components are untouched by the deferral", () => {
    test("a Camera added to an inactive object still initialises", () => {
        // The reason the fix splits the two paths: this is where Camera, Light
        // and the renderers create their backing Three.js objects, and every one
        // of them assumes it exists from the moment it is added.
        const go = object("hidden", false);

        const cam = go.addComponent(Camera);

        expect(cam.fieldOfView).toBeGreaterThan(0);
        expect(() => cam.getBackgroundColor()).not.toThrow();
    });

    test("and is registered, so the engine can still find it", () => {
        const go = object("hidden", false);
        const cam = go.addComponent(Camera);

        expect(cam.exists()).toBe(true);
        expect(go.getComponent(Camera)).toBe(cam);
    });
});

describe("A deferred script joins the loop correctly once activated", () => {
    class Counter extends ScriptableBehaviour {
        public awakes = 0;
        public starts = 0;
        public updates = 0;
        public override awake(): void { this.awakes++; }
        public override start(): void { this.starts++; }
        public override update(): void { this.updates++; }
    }

    test("start still follows awake and precedes the first update", () => {
        const go = object("hidden", false);
        const c = go.addComponent(Counter);

        go.setActive(true);
        go._systemUpdate();
        go._systemUpdate();

        expect(c.awakes).toBe(1);
        expect(c.starts).toBe(1);
        expect(c.updates).toBe(2);
    });

    test("an object never activated never runs anything", () => {
        const go = object("hidden", false);
        const c = go.addComponent(Counter);

        go._systemUpdate();

        expect(c.awakes).toBe(0);
        expect(c.updates).toBe(0);

        EngineObject.Destroy(go);
    });
});
