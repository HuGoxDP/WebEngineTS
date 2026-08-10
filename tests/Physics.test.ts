import { describe, test, expect, beforeEach } from "vitest";
import * as CANNON from "cannon-es";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
import { LayerCollisionMatrix } from "../src/engine/physics/LayerCollisionMatrix";
import { PhysicMaterial } from "../src/engine/physics/PhysicMaterial";
import { Collision, ContactPoint } from "../src/engine/physics/Collision";
import { ForceMode, RigidbodyConstraints } from "../src/engine/physics/Rigidbody";
import { Vector3 } from "../src/engine/core/math/Vector3";

describe("PhysicsWorld", () => {
    beforeEach(() => {
        PhysicsWorld._reset();
    });

    test("singleton returns same instance", () => {
        const a = PhysicsWorld.instance;
        const b = PhysicsWorld.instance;
        expect(a).toBe(b);
    });

    test("default gravity is (0, -9.81, 0)", () => {
        const g = PhysicsWorld.instance.gravity;
        expect(g.x).toBe(0);
        expect(g.y).toBeCloseTo(-9.81);
        expect(g.z).toBe(0);
    });

    test("gravity can be changed", () => {
        PhysicsWorld.instance.gravity = new Vector3(0, -20, 0);
        const g = PhysicsWorld.instance.gravity;
        expect(g.y).toBeCloseTo(-20);
    });

    test("reset creates a new instance", () => {
        const a = PhysicsWorld.instance;
        PhysicsWorld._reset();
        const b = PhysicsWorld.instance;
        expect(a).not.toBe(b);
    });

    test("step advances simulation", () => {
        const world = PhysicsWorld.instance.world;
        const body = new CANNON.Body({ mass: 1, type: CANNON.Body.DYNAMIC });
        body.position.set(0, 10, 0);
        world.addBody(body);

        PhysicsWorld.instance.step(1 / 50);

        // Body should have fallen due to gravity
        expect(body.position.y).toBeLessThan(10);
    });
});

describe("PhysicMaterial", () => {
    test("default values", () => {
        const mat = new PhysicMaterial();
        expect(mat.friction).toBeCloseTo(0.4);
        expect(mat.bounciness).toBeCloseTo(0);
    });

    test("custom values", () => {
        const mat = new PhysicMaterial(0.8, 0.5);
        expect(mat.friction).toBeCloseTo(0.8);
        expect(mat.bounciness).toBeCloseTo(0.5);
    });

    test("property changes update cannon material", () => {
        const mat = new PhysicMaterial();
        mat.friction = 0.9;
        mat.bounciness = 1.0;
        expect(mat._cannonMaterial.friction).toBeCloseTo(0.9);
        expect(mat._cannonMaterial.restitution).toBeCloseTo(1.0);
    });
});

describe("Collision", () => {
    test("ContactPoint stores point and normal", () => {
        const cp = new ContactPoint(
            new Vector3(1, 2, 3),
            new Vector3(0, 1, 0)
        );
        expect(cp.point.x).toBe(1);
        expect(cp.point.y).toBe(2);
        expect(cp.point.z).toBe(3);
        expect(cp.normal.y).toBe(1);
    });
});

describe("ForceMode enum", () => {
    test("enum values are distinct", () => {
        expect(ForceMode.Force).toBe(0);
        expect(ForceMode.VelocityChange).toBe(1);
        expect(ForceMode.Impulse).toBe(2);
        expect(ForceMode.Acceleration).toBe(3);
    });
});

describe("RigidbodyConstraints", () => {
    test("FreezePosition combines X Y Z", () => {
        expect(RigidbodyConstraints.FreezePosition).toBe(
            RigidbodyConstraints.FreezePositionX |
            RigidbodyConstraints.FreezePositionY |
            RigidbodyConstraints.FreezePositionZ
        );
    });

    test("FreezeAll combines position and rotation", () => {
        expect(RigidbodyConstraints.FreezeAll).toBe(
            RigidbodyConstraints.FreezePosition |
            RigidbodyConstraints.FreezeRotation
        );
    });
});

