import * as CANNON from "cannon-es";
import { Behaviour } from "../core/Behaviour";
import { Vector3 } from "../core/math/Vector3";
import { Quaternion } from "../core/math/Quaternion";
import { PhysicsWorld } from "./PhysicsWorld";
import type { PhysicMaterial } from "./PhysicMaterial";
import { Serializable, SerializedField } from "../core/reflection/Decorators";
import { FieldType } from "../core/reflection/Types";
import type { GameObject } from "../core/GameObject";

/**
 * Defines how forces affect the position of a {@link Rigidbody}.
 */
export enum ForceMode {
    /** Add a continuous force, using mass. */
    Force = 0,
    /** Add an instant velocity change, ignoring mass. */
    VelocityChange = 1,
    /** Add an instant force impulse, using mass. */
    Impulse = 2,
    /** Add a continuous acceleration, ignoring mass. */
    Acceleration = 3,
}

/**
 * Flags for constraining Rigidbody motion.
 */
export enum RigidbodyConstraints {
    None = 0,
    FreezePositionX = 1 << 0,
    FreezePositionY = 1 << 1,
    FreezePositionZ = 1 << 2,
    FreezeRotationX = 1 << 3,
    FreezeRotationY = 1 << 4,
    FreezeRotationZ = 1 << 5,
    FreezePosition = FreezePositionX | FreezePositionY | FreezePositionZ,
    FreezeRotation = FreezeRotationX | FreezeRotationY | FreezeRotationZ,
    FreezeAll = FreezePosition | FreezeRotation,
}

/**
 * Controls the physics simulation for a GameObject.
 *
 * @remarks
 * Equivalent to Unity's `Rigidbody`.
 * Attach to a GameObject along with one or more {@link Collider} components
 * to enable physics-driven motion.
 */
@Serializable({ typeName: "Rigidbody", category: "Physics" })
export class Rigidbody extends Behaviour {
    /** @internal The cannon-es body. */
    public _body: CANNON.Body;

    private _isKinematic: boolean = false;
    private _useGravity: boolean = true;
    private _constraints: RigidbodyConstraints = RigidbodyConstraints.None;

    private static _tmpVec = new CANNON.Vec3();

    constructor(gameObject: GameObject) {
        super(gameObject);
        this._body = new CANNON.Body({ mass: 1, type: CANNON.Body.DYNAMIC });
        this._body.userData = { rigidbody: this };
    }

    // ==================== PROPERTIES ====================

    /** Mass of the rigidbody in kilograms. */
    @SerializedField()
    public get mass(): number { return this._body.mass; }
    public set mass(value: number) {
        this._body.mass = value;
        this._body.updateMassProperties();
    }

    /** Drag coefficient applied to linear velocity each step. */
    @SerializedField()
    public get drag(): number { return this._body.linearDamping; }
    public set drag(value: number) { this._body.linearDamping = value; }

    /** Drag coefficient applied to angular velocity each step. */
    @SerializedField()
    public get angularDrag(): number { return this._body.angularDamping; }
    public set angularDrag(value: number) { this._body.angularDamping = value; }

    /** If true, the body is not affected by forces but can be moved via Transform. */
    @SerializedField()
    public get isKinematic(): boolean { return this._isKinematic; }
    public set isKinematic(value: boolean) {
        this._isKinematic = value;
        this._body.type = value ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
        this._body.updateMassProperties();
    }

    /**
     * Whether this body is affected by gravity.
     *
     * @remarks
     * cannon-es has no per-body gravity switch, so `false` is implemented by
     * applying an equal and opposite force before every step — see
     * {@link _applyGravityCompensation}, which `Physics._step` drives.
     */
    @SerializedField()
    public get useGravity(): boolean { return this._useGravity; }
    public set useGravity(value: boolean) {
        this._useGravity = value;
    }

    /** The velocity of the rigidbody in world space (units/second). */
    public get velocity(): Vector3 {
        const v = this._body.velocity;
        return new Vector3(v.x, v.y, v.z);
    }

    public set velocity(value: Vector3) {
        this._body.velocity.set(value.x, value.y, value.z);
    }

    /** The angular velocity of the rigidbody (radians/second). */
    public get angularVelocity(): Vector3 {
        const v = this._body.angularVelocity;
        return new Vector3(v.x, v.y, v.z);
    }

    public set angularVelocity(value: Vector3) {
        this._body.angularVelocity.set(value.x, value.y, value.z);
    }

    /** Constraints on the rigidbody's position and rotation. */
    @SerializedField({ type: FieldType.Enum, enumValues: RigidbodyConstraints as unknown as Record<string, number> })
    public get constraints(): RigidbodyConstraints { return this._constraints; }
    public set constraints(value: RigidbodyConstraints) {
        this._constraints = value;
        this._applyConstraints();
    }

    /** The physics material for this rigidbody's collisions. */
    public set material(value: PhysicMaterial | null) {
        this._body.material = value ? value._cannonMaterial : null;
    }

    // ==================== METHODS ====================

