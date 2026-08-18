// path: src/engine/math/Vector4.ts

import { EngineSettings } from '../EngineSettings';

/**
 * Vector4.ts
 * A 4D vector.
 * Used for RGBA colours, homogeneous coordinates and shader parameters.
 * Follows the zero-allocation pattern: every static operation takes an
 * optional `out` parameter and writes its result there instead of allocating.
 */
export class Vector4 {
    public x: number;
    public y: number;
    public z: number;
    public w: number;

    // ==================== CACHED READONLY INSTANCES ====================
    private static readonly _zero = Object.freeze(new Vector4(0, 0, 0, 0));
    private static readonly _one = Object.freeze(new Vector4(1, 1, 1, 1));
    private static readonly _positiveInfinity = Object.freeze(new Vector4(Infinity, Infinity, Infinity, Infinity));
    private static readonly _negativeInfinity = Object.freeze(new Vector4(-Infinity, -Infinity, -Infinity, -Infinity));

    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    // ==================== STATIC READONLY CONSTANTS ====================
    // WARNING: These return shared instances. Do NOT mutate!

    /** Returns (0, 0, 0, 0). Shared instance — do not mutate! */
    static get zero(): Vector4 { return Vector4._zero; }
    /** Returns (1, 1, 1, 1). Shared instance — do not mutate! */
    static get one(): Vector4 { return Vector4._one; }
    /** Returns (Infinity, Infinity, Infinity, Infinity). Shared instance — do not mutate! */
    static get positiveInfinity(): Vector4 { return Vector4._positiveInfinity; }
    /** Returns (-Infinity, -Infinity, -Infinity, -Infinity). Shared instance — do not mutate! */
    static get negativeInfinity(): Vector4 { return Vector4._negativeInfinity; }

    // ==================== STATIC METHODS ====================

    /**
     * Adds two vectors.
     */
    static add(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = a.x + b.x;
        result.y = a.y + b.y;
        result.z = a.z + b.z;
        result.w = a.w + b.w;
        return result;
    }

    /**
     * Subtracts `b` from `a`.
     */
    static subtract(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = a.x - b.x;
        result.y = a.y - b.y;
        result.z = a.z - b.z;
        result.w = a.w - b.w;
        return result;
    }

    /**
     * Multiplies two vectors component by component.
     */
    static multiply(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = a.x * b.x;
        result.y = a.y * b.y;
        result.z = a.z * b.z;
        result.w = a.w * b.w;
        return result;
    }

    /**
     * Multiplies a vector by a scalar.
     */
    static multiplyScalar(v: Vector4, scalar: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = v.x * scalar;
        result.y = v.y * scalar;
        result.z = v.z * scalar;
        result.w = v.w * scalar;
        return result;
    }

    /**
     * Alias for {@link multiplyScalar}.
     */
    static scale(v: Vector4, scalar: number, out?: Vector4): Vector4 {
        return Vector4.multiplyScalar(v, scalar, out);
    }

