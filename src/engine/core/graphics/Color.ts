import * as THREE from 'three';

/**
 * Клас для роботи з кольорами.
 * Обгортка над THREE.Color, що приховує залежність від Three.js.
 */
export class Color {
    /** @internal Внутрішній об'єкт Three.js (недоступний для сценаріїв) */
    private readonly _threeColor: THREE.Color;

    // ===== Статичні константи (часто використовувані кольори) =====

    public static readonly white: Color = new Color(1, 1, 1);
    public static readonly black: Color = new Color(0, 0, 0);
    public static readonly red: Color = new Color(1, 0, 0);
    public static readonly green: Color = new Color(0, 1, 0);
    public static readonly blue: Color = new Color(0, 0, 1);
    public static readonly yellow: Color = new Color(1, 1, 0);
    public static readonly cyan: Color = new Color(0, 1, 1);
    public static readonly magenta: Color = new Color(1, 0, 1);
    public static readonly gray: Color = new Color(0.5, 0.5, 0.5);
    public static readonly orange: Color = new Color(1, 0.647, 0);

    /**
     * Створює новий колір.
     * @param r Червоний компонент (0-1) або hex-значення
     * @param g Зелений компонент (0-1)
     * @param b Синій компонент (0-1)
     */
    constructor(r: number = 0, g?: number, b?: number) {
        // Якщо передано тільки одне число — це hex
        if (g === undefined && b === undefined) {
            this._threeColor = new THREE.Color(r);
        } else {
            this._threeColor = new THREE.Color(r, g ?? 0, b ?? 0);
        }
    }

    // ===== Геттери та сеттери для компонентів =====

    /** Червоний компонент (0-1) */
    public get r(): number {
        return this._threeColor.r;
    }

    public set r(value: number) {
        this._threeColor.r = value;
    }

    /** Зелений компонент (0-1) */
    public get g(): number {
        return this._threeColor.g;
    }

    public set g(value: number) {
        this._threeColor.g = value;
    }

    /** Синій компонент (0-1) */
    public get b(): number {
        return this._threeColor.b;
    }

    public set b(value: number) {
        this._threeColor.b = value;
    }

    // ===== Методи встановлення =====

    /**
     * Встановлює RGB компоненти кольору.
     * @param r Червоний (0-1)
     * @param g Зелений (0-1)
     * @param b Синій (0-1)
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public set(r: number, g: number, b: number): this {
        this._threeColor.setRGB(r, g, b);
        return this;
    }

    /**
     * Встановлює колір з hex-значення.
     * @param hex Числове hex-значення (наприклад, 0xff0000)
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public setHex(hex: number): this {
        this._threeColor.setHex(hex);
        return this;
    }

    /**
     * Встановлює колір з HSL (Hue, Saturation, Lightness).
     * @param h Відтінок (0-1)
     * @param s Насиченість (0-1)
     * @param l Яскравість (0-1)
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public setHSL(h: number, s: number, l: number): this {
        this._threeColor.setHSL(h, s, l);
        return this;
    }

    /**
     * Встановлює колір з CSS-рядка.
     * @param style CSS колір (наприклад, "#ff0000", "rgb(255,0,0)", "red")
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public setStyle(style: string): this {
        this._threeColor.setStyle(style);
        return this;
    }

    // ===== Методи копіювання =====

    /**
     * Копіює значення з іншого кольору.
     * @param color Колір для копіювання
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public copy(color: Color): this {
        this._threeColor.copy(color._threeColor);
        return this;
    }

    /**
     * Створює копію цього кольору.
     * @returns Новий екземпляр Color
     */
    public clone(): Color {
        return new Color(this.r, this.g, this.b);
    }

    // ===== Математичні операції =====

    /**
     * Додає компоненти іншого кольору.
     * @param color Колір для додавання
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public add(color: Color): this {
        this._threeColor.add(color._threeColor);
        return this;
    }

    /**
     * Множить компоненти на інший колір.
     * @param color Колір для множення
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public multiply(color: Color): this {
        this._threeColor.multiply(color._threeColor);
        return this;
    }

    /**
     * Множить всі компоненти на скаляр.
     * @param scalar Множник
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public multiplyScalar(scalar: number): this {
        this._threeColor.multiplyScalar(scalar);
        return this;
    }

    /**
     * Лінійна інтерполяція до іншого кольору.
     * @param color Цільовий колір
     * @param alpha Коефіцієнт інтерполяції (0-1)
     * @returns Поточний екземпляр для ланцюжка викликів
     */
    public lerp(color: Color, alpha: number): this {
        this._threeColor.lerp(color._threeColor, alpha);
        return this;
    }

    // ===== Методи конвертації =====

    /**
     * Повертає hex-значення кольору.
     * @returns Числове hex-значення
     */
    public getHex(): number {
        return this._threeColor.getHex();
    }

    /**
     * Повертає CSS hex-рядок.
     * @returns Рядок формату "#rrggbb"
     */
    public getHexString(): string {
        return '#' + this._threeColor.getHexString();
    }

    /**
     * Повертає HSL компоненти кольору.
     * @returns Об'єкт з h, s, l компонентами
     */
    public getHSL(): { h: number; s: number; l: number } {
        const target = { h: 0, s: 0, l: 0 };
        this._threeColor.getHSL(target);
        return target;
    }

    /**
     * Повертає CSS rgb-рядок.
     * @returns Рядок формату "rgb(r, g, b)"
     */
    public getStyle(): string {
        return this._threeColor.getStyle();
    }

    // ===== Порівняння =====

    /**
     * Перевіряє рівність з іншим кольором.
     * @param color Колір для порівняння
     * @returns true якщо кольори однакові
     */
    public equals(color: Color): boolean {
        return this._threeColor.equals(color._threeColor);
    }

    // ===== Статичні фабричні методи =====

    /**
     * Створює колір з hex-значення.
     * @param hex Числове hex-значення
     * @returns Новий екземпляр Color
     */
    public static fromHex(hex: number): Color {
        const color = new Color();
        color.setHex(hex);
        return color;
    }

    /**
     * Створює колір з CSS-рядка.
     * @param style CSS колір
     * @returns Новий екземпляр Color
     */
    public static fromStyle(style: string): Color {
        const color = new Color();
        color.setStyle(style);
        return color;
    }

    /**
     * Створює колір з HSL.
     * @param h Відтінок (0-1)
     * @param s Насиченість (0-1)
     * @param l Яскравість (0-1)
     * @returns Новий екземпляр Color
     */
    public static fromHSL(h: number, s: number, l: number): Color {
        const color = new Color();
        color.setHSL(h, s, l);
        return color;
    }

    /**
     * Лінійна інтерполяція між двома кольорами.
     * @param a Початковий колір
     * @param b Кінцевий колір
     * @param t Коефіцієнт інтерполяції (0-1)
     * @returns Новий інтерпольований колір
     */
    public static lerp(a: Color, b: Color, t: number): Color {
        return a.clone().lerp(b, t);
    }

    // ===== Внутрішній доступ (для інших компонентів двигуна) =====

    /**
     * @internal Повертає внутрішній THREE.Color.
     * Використовується тільки компонентами двигуна.
     */
    public get _internal(): THREE.Color {
        return this._threeColor;
    }

    /**
     * Рядкове представлення кольору.
     */
    public toString(): string {
        return `Color(${this.r.toFixed(3)}, ${this.g.toFixed(3)}, ${this.b.toFixed(3)})`;
    }
}
