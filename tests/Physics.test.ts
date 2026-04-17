import { describe, test, expect, beforeEach } from "vitest";
import * as CANNON from "cannon-es";
import { PhysicsWorld } from "../src/engine/physics/PhysicsWorld";
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
