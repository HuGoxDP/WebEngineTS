import * as CANNON from "cannon-es";
import { Behaviour } from "../core/Behaviour";
import { Vector3 } from "../core/math/Vector3";
import { Rigidbody } from "./Rigidbody";
import { PhysicsWorld } from "./PhysicsWorld";
import { Serializable, SerializedField } from "../core/reflection/Decorators";
import { FieldType } from "../core/reflection/Types";
import type { GameObject } from "../core/GameObject";

/**
 * Base for the joints that tie two bodies together.
 *
 * @remarks
 * Equivalent to Unity's `Joint`. A joint needs a {@link Rigidbody} on its own
 * GameObject; {@link connectedBody} is the other end, and leaving it null
 * anchors the joint to the world, which is how a swinging sign or a hinged door
 * frame is built.
 *
 * The constraint is created when the component is enabled and removed when it
 * is disabled, so toggling a joint off genuinely releases it rather than
 * leaving a solved-but-ignored constraint in the world.
 *
 * Subclasses decide what kind of constraint that is; everything about *when* it
 * exists lives here.
 */
export abstract class Joint extends Behaviour {

    /**
     * The body at the other end, or null to anchor to the world.
     *
     * @remarks
     * Equivalent to Unity's `Joint.connectedBody`. Changing it rebuilds the
     * constraint, so it can be re-targeted at runtime.
     */
    @SerializedField({ type: FieldType.Component })
    public get connectedBody(): Rigidbody | null { return this._connectedBody; }

    public set connectedBody(value: Rigidbody | null) {
        if (this._connectedBody === value) return;
        this._connectedBody = value;
        this._rebuild();
    }

    private _connectedBody: Rigidbody | null = null;
    private _constraint: CANNON.Constraint | null = null;
    private _attached: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Whether the joint is currently solving. */
    public get isActive(): boolean { return this._attached; }

    /**
     * Removes this joint.
     *
     * @remarks
     * Equivalent to destroying the component in Unity. The bodies keep whatever
     * velocity they had — breaking a joint should not also stop what it held.
     */
    public breakJoint(): void {
        this._teardown();
    }

    protected override onEnable(): void {
        this._rebuild();
    }

    protected override onDisable(): void {
        this._teardown();
    }

    protected override onDestroy(): void {
        this._teardown();
    }

    /**
     * Builds the cannon-es constraint for this joint kind.
     *
     * @param self - the body on this GameObject.
     * @param other - the body at the other end, or the world's static body.
     * @returns the constraint, or null if this joint cannot be built.
     */
    protected abstract _createConstraint(
        self: CANNON.Body,
        other: CANNON.Body,
    ): CANNON.Constraint | null;

    /** @internal Recreates the constraint after a property changed. */
    protected _rebuild(): void {
        this._teardown();
        if (!this.isActiveAndEnabled) return;

        const own = this.gameObject.getComponent(Rigidbody);
        const self = own?._body ?? null;
        if (!self) {
            console.warn(`[${this.constructor.name}] needs a Rigidbody on the same GameObject.`);
            return;
        }

        // A joint's geometry is expressed relative to where the bodies *are*,
        // and a body only reaches its transform's position when its own
        // onEnable runs. Component order is not something a scenario author
        // should have to think about, so both ends are brought up to date here.
        own!._syncTransformToBody();
        this._connectedBody?._syncTransformToBody();

        // A null connected body means "the world": a static body at the origin,
        // which is what anchors a joint to nothing in particular.
        const other = this._connectedBody?._body ?? Joint._worldBody();

        const constraint = this._createConstraint(self, other);
        if (constraint) {
            this._constraint = constraint;
            PhysicsWorld.instance.world.addConstraint(constraint);
        }

        this._attachForces(self, other);
        this._attached = true;
    }

    private _teardown(): void {
        if (!this._attached) return;

        if (this._constraint) {
            PhysicsWorld.instance.world.removeConstraint(this._constraint);
            this._constraint = null;
        }

        this._detachForces();
        this._attached = false;
    }

    /**
     * @internal
     * Attaches whatever this joint needs that is not a constraint.
     *
     * @remarks
     * Most joints are constraints: the solver is told about them once and
     * satisfies them each step. A spring is not — it is a force applied every
     * step, which is how cannon models one and why {@link SpringJoint} needs a
     * hook here rather than a return value from {@link _createConstraint}.
     * The default does nothing.
     */
    protected _attachForces(_self: CANNON.Body, _other: CANNON.Body): void {}

    /** @internal The other half of {@link _attachForces}. */
    protected _detachForces(): void {}

    /** The shared static body every world-anchored joint attaches to. */
    private static _world: CANNON.Body | null = null;

    private static _worldBody(): CANNON.Body {
        if (!Joint._world) {
            Joint._world = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
        }
        return Joint._world;
    }

    /** @internal Drops the shared world body. For tests. */
    public static _reset(): void {
        Joint._world = null;
    }
}

/**
 * Holds two bodies in a fixed relative position and rotation.
 *
 * @remarks
 * Equivalent to Unity's `FixedJoint`. Useful for assembling a rigid object out
 * of parts that may later break apart — before that, it behaves as one body.
 */
@Serializable({ typeName: "FixedJoint", category: "Physics" })
export class FixedJoint extends Joint {

    protected override _createConstraint(
        self: CANNON.Body,
        other: CANNON.Body,
    ): CANNON.Constraint {
        return new CANNON.LockConstraint(self, other);
    }
}

/**
 * Lets two bodies rotate about a shared axis, like a door or a lever.
 *
 * @remarks
 * Equivalent to Unity's `HingeJoint`.
 */
@Serializable({ typeName: "HingeJoint", category: "Physics" })
export class HingeJoint extends Joint {

