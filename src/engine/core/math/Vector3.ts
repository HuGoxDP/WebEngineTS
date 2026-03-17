// path: src/engine/math/Vector3.ts

import { EngineSettings } from '../EngineSettings';

/**
 * Vector3.ts
 * Математичний клас для роботи з 3D векторами.
 * Реалізує Zero-Allocation pattern через параметр 'out'.
 *
 * @remarks
 * API максимально наближений до Unity Vector3.
 */
export class Vector3 {
    public x: number;
    public y: number;
    public z: number;

    // ==================== CACHED READONLY INSTANCES ====================
    // Unity caches these to avoid allocation on every access
    private static readonly _zero = Object.freeze(new Vector3(0, 0, 0));
    private static readonly _one = Object.freeze(new Vector3(1, 1, 1));
    private static readonly _up = Object.freeze(new Vector3(0, 1, 0));
    private static readonly _down = Object.freeze(new Vector3(0, -1, 0));
    private static readonly _left = Object.freeze(new Vector3(-1, 0, 0));
    private static readonly _right = Object.freeze(new Vector3(1, 0, 0));
    private static readonly _forward = Object.freeze(new Vector3(0, 0, 1));
    private static readonly _back = Object.freeze(new Vector3(0, 0, -1));

    // Internal temp vectors for zero-allocation operations
    private static readonly _temp1 = new Vector3();

    constructor(x: number = 0, y: number = 0, z: number = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    // ==================== STATIC READONLY CONSTANTS ====================
    // WARNING: These return shared instances. Do NOT mutate!
    // Clone if you need a mutable copy: Vector3.zero.clone()

    /** Returns (0, 0, 0). Shared instance — do not mutate! */
    static get zero(): Vector3 { return Vector3._zero; }
    /** Returns (1, 1, 1). Shared instance — do not mutate! */
    static get one(): Vector3 { return Vector3._one; }
    /** Returns (0, 1, 0). Shared instance — do not mutate! */
    static get up(): Vector3 { return Vector3._up; }
    /** Returns (0, -1, 0). Shared instance — do not mutate! */
    static get down(): Vector3 { return Vector3._down; }
    /** Returns (-1, 0, 0). Shared instance — do not mutate! */
    static get left(): Vector3 { return Vector3._left; }
    /** Returns (1, 0, 0). Shared instance — do not mutate! */
    static get right(): Vector3 { return Vector3._right; }
    /** Returns (0, 0, 1). Shared instance — do not mutate! */
    static get forward(): Vector3 { return Vector3._forward; }
    /** Returns (0, 0, -1). Shared instance — do not mutate! */
    static get back(): Vector3 { return Vector3._back; }

    // ==================== STATIC METHODS ====================

    /**
     * Додає два вектори.
     * @param out (Опціонально) Вектор, у який буде записано результат. Якщо не задано, створюється новий.
     */
    static add(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = a.x + b.x;
        result.y = a.y + b.y;
        result.z = a.z + b.z;
        return result;
    }

    /**
     * Віднімає вектори (a - b).
     * @param out (Опціонально) Вектор для запису результату.
     */
    static subtract(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = a.x - b.x;
        result.y = a.y - b.y;
        result.z = a.z - b.z;
        return result;
    }

    /**
     * Покомпонентне множення векторів (Scale).
     */
    static multiply(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = a.x * b.x;
        result.y = a.y * b.y;
        result.z = a.z * b.z;
        return result;
    }

    /**
     * Множення вектора на число.
     */
    static multiplyScalar(v: Vector3, scalar: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = v.x * scalar;
        result.y = v.y * scalar;
        result.z = v.z * scalar;
        return result;
    }

    /**
     * Аліас для multiplyScalar (для сумісності з Unity).
     */
    static scale(v: Vector3, scalar: number, out?: Vector3): Vector3 {
        return Vector3.multiplyScalar(v, scalar, out);
    }

    /**
     * Ділення вектора на число.
     */
    static divideScalar(v: Vector3, scalar: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            result.x = v.x * invScalar;
            result.y = v.y * invScalar;
            result.z = v.z * invScalar;
        } else {
            console.warn("Vector3: Division by zero");
            result.set(0, 0, 0);
        }
        return result;
    }

    /**
     * Лінійна інтерполяція між двома векторами.
     * @param t Параметр інтерполяції (0 = a, 1 = b). Обмежується до [0,1].
     */
    static lerp(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        t = Math.max(0, Math.min(1, t)); // Clamp t between 0 and 1
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
        return result;
    }

