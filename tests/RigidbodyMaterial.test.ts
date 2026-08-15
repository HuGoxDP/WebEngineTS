import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { PhysicMaterial } from "../src/engine/physics/PhysicMaterial";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * A PhysicMaterial does nothing until the world has a ContactMaterial pairing
 * for it — the class says so, and `Collider.sharedMaterial` registers one.
 * `Rigidbody.material` did not, so the same material was live on a collider and
 * inert on a body. It was also write-only. Audit part 5, F32.
 */

const made: GameObject[] = [];

function body(name = "Body"): Rigidbody {
    const go = new GameObject(name);
    made.push(go);
    return go.addComponent(Rigidbody);
}

/** Whether the solver has a pairing to read this material's numbers from. */
function isPaired(material: PhysicMaterial): boolean {
    const world = PhysicsWorld.instance.world;
    return world.getContactMaterial(material._cannonMaterial, material._cannonMaterial) != null;
}

beforeEach(() => {
    PhysicsWorld._reset();
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    PhysicsWorld._reset();
});

describe("Rigidbody.material", () => {
    test("registers the material, so the solver can read it", () => {
        const bouncy = new PhysicMaterial(0.2, 0.9);
        const rb = body();

        rb.material = bouncy;

        expect(isPaired(bouncy)).toBe(true);
    });

    test("reads back what was assigned", () => {
        const ice = new PhysicMaterial(0.02, 0);
        const rb = body();

        rb.material = ice;

        expect(rb.material).toBe(ice);
    });

    test("starts empty and can be cleared", () => {
        const rb = body();
        expect(rb.material).toBeNull();

        rb.material = new PhysicMaterial(0.5, 0.5);
        rb.material = null;

        expect(rb.material).toBeNull();
        expect(rb._body.material).toBeNull();
    });

    test("the pairing carries the material's numbers", () => {
        const bouncy = new PhysicMaterial(0.3, 0.8);
        const rb = body();

        rb.material = bouncy;

        const pairing = PhysicsWorld.instance.world.getContactMaterial(
            bouncy._cannonMaterial, bouncy._cannonMaterial,
        )!;
        expect(pairing.restitution).toBeCloseTo(0.8);
        expect(pairing.friction).toBeCloseTo(0.3);
    });

    test("a later change to the material reaches the solver", () => {
        // PhysicMaterial refreshes its pairings; this only works if one exists.
        const material = new PhysicMaterial(0.4, 0);
        const rb = body();
        rb.material = material;

        material.bounciness = 0.6;

        const pairing = PhysicsWorld.instance.world.getContactMaterial(
            material._cannonMaterial, material._cannonMaterial,
        )!;
        expect(pairing.restitution).toBeCloseTo(0.6);
    });

    test("two bodies sharing a material are paired once", () => {
        const shared = new PhysicMaterial(0.5, 0.5);
        const before = PhysicsWorld.instance.world.contactmaterials.length;

        body("A").material = shared;
        body("B").material = shared;

        expect(PhysicsWorld.instance.world.contactmaterials.length).toBe(before + 1);
    });
});
