// path: src/engine/math/Color.ts

import { EngineSettings } from '../EngineSettings';

/**
 * Color.ts
 * Представлення кольору у форматі RGBA.
 * Значення компонентів знаходяться в діапазоні від 0.0 до 1.0.
 *
 * @remarks
 * API максимально наближений до Unity Color.
 */
export class Color {
    public r: number;
    public g: number;
    public b: number;
    public a: number;

    // ==================== CACHED READONLY INSTANCES ====================
    private static readonly _white = Object.freeze(new Color(1, 1, 1, 1));
    private static readonly _black = Object.freeze(new Color(0, 0, 0, 1));
    private static readonly _red = Object.freeze(new Color(1, 0, 0, 1));
    private static readonly _green = Object.freeze(new Color(0, 1, 0, 1));
    private static readonly _blue = Object.freeze(new Color(0, 0, 1, 1));
    private static readonly _yellow = Object.freeze(new Color(1, 0.92, 0.016, 1));
    private static readonly _cyan = Object.freeze(new Color(0, 1, 1, 1));
    private static readonly _magenta = Object.freeze(new Color(1, 0, 1, 1));
    private static readonly _gray = Object.freeze(new Color(0.5, 0.5, 0.5, 1));
    private static readonly _grey = Object.freeze(new Color(0.5, 0.5, 0.5, 1)); // Unity has both spellings
    private static readonly _clear = Object.freeze(new Color(0, 0, 0, 0));

    /**
     * Створює новий колір.
     * @param r Червоний (0.0 - 1.0). За замовчуванням 1.
     * @param g Зелений (0.0 - 1.0). За замовчуванням 1.
     * @param b Синій (0.0 - 1.0). За замовчуванням 1.
     * @param a Альфа/Прозорість (0.0 - 1.0). За замовчуванням 1.
     */
    constructor(r: number = 1, g: number = 1, b: number = 1, a: number = 1) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    // ==================== STATIC READONLY CONSTANTS ====================
    // WARNING: These return shared instances. Do NOT mutate!

    /** Returns white (1, 1, 1, 1). Shared instance — do not mutate! */
    static get white(): Color { return Color._white; }
    /** Returns black (0, 0, 0, 1). Shared instance — do not mutate! */
    static get black(): Color { return Color._black; }
    /** Returns red (1, 0, 0, 1). Shared instance — do not mutate! */
    static get red(): Color { return Color._red; }
    /** Returns green (0, 1, 0, 1). Shared instance — do not mutate! */
    static get green(): Color { return Color._green; }
    /** Returns blue (0, 0, 1, 1). Shared instance — do not mutate! */
    static get blue(): Color { return Color._blue; }
    /** Returns yellow (1, 0.92, 0.016, 1). Shared instance — do not mutate! */
    static get yellow(): Color { return Color._yellow; }
    /** Returns cyan (0, 1, 1, 1). Shared instance — do not mutate! */
    static get cyan(): Color { return Color._cyan; }
    /** Returns magenta (1, 0, 1, 1). Shared instance — do not mutate! */
    static get magenta(): Color { return Color._magenta; }
    /** Returns gray (0.5, 0.5, 0.5, 1). Shared instance — do not mutate! */
    static get gray(): Color { return Color._gray; }
    /** Returns grey (0.5, 0.5, 0.5, 1). Alias for gray. Shared instance — do not mutate! */
    static get grey(): Color { return Color._grey; }
    /** Returns clear/transparent (0, 0, 0, 0). Shared instance — do not mutate! */
    static get clear(): Color { return Color._clear; }

    // ==================== STATIC METHODS ====================

    /**
     * Лінійна інтерполяція між двома кольорами.
     * @param a Початковий колір
     * @param b Кінцевий колір
     * @param t Коефіцієнт (0-1), обмежується
     * @param out Опціональний результат
     */
    static Lerp(a: Color, b: Color, t: number, out?: Color): Color {
        const result = out ?? new Color();
        t = Math.max(0, Math.min(1, t));
        result.r = a.r + (b.r - a.r) * t;
        result.g = a.g + (b.g - a.g) * t;
        result.b = a.b + (b.b - a.b) * t;
        result.a = a.a + (b.a - a.a) * t;
        return result;
    }

    /**
     * Лінійна інтерполяція без обмеження t.
     */
    static LerpUnclamped(a: Color, b: Color, t: number, out?: Color): Color {
        const result = out ?? new Color();
        result.r = a.r + (b.r - a.r) * t;
        result.g = a.g + (b.g - a.g) * t;
        result.b = a.b + (b.b - a.b) * t;
        result.a = a.a + (b.a - a.a) * t;
        return result;
    }

    /**
     * Додає два кольори.
     */
    static Add(a: Color, b: Color, out?: Color): Color {
        const result = out ?? new Color();
        result.r = a.r + b.r;
        result.g = a.g + b.g;
        result.b = a.b + b.b;
        result.a = a.a + b.a;
        return result;
    }

