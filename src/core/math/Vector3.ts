import { EngineSettings } from "../EngineSettings";

/**
 * Vector3.ts
 * Математичний клас для роботи з 3D векторами.
 * Реалізує Zero-Allocation pattern через параметр 'out'.
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

    /**
     * Додає два вектори.
     * @param out (Опціонально) Вектор, у який буде записано результат. Якщо не задано, створюється новий.
     */
    static add(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
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
        const result = out || new Vector3();
        result.x = a.x - b.x;
        result.y = a.y - b.y;
        result.z = a.z - b.z;
        return result;
    }

    /**
     * Покомпонентне множення векторів (Scale).
     */
    static multiply(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        result.x = a.x * b.x;
        result.y = a.y * b.y;
        result.z = a.z * b.z;
        return result;
    }

    /**
     * Множення вектора на число.
     */
    static multiplyScalar(v: Vector3, scalar: number, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        result.x = v.x * scalar;
        result.y = v.y * scalar;
        result.z = v.z * scalar;
        return result;
    }

    /**
     * Ділення вектора на число.
     */
    static divideScalar(v: Vector3, scalar: number, out?: Vector3): Vector3 {
        const result = out || new Vector3();
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
     */
    static lerp(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        t = Math.max(0, Math.min(1, t)); // Clamp t between 0 and 1
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
        return result;
    }

    /**
     * Векторний добуток (Cross Product).
     */
    static cross(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
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

    copy(v: Vector3): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

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

    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

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

    distanceTo(v: Vector3): number {
        return Vector3.distance(this, v);
    }

    distanceToSquared(v: Vector3): number {
        return Vector3.distanceSquared(this, v);
    }

    toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`;
    }
}