    /**
     * Лінійна інтерполяція без обмеження параметра t.
     */
    static lerpUnclamped(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
        return result;
    }

    /**
     * Сферична інтерполяція між двома векторами.
     * @param t Параметр інтерполяції (0 = a, 1 = b). Обмежується до [0,1].
     */
    static slerp(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        t = Math.max(0, Math.min(1, t));

        const magA = a.magnitude();
        const magB = b.magnitude();

        if (magA < EngineSettings.Math.EPSILON || magB < EngineSettings.Math.EPSILON) {
            return Vector3.lerp(a, b, t, result);
        }

        // Normalize inputs
        const ax = a.x / magA, ay = a.y / magA, az = a.z / magA;
        const bx = b.x / magB, by = b.y / magB, bz = b.z / magB;

        // Dot product
        let dot = ax * bx + ay * by + az * bz;
        dot = Math.max(-1, Math.min(1, dot));

        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);

        let ratioA: number, ratioB: number;
        if (sinTheta < EngineSettings.Math.EPSILON) {
            // Vectors are parallel, use lerp
            ratioA = 1 - t;
            ratioB = t;
        } else {
            ratioA = Math.sin((1 - t) * theta) / sinTheta;
            ratioB = Math.sin(t * theta) / sinTheta;
        }

        // Interpolate magnitude
        const mag = magA + (magB - magA) * t;

        result.x = (ax * ratioA + bx * ratioB) * mag;
        result.y = (ay * ratioA + by * ratioB) * mag;
        result.z = (az * ratioA + bz * ratioB) * mag;

