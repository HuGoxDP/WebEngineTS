// path: src/engine/math/Ray.ts

import { Vector3 } from './Vector3';
import { EngineSettings } from '../EngineSettings';

/**
 * Ray.ts
 * Represents an infinite line starting at origin and going in direction.
 * Used for raycasting, picking, and intersection tests.
 *
 * @remarks
 * API matches Unity Ray as closely as possible.
 * Direction is always normalized internally.
 */
export class Ray {
    /** Starting point of the ray */
    private _origin: Vector3;
    /** Normalized direction of the ray */
    private _direction: Vector3;

    /**
     * Creates a new Ray.
     * @param origin Starting point (default: (0,0,0))
     * @param direction Direction vector (will be normalized, default: (0,0,1))
     */
    constructor(origin?: Vector3, direction?: Vector3) {
        this._origin = origin ? origin.clone() : new Vector3(0, 0, 0);
        this._direction = direction ? direction.normalized : new Vector3(0, 0, 1);
    }

    // ==================== PROPERTIES ====================

    /** Starting point of the ray */
    get origin(): Vector3 {
        return this._origin;
    }

    set origin(value: Vector3) {
        this._origin.copy(value);
    }

    /**
     * Normalized direction of the ray.
     * Setting this will normalize the input vector.
     */
    get direction(): Vector3 {
        return this._direction;
    }

    set direction(value: Vector3) {
        this._direction.copy(value).normalize();
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Sets the origin and direction of this ray.
     * @param origin New origin point
     * @param direction New direction (will be normalized)
     * @returns this for chaining
     */
    set(origin: Vector3, direction: Vector3): this {
        this._origin.copy(origin);
        this._direction.copy(direction).normalize();
        return this;
    }

    /**
     * Copies values from another Ray.
     * @param other Ray to copy from
     * @returns this for chaining
     */
    copy(other: Ray): this {
        this._origin.copy(other._origin);
        this._direction.copy(other._direction);
        return this;
    }

    /**
     * Creates a copy of this Ray.
     */
    clone(): Ray {
        return new Ray(this._origin.clone(), this._direction.clone());
    }

    /**
     * Returns a point at distance units along the ray.
     * WARNING: Allocates new Vector3. Use getPoint(distance, out) in hot paths.
     * @param distance Distance along the ray
     */
    getPoint(distance: number): Vector3;
    /**
     * Returns a point at distance units along the ray (zero-allocation).
     * @param distance Distance along the ray
     * @param out Vector to write result
     */
    getPoint(distance: number, out: Vector3): Vector3;
    getPoint(distance: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = this._origin.x + this._direction.x * distance;
        result.y = this._origin.y + this._direction.y * distance;
        result.z = this._origin.z + this._direction.z * distance;
        return result;
    }

    /**
     * Returns the closest point on the ray to the given point.
     * @param point Point to find closest point to
     * @param out Optional vector for result
     */
    closestPointToPoint(point: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();

        // Vector from origin to point
        const dx = point.x - this._origin.x;
        const dy = point.y - this._origin.y;
        const dz = point.z - this._origin.z;

        // Project onto ray direction
        let t = dx * this._direction.x + dy * this._direction.y + dz * this._direction.z;

        // Clamp to ray (not before origin)
        t = Math.max(0, t);

        return this.getPoint(t, result);
    }

    /**
     * Returns the squared distance from a point to the ray.
     * Zero-allocation implementation.
     */
    distanceToPointSquared(point: Vector3): number {
        // Vector from origin to point
        const dx = point.x - this._origin.x;
        const dy = point.y - this._origin.y;
        const dz = point.z - this._origin.z;

        // Project onto ray direction
        let t = dx * this._direction.x + dy * this._direction.y + dz * this._direction.z;

        // Clamp to ray (not before origin)
        t = Math.max(0, t);

        // Compute point on ray
        const px = this._origin.x + this._direction.x * t;
        const py = this._origin.y + this._direction.y * t;
        const pz = this._origin.z + this._direction.z * t;

        // Distance squared
        const ex = point.x - px;
        const ey = point.y - py;
        const ez = point.z - pz;

        return ex * ex + ey * ey + ez * ez;
    }

    /**
     * Returns the distance from a point to the ray.
     */
    distanceToPoint(point: Vector3): number {
        return Math.sqrt(this.distanceToPointSquared(point));
    }

    /**
     * Checks equality with another Ray.
     * @param other Ray to compare
     * @param epsilon Tolerance for comparison
     */
    equals(other: Ray, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            this._origin.equals(other._origin, epsilon) &&
            this._direction.equals(other._direction, epsilon)
        );
    }

    toString(): string {
        return `Ray(Origin: ${this._origin.toString()}, Dir: ${this._direction.toString()})`;
    }

    // ==================== STATIC FACTORY METHODS ====================

    /**
     * Creates a ray from two points (from -> to).
     * @param from Starting point
     * @param to Target point
     * @param out Optional ray to reuse
     */
    static fromPoints(from: Vector3, to: Vector3, out?: Ray): Ray {
        const ray = out ?? new Ray();
        ray._origin.copy(from);
        ray._direction.set(
            to.x - from.x,
            to.y - from.y,
            to.z - from.z
        ).normalize();
        return ray;
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only. Do NOT expose to users.

    /**
     * @internal
     * Copies values to a Three.js Ray-like object.
     * Used by sync/adapter layer.
     */
    _copyToThreeRay(threeRay: {
        origin: { x: number; y: number; z: number };
        direction: { x: number; y: number; z: number }
    }): void {
        threeRay.origin.x = this._origin.x;
        threeRay.origin.y = this._origin.y;
        threeRay.origin.z = this._origin.z;
        threeRay.direction.x = this._direction.x;
        threeRay.direction.y = this._direction.y;
        threeRay.direction.z = this._direction.z;
    }

    /**
     * @internal
     * Copies values from a Three.js Ray-like object.
     * Used by sync/adapter layer.
     */
    _copyFromThreeRay(threeRay: {
        origin: { x: number; y: number; z: number };
        direction: { x: number; y: number; z: number }
    }): this {
        this._origin.x = threeRay.origin.x;
        this._origin.y = threeRay.origin.y;
        this._origin.z = threeRay.origin.z;
        this._direction.x = threeRay.direction.x;
        this._direction.y = threeRay.direction.y;
        this._direction.z = threeRay.direction.z;
        return this;
    }
}