    /**
     * Множить два кольори покомпонентно.
     */
    static Multiply(a: Color, b: Color, out?: Color): Color {
        const result = out ?? new Color();
        result.r = a.r * b.r;
        result.g = a.g * b.g;
        result.b = a.b * b.b;
        result.a = a.a * b.a;
        return result;
    }

    /**
     * Множить колір на скаляр.
     */
    static Scale(color: Color, scalar: number, out?: Color): Color {
        const result = out ?? new Color();
        result.r = color.r * scalar;
        result.g = color.g * scalar;
        result.b = color.b * scalar;
        result.a = color.a * scalar;
        return result;
    }

    /**
     * Створює колір з HSV (Hue, Saturation, Value).
     * @param h Hue (0-1)
     * @param s Saturation (0-1)
     * @param v Value/Brightness (0-1)
     * @param out Опціональний результат
     */
    static HSVToRGB(h: number, s: number, v: number, out?: Color): Color {
        const result = out ?? new Color();

        if (s <= 0) {
            result.r = result.g = result.b = v;
            result.a = 1;
            return result;
        }

        h = h % 1;
        if (h < 0) h += 1;

        h *= 6;
        const i = Math.floor(h);
        const f = h - i;
        const p = v * (1 - s);
        const q = v * (1 - s * f);
        const t = v * (1 - s * (1 - f));

        switch (i) {
            case 0: result.r = v; result.g = t; result.b = p; break;
            case 1: result.r = q; result.g = v; result.b = p; break;
            case 2: result.r = p; result.g = v; result.b = t; break;
            case 3: result.r = p; result.g = q; result.b = v; break;
            case 4: result.r = t; result.g = p; result.b = v; break;
            default: result.r = v; result.g = p; result.b = q; break;
        }

        result.a = 1;
        return result;
    }

    /**
     * Конвертує RGB колір в HSV.
     * @returns {h, s, v} об'єкт з компонентами HSV (0-1)
     */
    static RGBToHSV(color: Color): { h: number; s: number; v: number } {
        const r = color.r, g = color.g, b = color.b;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;

        let h = 0;
        const s = max === 0 ? 0 : delta / max;
        const v = max;

        if (delta !== 0) {
            if (max === r) {
                h = ((g - b) / delta) % 6;
            } else if (max === g) {
                h = (b - r) / delta + 2;
            } else {
                h = (r - g) / delta + 4;
            }
            h /= 6;
            if (h < 0) h += 1;
        }

        return { h, s, v };
    }

    /**
     * Створює колір з hex числа.
     * @param hex Наприклад 0xFF0000 для червоного
     * @param out Опціональний результат
     */
    static FromHex(hex: number, out?: Color): Color {
        const result = out ?? new Color();
        result.r = ((hex >> 16) & 255) / 255;
        result.g = ((hex >> 8) & 255) / 255;
        result.b = (hex & 255) / 255;
        result.a = 1;
        return result;
    }

