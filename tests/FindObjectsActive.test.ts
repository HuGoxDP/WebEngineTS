import { describe, test, expect, afterEach } from "vitest";
import { EngineObject } from "../src/engine/core/EngineObject";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Mesh } from "../src/engine/core/graphics/Mesh";

/**
 * `FindObjectsOfType` promised "all active loaded objects" and filtered only
 * destruction — a GameObject with `setActive(false)`, and every component on
 * it, came back. The doc was corrected first so nobody planned around a promise
 * that was not kept; this is the semantics catching up. Audit F3, open since
 * part 1.
 */

class Marker extends ScriptableBehaviour {}
class Other extends ScriptableBehaviour {}

const made: (GameObject | Mesh)[] = [];

function object(name: string, active = true): GameObject {
    const go = new GameObject(name);
    made.push(go);
    if (!active) go.setActive(false);
    return go;
}

afterEach(() => {
    // The registry these searches walk is global, so anything left behind
    // shows up in the next test's results.
    for (const o of made) if (o.exists()) o._destroyImmediate();
    made.length = 0;
});

describe("FindObjectsOfType", () => {
    test("skips components on inactive GameObjects, as Unity does", () => {
        const visible = object("visible");
        visible.addComponent(Marker);
        const hidden = object("hidden", false);
        hidden.addComponent(Marker);

        const found = EngineObject.FindObjectsOfType(Marker);

        expect(found).toHaveLength(1);
        expect(found[0].gameObject.name).toBe("visible");
    });

    test("returns them when asked, which is Unity's other overload", () => {
        object("visible").addComponent(Marker);
        object("hidden", false).addComponent(Marker);

        const found = EngineObject.FindObjectsOfType(Marker, true);

        expect(found).toHaveLength(2);
    });

    test("a disabled component on an active object is still found", () => {
        // The distinction that matters: Unity filters on the *object's*
        // activity, not the component's `enabled`.
        const go = object("visible");
        const marker = go.addComponent(Marker);
        marker.enabled = false;

        expect(EngineObject.FindObjectsOfType(Marker)).toHaveLength(1);
    });

    test("a child of an inactive parent is skipped — hierarchy, not self", () => {
        const parent = object("parent", false);
        const child = object("child");
        child.transform.parent = parent.transform;
        child.addComponent(Marker);

        expect(child.activeSelf).toBe(true);
        expect(EngineObject.FindObjectsOfType(Marker)).toHaveLength(0);
        expect(EngineObject.FindObjectsOfType(Marker, true)).toHaveLength(1);
    });

    test("the inactive GameObject itself is skipped too", () => {
        object("visible");
        object("hidden", false);

        const names = EngineObject.FindObjectsOfType(GameObject).map(g => g.name);

        expect(names).toContain("visible");
        expect(names).not.toContain("hidden");
    });

    test("assets are always found, having no activity to test", () => {
        // The reason the check is duck-typed rather than a blanket filter: this
        // is how the diagnostics subsystem enumerates meshes and textures, and
        // a mesh is neither active nor inactive.
        const mesh = new Mesh();
        made.push(mesh);

        const found = EngineObject.FindObjectsOfType(Mesh);

        expect(found).toContain(mesh);
        expect(EngineObject.FindObjectsOfType(Mesh, true)).toContain(mesh);
    });

    test("destroyed objects stay out, as they always did", () => {
        const go = object("visible");
        go.addComponent(Marker);

        go.destroyImmediate();

        expect(EngineObject.FindObjectsOfType(Marker, true)).toHaveLength(0);
    });

    test("the type filter still applies", () => {
        const go = object("visible");
        go.addComponent(Marker);
        go.addComponent(Other);

        expect(EngineObject.FindObjectsOfType(Marker)).toHaveLength(1);
    });
});

describe("FindObjectOfType", () => {
    test("skips an inactive object and finds the next active one", () => {
        object("hidden", false).addComponent(Marker);
        const visible = object("visible");
        visible.addComponent(Marker);

        const found = EngineObject.FindObjectOfType(Marker);

        expect(found?.gameObject.name).toBe("visible");
    });

    test("returns null when only inactive ones exist", () => {
        object("hidden", false).addComponent(Marker);

        expect(EngineObject.FindObjectOfType(Marker)).toBeNull();
        expect(EngineObject.FindObjectOfType(Marker, true)).not.toBeNull();
    });
});

describe("Scene.findObjectsOfType", () => {
    test("agrees with the static form about inactive objects", () => {
        // Both claimed Unity equivalence; only one of them can be right, so
        // they were changed together.
        object("visible").addComponent(Marker);
        object("hidden", false).addComponent(Marker);
        const scene = SceneManager.activeScene;

        expect(scene.findObjectsOfType(Marker)).toHaveLength(1);
        expect(scene.findObjectsOfType(Marker, true)).toHaveLength(2);
    });

    test("the singular form does too", () => {
        object("hidden", false).addComponent(Marker);
        const scene = SceneManager.activeScene;

        expect(scene.findObjectOfType(Marker)).toBeNull();
        expect(scene.findObjectOfType(Marker, true)).not.toBeNull();
    });

    test("a disabled component on an active object is still found", () => {
        const go = object("visible");
        go.addComponent(Marker).enabled = false;
        const scene = SceneManager.activeScene;

        expect(scene.findObjectsOfType(Marker)).toHaveLength(1);
    });
});
