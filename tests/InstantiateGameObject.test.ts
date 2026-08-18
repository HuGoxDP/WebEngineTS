import { describe, test, expect, afterEach, vi } from "vitest";
import { EngineObject } from "../src/engine/core/EngineObject";
import { GameObject } from "../src/engine/core/GameObject";
import { MeshFilter } from "../src/engine/core/rendering/MeshFilter";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * `EngineObject.Instantiate` on a GameObject inherited a base implementation
 * that built `new GameObject(name + " (Clone)")` — no components, no children,
 * none of the transform, added to the scene and invisible. Unity's most-used
 * API, failing silently. It was made to refuse (F25, part 4); it now makes a
 * real copy, and names whatever it could not copy rather than dropping it
 * quietly.
 */

@Serializable({ typeName: "Test.F25.Marker" })
class Marker extends ScriptableBehaviour {
    @SerializedField() public label = "unset";
}

/** No `@Serializable`, so the serializer cannot reproduce it. */
class Opaque extends ScriptableBehaviour {}

const made: GameObject[] = [];

function track<T extends GameObject>(go: T): T {
    made.push(go);
    return go;
}

function makeObject(): GameObject {
    const go = track(new GameObject("Original"));
    go.transform.position = new Vector3(1, 2, 3);
    go.addComponent(MeshFilter);
    go.addComponent(Marker).label = "hello";
    const child = track(new GameObject("Child"));
    child.transform.setParent(go.transform, false);
    return go;
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Instantiating a GameObject", () => {
    test("returns a copy rather than refusing", () => {
        const original = makeObject();

        const copy = track(EngineObject.Instantiate(original) as GameObject);

        expect(copy).not.toBe(original);
        expect(copy.exists()).toBe(true);
    });

    test("brings the children with it", () => {
        const original = makeObject();

        const copy = track(EngineObject.Instantiate(original) as GameObject);

        expect(copy.transform.childCount).toBe(1);
        expect(copy.transform.getChild(0).gameObject.name).toBe("Child");
        expect(copy.transform.getChild(0).gameObject).not.toBe(
            original.transform.getChild(0).gameObject,
        );
    });

    test("brings the transform with it", () => {
        const original = makeObject();

        const copy = track(EngineObject.Instantiate(original) as GameObject);

        expect(copy.transform.position.x).toBeCloseTo(1);
        expect(copy.transform.position.y).toBeCloseTo(2);
        expect(copy.transform.position.z).toBeCloseTo(3);
    });

    test("brings serializable component state with it", () => {
        const original = makeObject();

        const copy = track(EngineObject.Instantiate(original) as GameObject);
        const marker = copy.getComponent(Marker);

        expect(marker).not.toBeNull();
        expect(marker!.label).toBe("hello");
        expect(marker).not.toBe(original.getComponent(Marker));
    });

    test("the copy is independent — editing it does not reach the original", () => {
        const original = makeObject();
        const copy = track(EngineObject.Instantiate(original) as GameObject);

        copy.getComponent(Marker)!.label = "changed";
        copy.transform.position = new Vector3(9, 9, 9);

        expect(original.getComponent(Marker)!.label).toBe("hello");
        expect(original.transform.position.x).toBeCloseTo(1);
    });

    test("what it cannot copy, it names", () => {
        // The reason this used to refuse: a copy missing a component is worse
        // than no copy at all *if nobody says so*. So it says so.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const original = makeObject();
        original.addComponent(Opaque);

        track(EngineObject.Instantiate(original) as GameObject);

        expect(warn).toHaveBeenCalledTimes(1);
        const line = String(warn.mock.calls[0][0]);
        expect(line).toContain("Opaque");
        expect(line).toContain("Original");
        expect(line).toContain("@Serializable");
    });

    test("and says nothing when it copied everything", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const original = makeObject();

        track(EngineObject.Instantiate(original) as GameObject);

        expect(warn).not.toHaveBeenCalled();
    });

    test("an unserializable component on a child is named too", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const original = makeObject();
        original.transform.getChild(0).gameObject.addComponent(Opaque);

        track(EngineObject.Instantiate(original) as GameObject);

        expect(String(warn.mock.calls[0][0])).toContain("Opaque");
    });

    test("the copy joins the scene", () => {
        const original = makeObject();
        const before = original.scene.getRootGameObjects().length;

        track(EngineObject.Instantiate(original) as GameObject);

        expect(original.scene.getRootGameObjects()).toHaveLength(before + 1);
    });

    test("a component still refuses to be cloned on its own", () => {
        const original = makeObject();
        const filter = original.getComponent(MeshFilter)!;

        expect(() => EngineObject.Instantiate(filter)).toThrow(/in isolation/i);
    });

    test("the original is untouched", () => {
        const original = makeObject();

        track(EngineObject.Instantiate(original) as GameObject);

        expect(original.exists()).toBe(true);
        expect(original.getComponent(MeshFilter)).not.toBeNull();
        expect(original.transform.childCount).toBe(1);
        expect(original.getComponent(Marker)!.label).toBe("hello");
    });
});
