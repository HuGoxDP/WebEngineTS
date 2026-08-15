import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { Physics } from "../src/engine/physics/Physics";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * `useGravity = false` did nothing after the first frame. The counter-force
 * lived in `_syncTransformToBody`, which the step calls for **kinematic**
 * bodies only, and the branch inside it required the body to be **dynamic** —
 * two conditions that cannot both hold. Audit part 5, F26.
 */

const made: GameObject[] = [];

function bodyAt(y: number): Rigidbody {
    const go = new GameObject("Body");
    go.transform.position = new Vector3(0, y, 0);
    made.push(go);
    return go.addComponent(Rigidbody);
}

/** Steps the simulation the way Application._loop does. */
function simulate(steps: number, dt = 1 / 60): void {
    for (let i = 0; i < steps; i++) Physics._step(dt);
}

beforeEach(() => {
    PhysicsWorld._reset();
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    PhysicsWorld._reset();
});

describe("Rigidbody.useGravity", () => {
    test("false keeps the body where it is, second after second", () => {
        const rb = bodyAt(10);
        rb.useGravity = false;

        simulate(120);

        expect(rb.velocity.y).toBeCloseTo(0, 3);
        expect(rb.gameObject.transform.position.y).toBeCloseTo(10, 3);
    });

    test("true still falls", () => {
        const rb = bodyAt(10);

        simulate(60);

        expect(rb.velocity.y).toBeLessThan(-5);
        expect(rb.gameObject.transform.position.y).toBeLessThan(9);
    });

    test("turning it off mid-flight stops the acceleration, not the motion", () => {
        // Unity's semantics: gravity stops acting; whatever velocity the body
        // already had is still its own.
        const rb = bodyAt(10);
        // Drag off: cannon damps velocity every step by default, and this test
        // is about gravity, not about how fast the air slows the body down.
        rb.drag = 0;
        simulate(30);
        const falling = rb.velocity.y;
        expect(falling).toBeLessThan(0);

        rb.useGravity = false;
        simulate(30);

        expect(rb.velocity.y).toBeCloseTo(falling, 3);
    });

    test("turning it back on resumes falling", () => {
        const rb = bodyAt(10);
        rb.useGravity = false;
        simulate(30);
        expect(rb.velocity.y).toBeCloseTo(0, 3);

        rb.useGravity = true;
        simulate(30);

        expect(rb.velocity.y).toBeLessThan(-4);
    });

    test("it holds against a non-default gravity too", () => {
        PhysicsWorld.instance.gravity = new Vector3(3, -20, 0);
        const rb = bodyAt(10);
        rb.useGravity = false;

        simulate(60);

        expect(rb.velocity.y).toBeCloseTo(0, 3);
        expect(rb.velocity.x).toBeCloseTo(0, 3);
    });

    test("a heavier body is held just as still", () => {
        // The counter-force scales with mass, as gravity does.
        const rb = bodyAt(10);
        rb.mass = 50;
        rb.useGravity = false;

        simulate(60);

        expect(rb.velocity.y).toBeCloseTo(0, 3);
    });
});