        return result;
    }

    /**
     * Сферична інтерполяція без обмеження t.
     */
    static slerpUnclamped(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();

        const magA = a.magnitude();
        const magB = b.magnitude();

        if (magA < EngineSettings.Math.EPSILON || magB < EngineSettings.Math.EPSILON) {
            return Vector3.lerpUnclamped(a, b, t, result);
        }

        const ax = a.x / magA, ay = a.y / magA, az = a.z / magA;
        const bx = b.x / magB, by = b.y / magB, bz = b.z / magB;

        let dot = ax * bx + ay * by + az * bz;
        dot = Math.max(-1, Math.min(1, dot));

        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);

        let ratioA: number, ratioB: number;
        if (sinTheta < EngineSettings.Math.EPSILON) {
            ratioA = 1 - t;
            ratioB = t;
        } else {
            ratioA = Math.sin((1 - t) * theta) / sinTheta;
            ratioB = Math.sin(t * theta) / sinTheta;
        }

        const mag = magA + (magB - magA) * t;

        result.x = (ax * ratioA + bx * ratioB) * mag;
        result.y = (ay * ratioA + by * ratioB) * mag;
        result.z = (az * ratioA + bz * ratioB) * mag;

        return result;
    }

    /**
     * Скалярний добуток (Dot Product).
     */
    static dot(a: Vector3, b: Vector3): number {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    /**
     * Векторний добуток (Cross Product).
     */
    static cross(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const ax = a.x, ay = a.y, az = a.z;
        const bx = b.x, by = b.y, bz = b.z;

        result.x = ay * bz - az * by;
        result.y = az * bx - ax * bz;
        result.z = ax * by - ay * bx;
        return result;
    }

    /**
     * Відстань між векторами.
     */
    static distance(a: Vector3, b: Vector3): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Квадрат відстані (швидше, без кореня).
     */
    static distanceSquared(a: Vector3, b: Vector3): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Повертає нормалізовану копію вектора.
     */
    static normalized(v: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (mag > EngineSettings.Math.EPSILON) {
            const invMag = 1 / mag;
            result.x = v.x * invMag;
            result.y = v.y * invMag;
            result.z = v.z * invMag;
        } else {
            result.x = result.y = result.z = 0;
        }
        return result;
    }

    /**
     * Повертає вектор з мінімальними компонентами.
     */
    static min(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = Math.min(a.x, b.x);
        result.y = Math.min(a.y, b.y);
        result.z = Math.min(a.z, b.z);
        return result;
    }

    /**
     * Повертає вектор з максимальними компонентами.
     */
    static max(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = Math.max(a.x, b.x);
        result.y = Math.max(a.y, b.y);
        result.z = Math.max(a.z, b.z);
        return result;
    }

    /**
     * Обмежує кожну компоненту вектора між відповідними компонентами min та max.
     */
    static clamp(v: Vector3, min: Vector3, max: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = Math.max(min.x, Math.min(max.x, v.x));
        result.y = Math.max(min.y, Math.min(max.y, v.y));
        result.z = Math.max(min.z, Math.min(max.z, v.z));
        return result;
    }

    /**
     * Обмежує довжину вектора максимальним значенням.
     */
    static clampMagnitude(v: Vector3, maxLength: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const sqrMag = v.x * v.x + v.y * v.y + v.z * v.z;
        if (sqrMag > maxLength * maxLength) {
            const mag = Math.sqrt(sqrMag);
            const scale = maxLength / mag;
            result.x = v.x * scale;
            result.y = v.y * scale;
            result.z = v.z * scale;
        } else {
            result.x = v.x;
            result.y = v.y;
            result.z = v.z;
        }
        return result;
    }

    /**
     * Відображає вектор відносно площини, заданої нормаллю.
     */
    static reflect(direction: Vector3, normal: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const dot2 = 2 * (direction.x * normal.x + direction.y * normal.y + direction.z * normal.z);
        result.x = direction.x - dot2 * normal.x;
        result.y = direction.y - dot2 * normal.y;
        result.z = direction.z - dot2 * normal.z;
        return result;
    }

    /**
     * Проєктує вектор a на вектор b.
     */
    static project(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const sqrMag = b.x * b.x + b.y * b.y + b.z * b.z;
        if (sqrMag < EngineSettings.Math.EPSILON) {
            result.set(0, 0, 0);
            return result;
        }
        const dot = a.x * b.x + a.y * b.y + a.z * b.z;
        const scale = dot / sqrMag;
        result.x = b.x * scale;
        result.y = b.y * scale;
        result.z = b.z * scale;
        return result;
    }

    /**
     * Проєктує вектор на площину, задану нормаллю.
     */
    static projectOnPlane(vector: Vector3, planeNormal: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const sqrMag = planeNormal.x * planeNormal.x + planeNormal.y * planeNormal.y + planeNormal.z * planeNormal.z;
        if (sqrMag < EngineSettings.Math.EPSILON) {
            result.copy(vector);
            return result;
        }
        const dot = vector.x * planeNormal.x + vector.y * planeNormal.y + vector.z * planeNormal.z;
        const scale = dot / sqrMag;
        result.x = vector.x - planeNormal.x * scale;
        result.y = vector.y - planeNormal.y * scale;
        result.z = vector.z - planeNormal.z * scale;
        return result;
    }

    /**
     * Кут між векторами в градусах.
     */
    static angle(from: Vector3, to: Vector3): number {
        const denominator = Math.sqrt(
            (from.x * from.x + from.y * from.y + from.z * from.z) *
            (to.x * to.x + to.y * to.y + to.z * to.z)
        );
        if (denominator < EngineSettings.Math.EPSILON) return 0;

        const dotProduct = from.x * to.x + from.y * to.y + from.z * to.z;
        const dot = Math.max(-1, Math.min(1, dotProduct / denominator));
        return Math.acos(dot) * (180 / Math.PI);
    }

    /**
     * Знаковий кут між векторами в градусах відносно осі.
     * Uses internal temp to avoid allocation.
     */
    static signedAngle(from: Vector3, to: Vector3, axis: Vector3): number {
        const unsignedAngle = Vector3.angle(from, to);
        // Use internal temp vector to avoid allocation
        Vector3.cross(from, to, Vector3._temp1);
        const cross = Vector3._temp1;
        const axisSign = axis.x * cross.x + axis.y * cross.y + axis.z * cross.z;
        const sign = axisSign >= 0 ? 1 : -1;
        return unsignedAngle * sign;
    }

    /**
     * Рухає точку current до target, не перевищуючи maxDistanceDelta.
     * Unity-like MoveTowards.
     */
    static moveTowards(current: Vector3, target: Vector3, maxDistanceDelta: number, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();

        const dx = target.x - current.x;
        const dy = target.y - current.y;
        const dz = target.z - current.z;

        const sqrDist = dx * dx + dy * dy + dz * dz;

        if (sqrDist === 0 || (maxDistanceDelta >= 0 && sqrDist <= maxDistanceDelta * maxDistanceDelta)) {
            result.x = target.x;
            result.y = target.y;
            result.z = target.z;
            return result;
        }

        const dist = Math.sqrt(sqrDist);
        const scale = maxDistanceDelta / dist;

        result.x = current.x + dx * scale;
        result.y = current.y + dy * scale;
        result.z = current.z + dz * scale;

        return result;
    }

    /**
     * Плавно переміщує вектор до цілі з згладжуванням.
     * Unity-like SmoothDamp (simplified version).
     * @param current Поточна позиція
     * @param target Цільова позиція
     * @param currentVelocity Поточна швидкість (буде модифікована)
     * @param smoothTime Приблизний час досягнення цілі
     * @param maxSpeed Максимальна швидкість (Infinity за замовчуванням)
     * @param deltaTime Час кадру
     * @param out Вектор для результату
     */
    static smoothDamp(
        current: Vector3,
        target: Vector3,
        currentVelocity: Vector3,
        smoothTime: number,
        maxSpeed: number = Infinity,
        deltaTime: number,
        out?: Vector3
    ): Vector3 {
        const result = out ?? new Vector3();

        // Clamp smoothTime to minimum
        smoothTime = Math.max(0.0001, smoothTime);

        const omega = 2 / smoothTime;
        const x = omega * deltaTime;
        const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

        let dx = current.x - target.x;
        let dy = current.y - target.y;
        let dz = current.z - target.z;

        // Clamp maximum speed
        const maxChange = maxSpeed * smoothTime;
        const sqrMag = dx * dx + dy * dy + dz * dz;
        if (sqrMag > maxChange * maxChange) {
            const mag = Math.sqrt(sqrMag);
            dx = (dx / mag) * maxChange;
            dy = (dy / mag) * maxChange;
            dz = (dz / mag) * maxChange;
        }

        const targetX = current.x - dx;
        const targetY = current.y - dy;
        const targetZ = current.z - dz;

        const tempX = (currentVelocity.x + omega * dx) * deltaTime;
        const tempY = (currentVelocity.y + omega * dy) * deltaTime;
        const tempZ = (currentVelocity.z + omega * dz) * deltaTime;

        currentVelocity.x = (currentVelocity.x - omega * tempX) * exp;
        currentVelocity.y = (currentVelocity.y - omega * tempY) * exp;
        currentVelocity.z = (currentVelocity.z - omega * tempZ) * exp;

        result.x = targetX + (dx + tempX) * exp;
        result.y = targetY + (dy + tempY) * exp;
        result.z = targetZ + (dz + tempZ) * exp;

        // Prevent overshooting
        const origMinusCurrentX = target.x - current.x;
        const origMinusCurrentY = target.y - current.y;
        const origMinusCurrentZ = target.z - current.z;
        const outMinusOrigX = result.x - target.x;
        const outMinusOrigY = result.y - target.y;
        const outMinusOrigZ = result.z - target.z;

        if (origMinusCurrentX * outMinusOrigX + origMinusCurrentY * outMinusOrigY + origMinusCurrentZ * outMinusOrigZ > 0) {
            result.x = target.x;
            result.y = target.y;
            result.z = target.z;
            currentVelocity.x = (result.x - target.x) / deltaTime;
            currentVelocity.y = (result.y - target.y) / deltaTime;
            currentVelocity.z = (result.z - target.z) / deltaTime;
        }

        return result;
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Встановлює значення компонентів.
     * @returns this для ланцюгових викликів
     */
    set(x: number = 0, y: number = 0, z: number = 0): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    /**
     * Встановлює тільки X компонент.
     */
    setX(x: number): this {
        this.x = x;
        return this;
    }

    /**
     * Встановлює тільки Y компонент.
     */
    setY(y: number): this {
        this.y = y;
        return this;
    }

    /**
     * Встановлює тільки Z компонент.
     */
    setZ(z: number): this {
        this.z = z;
        return this;
    }

    /**
     * Копіює значення з іншого вектора.
     */
    copy(v: Vector3): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

    /**
     * Створює копію вектора.
     */
    clone(): Vector3 {
        return new Vector3(this.x, this.y, this.z);
    }

    /**
     * Додає вектор (мутує поточний).
     */
    add(v: Vector3): this {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    /**
     * Віднімає вектор (мутує поточний).
     */
    subtract(v: Vector3): this {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    /**
     * Покомпонентне множення (мутує поточний).
     */
    multiply(v: Vector3): this {
        this.x *= v.x;
        this.y *= v.y;
        this.z *= v.z;
        return this;
    }

    /**
     * Множення на скаляр (мутує поточний).
     */
    multiplyScalar(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        this.z *= scalar;
        return this;
    }

    /**
     * Ділення на скаляр (мутує поточний).
     */
    divideScalar(scalar: number): this {
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            this.x *= invScalar;
            this.y *= invScalar;
            this.z *= invScalar;
        } else {
            console.warn("Vector3: Division by zero");
            this.set(0, 0, 0);
        }
        return this;
    }

    /**
     * Перевіряє рівність з іншим вектором (з точністю epsilon).
     */
    equals(v: Vector3, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon &&
            Math.abs(this.z - v.z) < epsilon
        );
    }

    /**
     * Повертає довжину вектора (magnitude).
     */
    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    /**
     * Повертає квадрат довжини (швидше за magnitude).
     */
    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    /**
     * Нормалізує вектор (робить довжину = 1, мутує поточний).
     */
    normalize(): this {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return this.divideScalar(mag);
        }
        return this.set(0, 0, 0);
    }

    /**
     * Повертає нормалізовану копію вектора (не мутує поточний).
     */
    get normalized(): Vector3 {
        const mag = this.magnitude();
        if (mag > EngineSettings.Math.EPSILON) {
            return new Vector3(this.x / mag, this.y / mag, this.z / mag);
        }
        return new Vector3(0, 0, 0);
    }

    /**
     * Скалярний добуток з іншим вектором.
     */
    dot(v: Vector3): number {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    /**
     * Векторний добуток (мутує поточний).
     */
    cross(v: Vector3): this {
        const ax = this.x, ay = this.y, az = this.z;
        const bx = v.x, by = v.y, bz = v.z;

        this.x = ay * bz - az * by;
        this.y = az * bx - ax * bz;
        this.z = ax * by - ay * bx;
        return this;
    }

    /**
     * Відстань до іншого вектора.
     */
    distanceTo(v: Vector3): number {
        return Vector3.distance(this, v);
    }

    /**
     * Квадрат відстані до іншого вектора.
     */
    distanceToSquared(v: Vector3): number {
        return Vector3.distanceSquared(this, v);
    }

    /**
     * Перетворює вектор у рядок для виводу.
     */
    toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`;
    }

    // ==================== QUATERNION ROTATION ====================

    /**
     * Applies a quaternion rotation to this vector in-place.
     *
     * @param q — the rotation quaternion (must be normalized).
     * @returns this (for chaining).
     *
     * @remarks
     * Equivalent to Unity's `Quaternion * Vector3` operator.
     * Uses the optimized formula: v' = q * v * q⁻¹
     */
    applyQuaternion(q: { x: number; y: number; z: number; w: number }): this {
        const vx = this.x, vy = this.y, vz = this.z;
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;

        // Calculate quaternion * vector (intermediate)
        const ix = qw * vx + qy * vz - qz * vy;
        const iy = qw * vy + qz * vx - qx * vz;
        const iz = qw * vz + qx * vy - qy * vx;
        const iw = -qx * vx - qy * vy - qz * vz;

        // Calculate result = intermediate * quaternion⁻¹
        this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
        this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
        this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;

        return this;
    }

    /**
     * Returns a new vector that is this vector rotated by a quaternion.
     *
     * @param q — the rotation quaternion (must be normalized).
     * @param out — optional pre-allocated result vector.
     * @returns the rotated vector.
     *
     * @remarks
     * Non-mutating variant of {@link applyQuaternion}.
     */
    rotatedBy(q: { x: number; y: number; z: number; w: number }, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = this.x;
        result.y = this.y;
        result.z = this.z;
        return result.applyQuaternion(q);
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only. Do NOT expose to users.

    /**
     * @internal
     * Copies values to a Three.js Vector3-like object.
     * Used by sync/adapter layer.
     */
    _copyToThree(threeVec: { x: number; y: number; z: number }): void {
        threeVec.x = this.x;
        threeVec.y = this.y;
        threeVec.z = this.z;
    }

    /**
     * @internal
     * Copies values from a Three.js Vector3-like object.
     * Used by sync/adapter layer.
     */
    _copyFromThree(threeVec: { x: number; y: number; z: number }): this {
        this.x = threeVec.x;
        this.y = threeVec.y;
        this.z = threeVec.z;
        return this;
    }
}