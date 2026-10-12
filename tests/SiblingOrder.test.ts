import { describe, test, expect, beforeEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";

/**
 * The order of children and of components is part of a scene: the hierarchy
 * lists it, layout groups arrange by it, update runs in it, and the file is
 * written in it. An editor that cannot change it cannot offer "drop between two
 * rows" or "Move Up".
 */

@Serializable({ typeName: "SiblingSpec.A" })
class A extends Behaviour {
    @SerializedField() public value = 1;
}
@Serializable({ typeName: "SiblingSpec.B" })
class B extends Behaviour {}
@Serializable({ typeName: "SiblingSpec.C" })
class C extends Behaviour {}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

function family(): { parent: GameObject; kids: GameObject[] } {
    const parent = new GameObject("Parent");
    const kids = ["a", "b", "c", "d"].map(name => {
        const go = new GameObject(name);
        go.transform.parent = parent.transform;
        return go;
    });
    return { parent, kids };
}

const names = (parent: GameObject): string =>
    Array.from({ length: parent.transform.childCount }, (_, i) => parent.transform.getChild(i).gameObject.name).join("");

describe("Transform — sibling index", () => {
    beforeEach(clear);

    test("children are numbered in the order they were added", () => {
        const { kids } = family();
        expect(kids.map(k => k.transform.getSiblingIndex())).toEqual([0, 1, 2, 3]);
    });

    test("setSiblingIndex moves a child and shifts the ones it passes", () => {
        const { parent, kids } = family();

        kids[3].transform.setSiblingIndex(1);
        expect(names(parent)).toBe("adbc");

        kids[0].transform.setSiblingIndex(2);
        expect(names(parent)).toBe("dbac");
    });

    test("setAsFirstSibling and setAsLastSibling", () => {
        const { parent, kids } = family();

        kids[2].transform.setAsFirstSibling();
        expect(names(parent)).toBe("cabd");

        kids[0].transform.setAsLastSibling();
        expect(names(parent)).toBe("cbda");
    });

    test("an index past either end is clamped to it", () => {
        const { parent, kids } = family();

        kids[0].transform.setSiblingIndex(99);
        expect(names(parent)).toBe("bcda");

        kids[0].transform.setSiblingIndex(-5);
        expect(names(parent)).toBe("abcd");
    });

    test("only the order changes — nothing moves in space", () => {
        const { kids } = family();
        kids[1].transform.localPosition = new Vector3(4, 5, 6);

        kids[1].transform.setSiblingIndex(3);

        expect(kids[1].transform.localPosition.x).toBeCloseTo(4);
        expect(kids[1].transform.localPosition.z).toBeCloseTo(6);
        expect(kids[1].transform.parent).toBe(kids[0].transform.parent);
    });

    test("root objects have an order too", () => {
        const [x, y, z] = ["x", "y", "z"].map(n => new GameObject(n));
        const order = () => SceneManager.activeScene.getRootGameObjects().map(g => g.name).join("");

        expect(order()).toBe("xyz");
        z.transform.setAsFirstSibling();
        expect(order()).toBe("zxy");
        expect(x.transform.getSiblingIndex()).toBe(1);

        y.transform.setSiblingIndex(0);
        expect(order()).toBe("yzx");
    });

    test("a re-parented object goes to the end of its new siblings", () => {
        const { parent, kids } = family();
        const other = new GameObject("e");

        other.transform.parent = parent.transform;

        expect(other.transform.getSiblingIndex()).toBe(kids.length);
    });

    test("the saved scene is written in the new order, and loads back in it", () => {
        const { parent, kids } = family();
        kids[3].transform.setAsFirstSibling();

        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        expect(json.roots[0].children.map(c => c.name).join("")).toBe("dabc");

        clear();
        const [back] = SceneSerializer.deserializeScene(json);
        expect(names(back)).toBe("dabc");
        expect(parent.exists()).toBe(false);
    });

    test("reordering is seen by anything that caches the hierarchy", () => {
        const { kids } = family();
        const before = (Transform as unknown as { _hierarchyVersion: number })._hierarchyVersion;

        kids[0].transform.setAsLastSibling();

        expect((Transform as unknown as { _hierarchyVersion: number })._hierarchyVersion).toBeGreaterThan(before);
    });
});

describe("GameObject — component order", () => {
    beforeEach(clear);

    function made() {
        const go = new GameObject("Holder");
        return { go, a: go.addComponent(A), b: go.addComponent(B), c: go.addComponent(C) };
    }

    test("components are listed in the order they were added", () => {
        const { go, a, b, c } = made();
        expect(go.getAllComponents()).toEqual([a, b, c]);
        expect(go.getComponentIndex(b)).toBe(1);
    });

    test("setComponentIndex moves one and shifts the rest", () => {
        const { go, a, b, c } = made();

        expect(go.setComponentIndex(c, 0)).toBe(true);
        expect(go.getAllComponents()).toEqual([c, a, b]);

        go.setComponentIndex(c, 99);
        expect(go.getAllComponents()).toEqual([a, b, c]);
    });

    test("a component of another object is refused", () => {
        const { go } = made();
        const stranger = new GameObject("Other").addComponent(A);

        expect(go.setComponentIndex(stranger, 0)).toBe(false);
        expect(go.getComponentIndex(stranger)).toBe(-1);
    });

    test("the list is a copy: changing it does not reorder anything", () => {
        const { go, a, b, c } = made();

        go.getAllComponents().reverse();

        expect(go.getAllComponents()).toEqual([a, b, c]);
    });

    test("the saved scene keeps the order", () => {
        const { go, a } = made();
        go.setComponentIndex(a, 2);

        const json = SceneSerializer.serializeGameObject(go);

        expect(json.components.map(c => c.type)).toEqual(["SiblingSpec.B", "SiblingSpec.C", "SiblingSpec.A"]);
        clear();
        const back = SceneSerializer.deserializeGameObject(json);
        expect(back.getAllComponents().map(c => c.constructor.name)).toEqual(["B", "C", "A"]);
    });
});

import { Transform } from "../src/engine/core/Transform";
