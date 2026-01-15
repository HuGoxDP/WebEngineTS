import { EngineSettings } from "../EngineSettings.ts";

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

    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    // Статичні константи
    static get zero(): Vector4 { return new Vector4(0, 0, 0, 0); }
    static get one(): Vector4 { return new Vector4(1, 1, 1, 1); }
    static get positiveInfinity(): Vector4 { 
        return new Vector4(Infinity, Infinity, Infinity, Infinity); 
    }
    static get negativeInfinity(): Vector4 { 
        return new Vector4(-Infinity, -Infinity, -Infinity, -Infinity); 
    }

    /**
     * Додає два вектори.
     * @param out (Опціонально) Вектор, у який буде записано результат. Якщо не задано, створюється новий.
     */
    static add(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out || new Vector4();
        result.x = a.x + b.x;
        result.y = a.y + b.y;
        result.z = a.z + b.z;
        result.w = a.w + b.w;
        return result;
    }

    /**
     * Віднімає вектори (a - b).
     * @param out (Опціонально) Вектор для запису результату.
     */
    static subtract(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out || new Vector4();
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
        const result = out || new Vector4();
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
        const result = out || new Vector4();
        result.x = v.x * scalar;
        result.y = v.y * scalar;
        result.z = v.z * scalar;
        result.w = v.w * scalar;
        return result;
    }

    /**
     * Ділення вектора на число.
     */
    static divideScalar(v: Vector4, scalar: number, out?: Vector4): Vector4 {
        const result = out || new Vector4();
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
        const result = out || new Vector4();
        t = Math.max(0, Math.min(1, t)); // Clamp t between 0 and 1
        result.x = a.x + (b.x - a.x) * t;
        result.y = a.y + (b.y - a.y) * t;
        result.z = a.z + (b.z - a.z) * t;
        result.w = a.w + (b.w - a.w) * t;
        return result;
    }

    /**
     * Лінійна інтерполяція без обмеження t (може виходити за межі 0-1).
     */
    static lerpUnclamped(a: Vector4, b: Vector4, t: number, out?: Vector4): Vector4 {
        const result = out || new Vector4();
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
     * Нормалізує вектор (робить його довжину рівною 1).
     */
    static normalize(v: Vector4, out?: Vector4): Vector4 {
        const result = out || new Vector4();
        result.copy(v);
        return result.normalize();
    }

    /**
     * Повертає вектор з максимальними компонентами з двох векторів.
     */
    static max(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out || new Vector4();
        result.x = Math.max(a.x, b.x);
        result.y = Math.max(a.y, b.y);
        result.z = Math.max(a.z, b.z);
        result.w = Math.max(a.w, b.w);
        return result;
    }

    /**
     * Повертає вектор з мінімальними компонентами з двох векторів.
     */
    static min(a: Vector4, b: Vector4, out?: Vector4): Vector4 {
        const result = out || new Vector4();
        result.x = Math.min(a.x, b.x);
        result.y = Math.min(a.y, b.y);
        result.z = Math.min(a.z, b.z);
        result.w = Math.min(a.w, b.w);
        return result;
    }

    /**
     * Проектує вектор на інший вектор.
     */
    static project(vector: Vector4, onNormal: Vector4, out?: Vector4): Vector4 {
        const sqrMag = onNormal.sqrMagnitude();
        if (sqrMag < EngineSettings.Math.EPSILON) {
            return (out || new Vector4()).set(0, 0, 0, 0);
        }
        const dot = Vector4.dot(vector, onNormal);
        return Vector4.multiplyScalar(onNormal, dot / sqrMag, out);
    }

    // === Методи екземпляра ===

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
    equals(v: Vector4, epsilon = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon &&
            Math.abs(this.z - v.z) < epsilon &&
            Math.abs(this.w - v.w) < epsilon
        );
    }

    /**
     * Повертає довжину вектора (Magnitude).
     * Для порівняння краще використовувати sqrMagnitude.
     */
    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    }

    /**
     * Повертає квадрат довжини вектора.
     * Швидше за magnitude, бо не використовує корінь.
     */
    sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    /**
     * Нормалізує вектор (робить його довжину рівною 1).
     * Змінює поточний вектор.
     */
    normalize(): this {
        return this.divideScalar(this.magnitude());
    }

    /**
     * Повертає нормалізовану копію вектора, не змінюючи оригінал.
     */
    normalized(): Vector4 {
        return this.clone().normalize();
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
     * Лінійна інтерполяція між цим вектором та іншим.
     * @param v Цільовий вектор.
     * @param t Коефіцієнт (0-1).
     */
    lerp(v: Vector4, t: number): this {
        // clamp01 t
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
            const normalizedX = this.x / mag;
            const normalizedY = this.y / mag;
            const normalizedZ = this.z / mag;
            const normalizedW = this.w / mag;
            this.x = normalizedX * maxLength;
            this.y = normalizedY * maxLength;
            this.z = normalizedZ * maxLength;
            this.w = normalizedW * maxLength;
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
}
