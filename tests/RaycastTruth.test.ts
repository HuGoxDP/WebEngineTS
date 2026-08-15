import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { Physics } from "../src/engine/physics/Physics";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { RaycastHit } from "../src/engine/physics/RaycastHit";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";
import { Ray } from "../src/engine/core/math/Ray";

/**
 * A raycast has to answer about the world as it is now, in the units the caller
 * works in. Three of its answers were wrong: the normal came back in the hit
 * object's local space, an object inactive because of its *parent* was still
 * hit, and a collider moved earlier in the same Update was hit at last frame's
 * position. Audit part 5, F28.
 */

const made: GameObject[] = [];

function boxAt(position: Vector3, name = "Box"): GameObject {
    const go = new GameObject(name);
    go.transform.position = position;
    go.addComponent(BoxCollider);
    made.push(go);
    return go;
}

/** A ray down the -X axis, aimed at the origin from x = +10. */
function rayFromRight(): Ray {
    return new Ray(new Vector3(10, 0, 0), new Vector3(-1, 0, 0));
}

beforeEach(() => {
    PhysicsWorld._reset();
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    PhysicsWorld._reset();
});

describe("Physics.raycast reports the world", () => {
    test("the normal is in world space, not the object's", () => {
        // A box rotated 90° about Z: the face the ray hits is the same face in
        // world terms, but a *different* local face normal. Reporting the local
        // one points it somewhere the ray never came from.
        const go = boxAt(new Vector3(0, 0, 0));
        go.transform.rotation = Quaternion.euler(0, 0, 90);

        const hit = new RaycastHit();
        expect(Physics.raycast(rayFromRight(), hit)).toBe(true);

        // Facing back along the ray, whatever the box's own orientation is.
        expect(hit.normal.x).toBeCloseTo(1, 5);
        expect(hit.normal.y).toBeCloseTo(0, 5);
        expect(hit.normal.z).toBeCloseTo(0, 5);
    });

    test("an unrotated box reports the same normal", () => {
        boxAt(new Vector3(0, 0, 0));

        const hit = new RaycastHit();
        Physics.raycast(rayFromRight(), hit);

        expect(hit.normal.x).toBeCloseTo(1, 5);
    });

    test("a collider moved this frame is hit where it is now", () => {
        // No render has happened since the move, so Three's world matrices are
        // stale unless the raycast refreshes them itself.
        const go = boxAt(new Vector3(0, 0, 0));

        go.transform.position = new Vector3(0, 50, 0);

        expect(Physics.raycast(rayFromRight())).toBe(false);
    });

    test("and is hit after moving into the ray", () => {
        const go = boxAt(new Vector3(0, 50, 0));

        go.transform.position = new Vector3(0, 0, 0);

        expect(Physics.raycast(rayFromRight())).toBe(true);
    });

    test("an object inactive through its parent is not hit", () => {
        // Unity's Raycast ignores anything not active in the hierarchy; this
        // checked only the object's own flag.
        const parent = new GameObject("Parent");
        made.push(parent);
        const child = boxAt(new Vector3(0, 0, 0), "Child");
        child.transform.setParent(parent.transform, true);

        parent.setActive(false);

        expect(Physics.raycast(rayFromRight())).toBe(false);
    });

    test("the object itself being inactive still counts", () => {
        const go = boxAt(new Vector3(0, 0, 0));

        go.setActive(false);

        expect(Physics.raycast(rayFromRight())).toBe(false);
    });

    test("the hit carries the collider and its transform", () => {
        const go = boxAt(new Vector3(0, 0, 0));

        const hit = new RaycastHit();
        Physics.raycast(rayFromRight(), hit);

        expect(hit.collider).toBe(go.getComponent(BoxCollider));
        expect(hit.transform).toBe(go.transform);
        expect(hit.gameObject).toBe(go);
        expect(hit.distance).toBeCloseTo(9.5, 5);
    });

    test("maxDistance still bounds it", () => {
        boxAt(new Vector3(0, 0, 0));

        expect(Physics.raycast(rayFromRight(), undefined, 5)).toBe(false);
        expect(Physics.raycast(rayFromRight(), undefined, 20)).toBe(true);
    });
});
