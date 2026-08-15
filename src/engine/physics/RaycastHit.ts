import { Vector3 } from "../core/math/Vector3";
import { Transform } from "../core/Transform";
import { GameObject } from "../core/GameObject";
import { Collider } from "./Collider";

/**
 * What a raycast hit, and where.
 *
 * @remarks
 * Equivalent to Unity's `RaycastHit`. Filled in by {@link Physics.raycast},
 * which takes an instance rather than allocating one, so a caster in a hot path
 * can reuse the same object every frame.
 */
export class RaycastHit {
    /** The impact point, in world space. */
    public point: Vector3 = new Vector3();

    /**
     * The surface normal at the impact point, in world space.
     *
     * @remarks
     * World space, as Unity reports it — not the hit object's local space, which
     * is what the underlying Three.js intersection carries.
     */
    public normal: Vector3 = new Vector3();

    /** Distance from the ray's origin to the impact point. */
    public distance: number = 0;

    /** Transform of the object that was hit, or `null` if there was no hit. */
    public transform: Transform | null = null;

    /** The collider that was hit, or `null` if there was no hit. */
    public collider: Collider | null = null;

    /** The GameObject that was hit, through its {@link transform}. */
    public get gameObject(): GameObject | null {
        return this.transform ? this.transform.gameObject : null;
    }

    /**
     * Resets every field, so the instance can be reused.
     *
     * @remarks
     * `Physics.raycast` clears what it cannot fill in, so calling this is not
     * required between casts — it is here for a caller that wants to be sure a
     * hit it is holding is not read as fresh.
     */
    public clear(): void {
        this.point.set(0, 0, 0);
        this.normal.set(0, 0, 0);
        this.distance = 0;
        this.transform = null;
        this.collider = null;
    }
}
