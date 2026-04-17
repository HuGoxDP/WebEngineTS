import { Vector3 } from "../core/math/Vector3";
import type { GameObject } from "../core/GameObject";
import type { Collider } from "./Collider";

/**
 * Contact point in a collision.
 */
export class ContactPoint {
    /** Contact point in world space. */
    public readonly point: Vector3;

    /** Normal of the contact point. */
    public readonly normal: Vector3;

    constructor(point: Vector3, normal: Vector3) {
        this.point = point;
        this.normal = normal;
    }
}

/**
 * Describes a collision between two colliders.
 *
 * @remarks
 * Equivalent to Unity's `Collision` class.
 * Passed to `onCollisionEnter`, `onCollisionStay`, `onCollisionExit` callbacks.
 */
export class Collision {
    /** The other collider involved in the collision. */
    public readonly collider: Collider;

    /** The other GameObject involved in the collision. */
    public readonly gameObject: GameObject;

    /** The relative velocity of the two colliding objects. */
    public readonly relativeVelocity: Vector3;

    /** The contact points of the collision. */
    public readonly contacts: ReadonlyArray<ContactPoint>;

    constructor(
        collider: Collider,
        relativeVelocity: Vector3,
        contacts: ContactPoint[]
    ) {
        this.collider = collider;
        this.gameObject = collider.gameObject;
        this.relativeVelocity = relativeVelocity;
        this.contacts = contacts;
    }
}
