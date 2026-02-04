// path: src/engine/math/Vector4.ts

import { EngineSettings } from '../EngineSettings';

/**
 * Vector4.ts
 * Математичний клас для роботи з 4D векторами.
 * Використовується для: RGBA кольорів, однорідних координат, шейдерних параметрів.
 * Реалізує Zero-Allocation pattern через параметр 'out'.
 */
export class Vector4 {
    public x: number;
    public y: number;
    public z: number;
    public w: number;

    // ==================== CACHED READONLY INSTANCES ====================
    private static readonly _zero = new Vector4(0, 0, 0, 0);
    private static readonly _one = new Vector4(1, 1, 1, 1);
    private static readonly _positiveInfinity = new Vector4(Infinity, Infinity, Infinity, Infinity);
    private static readonly _negativeInfinity = new Vector4(-Infinity, -Infinity, -Infinity, -Infinity);

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
     * Додає два вектори.
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
     * Віднімає вектори (a - b).
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
     * Покомпонентне множення векторів (Scale).
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
     * Множення вектора на число.
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
     * Аліас для multiplyScalar.
     */
    static scale(v: Vector4, scalar: number, out?: Vector4): Vector4 {
        return Vector4.multiplyScalar(v, scalar, out);
    }

    /**
     * Ділення вектора на число.
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
     * Лінійна інтерполяція між двома векторами.
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
     * Лінійна інтерполяція без обмеження t.
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
     * Скалярний добуток (Dot Product).
     */
    static dot(a: Vector4, b: Vector4): number {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }

    /**
     * Відстань між векторами.
     */
    static distance(a: Vector4, b: Vector4): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dw = a.w - b.w;
        return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    }

    /**
     * Квадрат відстані (швидше, без кореня).
     */
    static distanceSquared(a: Vector4, b: Vector4): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dw = a.w - b.w;
        return dx * dx + dy * dy + dz * dz + dw * dw;
    }

    /**
     * Повертає нормалізовану копію вектора.
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
     * Повертає вектор з максимальними компонентами.
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
     * Повертає вектор з мінімальними компонентами.
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
     * Обмежує кожну компоненту вектора.
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
     * Обмежує довжину вектора максимальним значенням.
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
     * Проектує вектор на інший вектор.
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
     * Рухає точку current до target, не перевищуючи maxDistanceDelta.
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
     * Встановлює значення компонентів вектора.
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
     * Копіює значення з іншого вектора.
     */
    copy(v: Vector4): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        this.w = v.w;
        return this;
    }

    /**
     * Створює копію цього вектора.
     */
    clone(): Vector4 {
        return new Vector4(this.x, this.y, this.z, this.w);
    }

    /**
     * Додає інший вектор до цього.
     */
    add(v: Vector4): this {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        this.w += v.w;
        return this;
    }

    /**
     * Віднімає інший вектор від цього.
     */
    subtract(v: Vector4): this {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        this.w -= v.w;
        return this;
    }

    /**
     * Множить цей вектор на інший покомпонентно (Scale).
     */
    multiply(v: Vector4): this {
        this.x *= v.x;
        this.y *= v.y;
        this.z *= v.z;
        this.w *= v.w;
        return this;
    }

    /**
     * Ділить цей вектор на інший покомпонентно.
     */
    divide(v: Vector4): this {
        this.x /= v.x;
        this.y /= v.y;
        this.z /= v.z;
        this.w /= v.w;
        return this;
    }

    /**
     * Множить вектор на скаляр (число).
     */
    multiplyScalar(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        this.z *= scalar;
        this.w *= scalar;
        return this;
    }

    /**
     * Ділить вектор на скаляр.
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
     * Перевіряє рівність векторів з урахуванням похибки (Epsilon).
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
     * Повертає довжину вектора (Magnitude).
     */
    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    }

    /**
     * Повертає квадрат довжини вектора.
     */
    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    /**
     * Нормалізує вектор (робить його довжину рівною 1).
     */
    normalize(): this {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return this.divideScalar(mag);
        }
        return this.set(0, 0, 0, 0);
    }

    /**
     * Повертає нормалізовану копію вектора (не мутує поточний).
     */
    get normalized(): Vector4 {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return new Vector4(this.x / mag, this.y / mag, this.z / mag, this.w / mag);
        }
        return new Vector4(0, 0, 0, 0);
    }

    /**
     * Скалярний добуток векторів (Dot Product).
     */
    dot(v: Vector4): number {
        return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
    }

    /**
     * Повертає відстань до іншого вектора.
     */
    distanceTo(v: Vector4): number {
        return Vector4.distance(this, v);
    }

    /**
     * Повертає квадрат відстані до іншого вектора.
     */
    distanceToSquared(v: Vector4): number {
        return Vector4.distanceSquared(this, v);
    }

    /**
     * Лінійна інтерполяція між цим вектором та іншим (мутує поточний).
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
     * Лінійна інтерполяція без обмеження t.
     */
    lerpUnclamped(v: Vector4, t: number): this {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        this.z += (v.z - this.z) * t;
        this.w += (v.w - this.w) * t;
        return this;
    }

    /**
     * Обмежує компоненти вектора між мінімальними та максимальними значеннями.
     */
    clamp(min: Vector4, max: Vector4): this {
        this.x = Math.max(min.x, Math.min(max.x, this.x));
        this.y = Math.max(min.y, Math.min(max.y, this.y));
        this.z = Math.max(min.z, Math.min(max.z, this.z));
        this.w = Math.max(min.w, Math.min(max.w, this.w));
        return this;
    }

    /**
     * Обмежує довжину вектора максимальним значенням.
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
     * Інвертує вектор (множить на -1).
     */
    negate(): this {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        this.w = -this.w;
        return this;
    }

    /**
     * Повертає рядкове представлення вектора.
     */
    toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)}, ${this.w.toFixed(2)})`;
    }

    /**
     * Повертає масив з компонентів вектора [x, y, z, w].
     */
    toArray(): [number, number, number, number] {
        return [this.x, this.y, this.z, this.w];
    }

    /**
     * Встановлює значення з масиву.
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