    /**
     * Divides a vector by a scalar.
     */
    static divideScalar(v: Vector4, scalar: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            result.x = v.x * invScalar;
            result.y = v.y * invScalar;
            result.z = v.z * invScalar;
            result.w = v.w * invScalar;
        } else {
            console.warn("Vector4: Division by zero");
            result.set(0, 0, 0, 0);
        }
        return result;
    }

    /**
     * Linearly interpolates between two vectors.
     */
    static lerp(a: Vector4, b: Vector4, t: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        t = Math.max(0, Math.min(1, t));
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
        result.w = a.w + (b.w - a.w) * t;
        return result;
    }

    /**
     * Linearly interpolates without clamping `t`.
     */
    static lerpUnclamped(a: Vector4, b: Vector4, t: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
        result.w = a.w + (b.w - a.w) * t;
        return result;
    }

    /**
     * Dot product.
     */
    static dot(a: Vector4, b: Vector4): number {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }

    /**
     * Distance between two points.
     */
    static distance(a: Vector4, b: Vector4): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dw = a.w - b.w;
        return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    }

    /**
     * Squared distance — cheaper than {@link distance}, with no square root.
     */
    static distanceSquared(a: Vector4, b: Vector4): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dw = a.w - b.w;
        return dx * dx + dy * dy + dz * dz + dw * dw;
    }

    /**
     * Returns a normalized copy of the vector.
     */
    static normalized(v: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w);
        if (mag > EngineSettings.Math.EPSILON) {
            const invMag = 1 / mag;
            result.x = v.x * invMag;
            result.y = v.y * invMag;
            result.z = v.z * invMag;
            result.w = v.w * invMag;
        } else {
            result.x = result.y = result.z = result.w = 0;
        }
        return result;
    }

    /**
     * Returns the component-wise maximum of two vectors.
     */
    static max(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = Math.max(a.x, b.x);
        result.y = Math.max(a.y, b.y);
        result.z = Math.max(a.z, b.z);
        result.w = Math.max(a.w, b.w);
        return result;
    }

    /**
     * Returns the component-wise minimum of two vectors.
     */
    static min(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = Math.min(a.x, b.x);
        result.y = Math.min(a.y, b.y);
        result.z = Math.min(a.z, b.z);
        result.w = Math.min(a.w, b.w);
        return result;
    }

    /**
     * Clamps each component between the matching components of `min` and `max`.
     */
    static clamp(v: Vector4, min: Vector4, max: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = Math.max(min.x, Math.min(max.x, v.x));
        result.y = Math.max(min.y, Math.min(max.y, v.y));
        result.z = Math.max(min.z, Math.min(max.z, v.z));
        result.w = Math.max(min.w, Math.min(max.w, v.w));
        return result;
    }

    /**
     * Clamps the vector's length to `maxLength`, leaving its direction alone.
     */
    static clampMagnitude(v: Vector4, maxLength: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        const sqrMag = v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w;
        if (sqrMag > maxLength * maxLength) {
            const mag = Math.sqrt(sqrMag);
            const scale = maxLength / mag;
            result.x = v.x * scale;
            result.y = v.y * scale;
            result.z = v.z * scale;
            result.w = v.w * scale;
        } else {
            result.x = v.x;
            result.y = v.y;
            result.z = v.z;
            result.w = v.w;
        }
        return result;
    }

    /**
     * Projects one vector onto another.
     */
    static project(vector: Vector4, onNormal: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        const sqrMag = onNormal.sqrMagnitude();
        if (sqrMag < EngineSettings.Math.EPSILON) {
            return result.set(0, 0, 0, 0);
        }
        const dot = Vector4.dot(vector, onNormal);
        return Vector4.multiplyScalar(onNormal, dot / sqrMag, result);
    }

    /**
     * Moves `current` towards `target` by at most `maxDistanceDelta`.
     */
    static moveTowards(current: Vector4, target: Vector4, maxDistanceDelta: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();

        const dx = target.x - current.x;
        const dy = target.y - current.y;
        const dz = target.z - current.z;
        const dw = target.w - current.w;
        const sqrDist = dx * dx + dy * dy + dz * dz + dw * dw;

        if (sqrDist === 0 || (maxDistanceDelta >= 0 && sqrDist <= maxDistanceDelta * maxDistanceDelta)) {
            result.x = target.x;
            result.y = target.y;
            result.z = target.z;
            result.w = target.w;
            return result;
        }

        const dist = Math.sqrt(sqrDist);
        const scale = maxDistanceDelta / dist;

        result.x = current.x + dx * scale;
        result.y = current.y + dy * scale;
        result.z = current.z + dz * scale;
        result.w = current.w + dw * scale;
        return result;
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Sets all components.
     */
    set(x: number = 0, y: number = 0, z: number = 0, w: number = 0): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }

    setX(x: number): this {
        this.x = x;
        return this;
    }

    setY(y: number): this {
        this.y = y;
        return this;
    }

    setZ(z: number): this {
        this.z = z;
        return this;
    }

    setW(w: number): this {
        this.w = w;
        return this;
    }

    /**
     * Copies the components of another vector into this one.
     */
    copy(v: Vector4): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        this.w = v.w;
        return this;
    }

    /**
     * Returns a new vector with the same components.
     */
    clone(): Vector4 {
        return new Vector4(this.x, this.y, this.z, this.w);
    }

    /**
     * Adds a vector to this one, in place.
     */
    add(v: Vector4): this {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        this.w += v.w;
        return this;
    }

    /**
     * Subtracts a vector from this one, in place.
     */
    subtract(v: Vector4): this {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        this.w -= v.w;
        return this;
    }

    /**
     * Multiplies this vector by another component by component, in place.
     */
    multiply(v: Vector4): this {
        this.x *= v.x;
        this.y *= v.y;
        this.z *= v.z;
        this.w *= v.w;
        return this;
    }

    /**
     * Divides this vector by another component by component, in place.
     */
    divide(v: Vector4): this {
        this.x /= v.x;
        this.y /= v.y;
        this.z /= v.z;
        this.w /= v.w;
        return this;
    }

    /**
     * Multiplies this vector by a scalar, in place.
     */
    multiplyScalar(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        this.z *= scalar;
        this.w *= scalar;
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
            this.z *= invScalar;
            this.w *= invScalar;
        } else {
            console.warn("Vector4: Division by zero");
            this.set(0, 0, 0, 0);
        }
        return this;
    }

    /**
     * Whether another vector is equal to this one, within `epsilon`.
     */
    equals(v: Vector4, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon &&
            Math.abs(this.z - v.z) < epsilon &&
            Math.abs(this.w - v.w) < epsilon
        );
    }

    /**
     * The vector's length.
     */
    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    }

    /**
     * The vector's squared length — cheaper than {@link magnitude}.
     */
    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    /**
     * Scales this vector to unit length, in place.
     */
    normalize(): this {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return this.divideScalar(mag);
        }
        return this.set(0, 0, 0, 0);
    }

    /**
     * Returns a unit-length copy, leaving this vector unchanged.
     */
    get normalized(): Vector4 {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return new Vector4(this.x / mag, this.y / mag, this.z / mag, this.w / mag);
        }
        return new Vector4(0, 0, 0, 0);
    }

    /**
     * Dot product with another vector.
     */
    dot(v: Vector4): number {
        return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
    }

    /**
     * Distance to another point.
     */
    distanceTo(v: Vector4): number {
        return Vector4.distance(this, v);
    }

    /**
     * Squared distance to another point — cheaper than {@link distanceTo}.
     */
    distanceToSquared(v: Vector4): number {
        return Vector4.distanceSquared(this, v);
    }

    /**
     * Interpolates this vector towards another, in place.
     */
    lerp(v: Vector4, t: number): this {
        t = Math.max(0, Math.min(1, t));
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        this.z += (v.z - this.z) * t;
        this.w += (v.w - this.w) * t;
        return this;
    }

    /**
     * Linearly interpolates without clamping `t`.
     */
    lerpUnclamped(v: Vector4, t: number): this {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        this.z += (v.z - this.z) * t;
        this.w += (v.w - this.w) * t;
        return this;
    }

    /**
     * Clamps each component between the matching components of `min` and `max`, in place.
     */
    clamp(min: Vector4, max: Vector4): this {
        this.x = Math.max(min.x, Math.min(max.x, this.x));
        this.y = Math.max(min.y, Math.min(max.y, this.y));
        this.z = Math.max(min.z, Math.min(max.z, this.z));
        this.w = Math.max(min.w, Math.min(max.w, this.w));
        return this;
    }

    /**
     * Clamps the vector's length to `maxLength`, leaving its direction alone.
     */
    clampMagnitude(maxLength: number): this {
        const sqrMag = this.sqrMagnitude();
        if (sqrMag > maxLength * maxLength) {
            const mag = Math.sqrt(sqrMag);
            const scale = maxLength / mag;
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
            this.w *= scale;
        }
        return this;
    }

    /**
     * Negates every component, in place.
     */
    negate(): this {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        this.w = -this.w;
        return this;
    }

    /**
     * A readable string form, for logging.
     */
    toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)}, ${this.w.toFixed(2)})`;
    }

    /**
     * Returns the components as `[x, y, z, w]`.
     */
    toArray(): [number, number, number, number] {
        return [this.x, this.y, this.z, this.w];
    }

    /**
     * Sets the components from an array.
     */
    fromArray(array: number[], offset: number = 0): this {
        this.x = array[offset];
        this.y = array[offset + 1];
        this.z = array[offset + 2];
        this.w = array[offset + 3];
        return this;
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only.

    /**
     * @internal
     * Copies values to a Three.js Vector4-like object.
     */
    _copyToThree(threeVec: { x: number; y: number; z: number; w: number }): void {
        threeVec.x = this.x;
        threeVec.y = this.y;
        threeVec.z = this.z;
        threeVec.w = this.w;
    }

    /**
     * @internal
     * Copies values from a Three.js Vector4-like object.
     */
    _copyFromThree(threeVec: { x: number; y: number; z: number; w: number }): this {
        this.x = threeVec.x;
        this.y = threeVec.y;
        this.z = threeVec.z;
        this.w = threeVec.w;
        return this;
    }
}