    /** Point the hinge passes through, in this body's local space. */
    @SerializedField({ type: FieldType.Vector3 })
    public readonly anchor: Vector3 = new Vector3(0, 0, 0);

    /** Axis the hinge turns about, in this body's local space. */
    @SerializedField({ type: FieldType.Vector3 })
    public readonly axis: Vector3 = new Vector3(0, 1, 0);

    /**
     * Rebuilds the hinge after {@link anchor} or {@link axis} changed.
     *
     * @remarks
     * They are plain vectors mutated in place, so there is no setter to hook —
     * the same reason `RectTransform` exposes an explicit invalidation.
     */
    public applyGeometry(): void {
        this._rebuild();
    }

    protected override _createConstraint(
        self: CANNON.Body,
        other: CANNON.Body,
    ): CANNON.Constraint {
        const pivotA = new CANNON.Vec3(this.anchor.x, this.anchor.y, this.anchor.z);
        const axisA = new CANNON.Vec3(this.axis.x, this.axis.y, this.axis.z);

        // The other end of the hinge has to describe the *same* line, in its own
        // frame. cannon defaults pivotB to that body's origin and axisB to its
        // local X, so leaving them out hinged the two bodies about different
        // axes through different points — they snapped together and twisted.
        // Unity computes this for you; `autoConfigureConnectedAnchor` is the
        // name of doing exactly what follows.
        const pivotB = other.pointToLocalFrame(self.pointToWorldFrame(pivotA, new CANNON.Vec3()));
        const axisB = other.vectorToLocalFrame(self.vectorToWorldFrame(axisA, new CANNON.Vec3()));

        return new CANNON.HingeConstraint(self, other, { pivotA, axisA, pivotB, axisB });
    }
}

/**
 * Pulls two bodies towards a rest distance, springily.
 *
 * @remarks
 * Equivalent to Unity's `SpringJoint`. Push the bodies together or pull them
 * apart and the spring pushes back in proportion to how far they are from
 * {@link distance}; {@link damping} decides how quickly the resulting
 * oscillation dies away.
 *
 * **This is a force, not a constraint**, which is the difference between a
 * spring and a rod. The solver is never told about it: the force is applied
 * before each step, so the bodies may be pulled well away from the rest length
 * by anything stronger and will be drawn back rather than snapped back. A joint
 * that must hold an exact distance is a `DistanceConstraint`, which this class
 * used to be — see F31 in `design/audit/findings.md` for why the change was
 * worth making.
 */
@Serializable({ typeName: "SpringJoint", category: "Physics" })
export class SpringJoint extends Joint {

    private _distance: number = 1;
    private _stiffness: number = 100;

    /**
     * The distance the spring pulls the bodies towards, in world units.
     *
     * @remarks
     * A rest length, not a limit: the bodies may be further apart or closer
     * together, and the spring's force grows with the difference.
     */
    @SerializedField()
    public get distance(): number { return this._distance; }

    public set distance(value: number) {
        const next = Math.max(0, value);
        if (this._distance === next) return;
        this._distance = next;
        this._rebuild();
    }

    /**
     * The spring constant: force per unit of displacement from {@link distance}.
     *
     * @remarks
     * A real spring constant now, which it was not before — it used to be
     * cannon's `maxForce`, so raising it made the joint *more* rigid rather than
     * bouncier. Higher is a stiffer spring: it pulls harder for the same
     * displacement and oscillates faster. Equivalent to Unity's
     * `SpringJoint.spring`.
     */
    @SerializedField()
    public get stiffness(): number { return this._stiffness; }

    public set stiffness(value: number) {
        const next = Math.max(0, value);
        if (this._stiffness === next) return;
        this._stiffness = next;
        this._rebuild();
    }

    /**
     * How fast the oscillation dies away, in force per unit of relative speed.
     *
     * @remarks
     * `0` is a spring that never settles: pull it and the bodies bounce about
     * their rest distance for as long as the scene runs. Raise it until the
     * motion stops in about as long as the effect should last. Equivalent to
     * Unity's `SpringJoint.damper`.
     */
    @SerializedField()
    public get damping(): number { return this._damping; }

    public set damping(value: number) {
        const next = Math.max(0, value);
        if (this._damping === next) return;
        this._damping = next;
        if (this._spring) this._spring.damping = next;
    }

    private _damping: number = 1;
    private _spring: CANNON.Spring | null = null;

    /**
     * @internal
     * A spring adds no constraint. cannon models one as a force applied before
     * each step, so there is nothing for the solver's constraint list.
     */
    protected override _createConstraint(): CANNON.Constraint | null {
        return null;
    }

    /** @internal */
    protected override _attachForces(self: CANNON.Body, other: CANNON.Body): void {
        this._spring = new CANNON.Spring(self, other, {
            restLength: this._distance,
            stiffness: this._stiffness,
            damping: this._damping,
        });
        SpringJoint._active.push(this._spring);
    }

    /** @internal */
    protected override _detachForces(): void {
        if (!this._spring) return;
        const index = SpringJoint._active.indexOf(this._spring);
        if (index !== -1) SpringJoint._active.splice(index, 1);
        this._spring = null;
    }

    /** Every spring currently attached, in the order they were enabled. */
    private static readonly _active: CANNON.Spring[] = [];

    /**
     * @internal
     * Applies every attached spring's force. Called by `Physics._step`
     * immediately before the world steps, because cannon clears forces at the
     * end of each step — a spring that applied its force any earlier would
     * have it wiped before it did anything.
     */
    public static _applyAll(): void {
        const springs = SpringJoint._active;
        for (let i = 0; i < springs.length; i++) springs[i].applyForce();
    }

    /** @internal Drops every attached spring — used when the world is reset. */
    public static _clear(): void {
        SpringJoint._active.length = 0;
    }
}
