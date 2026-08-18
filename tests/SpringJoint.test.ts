import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { SpringJoint } from "../src/engine/physics/Joint";
import { Physics } from "../src/engine/physics/Physics";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * `SpringJoint` was a cannon `DistanceConstraint` — a rod of fixed length. It
 * had no oscillation and no damping, and `stiffness` was the solver's force
 * limit, so raising it made the joint *more* rigid rather than bouncier. Audit
 * F31, open since part 5.
 */

const made: GameObject[] = [];

function body(name: string, position: Vector3, useGravity = false): Rigidbody {
    const go = new GameObject(name);
    made.push(go);
    go.transform.position = position;
    const rb = go.addComponent(Rigidbody);
    rb.useGravity = useGravity;
    return rb;
}

/** Runs `n` fixed steps of the simulation. */
function step(n: number, dt = 1 / 60): void {
    for (let i = 0; i < n; i++) Physics._step(dt);
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A spring joint", () => {
    test("pulls a stretched pair back towards its rest length", () => {
        // Anchor at the origin, bob three units away, rest length one.
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        anchor.isKinematic = true;
        const bob = body("Bob", new Vector3(3, 0, 0));

        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;
        joint.distance = 1;
        joint.stiffness = 50;
        joint.damping = 2;

        step(60);

        expect(bob.transform.position.x).toBeLessThan(3);
    });

    test("pushes a compressed pair apart", () => {
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        anchor.isKinematic = true;
        const bob = body("Bob", new Vector3(0.2, 0, 0));

        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;
        joint.distance = 2;
        joint.stiffness = 50;
        joint.damping = 2;

        step(60);

        expect(bob.transform.position.x).toBeGreaterThan(0.2);
    });

    test("settles near the rest length when damped", () => {
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        anchor.isKinematic = true;
        const bob = body("Bob", new Vector3(4, 0, 0));

        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;
        joint.distance = 2;
        joint.stiffness = 60;
        joint.damping = 8;

        step(600);

        expect(bob.transform.position.x).toBeGreaterThan(1.5);
        expect(bob.transform.position.x).toBeLessThan(2.5);
    });

    test("keeps oscillating with no damping — which a rod never did", () => {
        // The behaviour the class is named for and did not have. Undamped, the
        // bob should still be moving after a second of simulation.
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        anchor.isKinematic = true;
        const bob = body("Bob", new Vector3(3, 0, 0));

        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;
        joint.distance = 1;
        joint.stiffness = 60;
        joint.damping = 0;

        step(60);
        const speed = bob.velocity.magnitude();

        expect(speed).toBeGreaterThan(0.1);
    });

    test("stretches under load, where a rod would not give at all", () => {
        // The clearest separation between the two. A DistanceConstraint holds
        // its length against gravity; a spring hangs longer the heavier the
        // load, and longer still the softer it is.
        function restingLength(stiffness: number): number {
            const anchor = body(`A${stiffness}`, new Vector3(0, 0, 0));
            anchor.isKinematic = true;
            const bob = body(`B${stiffness}`, new Vector3(0, -1, 0), true);
            bob.mass = 5;
            const joint = bob.gameObject.addComponent(SpringJoint);
            joint.connectedBody = anchor;
            joint.distance = 1;
            joint.stiffness = stiffness;
            joint.damping = 30;
            step(400);
            return -bob.transform.position.y;
        }

        const soft = restingLength(60);
        const stiff = restingLength(600);

        // Both hang below the rest length, and the soft one hangs further.
        expect(soft).toBeGreaterThan(1.05);
        expect(soft).toBeGreaterThan(stiff);
    });

    test("a stiffer spring pulls harder over the same time", () => {
        // The property that was inverted before: stiffness was cannon's
        // maxForce, so raising it made the joint more rigid, not springier.
        function travelAfter(stiffness: number): number {
            const anchor = body(`A${stiffness}`, new Vector3(0, 0, 0));
            anchor.isKinematic = true;
            const bob = body(`B${stiffness}`, new Vector3(3, 0, 0));
            const joint = bob.gameObject.addComponent(SpringJoint);
            joint.connectedBody = anchor;
            joint.distance = 1;
            joint.stiffness = stiffness;
            joint.damping = 0;
            step(10);
            return 3 - bob.transform.position.x;
        }

        const soft = travelAfter(20);
        const stiff = travelAfter(200);

        expect(stiff).toBeGreaterThan(soft);
    });

    test("adds no constraint to the solver, being a force", () => {
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        const bob = body("Bob", new Vector3(2, 0, 0));
        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;

        expect(joint.isActive).toBe(true);
        expect(PhysicsWorld.instance.world.constraints.length).toBe(0);
    });

    test("stops applying force once disabled", () => {
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        anchor.isKinematic = true;
        const bob = body("Bob", new Vector3(3, 0, 0));
        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;
        joint.distance = 1;
        joint.stiffness = 80;
        joint.damping = 20;

        step(30);
        joint.enabled = false;
        bob.velocity = new Vector3(0, 0, 0);
        const parked = bob.transform.position.x;
        step(60);

        expect(joint.isActive).toBe(false);
        expect(bob.transform.position.x).toBeCloseTo(parked, 3);
    });

    test("and starts again when re-enabled", () => {
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        anchor.isKinematic = true;
        const bob = body("Bob", new Vector3(3, 0, 0));
        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;
        joint.distance = 1;
        joint.stiffness = 80;

        joint.enabled = false;
        joint.enabled = true;
        const before = bob.transform.position.x;
        step(30);

        expect(joint.isActive).toBe(true);
        expect(bob.transform.position.x).toBeLessThan(before);
    });

    test("damping is clamped at zero, like the other two", () => {
        const bob = body("Bob", new Vector3(0, 0, 0));
        const joint = bob.gameObject.addComponent(SpringJoint);

        joint.damping = -4;

        expect(joint.damping).toBe(0);
    });

    test("changing damping while attached reaches the live spring", () => {
        const anchor = body("Anchor", new Vector3(0, 0, 0));
        const bob = body("Bob", new Vector3(2, 0, 0));
        const joint = bob.gameObject.addComponent(SpringJoint);
        joint.connectedBody = anchor;

        joint.damping = 7;

        expect(joint.damping).toBe(7);
        expect(joint.isActive).toBe(true);
    });
});
