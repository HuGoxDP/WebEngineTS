import { describe, test, expect } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";

/**
 * Reparenting, against Unity's documented semantics rather than ours.
 *
 * `Transform.parent`'s setter used to pass `worldPositionStays: false`, so an
 * object jumped when it was reparented. Unity keeps it in place: "Changing the
 * parent will modify the parent-relative position, scale and rotation but keep
 * the world space position, rotation and scale the same." The engine's own
 * `setParent` already defaulted to `true`, so the property contradicted its
 * sibling as well as Unity.
 */

function at(x: number, y: number, z: number): GameObject {
    const go = new GameObject("go");
    go.transform.position = new Vector3(x, y, z);
    return go;
}

describe("Transform.parent — world position is preserved", () => {
    test("an object does not move when it gains a parent", () => {
        const parent = at(10, 0, 0);
        const child = at(1, 2, 3);

        child.transform.parent = parent.transform;

        const world = child.transform.position;
        expect(world.x).toBeCloseTo(1, 5);
        expect(world.y).toBeCloseTo(2, 5);
        expect(world.z).toBeCloseTo(3, 5);
        // Which means the local values moved instead.
        expect(child.transform.localPosition.x).toBeCloseTo(-9, 5);
    });

    test("an object does not move when it loses its parent", () => {
        const parent = at(10, 0, 0);
        const child = at(1, 2, 3);
        child.transform.parent = parent.transform;

        child.transform.parent = null;

        const world = child.transform.position;
        expect(world.x).toBeCloseTo(1, 5);
        expect(world.y).toBeCloseTo(2, 5);
        expect(world.z).toBeCloseTo(3, 5);
    });

    test("rotation survives reparenting too", () => {
        const parent = new GameObject("parent");
        parent.transform.rotation = Quaternion.euler(0, 90, 0);
        const child = new GameObject("child");
        child.transform.rotation = Quaternion.euler(0, 30, 0);

        child.transform.parent = parent.transform;

        expect(child.transform.eulerAngles.y).toBeCloseTo(30, 3);
    });

    test("scale survives reparenting too", () => {
        const parent = new GameObject("parent");
        parent.transform.localScale = new Vector3(2, 2, 2);
        const child = new GameObject("child");
        child.transform.localScale = new Vector3(3, 3, 3);

        child.transform.parent = parent.transform;

        expect(child.transform.lossyScale.x).toBeCloseTo(3, 5);
        expect(child.transform.localScale.x).toBeCloseTo(1.5, 5);
    });

    test("moving between two parents keeps the object where it was", () => {
        const first = at(10, 0, 0);
        const second = at(0, 5, 0);
        const child = at(1, 2, 3);
        child.transform.parent = first.transform;

        child.transform.parent = second.transform;

        const world = child.transform.position;
        expect(world.x).toBeCloseTo(1, 5);
        expect(world.y).toBeCloseTo(2, 5);
        expect(world.z).toBeCloseTo(3, 5);
    });
});

describe("Transform.setParent — the explicit opt-out", () => {
    test("worldPositionStays: false keeps the local values, so the object moves", () => {
        const parent = at(10, 0, 0);
        const child = at(1, 2, 3);

        child.transform.setParent(parent.transform, false);

        // Local is untouched, so the world position shifts by the parent's.
        expect(child.transform.localPosition.x).toBeCloseTo(1, 5);
        expect(child.transform.position.x).toBeCloseTo(11, 5);
    });

    test("the default matches the property, as Unity's does", () => {
        const parent = at(10, 0, 0);
        const child = at(1, 2, 3);

        child.transform.setParent(parent.transform);

        expect(child.transform.position.x).toBeCloseTo(1, 5);
    });
});

describe("Transform.parent — hierarchy bookkeeping", () => {
    test("the child list and parent pointer agree", () => {
        const parent = new GameObject("parent");
        const child = new GameObject("child");

        child.transform.parent = parent.transform;

        expect(parent.transform.childCount).toBe(1);
        expect(parent.transform.getChild(0)).toBe(child.transform);
        expect(child.transform.parent).toBe(parent.transform);
    });

    test("reparenting removes the child from its former parent", () => {
        const first = new GameObject("first");
        const second = new GameObject("second");
        const child = new GameObject("child");
        child.transform.parent = first.transform;

        child.transform.parent = second.transform;

        expect(first.transform.childCount).toBe(0);
        expect(second.transform.childCount).toBe(1);
    });

    test("assigning the same parent again is a no-op", () => {
        const parent = new GameObject("parent");
        const child = new GameObject("child");
        child.transform.parent = parent.transform;

        child.transform.parent = parent.transform;

        expect(parent.transform.childCount).toBe(1);
    });
});
