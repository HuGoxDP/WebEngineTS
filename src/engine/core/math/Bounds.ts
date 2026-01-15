import { Vector3 } from "./Vector3";
import { EngineSettings } from "../EngineSettings";

/**
 * Bounds.ts
 * Осесіметрична обмежувальна коробка (Axis-Aligned Bounding Box - AABB).
 * Використовується для: визначення меж мешів, culling, перевірки перетинів.
 * 
 * Bounds описується двома способами:
 * 1. center + size (основний)
 * 2. min + max (альтернативний через setMinMax)
 */
export class Bounds {
    /** Центр обмежувальної коробки */
    private _center: Vector3;
    /** Повний розмір коробки (ширина, висота, глибина) */
    private _size: Vector3;
    
    /**
     * Створює новий Bounds.
     * @param center Центр коробки (за замовчуванням (0,0,0))
     * @param size Розмір коробки (за замовчуванням (0,0,0))
     */
    constructor(center?: Vector3, size?: Vector3) {
        this._center = center ? center.clone() : new Vector3(0, 0, 0);
        this._size = size ? size.clone() : new Vector3(0, 0, 0);
    }

    /** Центр обмежувальної коробки */
    get center(): Vector3 {
        return this._center;
    }

    set center(value: Vector3) {
        this._center.copy(value);
    }

    /** Повний розмір коробки */
    get size(): Vector3 {
        return this._size;
    }

    set size(value: Vector3) {
        this._size.copy(value);
    }

    /** Половина розміру (від центру до краю) */
    get extents(): Vector3 {
        return new Vector3(
            this._size.x * 0.5,
            this._size.y * 0.5,
            this._size.z * 0.5
        );
    }

    set extents(value: Vector3) {
        this._size.set(value.x * 2, value.y * 2, value.z * 2);
    }

    /** Мінімальна точка коробки (лівий нижній дальній кут) */
    get min(): Vector3 {
        return new Vector3(
            this._center.x - this._size.x * 0.5,
            this._center.y - this._size.y * 0.5,
            this._center.z - this._size.z * 0.5
        );
    }

    set min(value: Vector3) {
        this.setMinMax(value, this.max);
    }

    /** Максимальна точка коробки (правий верхній ближній кут) */
    get max(): Vector3 {
        return new Vector3(
            this._center.x + this._size.x * 0.5,
            this._center.y + this._size.y * 0.5,
            this._center.z + this._size.z * 0.5
        );
    }

    set max(value: Vector3) {
        this.setMinMax(this.min, value);
    }


    /**
     * Встановлює центр та розмір.
     * @param center Центр коробки
     * @param size Розмір коробки
     */
    set(center: Vector3, size: Vector3): this {
        this._center.copy(center);
        this._size.copy(size);
        return this;
    }

    /**
     * Встановлює bounds через мінімальну та максимальну точки.
     * @param min Мінімальна точка
     * @param max Максимальна точка
     */
    setMinMax(min: Vector3, max: Vector3): this {
        // Розмір = max - min
        this._size.set(
            max.x - min.x,
            max.y - min.y,
            max.z - min.z
        );
        // Центр = min + size/2
        this._center.set(
            min.x + this._size.x * 0.5,
            min.y + this._size.y * 0.5,
            min.z + this._size.z * 0.5
        );
        return this;
    }

    /**
     * Копіює значення з іншого Bounds.
     * @param other Bounds для копіювання
     */
    copy(other: Bounds): this {
        this._center.copy(other._center);
        this._size.copy(other._size);
        return this;
    }

    /**
     * Створює копію цього Bounds.
     */
    clone(): Bounds {
        return new Bounds(this._center.clone(), this._size.clone());
    }


