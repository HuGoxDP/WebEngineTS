import { EngineSettings } from "../EngineSettings";

/**
 * Клас для представлення 2D векторів і точок (x, y).
 * Використовується для 2D фізики, UI елементів та UV координат текстур.
 * Реалізує методи для оптимізації пам'яті (мутація замість створення нових об'єктів).
 */
export class Vector2 {
    public x: number;
    public y: number;

    /**
     * Створює новий Vector2.
     * @param x Координата X.
     * @param y Координата Y.
     */
    constructor(x: number = 0, y: number = 0) {
        this.x = x;
        this.y = y;
    }


    /** Повертає (0, 0) */
    static get zero(): Vector2 { return new Vector2(0, 0); }
    /** Повертає (1, 1) */
    static get one(): Vector2 { return new Vector2(1, 1); }
    /** Повертає (0, 1) */
    static get up(): Vector2 { return new Vector2(0, 1); }
    /** Повертає (0, -1) */
    static get down(): Vector2 { return new Vector2(0, -1); }
    /** Повертає (-1, 0) */
    static get left(): Vector2 { return new Vector2(-1, 0); }
    /** Повертає (1, 0) */
    static get right(): Vector2 { return new Vector2(1, 0); }
    /** Повертає (Infinity, Infinity) */
    static get positiveInfinity(): Vector2 { return new Vector2(Infinity, Infinity); }
    /** Повертає (-Infinity, -Infinity) */
    static get negativeInfinity(): Vector2 { return new Vector2(-Infinity, -Infinity); }


    /**
     * Встановлює значення x та y.
     */
    public set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    /**
     * Копіює значення з іншого вектора.
     * @param v Вектор, з якого копіюємо.
     */
    public copy(v: Vector2): this {
        this.x = v.x;
        this.y = v.y;
        return this;
    }

    /**
     * Створює копію цього вектора.
     */
    public clone(): Vector2 {
        return new Vector2(this.x, this.y);
    }


    /**
     * Додає інший вектор до цього.
     */
    public add(v: Vector2): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }

    /**
     * Віднімає інший вектор від цього.
     */
    public subtract(v: Vector2): this {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }

    /**
     * Множить цей вектор на інший покомпонентно (Scale).
     */
    public multiply(v: Vector2): this {
        this.x *= v.x;
        this.y *= v.y;
        return this;
    }

    /**
     * Ділить цей вектор на інший покомпонентно.
     */
    public divide(v: Vector2): this {
        this.x /= v.x;
        this.y /= v.y;
        return this;
    }

    /**
     * Множить вектор на скаляр (число).
     */
    public multiplyScalar(scalar: number): this {
        this.x *= scalar;
        this.y *= scalar;
        return this;
    }

    /**
     * Ділить вектор на скаляр.
     */
    public divideScalar(scalar: number): this {
        if (scalar !== 0) {
            const invScalar = 1 / scalar;
            this.x *= invScalar;
            this.y *= invScalar;
        } else {
            console.warn("Vector2: Ділення на нуль!");
            this.set(0, 0);
        }
        return this;
    }


    /**
     * Повертає довжину вектора (Magnitude).
     * Для порівняння краще використовувати sqrMagnitude.
     */
    public magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    /**
     * Повертає квадрат довжини вектора.
     * Швидше за magnitude, бо не використовує корінь.
     */
    public sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y;
    }

    /**
     * Нормалізує вектор (робить його довжину рівною 1).
     * Змінює поточний вектор.
     */
    public normalize(): this {
        return this.divideScalar(this.magnitude());
    }

    /**
     * Повертає відстань до іншого вектора.
     */
    public distanceTo(v: Vector2): number {
        return Math.sqrt(this.distanceToSquared(v));
    }

    /**
     * Повертає квадрат відстані до іншого вектора.
     */
    public distanceToSquared(v: Vector2): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        return dx * dx + dy * dy;
    }

    /**
     * Скалярний добуток векторів (Dot Product).
     */
    public dot(v: Vector2): number {
        return this.x * v.x + this.y * v.y;
    }

    /**
     * Лінійна інтерполяція між цим вектором та іншим.
     * @param v Цільовий вектор.
     * @param t Коефіцієнт (0-1).
     */
    public lerp(v: Vector2, t: number): this {
        // clamp01 t
        t = Math.max(0, Math.min(1, t));
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        return this;
    }

    /**
     * Перевіряє рівність векторів з урахуванням похибки (Epsilon).
     */
    public equals(v: Vector2, epsilon = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon
        );
    }

    /**
     * Повертає рядкове представлення вектора.
     */
    public toString(): string {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
    }

    /**
     * Конвертує в масив [x, y].
     */
    public toArray(): [number, number] {
        return [this.x, this.y];
    }
}