    /**
     * Створює колір з hex рядка.
     * @param hexString Наприклад "#FF0000" або "FF0000"
     * @param out Опціональний результат
     */
    static FromHexString(hexString: string, out?: Color): Color {
        const result = out ?? new Color();
        let hex = hexString.replace('#', '');

        if (hex.length === 3) {
            // Short form: #RGB -> #RRGGBB
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        const num = parseInt(hex, 16);
        if (isNaN(num)) {
            console.warn(`Color.FromHexString: Invalid hex string "${hexString}"`);
            return result.set(1, 1, 1, 1);
        }

        return Color.FromHex(num, result);
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Встановлює компоненти кольору.
     */
    set(r: number, g: number, b: number, a: number = 1): this {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
        return this;
    }

    /**
     * Копіює значення з іншого кольору.
     */
    copy(other: Color): this {
        this.r = other.r;
        this.g = other.g;
        this.b = other.b;
        this.a = other.a;
        return this;
    }

    /**
     * Створює новий екземпляр з такими ж значеннями.
     */
    clone(): Color {
        return new Color(this.r, this.g, this.b, this.a);
    }

    /**
     * Додає інший колір до поточного (адитивне змішування).
     * Змінює поточний об'єкт.
     */
    add(other: Color): this {
        this.r += other.r;
        this.g += other.g;
        this.b += other.b;
        this.a += other.a;
        return this;
    }

    /**
     * Множить колір на число (зміна яскравості).
     * Змінює поточний об'єкт.
     */
    multiplyScalar(scalar: number): this {
        this.r *= scalar;
        this.g *= scalar;
        this.b *= scalar;
        this.a *= scalar;
        return this;
    }

    /**
     * Множить цей колір на інший покомпонентно (фільтрація).
     */
    multiply(other: Color): this {
        this.r *= other.r;
        this.g *= other.g;
        this.b *= other.b;
        this.a *= other.a;
        return this;
    }

    /**
     * Лінійна інтерполяція між поточним кольором та цільовим.
     * @param target Кінцевий колір.
     * @param t Коефіцієнт (0-1).
     */
    lerp(target: Color, t: number): this {
        t = Math.max(0, Math.min(1, t));
        this.r += (target.r - this.r) * t;
        this.g += (target.g - this.g) * t;
        this.b += (target.b - this.b) * t;
        this.a += (target.a - this.a) * t;
        return this;
    }

    /**
     * Обмежує всі компоненти в діапазоні [0, 1].
     */
    clamp01(): this {
        this.r = Math.max(0, Math.min(1, this.r));
        this.g = Math.max(0, Math.min(1, this.g));
        this.b = Math.max(0, Math.min(1, this.b));
        this.a = Math.max(0, Math.min(1, this.a));
        return this;
    }

    /**
     * Повертає значення сірого (luminance).
     * Використовує стандартні коефіцієнти для sRGB.
     */
    get grayscale(): number {
        return 0.299 * this.r + 0.587 * this.g + 0.114 * this.b;
    }

    /**
     * Повертає максимальну компоненту кольору (без альфа).
     */
    get maxColorComponent(): number {
        return Math.max(this.r, this.g, this.b);
    }

    /**
     * Повертає колір в лінійному колірному просторі (з gamma).
     * Використовується для коректних розрахунків освітлення.
     */
    get linear(): Color {
        const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        return new Color(
            toLinear(this.r),
            toLinear(this.g),
            toLinear(this.b),
            this.a
        );
    }

    /**
     * Повертає колір в gamma колірному просторі (з linear).
     */
    get gamma(): Color {
        const toGamma = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        return new Color(
            toGamma(this.r),
            toGamma(this.g),
            toGamma(this.b),
            this.a
        );
    }

    /**
     * Перевіряє рівність з іншим кольором.
     */
    equals(other: Color, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.r - other.r) < epsilon &&
            Math.abs(this.g - other.g) < epsilon &&
            Math.abs(this.b - other.b) < epsilon &&
            Math.abs(this.a - other.a) < epsilon
        );
    }

    /**
     * Повертає Hex число (наприклад 0xFF0000).
     * Альфа-канал ігнорується.
     */
    getHex(): number {
        const r = Math.floor(Math.max(0, Math.min(1, this.r)) * 255);
        const g = Math.floor(Math.max(0, Math.min(1, this.g)) * 255);
        const b = Math.floor(Math.max(0, Math.min(1, this.b)) * 255);
        return (r << 16) | (g << 8) | b;
    }

    /**
     * Повертає hex рядок (наприклад "#FF0000").
     */
    getHexString(): string {
        return '#' + this.getHex().toString(16).padStart(6, '0').toUpperCase();
    }

    /**
     * Встановлює колір з Hex числа.
     * @param hex Наприклад 0xFF0000.
     */
    setHex(hex: number): this {
        this.r = ((hex >> 16) & 255) / 255;
        this.g = ((hex >> 8) & 255) / 255;
        this.b = (hex & 255) / 255;
        this.a = 1;
        return this;
    }

    /**
     * Встановлює колір з HSV.
     */
    setHSV(h: number, s: number, v: number): this {
        Color.HSVToRGB(h, s, v, this);
        return this;
    }

    /**
     * Повертає HSV представлення кольору.
     */
    toHSV(): { h: number; s: number; v: number } {
        return Color.RGBToHSV(this);
    }

    /**
     * Повертає масив [r, g, b, a].
     * Зручно для передачі в шейдери.
     */
    toArray(): [number, number, number, number] {
        return [this.r, this.g, this.b, this.a];
    }

    /**
     * Встановлює з масиву.
     */
    fromArray(array: number[], offset: number = 0): this {
        this.r = array[offset];
        this.g = array[offset + 1];
        this.b = array[offset + 2];
        this.a = array[offset + 3] ?? 1;
        return this;
    }

    toString(): string {
        return `RGBA(${this.r.toFixed(3)}, ${this.g.toFixed(3)}, ${this.b.toFixed(3)}, ${this.a.toFixed(3)})`;
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only.

    /**
     * @internal
     * Copies RGB values to a Three.js Color-like object.
     * Note: Three.js Color doesn't have alpha, so it's handled separately.
     */
    _copyToThree(threeColor: { r: number; g: number; b: number }): void {
        threeColor.r = this.r;
        threeColor.g = this.g;
        threeColor.b = this.b;
    }

    /**
     * @internal
     * Copies values from a Three.js Color-like object.
     * Note: Alpha is preserved since Three.js Color doesn't have it.
     */
    _copyFromThree(threeColor: { r: number; g: number; b: number }): this {
        this.r = threeColor.r;
        this.g = threeColor.g;
        this.b = threeColor.b;
        // Alpha is NOT touched — Three.js Color doesn't have it
        return this;
    }
}