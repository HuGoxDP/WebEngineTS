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

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Whether the joint is currently solving. */
    public get isActive(): boolean { return this._constraint !== null; }

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
        if (!constraint) return;

        this._constraint = constraint;
        PhysicsWorld.instance.world.addConstraint(constraint);
    }

    private _teardown(): void {
        if (!this._constraint) return;
        PhysicsWorld.instance.world.removeConstraint(this._constraint);
        this._constraint = null;
    }

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
 * Holds two bodies a fixed distance apart.
 *
 * @remarks
 * **Named for Unity's `SpringJoint`, but stiffer than one.** Underneath is a
 * cannon `DistanceConstraint`: a rod of fixed length that the solver satisfies
 * every step, not a spring that oscillates around a rest length. There is no
 * damping, and {@link stiffness} is the solver's force limit — how hard the link
 * may pull before it gives — rather than a spring constant. Raising it makes the
 * link more rigid; it does not make it bouncier.
 *
 * A real spring means cannon's `Spring`, which applies a force each step rather
 * than being a constraint, so it belongs to a different lifecycle than the rest
 * of {@link Joint}. Until then this is what the class does, and the name is kept
 * because scenarios already use it.
 */
@Serializable({ typeName: "SpringJoint", category: "Physics" })
export class SpringJoint extends Joint {

    private _distance: number = 1;
    private _stiffness: number = 100;

    /** The distance the link holds, in world units. */
    @SerializedField()
    public get distance(): number { return this._distance; }

    public set distance(value: number) {
        const next = Math.max(0, value);
        if (this._distance === next) return;
        this._distance = next;
        this._rebuild();
    }

    /**
     * The maximum force the link may apply, in newtons.
     *
     * @remarks
     * cannon's `maxForce`, not a spring constant — see the class remarks. Higher
     * makes the fixed distance harder to violate; it does not add bounce.
     */
    @SerializedField()
    public get stiffness(): number { return this._stiffness; }

    public set stiffness(value: number) {
        const next = Math.max(0, value);
        if (this._stiffness === next) return;
        this._stiffness = next;
        this._rebuild();
    }

    protected override _createConstraint(
        self: CANNON.Body,
        other: CANNON.Body,
    ): CANNON.Constraint {
        return new CANNON.DistanceConstraint(self, other, this._distance, this._stiffness);
    }
}
