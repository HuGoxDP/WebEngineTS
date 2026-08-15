import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { SphereCollider } from "../src/engine/physics/SphereCollider";
import { CapsuleCollider } from "../src/engine/physics/CapsuleCollider";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * `center` moved the Three.js proxy mesh that raycasts hit, and never reached
 * cannon: the shape was added to the body at the object's origin. A ray then
 * hit the collider where nothing collided. Audit part 5, F27.
 */

const made: GameObject[] = [];

function object(name: string): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

/** Where cannon thinks the collider's shape sits, relative to the body. */
function offsetOf(collider: { _getBody(): { shapes: unknown[]; shapeOffsets: Array<{ x: number; y: number; z: number }> } | null },
                  shapeIndex = 0): { x: number; y: number; z: number } {
    const body = collider._getBody();
    expect(body).not.toBeNull();
    return body!.shapeOffsets[shapeIndex];
}

beforeEach(() => {
    PhysicsWorld._reset();
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    PhysicsWorld._reset();
});

describe("Collider.center reaches the simulation", () => {
    test("a box set before the body exists is added at its offset", () => {
        const go = object("Box");
        const box = go.addComponent(BoxCollider);
        box.center = new Vector3(0, 2, 0);
        go.addComponent(Rigidbody);

        expect(offsetOf(box).y).toBeCloseTo(2);
    });

    test("changing it afterwards moves the shape too", () => {
        const go = object("Box");
        go.addComponent(Rigidbody);
        const box = go.addComponent(BoxCollider);

        box.center = new Vector3(1, -3, 0.5);

        const offset = offsetOf(box);
        expect(offset.x).toBeCloseTo(1);
        expect(offset.y).toBeCloseTo(-3);
        expect(offset.z).toBeCloseTo(0.5);
    });

    test("a static collider with no Rigidbody offsets its implicit body's shape", () => {
        const go = object("Static");
        const box = go.addComponent(BoxCollider);

        box.center = new Vector3(0, 5, 0);

        expect(offsetOf(box).y).toBeCloseTo(5);
    });

    test("spheres and capsules do the same", () => {
        const sphereGo = object("Sphere");
        const sphere = sphereGo.addComponent(SphereCollider);
        sphere.center = new Vector3(0, 1.5, 0);

        const capsuleGo = object("Capsule");
        const capsule = capsuleGo.addComponent(CapsuleCollider);
        capsule.center = new Vector3(-2, 0, 0);

        expect(offsetOf(sphere).y).toBeCloseTo(1.5);
        expect(offsetOf(capsule).x).toBeCloseTo(-2);
    });

    test("the default is the origin, and stays there", () => {
        const go = object("Plain");
        const box = go.addComponent(BoxCollider);
        go.addComponent(Rigidbody);

        const offset = offsetOf(box);
        expect(offset.x).toBe(0);
        expect(offset.y).toBe(0);
        expect(offset.z).toBe(0);
    });

    test("the ray proxy and the simulation agree on where it is", () => {
        // The two representations are the whole point: they were updated by
        // different code paths, and only one of them was.
        const go = object("Both");
        const box = go.addComponent(BoxCollider);
        go.addComponent(Rigidbody);

        box.center = new Vector3(0, 4, 0);

        const proxy = box._getPhysicsShape();
        expect(proxy.position.y).toBeCloseTo(4);
        expect(offsetOf(box).y).toBeCloseTo(4);
    });

    test("moving a collider onto a Rigidbody added later keeps the offset", () => {
        // The reattach path builds the shape again on the new body.
        const go = object("Late");
        const box = go.addComponent(BoxCollider);
        box.center = new Vector3(0, 0, 3);

        go.addComponent(Rigidbody);

        expect(offsetOf(box).z).toBeCloseTo(3);
    });
});
