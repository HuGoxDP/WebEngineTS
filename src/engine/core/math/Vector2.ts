// path: src/engine/math/Vector2.ts

import { EngineSettings } from '../EngineSettings';

/**
 * Vector2.ts
 * A 2D vector.
 * Used for 2D physics, UI positions and texture UV coordinates.
 * Follows the zero-allocation pattern: every static operation takes an
 * optional `out` parameter and writes its result there instead of allocating.
 */
export class Vector2 {
    public x: number;
    public y: number;

    // ==================== CACHED READONLY INSTANCES ====================
    private static readonly _zero = Object.freeze(new Vector2(0, 0));
    private static readonly _one = Object.freeze(new Vector2(1, 1));
    private static readonly _up = Object.freeze(new Vector2(0, 1));
    private static readonly _down = Object.freeze(new Vector2(0, -1));
    private static readonly _left = Object.freeze(new Vector2(-1, 0));
    private static readonly _right = Object.freeze(new Vector2(1, 0));
    private static readonly _positiveInfinity = Object.freeze(new Vector2(Infinity, Infinity));
    private static readonly _negativeInfinity = Object.freeze(new Vector2(-Infinity, -Infinity));

    constructor(x: number = 0, y: number = 0) {
        this.x = x;
        this.y = y;
    }

    // ==================== STATIC READONLY CONSTANTS ====================
    // WARNING: These return shared instances. Do NOT mutate!

    /** Returns (0, 0). Shared instance — do not mutate! */
    static get zero(): Vector2 { return Vector2._zero; }
    /** Returns (1, 1). Shared instance — do not mutate! */
    static get one(): Vector2 { return Vector2._one; }
    /** Returns (0, 1). Shared instance — do not mutate! */
    static get up(): Vector2 { return Vector2._up; }
    /** Returns (0, -1). Shared instance — do not mutate! */
    static get down(): Vector2 { return Vector2._down; }
    /** Returns (-1, 0). Shared instance — do not mutate! */
    static get left(): Vector2 { return Vector2._left; }
    /** Returns (1, 0). Shared instance — do not mutate! */
    static get right(): Vector2 { return Vector2._right; }
    /** Returns (Infinity, Infinity). Shared instance — do not mutate! */
    static get positiveInfinity(): Vector2 { return Vector2._positiveInfinity; }
    /** Returns (-Infinity, -Infinity). Shared instance — do not mutate! */
    static get negativeInfinity(): Vector2 { return Vector2._negativeInfinity; }

    // ==================== STATIC METHODS ====================


    /**
     * Adds two vectors.
     */
    static add(a: Vector2, b: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = a.x + b.x;
        result.y = a.y + b.y;
        return result;
    }

    /**
     * Subtracts `b` from `a`.
     */
    static subtract(a: Vector2, b: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = a.x - b.x;
        result.y = a.y - b.y;
        return result;
    }

    /**
     * Multiplies two vectors component by component.
     */
    static multiply(a: Vector2, b: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = a.x * b.x;
        result.y = a.y * b.y;
        return result;
    }

    /**
     * Multiplies a vector by a scalar.
     */
    static multiplyScalar(v: Vector2, scalar: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = v.x * scalar;
        result.y = v.y * scalar;
        return result;
    }

    /**
     * Alias for {@link multiplyScalar}, named as Unity names it.
     */
    static scale(v: Vector2, scalar: number, out?: Vector2): Vector2 {
        return Vector2.multiplyScalar(v, scalar, out);
    }

