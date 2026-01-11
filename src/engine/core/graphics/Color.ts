
/**
 * Представлення кольору у форматі RGBA.
 * Значення компонентів знаходяться в діапазоні від 0.0 до 1.0.
 * Реалізує методи для маніпуляцій кольором без зайвих алокацій пам'яті.
 */
export class Color {
    public r: number;
    public g: number;
    public b: number;
    public a: number;

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


    static get white(): Color   { return new Color(1, 1, 1, 1); }
    static get black(): Color   { return new Color(0, 0, 0, 1); }
    static get red(): Color     { return new Color(1, 0, 0, 1); }
    static get green(): Color   { return new Color(0, 1, 0, 1); }
    static get blue(): Color    { return new Color(0, 0, 1, 1); }
    static get yellow(): Color  { return new Color(1, 0.92, 0.016, 1); }
    static get cyan(): Color    { return new Color(0, 1, 1, 1); }
    static get magenta(): Color { return new Color(1, 0, 1, 1); }
    static get gray(): Color    { return new Color(0.5, 0.5, 0.5, 1); }
    static get clear(): Color   { return new Color(0, 0, 0, 0); } // Повністю прозорий


    /**
     * Встановлює компоненти кольору.
     */
    public set(r: number, g: number, b: number, a: number = 1): this {
        this.r = r; this.g = g; this.b = b; this.a = a;
        return this;
    }

    /**
     * Копіює значення з іншого кольору.
     */
    public copy(other: Color): this {
        this.r = other.r;
        this.g = other.g;
        this.b = other.b;
        this.a = other.a;
        return this;
    }

    /**
     * Створює новий екземпляр з такими ж значеннями.
     */
    public clone(): Color {
        return new Color(this.r, this.g, this.b, this.a);
    }


    /**
     * Додає інший колір до поточного (адитивне змішування).
     * Змінює поточний об'єкт.
     */
    public add(other: Color): this {
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
    public multiplyScalar(scalar: number): this {
        this.r *= scalar;
        this.g *= scalar;
        this.b *= scalar;
        this.a *= scalar;
        return this;
    }

    /**
     * Множить цей колір на інший покомпонентно (фільтрація).
     */
    public multiply(other: Color): this {
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
    public lerp(target: Color, t: number): this {
        t = Math.max(0, Math.min(1, t)); // clamp01
        this.r += (target.r - this.r) * t;
        this.g += (target.g - this.g) * t;
        this.b += (target.b - this.b) * t;
        this.a += (target.a - this.a) * t;
        return this;
    }


    /**
     * Повертає Hex число (наприклад 0xFF0000).
     * Потрібно для внутрішньої роботи з Three.js матеріалами.
     * Альфа-канал ігнорується (Three.js приймає колір і прозорість окремо).
     */
    public getHex(): number {
        const r = Math.max(0, Math.min(1, this.r)) * 255;
        const g = Math.max(0, Math.min(1, this.g)) * 255;
        const b = Math.max(0, Math.min(1, this.b)) * 255;

        // Бітовий зсув для отримання integer
        return (r << 16) | (g << 8) | b;
    }

    /**
     * Встановлює колір з Hex числа.
     * @param hex Наприклад 0xFF0000.
     */
    public setHex(hex: number): this {
        this.r = ((hex >> 16) & 255) / 255;
        this.g = ((hex >> 8) & 255) / 255;
        this.b = (hex & 255) / 255;
        this.a = 1;
        return this;
    }

    /**
     * Повертає масив [r, g, b, a].
     * Зручно для передачі в шейдери.
     */
    public toArray(): [number, number, number, number] {
        return [this.r, this.g, this.b, this.a];
    }

    public toString(): string {
        return `RGBA(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`;
    }
}