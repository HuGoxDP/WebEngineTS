import { Vector2 } from "./Vector2";

/**
 * Rect.ts
 * Представляє прямокутник у 2D просторі.
 * Використовується для: viewport камери, UI елементів, sprite bounds, texture coordinates.
 * 
 * Rect описується позицією (x, y) та розміром (width, height).
 * Позиція відповідає лівому нижньому куту прямокутника.
 */
export class Rect {
    /** Координата X лівого краю прямокутника */
    public x: number;
    /** Координата Y нижнього краю прямокутника */
    public y: number;
    /** Ширина прямокутника */
    public width: number;
    /** Висота прямокутника */
    public height: number;

    /**
     * Створює новий Rect.
     * @param x X координата (лівий край)
     * @param y Y координата (нижній край)
     * @param width Ширина
     * @param height Висота
     */
    constructor(x: number = 0, y: number = 0, width: number = 0, height: number = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    // ==================== ВЛАСТИВОСТІ ====================

    /** Мінімальна X координата (лівий край) */
    get xMin(): number {
        return this.x;
    }

    set xMin(value: number) {
        const xMax = this.xMax;
        this.x = value;
        this.width = xMax - this.x;
    }

    /** Максимальна X координата (правий край) */
    get xMax(): number {
        return this.x + this.width;
    }

    set xMax(value: number) {
        this.width = value - this.x;
    }

    /** Мінімальна Y координата (нижній край) */
    get yMin(): number {
        return this.y;
    }

    set yMin(value: number) {
        const yMax = this.yMax;
        this.y = value;
        this.height = yMax - this.y;
    }

    /** Максимальна Y координата (верхній край) */
    get yMax(): number {
        return this.y + this.height;
    }

    set yMax(value: number) {
        this.height = value - this.y;
    }

    /** Позиція прямокутника (лівий нижній кут) */
    get position(): Vector2 {
        return new Vector2(this.x, this.y);
    }

    set position(value: Vector2) {
        this.x = value.x;
        this.y = value.y;
    }

    /** Розмір прямокутника */
    get size(): Vector2 {
        return new Vector2(this.width, this.height);
    }

    set size(value: Vector2) {
        this.width = value.x;
        this.height = value.y;
    }

    /** Центр прямокутника */
    get center(): Vector2 {
        return new Vector2(
            this.x + this.width * 0.5,
            this.y + this.height * 0.5
        );
    }

    set center(value: Vector2) {
        this.x = value.x - this.width * 0.5;
        this.y = value.y - this.height * 0.5;
    }

    /** Мінімальна точка (лівий нижній кут) */
    get min(): Vector2 {
        return new Vector2(this.xMin, this.yMin);
    }

    set min(value: Vector2) {
        this.xMin = value.x;
        this.yMin = value.y;
    }

    /** Максимальна точка (правий верхній кут) */
    get max(): Vector2 {
        return new Vector2(this.xMax, this.yMax);
    }

    set max(value: Vector2) {
        this.xMax = value.x;
        this.yMax = value.y;
    }

    // ==================== МЕТОДИ ВСТАНОВЛЕННЯ ====================

    /**
     * Встановлює координати та розмір прямокутника.
     * @param x X координата
     * @param y Y координата
     * @param width Ширина
     * @param height Висота
     */
    set(x: number, y: number, width: number, height: number): this {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        return this;
    }

    /**
     * Копіює значення з іншого Rect.
     * @param other Rect для копіювання
     */
    copy(other: Rect): this {
        this.x = other.x;
        this.y = other.y;
        this.width = other.width;
        this.height = other.height;
        return this;
    }

    /**
     * Створює копію цього Rect.
     */
    clone(): Rect {
        return new Rect(this.x, this.y, this.width, this.height);
    }

    // ==================== МЕТОДИ ПЕРЕВІРКИ ====================

    /**
     * Перевіряє, чи містить прямокутник вказану точку.
     * @param point Точка для перевірки
     * @param allowInverse Якщо true, то враховує прямокутники з від'ємними розмірами
     * @returns true якщо точка всередині або на межі
     */
    contains(point: Vector2, allowInverse: boolean = false): boolean {
        if (!allowInverse) {
            return (
                point.x >= this.xMin &&
                point.x <= this.xMax &&
                point.y >= this.yMin &&
                point.y <= this.yMax
            );
        } else {
            // Враховуємо від'ємні розміри
            const minX = Math.min(this.x, this.x + this.width);
            const maxX = Math.max(this.x, this.x + this.width);
            const minY = Math.min(this.y, this.y + this.height);
            const maxY = Math.max(this.y, this.y + this.height);

            return (
                point.x >= minX &&
                point.x <= maxX &&
                point.y >= minY &&
                point.y <= maxY
            );
        }
    }

    /**
     * Перевіряє, чи перетинається цей прямокутник з іншим.
     * @param other Інший Rect для перевірки
     * @param allowInverse Якщо true, то враховує прямокутники з від'ємними розмірами
     * @returns true якщо є перетин
     */
    overlaps(other: Rect, allowInverse: boolean = false): boolean {
        if (!allowInverse) {
            return (
                this.xMin < other.xMax &&
                this.xMax > other.xMin &&
                this.yMin < other.yMax &&
                this.yMax > other.yMin
            );
        } else {
            // Враховуємо від'ємні розміри
            const thisMinX = Math.min(this.x, this.x + this.width);
            const thisMaxX = Math.max(this.x, this.x + this.width);
            const thisMinY = Math.min(this.y, this.y + this.height);
            const thisMaxY = Math.max(this.y, this.y + this.height);

            const otherMinX = Math.min(other.x, other.x + other.width);
            const otherMaxX = Math.max(other.x, other.x + other.width);
            const otherMinY = Math.min(other.y, other.y + other.height);
            const otherMaxY = Math.max(other.y, other.y + other.height);

            return (
                thisMinX < otherMaxX &&
                thisMaxX > otherMinX &&
                thisMinY < otherMaxY &&
                thisMaxY > otherMinY
            );
        }
    }

    // ==================== УТИЛІТИ ====================

    /**
     * Порівнює два Rect на рівність.
     * @param other Інший Rect для порівняння
     * @param epsilon Похибка порівняння
     */
    equals(other: Rect, epsilon: number = 1e-6): boolean {
        return (
            Math.abs(this.x - other.x) < epsilon &&
            Math.abs(this.y - other.y) < epsilon &&
            Math.abs(this.width - other.width) < epsilon &&
            Math.abs(this.height - other.height) < epsilon
        );
    }

    /**
     * Повертає рядкове представлення Rect.
     */
    toString(): string {
        return `Rect(x: ${this.x.toFixed(2)}, y: ${this.y.toFixed(2)}, width: ${this.width.toFixed(2)}, height: ${this.height.toFixed(2)})`;
    }

    // ==================== СТАТИЧНІ МЕТОДИ ====================

    /**
     * Створює Rect з мінімальної та максимальної точок.
     * @param xMin Мінімальна X координата
     * @param yMin Мінімальна Y координата
     * @param xMax Максимальна X координата
     * @param yMax Максимальна Y координата
     */
    static minMaxRect(xMin: number, yMin: number, xMax: number, yMax: number): Rect {
        return new Rect(xMin, yMin, xMax - xMin, yMax - yMin);
    }

    /**
     * Створює Rect з центру та розміру.
     * @param center Центр прямокутника
     * @param size Розмір прямокутника
     */
    static fromCenterSize(center: Vector2, size: Vector2): Rect {
        return new Rect(
            center.x - size.x * 0.5,
            center.y - size.y * 0.5,
            size.x,
            size.y
        );
    }

    /**
     * Створює Rect з позиції та розміру.
     * @param position Позиція (лівий нижній кут)
     * @param size Розмір
     */
    static fromPositionSize(position: Vector2, size: Vector2): Rect {
        return new Rect(position.x, position.y, size.x, size.y);
    }

    /**
     * Знаходить нормалізовані координати точки відносно прямокутника.
     * Повертає (0,0) для лівого нижнього кута та (1,1) для правого верхнього.
     * @param rect Прямокутник
     * @param point Точка
     */
    static pointToNormalized(rect: Rect, point: Vector2): Vector2 {
        return new Vector2(
            (point.x - rect.x) / rect.width,
            (point.y - rect.y) / rect.height
        );
    }

    /**
     * Знаходить точку за нормалізованими координатами.
     * @param rect Прямокутник
     * @param normalizedPoint Нормалізовані координати (0-1)
     */
    static normalizedToPoint(rect: Rect, normalizedPoint: Vector2): Vector2 {
        return new Vector2(
            rect.x + normalizedPoint.x * rect.width,
            rect.y + normalizedPoint.y * rect.height
        );
    }

    /**
     * Створює Rect, що містить обидва вказані прямокутники.
     * @param a Перший Rect
     * @param b Другий Rect
     */
    static union(a: Rect, b: Rect): Rect {
        const xMin = Math.min(a.xMin, b.xMin);
        const yMin = Math.min(a.yMin, b.yMin);
        const xMax = Math.max(a.xMax, b.xMax);
        const yMax = Math.max(a.yMax, b.yMax);
        return Rect.minMaxRect(xMin, yMin, xMax, yMax);
    }

    /**
     * Створює Rect, що є перетином двох прямокутників.
     * Якщо немає перетину, повертає Rect з нульовим розміром.
     * @param a Перший Rect
     * @param b Другий Rect
     */
    static intersection(a: Rect, b: Rect): Rect {
        const xMin = Math.max(a.xMin, b.xMin);
        const yMin = Math.max(a.yMin, b.yMin);
        const xMax = Math.min(a.xMax, b.xMax);
        const yMax = Math.min(a.yMax, b.yMax);

        // Якщо немає перетину
        if (xMin >= xMax || yMin >= yMax) {
            return new Rect(0, 0, 0, 0);
        }

        return Rect.minMaxRect(xMin, yMin, xMax, yMax);
    }

    // ==================== СТАТИЧНІ КОНСТАНТИ ====================

    /** Rect з нульовими координатами та розміром */
    static get zero(): Rect {
        return new Rect(0, 0, 0, 0);
    }
}