describe("cannon-es body simulation", () => {
    beforeEach(() => {
        PhysicsWorld._reset();
    });

    test("dynamic body falls under gravity", () => {
        const world = PhysicsWorld.instance.world;
        const body = new CANNON.Body({
            mass: 1,
            shape: new CANNON.Sphere(0.5),
            position: new CANNON.Vec3(0, 10, 0),
        });
        world.addBody(body);

        // Step 10 times at 50Hz
        for (let i = 0; i < 10; i++) {
            world.step(1 / 50);
        }

        expect(body.position.y).toBeLessThan(10);
        expect(body.velocity.y).toBeLessThan(0);
    });

    test("static body does not move", () => {
        const world = PhysicsWorld.instance.world;
        const body = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            shape: new CANNON.Box(new CANNON.Vec3(5, 0.5, 5)),
            position: new CANNON.Vec3(0, 0, 0),
        });
        world.addBody(body);

        world.step(1 / 50);

        expect(body.position.y).toBe(0);
    });

    test("two bodies collide and produce contacts", () => {
        const world = PhysicsWorld.instance.world;

        // Floor
        const floor = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            shape: new CANNON.Box(new CANNON.Vec3(5, 0.5, 5)),
            position: new CANNON.Vec3(0, -0.5, 0),
        });
        world.addBody(floor);

        // Falling ball
        const ball = new CANNON.Body({
            mass: 1,
            shape: new CANNON.Sphere(0.5),
            position: new CANNON.Vec3(0, 0.5, 0),
        });
        world.addBody(ball);

        // Step enough for ball to reach floor
        for (let i = 0; i < 100; i++) {
            world.step(1 / 50);
        }

        // Ball should be resting on floor (y ~ 0.5, on top of floor at y=0)
        expect(ball.position.y).toBeCloseTo(0.5, 0);
    });

    test("impulse changes velocity immediately", () => {
        const world = PhysicsWorld.instance.world;
        world.gravity.set(0, 0, 0); // no gravity for this test

        const body = new CANNON.Body({
            mass: 1,
            shape: new CANNON.Sphere(0.5),
        });
        world.addBody(body);

        body.applyImpulse(new CANNON.Vec3(10, 0, 0));
        world.step(1 / 50);

        expect(body.velocity.x).toBeCloseTo(10, 0);
    });

    test("kinematic body does not fall", () => {
        const world = PhysicsWorld.instance.world;

        const body = new CANNON.Body({
            mass: 1,
            type: CANNON.Body.KINEMATIC,
            shape: new CANNON.Sphere(0.5),
            position: new CANNON.Vec3(0, 5, 0),
        });
        world.addBody(body);

        for (let i = 0; i < 10; i++) {
            world.step(1 / 50);
        }

        expect(body.position.y).toBeCloseTo(5);
    });
});

// ---------------------------------------------------------------------------
// Layer collision matrix (unity-parity Stage 5)
// ---------------------------------------------------------------------------

describe("LayerCollisionMatrix", () => {
    beforeEach(() => {
        PhysicsWorld._reset();
        LayerCollisionMatrix.reset();
    });

    test("every layer collides with every other by default", () => {
        expect(LayerCollisionMatrix.collides(0, 1)).toBe(true);
        expect(LayerCollisionMatrix.collides(5, 5)).toBe(true);
        expect(LayerCollisionMatrix.maskFor(0)).toBe(~0 >>> 0);
    });

    test("ignoring a pair is symmetric", () => {
        LayerCollisionMatrix.ignoreLayerCollision(1, 2);

        // A one-way collision is not something a solver can express: the pair
        // would collide or not depending on which body it looked at first.
        expect(LayerCollisionMatrix.collides(1, 2)).toBe(false);
        expect(LayerCollisionMatrix.collides(2, 1)).toBe(false);
    });

    test("ignoring one pair leaves the others alone", () => {
        LayerCollisionMatrix.ignoreLayerCollision(1, 2);

        expect(LayerCollisionMatrix.collides(1, 3)).toBe(true);
        expect(LayerCollisionMatrix.collides(0, 2)).toBe(true);
        expect(LayerCollisionMatrix.collides(1, 1)).toBe(true);
    });

    test("a layer can be made to ignore itself", () => {
        LayerCollisionMatrix.ignoreLayerCollision(4, 4);

        expect(LayerCollisionMatrix.collides(4, 4)).toBe(false);
        expect(LayerCollisionMatrix.collides(4, 5)).toBe(true);
    });

    test("ignoring can be undone", () => {
        LayerCollisionMatrix.ignoreLayerCollision(1, 2);
        LayerCollisionMatrix.ignoreLayerCollision(1, 2, false);

        expect(LayerCollisionMatrix.collides(1, 2)).toBe(true);
    });

    test("the mask lists exactly the layers that collide", () => {
        LayerCollisionMatrix.ignoreLayerCollision(0, 1);
        LayerCollisionMatrix.ignoreLayerCollision(0, 3);

        const mask = LayerCollisionMatrix.maskFor(0);

        expect(mask & (1 << 1)).toBe(0);
        expect(mask & (1 << 3)).toBe(0);
        expect(mask & (1 << 2)).not.toBe(0);
    });

    test("an out-of-range layer is refused rather than corrupting the table", () => {
        LayerCollisionMatrix.ignoreLayerCollision(-1, 0);
        LayerCollisionMatrix.ignoreLayerCollision(0, 99);

        expect(LayerCollisionMatrix.collides(0, 1)).toBe(true);
        expect(LayerCollisionMatrix.collides(0, 99)).toBe(false);
        expect(LayerCollisionMatrix.maskFor(99)).toBe(~0 >>> 0);
    });

    test("reset restores the fully permissive default", () => {
        LayerCollisionMatrix.ignoreLayerCollision(1, 2);
        LayerCollisionMatrix.reset();

        expect(LayerCollisionMatrix.collides(1, 2)).toBe(true);
    });

    test("it covers 32 layers, the width of the filter bitmask", () => {
        expect(LayerCollisionMatrix.layerCount).toBe(32);
        expect(LayerCollisionMatrix.collides(31, 31)).toBe(true);
    });
});
