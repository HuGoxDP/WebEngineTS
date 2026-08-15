import { describe, test, expect, afterEach } from "vitest";
import { EngineObject } from "../src/engine/core/EngineObject";
import { GameObject } from "../src/engine/core/GameObject";
import { MeshFilter } from "../src/engine/core/rendering/MeshFilter";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * `EngineObject.Instantiate` on a GameObject inherited a base implementation
 * that built `new GameObject(name + " (Clone)")` — no components, no children,
 * none of the transform, added to the scene and invisible. Unity's most-used
 * API, failing silently. Audit part 4, F25.
 */

const made: GameObject[] = [];

function makeObject(): GameObject {
    const go = new GameObject("Original");
    go.transform.position = new Vector3(1, 2, 3);
    go.addComponent(MeshFilter);
    const child = new GameObject("Child");
    child.transform.setParent(go.transform, false);
    made.push(go, child);
    return go;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Instantiating a GameObject", () => {
    test("refuses instead of returning an empty object", () => {
        const original = makeObject();

        expect(() => EngineObject.Instantiate(original)).toThrow(/not implemented/i);
    });

    test("names the object and points somewhere useful", () => {
        const original = makeObject();

        expect(() => EngineObject.Instantiate(original)).toThrow(/Original/);
        expect(() => EngineObject.Instantiate(original)).toThrow(/unity-parity-plan/);
    });

    test("leaves nothing half-built in the scene", () => {
        const original = makeObject();
        const before = original.scene.getRootGameObjects().length;

        expect(() => EngineObject.Instantiate(original)).toThrow();

        expect(original.scene.getRootGameObjects()).toHaveLength(before);
    });

    test("a component still refuses to be cloned on its own", () => {
        const original = makeObject();
        const filter = original.getComponent(MeshFilter)!;

        expect(() => EngineObject.Instantiate(filter)).toThrow(/in isolation/i);
    });

    test("the original is untouched by the attempt", () => {
        const original = makeObject();

        expect(() => EngineObject.Instantiate(original)).toThrow();

        expect(original.exists()).toBe(true);
        expect(original.getComponent(MeshFilter)).not.toBeNull();
        expect(original.transform.childCount).toBe(1);
    });
});
