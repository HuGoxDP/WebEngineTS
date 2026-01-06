import { EngineSettings } from "../EngineSettings";

/**
 * Vector3.ts
 * Математичний клас для роботи з 3D векторами.
 */
export class Vector3 {
    public x: number;
    public y: number;
    public z: number;
    constructor(x: number = 0, y: number = 0, z: number = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    static get zero(): Vector3 { return new Vector3(0, 0, 0); }
    static get one(): Vector3 { return new Vector3(1, 1, 1); }
    static get up(): Vector3 { return new Vector3(0, 1, 0); }
    static get down(): Vector3 { return new Vector3(0, -1, 0); }
    static get left(): Vector3 { return new Vector3(-1, 0, 0); }
    static get right(): Vector3 { return new Vector3(1, 0, 0); }
    static get forward(): Vector3 { return new Vector3(0, 0, 1); }
    static get back(): Vector3 { return new Vector3(0, 0, -1); }

    set(x: number = 0, y: number = 0, z: number = 0): this {
        this.x = x;
        this.y = y;
        this.z = z;
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

    /**
     * Копіює значення з іншого вектора в поточний.
     */
    copy(v: Vector3): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

    /**
     * Створює глибоку копію поточного вектора.
     */
   clone(): Vector3 {
        return new Vector3(this.x, this.y, this.z);
    }


    add(v: Vector3): this {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    subtract(v: Vector3): this {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    multiply(v: Vector3): this {
        this.x *= v.x;
        this.y *= v.y;
        this.z *= v.z;
        return this;
    }

    multiplyScalar(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        this.z *= scalar;
        return this;
    }

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

    equals(v: Vector3, epsilon = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon &&
            Math.abs(this.z - v.z) < epsilon
        );
    }

    /**
     * Довжина вектора (Magnitude).
     * Використовує квадратний корінь (повільна операція).
     */
    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    /**
     * Квадрат довжини.
     * Набагато швидше за magnitude(). Використовуй для порівняння відстаней.
     */
    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    /**
     * Нормалізує вектор (робить довжину рівною 1).
     */
    normalize(): this {
        return this.divideScalar(this.magnitude());
    }

    dot(v: Vector3): number {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    cross(v: Vector3): this {
        const ax = this.x, ay = this.y, az = this.z;
        const bx = v.x, by = v.y, bz = v.z;

        this.x = ay * bz - az * by;
        this.y = az * bx - ax * bz;
        this.z = ax * by - ay * bx;
        return this;
    }

    distanceToSquared(v: Vector3): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Відстань до іншого вектора.
     */
    distanceTo(v: Vector3): number {
        return Math.sqrt(this.distanceToSquared(v));
    }


    /**
     * Лінійна інтерполяція між двома векторами.
     * Повертає НОВИЙ вектор.
     */
    static lerp(a: Vector3, b: Vector3, t: number): Vector3 {
        t = Math.max(0, Math.min(1, t));
        return new Vector3(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            a.z + (b.z - a.z) * t
        );
    }

    /**
     * Створює новий вектор суми (щоб не змінювати оригінали)
     */
    static add(a: Vector3, b: Vector3): Vector3 {
        return new Vector3(a.x + b.x, a.y + b.y, a.z + b.z);
    }
    /**
     * Створює новий вектор віднімання (щоб не змінювати оригінали)
     */
    static subtract(a: Vector3, b: Vector3): Vector3 {
        return new Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    /**
     * Створює новий вектор множення (щоб не змінювати оригінали)
     */
    static multiply(a: Vector3, b: Vector3): Vector3 {
        return new Vector3(a.x * b.x, a.y * b.y, a.z * b.z);
    }
    /**
     * Створює новий вектор скалярного множення (щоб не змінювати оригінали)
     */
    static multiplyScalar(v: Vector3, scalar: number): Vector3 {
        return new Vector3(v.x * scalar, v.y * scalar, v.z * scalar);
    }
    /**
     * Створює новий вектор скалярного ділення (щоб не змінювати оригінали)
     */
    static divideScalar(v: Vector3, scalar: number): Vector3 {
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            return new Vector3(v.x * invScalar, v.y * invScalar, v.z * invScalar);
        } else {
            console.warn("Vector3: Division by zero");
            return Vector3.zero;
        }
    }

    toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`;
    }
}