    /**
     * Divides a vector by a scalar.
     */
    static divideScalar(v: Vector2, scalar: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            result.x = v.x * invScalar;
            result.y = v.y * invScalar;
        } else {
            console.warn("Vector2: Division by zero");
            result.set(0, 0);
        }
        return result;
    }

    /**
     * Linearly interpolates between two vectors.
     * @param a
     * @param b
     * @param t — interpolation factor (0 = `a`, 1 = `b`), clamped to [0, 1].
     * @param out
     */
    static lerp(a: Vector2, b: Vector2, t: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        t = Math.max(0, Math.min(1, t));
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        return result;
    }

    /**
     * Linearly interpolates between two vectors without clamping `t`.
     */
    static lerpUnclamped(a: Vector2, b: Vector2, t: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        return result;
    }

    /**
     * Dot product.
     */
    static dot(a: Vector2, b: Vector2): number {
        return a.x * b.x + a.y * b.y;
    }

    /**
     * Distance between two points.
     */
    static distance(a: Vector2, b: Vector2): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Squared distance — cheaper than {@link distance}, with no square root.
     */
    static distanceSquared(a: Vector2, b: Vector2): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    /**
     * Returns a normalized copy of the vector.
     */
    static normalized(v: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        const mag = Math.sqrt(v.x * v.x + v.y * v.y);
        if (mag > EngineSettings.Math.EPSILON) {
            const invMag = 1 / mag;
            result.x = v.x * invMag;
            result.y = v.y * invMag;
        } else {
            result.x = result.y = 0;
        }
        return result;
    }

    /**
     * Returns the component-wise minimum of two vectors.
     */
    static min(a: Vector2, b: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = Math.min(a.x, b.x);
        result.y = Math.min(a.y, b.y);
        return result;
    }

    /**
     * Returns the component-wise maximum of two vectors.
     */
    static max(a: Vector2, b: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = Math.max(a.x, b.x);
        result.y = Math.max(a.y, b.y);
        return result;
    }

    /**
     * Clamps each component between the matching components of `min` and `max`.
     */
    static clamp(v: Vector2, min: Vector2, max: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = Math.max(min.x, Math.min(max.x, v.x));
        result.y = Math.max(min.y, Math.min(max.y, v.y));
        return result;
    }

    /**
     * Clamps the vector's length to `maxLength`, leaving its direction alone.
     */
    static clampMagnitude(v: Vector2, maxLength: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        const sqrMag = v.x * v.x + v.y * v.y;
        if (sqrMag > maxLength * maxLength) {
            const mag = Math.sqrt(sqrMag);
            const scale = maxLength / mag;
            result.x = v.x * scale;
            result.y = v.y * scale;
        } else {
            result.x = v.x;
            result.y = v.y;
        }
        return result;
    }


    /**
     * Reflects a vector off the line defined by a normal.
     */
    static reflect(direction: Vector2, normal: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        const dot2 = 2 * (direction.x * normal.x + direction.y * normal.y);
        result.x = direction.x - dot2 * normal.x;
        result.y = direction.y - dot2 * normal.y;
        return result;
    }

    /**
     * Returns the vector rotated 90° counter-clockwise.
     */
    static perpendicular(v: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = -v.y;
        result.y = v.x;
        return result;
    }

    /**
     * Unsigned angle between two vectors, in degrees (0–180).
     */
    static angle(from: Vector2, to: Vector2): number {
        const denominator = Math.sqrt(
            (from.x * from.x + from.y * from.y) *
            (to.x * to.x + to.y * to.y)
        );
        if (denominator < EngineSettings.Math.EPSILON) return 0;

        const dot = from.x * to.x + from.y * to.y;
        const clamped = Math.max(-1, Math.min(1, dot / denominator));
        return Math.acos(clamped) * (180 / Math.PI);
    }

    /**
     * Signed angle between two vectors, in degrees (−180 to 180).
     */
    static signedAngle(from: Vector2, to: Vector2): number {
        const unsignedAngle = Vector2.angle(from, to);
        // 2D cross product (z-component of 3D cross)
        const cross = from.x * to.y - from.y * to.x;
        const sign = cross >= 0 ? 1 : -1;
        return unsignedAngle * sign;
    }

    /**
     * Moves `current` towards `target` by at most `maxDistanceDelta`.
     */
    static moveTowards(current: Vector2, target: Vector2, maxDistanceDelta: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();

        const dx = target.x - current.x;
        const dy = target.y - current.y;
        const sqrDist = dx * dx + dy * dy;

        if (sqrDist === 0 || (maxDistanceDelta >= 0 && sqrDist <= maxDistanceDelta * maxDistanceDelta)) {
            result.x = target.x;
            result.y = target.y;
            return result;
        }

        const dist = Math.sqrt(sqrDist);
        const scale = maxDistanceDelta / dist;

        result.x = current.x + dx * scale;
        result.y = current.y + dy * scale;
        return result;
    }

    /**
     * Gradually moves a vector towards a target, damping the approach.
     */
    static smoothDamp(
        current: Vector2,
        target: Vector2,
        currentVelocity: Vector2,
        smoothTime: number,
        maxSpeed: number = Infinity,
        deltaTime: number,
        out?: Vector2
    ): Vector2 {
        const result = out ?? new Vector2();

        smoothTime = Math.max(0.0001, smoothTime);
        const omega = 2 / smoothTime;
        const x = omega * deltaTime;
        const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

        let dx = current.x - target.x;
        let dy = current.y - target.y;

        const maxChange = maxSpeed * smoothTime;
        const sqrMag = dx * dx + dy * dy;
        if (sqrMag > maxChange * maxChange) {
            const mag = Math.sqrt(sqrMag);
            dx = (dx / mag) * maxChange;
            dy = (dy / mag) * maxChange;
        }

        const targetX = current.x - dx;
        const targetY = current.y - dy;

        const tempX = (currentVelocity.x + omega * dx) * deltaTime;
        const tempY = (currentVelocity.y + omega * dy) * deltaTime;

        currentVelocity.x = (currentVelocity.x - omega * tempX) * exp;
        currentVelocity.y = (currentVelocity.y - omega * tempY) * exp;

        result.x = targetX + (dx + tempX) * exp;
        result.y = targetY + (dy + tempY) * exp;

        // Prevent overshooting
        const origMinusCurrentX = target.x - current.x;
        const origMinusCurrentY = target.y - current.y;
        const outMinusOrigX = result.x - target.x;
        const outMinusOrigY = result.y - target.y;

        if (origMinusCurrentX * outMinusOrigX + origMinusCurrentY * outMinusOrigY > 0) {
            result.x = target.x;
            result.y = target.y;
            currentVelocity.x = (result.x - target.x) / deltaTime;
            currentVelocity.y = (result.y - target.y) / deltaTime;
        }

        return result;
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Sets both components.
     */
    set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    /**
     * Sets the X component only.
     */
    setX(x: number): this {
        this.x = x;
        return this;
    }

    /**
     * Sets the Y component only.
     */
    setY(y: number): this {
        this.y = y;
        return this;
    }

    /**
     * Copies the components of another vector into this one.
     */
    copy(v: Vector2): this {
        this.x = v.x;
        this.y = v.y;
        return this;
    }

    /**
     * Returns a new vector with the same components.
     */
    clone(): Vector2 {
        return new Vector2(this.x, this.y);
    }

    /**
     * Adds a vector to this one, in place.
     */
    add(v: Vector2): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }

    /**
     * Subtracts a vector from this one, in place.
     */
    subtract(v: Vector2): this {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }

    /**
     * Multiplies this vector by another component by component, in place.
     */
    multiply(v: Vector2): this {
        this.x *= v.x;
        this.y *= v.y;
        return this;
    }

    /**
     * Divides this vector by another component by component, in place.
     */
    divide(v: Vector2): this {
        this.x /= v.x;
        this.y /= v.y;
        return this;
    }

    /**
     * Multiplies this vector by a scalar, in place.
     */
    multiplyScalar(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        return this;
    }

    /**
     * Divides this vector by a scalar, in place.
     */
    divideScalar(scalar: number): this {
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            this.x *= invScalar;
            this.y *= invScalar;
        } else {
            console.warn("Vector2: Division by zero");
            this.set(0, 0);
        }
        return this;
    }

    /**
     * The vector's length.
     */
    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    /**
     * The vector's squared length — cheaper than {@link magnitude}.
     */
    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y;
    }

    /**
     * Scales this vector to unit length, in place.
     */
    normalize(): this {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return this.divideScalar(mag);
        }
        return this.set(0, 0);
    }

    /**
     * Returns a unit-length copy, leaving this vector unchanged.
     */
    get normalized(): Vector2 {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return new Vector2(this.x / mag, this.y / mag);
        }
        return new Vector2(0, 0);
    }

    /**
     * Distance to another point.
     */
    distanceTo(v: Vector2): number {
        return Vector2.distance(this, v);
    }

    /**
     * Squared distance to another point — cheaper than {@link distanceTo}.
     */
    distanceToSquared(v: Vector2): number {
        return Vector2.distanceSquared(this, v);
    }

    /**
     * Dot product with another vector.
     */
    dot(v: Vector2): number {
        return this.x * v.x + this.y * v.y;
    }

    /**
     * Interpolates this vector towards another, in place.
     */
    lerp(v: Vector2, t: number): this {
        t = Math.max(0, Math.min(1, t));
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        return this;
    }

    /**
     * Whether another vector is equal to this one, within `epsilon`.
     */
    equals(v: Vector2, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon
        );
    }

    /**
     * Negates every component, in place.
     */
    negate(): this {
        this.x = -this.x;
        this.y = -this.y;
        return this;
    }

    /**
     * A readable string form, for logging.
     */
    toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
    }

    /**
     * Returns the components as `[x, y]`.
     */
    toArray(): [number, number] {
        return [this.x, this.y];
    }

    /**
     * Sets the components from an array.
     */
    fromArray(array: number[], offset: number = 0): this {
        this.x = array[offset];
        this.y = array[offset + 1];
        return this;
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only.

    /**
     * @internal
     * Copies values to a Three.js Vector2-like object.
     */
    _copyToThree(threeVec: { x: number; y: number }): void {
        threeVec.x = this.x;
        threeVec.y = this.y;
    }

    /**
     * @internal
     * Copies values from a Three.js Vector2-like object.
     */
    _copyFromThree(threeVec: { x: number; y: number }): this {
        this.x = threeVec.x;
        this.y = threeVec.y;
        return this;
    }
}