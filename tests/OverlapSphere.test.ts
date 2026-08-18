import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Physics } from "../src/engine/physics/Physics";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { SphereCollider } from "../src/engine/physics/SphereCollider";
import { CapsuleCollider } from "../src/engine/physics/CapsuleCollider";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";

/**
 * `overlapSphere` compared the query against each collider's **transform
 * position**, so a large box whose origin sat outside was missed even when half
 * of it was inside, and a collider whose origin was inside came back however far
 * its shape reached away. Audit F29, open since part 5.
 */

const made: GameObject[] = [];

function box(name: string, position: Vector3, size: Vector3): BoxCollider {
    const go = new GameObject(name);
    made.push(go);
    go.transform.position = position;
    const col = go.addComponent(BoxCollider);
    col.size = size;
    return col;
}

function sphere(name: string, position: Vector3, radius: number): SphereCollider {
    const go = new GameObject(name);
    made.push(go);
    go.transform.position = position;
    const col = go.addComponent(SphereCollider);
    col.radius = radius;
    return col;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("overlapSphere", () => {
    test("finds a box whose origin is outside but whose body is inside", () => {
        // The finding, stated directly: a 10-unit box centred at x=6 reaches
        // from x=1 to x=11, so a unit sphere at the origin touches it — and its
        // origin is five units away.
        box("wall", new Vector3(6, 0, 0), new Vector3(10, 10, 10));

        const hits = Physics.overlapSphere(new Vector3(0, 0, 0), 1);

        expect(hits).toHaveLength(1);
        expect(hits[0].gameObject.name).toBe("wall");
    });

    test("skips a collider whose origin is inside but whose shape is not", () => {
        // A sphere of radius 0.1 at (0.5, 0, 0): its origin is inside a query
        // sphere of radius 1, but shift the query away and the shapes part
        // company well before the origins do.
        sphere("pebble", new Vector3(0.5, 0, 0), 0.1);

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 1)).toHaveLength(1);
        expect(Physics.overlapSphere(new Vector3(-0.6, 0, 0), 0.9)).toHaveLength(0);
    });

    test("touching exactly counts as overlapping", () => {
        sphere("ball", new Vector3(2, 0, 0), 1);

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 1)).toHaveLength(1);
        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 0.999)).toHaveLength(0);
    });

    test("a box is tested as an oriented box, not as its bounding box", () => {
        // A long thin box turned 45° about Y. A query just off its corner is
        // outside the box but inside the AABB an approximation would use.
        const col = box("beam", new Vector3(0, 0, 0), new Vector3(8, 0.2, 0.2));
        col.transform.rotation = Quaternion.euler(0, 45, 0);

        // Along the beam's own axis — comfortably inside. A +45° turn about Y
        // sends local +X to world (+0.707, 0, -0.707), so the beam runs towards
        // +X and -Z.
        const along = new Vector3(2, 0, -2);
        expect(Physics.overlapSphere(along, 0.2)).toHaveLength(1);

        // The same distance out on the other diagonal — far from the beam, but
        // well inside the axis-aligned box that contains it.
        const across = new Vector3(2.6, 0, 2.6);
        expect(Physics.overlapSphere(across, 0.2)).toHaveLength(0);
    });

    test("the collider's local centre offset is honoured", () => {
        const col = box("offset", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        col.center = new Vector3(10, 0, 0);

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 1)).toHaveLength(0);
        expect(Physics.overlapSphere(new Vector3(10, 0, 0), 0.1)).toHaveLength(1);
    });

    test("a capsule is a segment with thickness, not a sphere", () => {
        // 4 tall, radius 0.5: the body runs from y=-2 to y=+2 and is thin.
        const go = new GameObject("pillar");
        made.push(go);
        const col = go.addComponent(CapsuleCollider);
        col.radius = 0.5;
        col.height = 4;

        // Near the top cap — inside.
        expect(Physics.overlapSphere(new Vector3(0, 1.9, 0), 0.1)).toHaveLength(1);
        // Beyond the top cap.
        expect(Physics.overlapSphere(new Vector3(0, 2.7, 0), 0.1)).toHaveLength(0);
        // Off to the side at mid-height.
        expect(Physics.overlapSphere(new Vector3(0.9, 0, 0), 0.1)).toHaveLength(0);
        expect(Physics.overlapSphere(new Vector3(0.55, 0, 0), 0.1)).toHaveLength(1);
    });

    test("returns every collider it touches, not just the first", () => {
        box("a", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        box("b", new Vector3(0.5, 0, 0), new Vector3(1, 1, 1));
        sphere("c", new Vector3(-0.5, 0, 0), 0.5);

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 0.1)).toHaveLength(3);
    });

    test("a disabled collider is not found", () => {
        const col = box("off", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        col.enabled = false;

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 1)).toHaveLength(0);
    });

    test("a collider on an inactive object is not found", () => {
        const col = box("hidden", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        col.gameObject.setActive(false);

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 1)).toHaveLength(0);
    });

    test("nothing in range is an empty array, not null", () => {
        box("far", new Vector3(100, 0, 0), new Vector3(1, 1, 1));

        expect(Physics.overlapSphere(new Vector3(0, 0, 0), 1)).toEqual([]);
    });
});

describe("checkSphere", () => {
    test("answers the same question as overlapSphere", () => {
        box("wall", new Vector3(6, 0, 0), new Vector3(10, 10, 10));

        expect(Physics.checkSphere(new Vector3(0, 0, 0), 1)).toBe(true);
        expect(Physics.checkSphere(new Vector3(-20, 0, 0), 1)).toBe(false);
    });

    test("false when the scene is empty", () => {
        expect(Physics.checkSphere(new Vector3(0, 0, 0), 100)).toBe(false);
    });

    test("ignores disabled colliders, as the overlap does", () => {
        const col = box("off", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        col.enabled = false;

        expect(Physics.checkSphere(new Vector3(0, 0, 0), 1)).toBe(false);
    });
});