    /**
     * Перевіряє, чи містить Bounds вказану точку.
     * @param point Точка для перевірки
     * @returns true якщо точка всередині або на межі
     */
    contains(point: Vector3): boolean {
        const min = this.min;
        const max = this.max;
        
        return (
            point.x >= min.x && point.x <= max.x &&
            point.y >= min.y && point.y <= max.y &&
            point.z >= min.z && point.z <= max.z
        );
    }

    /**
     * Перевіряє, чи перетинається з іншим Bounds.
     * @param other Інший Bounds для перевірки
     * @returns true якщо є перетин
     */
    intersects(other: Bounds): boolean {
        const thisMin = this.min;
        const thisMax = this.max;
        const otherMin = other.min;
        const otherMax = other.max;

        // Перевіряємо перетин по кожній осі
        return (
            thisMin.x <= otherMax.x && thisMax.x >= otherMin.x &&
            thisMin.y <= otherMax.y && thisMax.y >= otherMin.y &&
            thisMin.z <= otherMax.z && thisMax.z >= otherMin.z
        );
    }


    /**
     * Розширює Bounds, щоб включити вказану точку.
     * @param point Точка для включення
     */
    encapsulate(point: Vector3): this;
    /**
     * Розширює Bounds, щоб включити інший Bounds.
     * @param bounds Bounds для включення
     */
    encapsulate(bounds: Bounds): this;
    encapsulate(pointOrBounds: Vector3 | Bounds): this {
        if (pointOrBounds instanceof Bounds) {
            // Encapsulate Bounds - включаємо min та max іншого bounds
            this.encapsulate(pointOrBounds.min);
            this.encapsulate(pointOrBounds.max);
        } else {
            // Encapsulate Point
            const point = pointOrBounds;
            const currentMin = this.min;
            const currentMax = this.max;

            const newMin = new Vector3(
                Math.min(currentMin.x, point.x),
                Math.min(currentMin.y, point.y),
                Math.min(currentMin.z, point.z)
            );
            const newMax = new Vector3(
                Math.max(currentMax.x, point.x),
                Math.max(currentMax.y, point.y),
                Math.max(currentMax.z, point.z)
            );

            this.setMinMax(newMin, newMax);
        }
        return this;
    }

    /**
     * Розширює Bounds на вказану величину по всіх осях.
     * @param amount Величина розширення (додається до розміру з обох сторін)
     */
    expand(amount: number): this;
    /**
     * Розширює Bounds на вказані величини по кожній осі.
     * @param amount Вектор величин розширення
     */
    expand(amount: Vector3): this;
    expand(amount: number | Vector3): this {
        if (typeof amount === 'number') {
            this._size.x += amount * 2;
            this._size.y += amount * 2;
            this._size.z += amount * 2;
        } else {
            this._size.x += amount.x * 2;
            this._size.y += amount.y * 2;
            this._size.z += amount.z * 2;
        }
        return this;
    }


    /**
     * Повертає найближчу точку на поверхні або всередині Bounds.
     * @param point Вхідна точка
     * @param out (Опціонально) Вектор для запису результату
     * @returns Найближча точка
     */
    closestPoint(point: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        const min = this.min;
        const max = this.max;

        result.set(
            Math.max(min.x, Math.min(max.x, point.x)),
            Math.max(min.y, Math.min(max.y, point.y)),
            Math.max(min.z, Math.min(max.z, point.z))
        );

        return result;
    }

    /**
     * Повертає квадрат відстані від точки до найближчої точки Bounds.
     * Якщо точка всередині - повертає 0.
     * @param point Точка для перевірки
     * @returns Квадрат відстані
     */
    sqrDistance(point: Vector3): number {
        const closest = this.closestPoint(point);
        return Vector3.distanceSquared(point, closest);
    }

