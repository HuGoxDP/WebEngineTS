import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as CANNON from "cannon-es";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { Joint, HingeJoint } from "../src/engine/physics/Joint";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * A hinge describes one line through space, and each body has to describe it in
 * its own frame. Only body A's half was given: cannon defaulted the other
 * body's pivot to its origin and its axis to local X, so the two bodies hinged
 * about different axes through different points. Audit part 5, F30.
 */

const made: GameObject[] = [];

function bodyAt(x: number, name: string): Rigidbody {
    const go = new GameObject(name);
    go.transform.position = new Vector3(x, 0, 0);
    made.push(go);
    return go.addComponent(Rigidbody);
}

/** The cannon constraint a joint built, typed for the assertions below. */
function constraintOf(joint: Joint): CANNON.HingeConstraint {
    const held = (joint as unknown as { _constraint: CANNON.Constraint | null })._constraint;
    expect(held).not.toBeNull();
    return held as CANNON.HingeConstraint;
}

beforeEach(() => {
    PhysicsWorld._reset();
    Joint._reset();
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    PhysicsWorld._reset();
    Joint._reset();
});

describe("HingeJoint describes the same hinge to both bodies", () => {
    test("the connected body's axis matches, rather than defaulting to its local X", () => {
        const door = bodyAt(0, "Door");
        const frame = bodyAt(2, "Frame");

        const hinge = door.gameObject.addComponent(HingeJoint);
        hinge.connectedBody = frame;

        const constraint = constraintOf(hinge);
        expect(constraint.axisA.y).toBeCloseTo(1);
        // Both unrotated, so B's local axis is A's: (0, 1, 0), not cannon's (1, 0, 0).
        expect(constraint.axisB.x).toBeCloseTo(0);
        expect(constraint.axisB.y).toBeCloseTo(1);
    });

    test("the connected body's pivot is the same point in space", () => {
        const door = bodyAt(0, "Door");
        const frame = bodyAt(2, "Frame");

        const hinge = door.gameObject.addComponent(HingeJoint);
        hinge.anchor.set(0.5, 0, 0);
        hinge.connectedBody = frame;
        hinge.applyGeometry();

        // World anchor is x = 0.5; from the frame at x = 2 that is x = -1.5.
        const constraint = constraintOf(hinge);
        expect(constraint.pivotA.x).toBeCloseTo(0.5);
        expect(constraint.pivotB.x).toBeCloseTo(-1.5);
    });

    test("a custom axis is carried across too", () => {
        const a = bodyAt(0, "A");
        const b = bodyAt(3, "B");

        const hinge = a.gameObject.addComponent(HingeJoint);
        hinge.axis.set(0, 0, 1);
        hinge.connectedBody = b;
        hinge.applyGeometry();

        const constraint = constraintOf(hinge);
        expect(constraint.axisB.z).toBeCloseTo(1);
        expect(constraint.axisB.x).toBeCloseTo(0);
    });

    test("hinging two bodies does not drag them together", () => {
        // The physical consequence: with B's pivot left at its own origin, the
        // solver pulls the two origins onto each other.
        const a = bodyAt(0, "A");
        const b = bodyAt(2, "B");
        a.useGravity = false;
        b.useGravity = false;

        const hinge = a.gameObject.addComponent(HingeJoint);
        hinge.anchor.set(1, 0, 0);
        hinge.connectedBody = b;
        hinge.applyGeometry();

        for (let i = 0; i < 60; i++) PhysicsWorld.instance.step(1 / 60);

        const separation = Math.abs(b._body.position.x - a._body.position.x);
        expect(separation).toBeGreaterThan(1.5);
    });

    test("a world-anchored hinge still builds", () => {
        const swinging = bodyAt(0, "Sign");

        const hinge = swinging.gameObject.addComponent(HingeJoint);

        expect(hinge.isActive).toBe(true);
        expect(constraintOf(hinge).axisB.y).toBeCloseTo(1);
    });
});
