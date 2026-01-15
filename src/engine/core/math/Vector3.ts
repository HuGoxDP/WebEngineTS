import { EngineSettings } from "../EngineSettings.ts";

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
     * Аліас для multiplyScalar (для сумісності з Unity).
     */
    static scale(v: Vector3, scalar: number, out?: Vector3): Vector3 {
        return Vector3.multiplyScalar(v, scalar, out);
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
     * @param t Параметр інтерполяції (0 = a, 1 = b). Обмежується до [0,1].
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
     * Лінійна інтерполяція без обмеження параметра t.
     */
    static lerpUnclamped(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
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

    /**
     * Повертає нормалізовану копію вектора.
     */
    static normalized(v: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (mag > 0) {
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
        const result = out || new Vector3();
        result.x = Math.min(a.x, b.x);
        result.y = Math.min(a.y, b.y);
        result.z = Math.min(a.z, b.z);
        return result;
    }

    /**
     * Повертає вектор з максимальними компонентами.
     */
    static max(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        result.x = Math.max(a.x, b.x);
        result.y = Math.max(a.y, b.y);
        result.z = Math.max(a.z, b.z);
        return result;
    }

    /**
     * Обмежує кожну компоненту вектора між відповідними компонентами min та max.
     */
    static clamp(v: Vector3, min: Vector3, max: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        result.x = Math.max(min.x, Math.min(max.x, v.x));
        result.y = Math.max(min.y, Math.min(max.y, v.y));
        result.z = Math.max(min.z, Math.min(max.z, v.z));
        return result;
    }

    /**
     * Обмежує довжину вектора максимальним значенням.
     */
    static clampMagnitude(v: Vector3, maxLength: number, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        const sqrMag = v.x * v.x + v.y * v.y + v.z * v.z;
        if (sqrMag > maxLength * maxLength) {
            const mag = Math.sqrt(sqrMag);
            const normalized = mag > 0 ? 1 / mag : 0;
            result.x = v.x * normalized * maxLength;
            result.y = v.y * normalized * maxLength;
            result.z = v.z * normalized * maxLength;
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
        const result = out || new Vector3();
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
        const result = out || new Vector3();
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
        const result = out || new Vector3();
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
        const denominator = Math.sqrt((from.x * from.x + from.y * from.y + from.z * from.z) * 
                                       (to.x * to.x + to.y * to.y + to.z * to.z));
        if (denominator < EngineSettings.Math.EPSILON) return 0;
        
        const dotProduct = from.x * to.x + from.y * to.y + from.z * to.z;
        const dot = Math.max(-1, Math.min(1, dotProduct / denominator));
        return Math.acos(dot) * (180 / Math.PI);
    }

    /**
     * Знаковий кут між векторами в градусах відносно осі.
     */
    static signedAngle(from: Vector3, to: Vector3, axis: Vector3): number {
        const unsignedAngle = Vector3.angle(from, to);
        const cross = Vector3.cross(from, to);
        const axisSign = axis.x * cross.x + axis.y * cross.y + axis.z * cross.z;
        const sign = Math.sign(axisSign);
        return unsignedAngle * sign;
    }

    // ==================== МЕТОДИ ЕКЗЕМПЛЯРА ====================

    // ==================== МЕТОДИ ЕКЗЕМПЛЯРА ====================

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
    equals(v: Vector3, epsilon = EngineSettings.Math.EPSILON): boolean {
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
        return this.divideScalar(this.magnitude());
    }

    /**
     * Повертає нормалізовану копію вектора (не мутує поточний).
     */
    get normalized(): Vector3 {
        const mag = this.magnitude();
        if (mag > 0) {
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
}