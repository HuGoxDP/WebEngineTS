import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { PhysicMaterial } from "../src/engine/physics/PhysicMaterial";
import { Physics } from "../src/engine/physics/Physics";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";

/**
 * cannon reads friction and restitution from a ContactMaterial registered for
 * the *pair* of materials in contact, never from a material on its own. The
 * engine used to register none, so every contact fell through to
 * world.defaultContactMaterial and setting PhysicMaterial.friction changed
 * nothing at all — the API looked like it worked. Reported from
 * ScenarioCreator (docs/ENGINE-GAPS.md §1) against 0.1.0-local.1786479071411.
 */

/** The contact material cannon would use for a pair, or null if none exists. */
function contactFor(a: PhysicMaterial, b: PhysicMaterial) {
    return PhysicsWorld.instance.world.getContactMaterial(
        a._cannonMaterial, b._cannonMaterial,
    ) ?? null;
}

function colliderWith(material: PhysicMaterial): BoxCollider {
    const collider = new GameObject("Body").addComponent(BoxCollider);
    collider.sharedMaterial = material;
    return collider;
}

afterEach(() => {
    Physics._reset();
});

describe("PhysicMaterial — reaching the solver", () => {
    test("assigning a material registers a pairing the solver can find", () => {
        const material = new PhysicMaterial(0.9, 0.1);

        colliderWith(material);

        // Two objects of the same material still need a pairing of their own.
        const contact = contactFor(material, material);
        expect(contact).not.toBeNull();
        expect(contact!.friction).toBeCloseTo(0.9, 6);
        expect(contact!.restitution).toBeCloseTo(0.1, 6);
    });

    test("two materials are paired with each other, combined by average", () => {
        // Average is Unity's default frictionCombine / bounceCombine.
        const ice = new PhysicMaterial(0.1, 0);
        const rubber = new PhysicMaterial(0.9, 0.8);

        colliderWith(ice);
        colliderWith(rubber);

        const contact = contactFor(ice, rubber);
        expect(contact).not.toBeNull();
        expect(contact!.friction).toBeCloseTo(0.5, 6);
        expect(contact!.restitution).toBeCloseTo(0.4, 6);
    });

    test("changing friction afterwards reaches the pairing", () => {
        // This is the case the report was written about: a slider driving
        // friction moved and changed nothing.
        const ramp = new PhysicMaterial(0.2, 0);
        const block = new PhysicMaterial(0.2, 0);
        colliderWith(ramp);
        colliderWith(block);

        ramp.friction = 0.8;

        expect(contactFor(ramp, block)!.friction).toBeCloseTo(0.5, 6);
        expect(contactFor(ramp, ramp)!.friction).toBeCloseTo(0.8, 6);
    });

    test("changing bounciness afterwards reaches the pairing", () => {
        const a = new PhysicMaterial(0.4, 0);
        const b = new PhysicMaterial(0.4, 0);
        colliderWith(a);
        colliderWith(b);

        a.bounciness = 1;

        expect(contactFor(a, b)!.restitution).toBeCloseTo(0.5, 6);
    });

    test("a material assigned twice does not accumulate pairings", () => {
        const material = new PhysicMaterial(0.5, 0);
        colliderWith(material);
        const before = PhysicsWorld.instance.world.contactmaterials.length;

        colliderWith(material);

        expect(PhysicsWorld.instance.world.contactmaterials.length).toBe(before);
    });

    test("a material used again after a world reset is re-registered", () => {
        // The contact materials die with the world; a material outliving it
        // must not keep writing into a solver nothing steps any more.
        const material = new PhysicMaterial(0.7, 0);
        colliderWith(material);

        Physics._reset();
        colliderWith(material);

        const contact = contactFor(material, material);
        expect(contact).not.toBeNull();
        expect(contact!.friction).toBeCloseTo(0.7, 6);
    });
});

describe("Physics — the default surface", () => {
    test("a contact with no material lands on the world default", () => {
        expect(Physics.defaultFriction).toBeCloseTo(0.3, 6);
        expect(Physics.defaultBounciness).toBeCloseTo(0, 6);
    });

    test("the default is settable, so a scene can have a house surface", () => {
        Physics.defaultFriction = 0.85;
        Physics.defaultBounciness = 0.25;

        expect(Physics.defaultFriction).toBeCloseTo(0.85, 6);
        expect(Physics.defaultBounciness).toBeCloseTo(0.25, 6);
    });
});