    /**
     * Перевіряє перетин з променем.
     * @param origin Початок променя
     * @param direction Напрямок променя (має бути нормалізований)
     * @returns Відстань до точки перетину, або -1 якщо немає перетину
     */
    intersectRay(origin: Vector3, direction: Vector3): number {
        const min = this.min;
        const max = this.max;

        let tmin = -Infinity;
        let tmax = Infinity;

        // Перевірка по осі X
        if (direction.x !== 0) {
            const t1 = (min.x - origin.x) / direction.x;
            const t2 = (max.x - origin.x) / direction.x;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (origin.x < min.x || origin.x > max.x) {
            return -1; // Промінь паралельний і не перетинає
        }

        // Перевірка по осі Y
        if (direction.y !== 0) {
            const t1 = (min.y - origin.y) / direction.y;
            const t2 = (max.y - origin.y) / direction.y;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (origin.y < min.y || origin.y > max.y) {
            return -1;
        }

        // Перевірка по осі Z
        if (direction.z !== 0) {
            const t1 = (min.z - origin.z) / direction.z;
            const t2 = (max.z - origin.z) / direction.z;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (origin.z < min.z || origin.z > max.z) {
            return -1;
        }

        // Перевірка результату
        if (tmax < 0 || tmin > tmax) {
            return -1; // Немає перетину
        }

        // Повертаємо найближчу позитивну відстань
        return tmin >= 0 ? tmin : tmax;
    }


    /**
     * Порівнює два Bounds на рівність.
     * @param other Інший Bounds для порівняння
     * @param epsilon Похибка порівняння
     */
    equals(other: Bounds, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        const eps = epsilon;
        return (
            Math.abs(this._center.x - other._center.x) < eps &&
            Math.abs(this._center.y - other._center.y) < eps &&
            Math.abs(this._center.z - other._center.z) < eps &&
            Math.abs(this._size.x - other._size.x) < eps &&
            Math.abs(this._size.y - other._size.y) < eps &&
            Math.abs(this._size.z - other._size.z) < eps
        );
    }

    /**
     * Перевіряє чи Bounds порожній (розмір нуль).
     */
    isEmpty(): boolean {
        return this._size.x === 0 && this._size.y === 0 && this._size.z === 0;
    }

    /**
     * Скидає Bounds до початкових значень.
     */
    reset(): this {
        this._center.set(0, 0, 0);
        this._size.set(0, 0, 0);
        return this;
    }

    /**
     * Повертає рядкове представлення Bounds.
     */
    toString(): string {
        return `Bounds(Center: ${this._center.toString()}, Size: ${this._size.toString()})`;
    }

    // ==================== СТАТИЧНІ МЕТОДИ ====================

    /**
     * Створює Bounds з мінімальної та максимальної точок.
     * @param min Мінімальна точка
     * @param max Максимальна точка
     */
    static fromMinMax(min: Vector3, max: Vector3): Bounds {
        const bounds = new Bounds();
        bounds.setMinMax(min, max);
        return bounds;
    }

    /**
     * Створює Bounds, що охоплює набір точок.
     * @param points Масив точок
     */
    static fromPoints(points: Vector3[]): Bounds {
        if (points.length === 0) {
            return new Bounds();
        }

        const min = points[0].clone();
        const max = points[0].clone();

        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            min.x = Math.min(min.x, p.x);
            min.y = Math.min(min.y, p.y);
            min.z = Math.min(min.z, p.z);
            max.x = Math.max(max.x, p.x);
            max.y = Math.max(max.y, p.y);
            max.z = Math.max(max.z, p.z);
        }

        return Bounds.fromMinMax(min, max);
    }

    /**
     * Об'єднує два Bounds в один.
     * @param a Перший Bounds
     * @param b Другий Bounds
     */
    static merge(a: Bounds, b: Bounds): Bounds {
        const result = a.clone();
        result.encapsulate(b);
        return result;
    }

    /**
     * Перевіряє перетин двох Bounds (статичний метод).
     * @param a Перший Bounds
     * @param b Другий Bounds
     */
    static intersect(a: Bounds, b: Bounds): boolean {
        return a.intersects(b);
    }
}
