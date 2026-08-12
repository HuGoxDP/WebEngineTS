import * as CANNON from "cannon-es";
import { EngineSettings } from "../core/EngineSettings";
import { Vector3 } from "../core/math/Vector3";
import type { Rigidbody } from "./Rigidbody";
import type { PhysicMaterial } from "./PhysicMaterial";

/**
 * @internal
 * Singleton wrapper around the cannon-es physics world.
 * Manages the simulation lifecycle and provides engine-level access.
 */
export class PhysicsWorld {
    private static _instance: PhysicsWorld | null = null;
    private _world: CANNON.World;

    /** @internal All registered rigidbodies. */
    public readonly _rigidbodies: Rigidbody[] = [];

    /** Materials already paired into the world, so a repeat is cheap. */
    private readonly _materials: PhysicMaterial[] = [];

    private constructor() {
        this._world = new CANNON.World();
        this._world.gravity.set(0, EngineSettings.Physics.GRAVITY, 0);
        (this._world.solver as CANNON.GSSolver).iterations = EngineSettings.Physics.DEFAULT_SOLVER_ITERATIONS;
        this._world.broadphase = new CANNON.SAPBroadphase(this._world);
        this._world.allowSleep = true;
    }

    /** @internal Gets or creates the singleton physics world. */
    public static get instance(): PhysicsWorld {
        if (!this._instance) {
            this._instance = new PhysicsWorld();
        }
        return this._instance;
    }

    /** @internal The underlying cannon-es world. */
    public get world(): CANNON.World {
        return this._world;
    }

    /** Global gravity vector. */
    public get gravity(): Vector3 {
        const g = this._world.gravity;
        return new Vector3(g.x, g.y, g.z);
    }

    public set gravity(value: Vector3) {
        this._world.gravity.set(value.x, value.y, value.z);
    }

    /**
     * @internal
     * Steps the physics simulation by the given time delta.
     * Called from Application._loop() inside the FixedUpdate accumulator.
     */
    public step(dt: number): void {
        this._world.step(dt);
    }

    /**
     * @internal
     * Brings a physics material into the simulation.
     *
     * @remarks
     * **A material on its own does nothing.** cannon reads friction and
     * restitution from a `ContactMaterial` registered for the *pair* of
     * materials in contact; without one it falls through to
     * `defaultContactMaterial`, which is why setting `PhysicMaterial.friction`
     * used to have no observable effect at all.
     *
     * So every material is paired with each one already known, and with itself
     * — two objects sharing a material still need a pairing. The count is
     * quadratic in *distinct materials*, which is a handful in practice, not in
     * colliders.
     *
     * **NEVER use in user-facing code.**
     */
    public _registerMaterial(material: PhysicMaterial): void {
        if (this._materials.indexOf(material) !== -1) return;

        for (const other of this._materials) {
            this._pair(material, other);
        }
        this._pair(material, material);
        this._materials.push(material);
    }

    /** Creates and registers one pairing, combining by average (Unity's default). */
    private _pair(a: PhysicMaterial, b: PhysicMaterial): void {
        const contact = new CANNON.ContactMaterial(a._cannonMaterial, b._cannonMaterial, {
            friction: (a.friction + b.friction) / 2,
            restitution: (a.bounciness + b.bounciness) / 2,
        });
        this._world.addContactMaterial(contact);
        a._addContact(contact);
        if (b !== a) b._addContact(contact);
    }

    /**
     * Friction used when a contact involves a collider with no material.
     *
     * @remarks
     * cannon's own default is 0.3. A collider without a `PhysicMaterial` has no
     * pairing to consult, so this is what it gets.
     */
    public get defaultFriction(): number {
        return this._world.defaultContactMaterial.friction;
    }

    public set defaultFriction(value: number) {
        this._world.defaultContactMaterial.friction = value;
    }

    /** Bounciness used when a contact involves a collider with no material. */
    public get defaultBounciness(): number {
        return this._world.defaultContactMaterial.restitution;
    }

    public set defaultBounciness(value: number) {
        this._world.defaultContactMaterial.restitution = value;
    }

    /** @internal Registers a rigidbody for sync tracking. */
    public _registerRigidbody(rb: Rigidbody): void {
        if (this._rigidbodies.indexOf(rb) === -1) {
            this._rigidbodies.push(rb);
        }
    }

    /** @internal Unregisters a rigidbody. */
    public _unregisterRigidbody(rb: Rigidbody): void {
        const idx = this._rigidbodies.indexOf(rb);
        if (idx > -1) {
            this._rigidbodies.splice(idx, 1);
        }
    }

    /** @internal Resets the physics world (e.g., on scene unload). */
    public static _reset(): void {
        if (this._instance) {
            this._instance._rigidbodies.length = 0;
            this._instance._world.bodies.length = 0;
            // The contact materials die with the world; a material that
            // outlives it must not keep pointing at them, or a later friction
            // change would write into a solver nothing steps any more.
            for (const material of this._instance._materials) {
                material._clearContacts();
            }
            this._instance._materials.length = 0;
            this._instance = null;
        }
    }
}
