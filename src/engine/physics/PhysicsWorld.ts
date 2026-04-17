import * as CANNON from "cannon-es";
import { EngineSettings } from "../core/EngineSettings";
import { Vector3 } from "../core/math/Vector3";
import type { Rigidbody } from "./Rigidbody";

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
            this._instance = null;
        }
    }
}