    /**
     * Adds a force to the rigidbody.
     * @param force Force vector in world space.
     * @param mode How the force is applied.
     */
    public addForce(force: Vector3, mode: ForceMode = ForceMode.Force): void {
        Rigidbody._tmpVec.set(force.x, force.y, force.z);
        switch (mode) {
            case ForceMode.Force:
                this._body.applyForce(Rigidbody._tmpVec);
                break;
            case ForceMode.Impulse:
                this._body.applyImpulse(Rigidbody._tmpVec);
                break;
            case ForceMode.VelocityChange:
                this._body.velocity.vadd(Rigidbody._tmpVec, this._body.velocity);
                break;
            case ForceMode.Acceleration:
                Rigidbody._tmpVec.scale(this._body.mass, Rigidbody._tmpVec);
                this._body.applyForce(Rigidbody._tmpVec);
                break;
        }
    }

    /**
     * Adds a torque to the rigidbody.
     * @param torque Torque vector in world space.
     */
    public addTorque(torque: Vector3): void {
        Rigidbody._tmpVec.set(torque.x, torque.y, torque.z);
        this._body.applyTorque(Rigidbody._tmpVec);
    }

    /**
     * Adds a force at a specific world position.
     * @param force Force vector in world space.
     * @param position World-space position where the force is applied.
     */
    public addForceAtPosition(force: Vector3, position: Vector3): void {
        const f = new CANNON.Vec3(force.x, force.y, force.z);
        const p = new CANNON.Vec3(position.x, position.y, position.z);
        this._body.applyForce(f, p);
    }

    /** Puts the rigidbody to sleep. */
    public sleep(): void {
        this._body.sleep();
    }

    /** Wakes the rigidbody from sleep. */
    public wakeUp(): void {
        this._body.wakeUp();
    }

    /** Whether the rigidbody is currently sleeping. */
    public get isSleeping(): boolean {
        return this._body.sleepState === CANNON.Body.SLEEPING;
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Called when a Rigidbody is enabled, so the colliders already on its
     * GameObject can move onto its body.
     *
     * @remarks
     * A callback rather than an import: `Collider` already imports `Rigidbody`,
     * and importing back would make the pair circular. `Collider` installs this
     * at module load, the same way `Physics` installs
     * `LayerCollisionMatrix._setChangeHandler`.
     */
    public static _onEnabled: ((gameObject: GameObject) => void) | null = null;

    protected override onAwake(): void {
        this._syncTransformToBody();
    }

    protected override onEnable(): void {
        const pw = PhysicsWorld.instance;
        pw.world.addBody(this._body);
        pw._registerRigidbody(this);
        this._syncTransformToBody();

        // Colliders added before this Rigidbody each built their own static
        // body, and this one would otherwise have no shapes at all — a body
        // that collides with nothing, silently. Unity has no such ordering
        // rule, so neither should this.
        Rigidbody._onEnabled?.(this.gameObject);
    }

    protected override onDisable(): void {
        const pw = PhysicsWorld.instance;
        pw.world.removeBody(this._body);
        pw._unregisterRigidbody(this);
    }

    // ==================== INTERNAL ====================

    /**
     * @internal
     * Copies engine Transform world position/rotation → cannon-es body.
     * Called before physics step.
     */
    public _syncTransformToBody(): void {
        const pos = this.transform.position;
        this._body.position.set(pos.x, pos.y, pos.z);

        const rot = this.transform.rotation;
        this._body.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    /**
     * @internal
     * Cancels world gravity for this body, for the step about to run.
     *
     * @remarks
     * cannon applies gravity inside `world.step` and clears every force at the
     * end of it, so the counter-force has to be re-applied before each step —
     * which is why it lives here, driven by `Physics._step`, and not in
     * {@link _syncTransformToBody}. It used to sit in that method, which the
     * step calls for **kinematic** bodies only, and which then required the body
     * to be **dynamic**: two conditions that cannot both hold, so `useGravity`
     * did nothing at all once the first frame had passed.
     *
     * No-op unless the body is dynamic and has `useGravity` off.
     */
    public _applyGravityCompensation(): void {
        if (this._useGravity || this._body.type !== CANNON.Body.DYNAMIC) return;

        const g = PhysicsWorld.instance.world.gravity;
        Rigidbody._tmpVec.set(
            -g.x * this._body.mass,
            -g.y * this._body.mass,
            -g.z * this._body.mass,
        );
        this._body.applyForce(Rigidbody._tmpVec);
    }

    /**
     * @internal
     * Copies cannon-es body position/rotation → engine Transform.
     * Called after physics step for dynamic (non-kinematic) bodies.
     */
    public _syncBodyToTransform(): void {
        if (this._isKinematic) return;

        const p = this._body.position;
        const q = this._body.quaternion;
        this.transform.position = new Vector3(p.x, p.y, p.z);
        this.transform.rotation = new Quaternion(q.x, q.y, q.z, q.w);
    }

    private _applyConstraints(): void {
        const c = this._constraints;
        // cannon-es uses linearFactor/angularFactor for axis locks
        this._body.linearFactor.set(
            (c & RigidbodyConstraints.FreezePositionX) ? 0 : 1,
            (c & RigidbodyConstraints.FreezePositionY) ? 0 : 1,
            (c & RigidbodyConstraints.FreezePositionZ) ? 0 : 1,
        );
        this._body.angularFactor.set(
            (c & RigidbodyConstraints.FreezeRotationX) ? 0 : 1,
            (c & RigidbodyConstraints.FreezeRotationY) ? 0 : 1,
            (c & RigidbodyConstraints.FreezeRotationZ) ? 0 : 1,
        );
    }
}
