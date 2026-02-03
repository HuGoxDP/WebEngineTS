import * as THREE from "three";
import { Texture } from "./Texture";
import { Color } from "./Color";

/**
 * Формати текстур (відповідає Unity TextureFormat).
 */
export enum TextureFormat {
    /** RGBA 32-bit (8 біт на канал) */
    RGBA32,
    /** RGB 24-bit (8 біт на канал, без alpha) */
    RGB24,
    /** Тільки Alpha 8-bit */
    Alpha8,
    /** ARGB 32-bit */
    ARGB32,
    /** RGB 16-bit (5-6-5) */
    RGB565,
    /** 16-bit float, один канал */
    R16,
    /** 32-bit float, один канал */
    RFloat,
    /** 32-bit float, два канали */
    RGFloat,
    /** 32-bit float, чотири канали */
    RGBAFloat
}

/**
 * 2D текстура для використання у матеріалах.
 * Повна імітація Unity Texture2D API.
 */
export class Texture2D extends Texture {
    private _width: number;
    private _height: number;
    private _format: TextureFormat;
    private _isReadable: boolean;
    private _pixels: Color[] | null = null;
    private _mipmapCount: number = 1;

    /**
     * Створює нову 2D текстуру.
     * @param width Ширина текстури в пікселях
     * @param height Висота текстури в пікселях
     * @param format Формат текстури
     * @param mipChain Чи генерувати mipmap ланцюжок
     */
    constructor(
        width: number,
        height: number,
        format: TextureFormat = TextureFormat.RGBA32,
        mipChain: boolean = true
    ) {
        // Створюємо порожню THREE.Texture
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            // Заповнюємо білим за замовчуванням
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
        }

        const threeTexture = new THREE.CanvasTexture(canvas);
        threeTexture.generateMipmaps = mipChain;
        threeTexture.needsUpdate = true;

        super(threeTexture);

        this._width = width;
        this._height = height;
        this._format = format;
        this._isReadable = true; // За замовчуванням readable
        this._mipmapCount = mipChain ? this.calculateMipmapCount(width, height) : 1;

        this.name = `Texture2D ${width}x${height}`;
    }

    // === Властивості ===

    /** Ширина текстури в пікселях */
    public get width(): number {
        return this._width;
    }

    /** Висота текстури в пікселях */
    public get height(): number {
        return this._height;
    }

    /** Формат текстури */
    public get format(): TextureFormat {
        return this._format;
    }

    /** Чи можна читати пікселі з текстури */
    public get isReadable(): boolean {
        return this._isReadable;
    }

    /** Кількість mipmap рівнів */
    public get mipmapCount(): number {
        return this._mipmapCount;
    }

    // === Робота з пікселями ===

    /**
     * Отримує колір пікселя на вказаних координатах.
     * @param x Координата X (0 до width-1)
     * @param y Координата Y (0 до height-1)
     */
    public getPixel(x: number, y: number): Color {
        if (!this._isReadable) {
            console.warn("Texture2D: Спроба читати з нечитабельної текстури!");
            return Color.black;
        }

        // Перевірка меж
        if (x < 0 || x >= this._width || y < 0 || y >= this._height) {
            console.warn(`Texture2D.getPixel: Координати (${x}, ${y}) поза межами!`);
            return Color.clear;
        }

        this.ensurePixelData();
        const index = y * this._width + x;
        return this._pixels![index].clone();
    }

    /**
     * Встановлює колір пікселя на вказаних координатах.
     * @param x Координата X
     * @param y Координата Y
     * @param color Колір для встановлення
     */
    public setPixel(x: number, y: number, color: Color): void {
        if (!this._isReadable) {
            console.warn("Texture2D: Спроба писати в нечитабельну текстуру!");
            return;
        }

        if (x < 0 || x >= this._width || y < 0 || y >= this._height) {
            return;
        }

        this.ensurePixelData();
        const index = y * this._width + x;
        this._pixels![index].copy(color);
    }

    /**
     * Отримує білінійно інтерпольований колір у нормалізованих координатах.
     * @param u Координата U (0.0 - 1.0)
     * @param v Координата V (0.0 - 1.0)
     */
    public getPixelBilinear(u: number, v: number): Color {
        if (!this._isReadable) {
            console.warn("Texture2D: Спроба читати з нечитабельної текстури!");
            return Color.black;
        }

        this.ensurePixelData();

        // Конвертуємо UV у координати пікселів
        const x = u * (this._width - 1);
        const y = v * (this._height - 1);

        // Цілі частини
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(x0 + 1, this._width - 1);
        const y1 = Math.min(y0 + 1, this._height - 1);

        // Дробові частини
        const fx = x - x0;
        const fy = y - y0;

        // Отримуємо 4 сусідні пікселі
        const c00 = this.getPixel(x0, y0);
        const c10 = this.getPixel(x1, y0);
        const c01 = this.getPixel(x0, y1);
        const c11 = this.getPixel(x1, y1);

        // Білінійна інтерполяція
        const c0 = c00.clone().lerp(c10, fx);
        const c1 = c01.clone().lerp(c11, fx);
        return c0.lerp(c1, fy);
    }

    /**
     * Отримує всі пікселі текстури як масив Color.
     */
    public getPixels(): Color[] {
        if (!this._isReadable) {
            console.warn("Texture2D: Спроба читати з нечитабельної текстури!");
            return [];
        }

        this.ensurePixelData();
        return this._pixels!.map(c => c.clone());
    }

    /**
     * Встановлює всі пікселі текстури з масиву Color.
     * @param colors Масив кольорів (має бути width * height)
     */
    public setPixels(colors: Color[]): void {
        if (!this._isReadable) {
            console.warn("Texture2D: Спроба писати в нечитабельну текстуру!");
            return;
        }

        const expectedLength = this._width * this._height;
        if (colors.length !== expectedLength) {
            console.error(
                `Texture2D.setPixels: Неправильна кількість пікселів! ` +
                `Очікується ${expectedLength}, отримано ${colors.length}`
            );
            return;
        }

        this.ensurePixelData();
        for (let i = 0; i < expectedLength; i++) {
            this._pixels![i].copy(colors[i]);
        }
    }

    /**
     * Застосовує зміни в пікселях до GPU текстури.
     * @param updateMipmaps Чи генерувати mipmaps
     * @param makeNoLongerReadable Чи зробити текстуру нечитабельною (оптимізація)
     */
    public apply(updateMipmaps: boolean = true, makeNoLongerReadable: boolean = false): void {
        if (!this._pixels) {
            console.warn("Texture2D.apply: Немає даних пікселів для застосування!");
            return;
        }

        // Отримуємо canvas з THREE.Texture
        const image = this._threeTexture.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            console.error("Texture2D.apply: Текстура не має canvas!");
            return;
        }

        const ctx = image.getContext('2d');
        if (!ctx) {
            console.error("Texture2D.apply: Не вдалося отримати 2D context!");
            return;
        }

        // Створюємо ImageData для запису пікселів
        const imageData = ctx.createImageData(this._width, this._height);
        const data = imageData.data;

        // Копіюємо дані з _pixels у ImageData
        for (let i = 0; i < this._pixels.length; i++) {
            const color = this._pixels[i];
            const offset = i * 4;
            data[offset + 0] = Math.floor(color.r * 255);
            data[offset + 1] = Math.floor(color.g * 255);
            data[offset + 2] = Math.floor(color.b * 255);
            data[offset + 3] = Math.floor(color.a * 255);
        }

        // Записуємо в canvas
        ctx.putImageData(imageData, 0, 0);

        // Оновлюємо THREE.Texture
        this._threeTexture.needsUpdate = true;
        if (updateMipmaps && this._threeTexture.generateMipmaps) {
            this._threeTexture.generateMipmaps = true;
        }

        // Звільняємо пам'ять, якщо потрібно
        if (makeNoLongerReadable) {
            this._pixels = null;
            this._isReadable = false;
        }
    }

    // === Приватні допоміжні методи ===

    /**
     * Завантажує дані пікселів з canvas, якщо вони ще не завантажені.
     */
    private ensurePixelData(): void {
        if (this._pixels) return;

        this._pixels = [];

        const image = this._threeTexture.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            // Створюємо порожній масив
            for (let i = 0; i < this._width * this._height; i++) {
                this._pixels.push(Color.white);
            }
            return;
        }

        const ctx = image.getContext('2d');
        if (!ctx) {
            // Створюємо порожній масив
            for (let i = 0; i < this._width * this._height; i++) {
                this._pixels.push(Color.white);
            }
            return;
        }

        const imageData = ctx.getImageData(0, 0, this._width, this._height);
        const data = imageData.data;

        for (let i = 0; i < this._width * this._height; i++) {
            const offset = i * 4;
            this._pixels.push(
                new Color(
                    data[offset + 0] / 255,
                    data[offset + 1] / 255,
                    data[offset + 2] / 255,
                    data[offset + 3] / 255
                )
            );
        }
    }

    /**
     * Розраховує кількість mipmap рівнів.
     */
    private calculateMipmapCount(width: number, height: number): number {
        return Math.floor(Math.log2(Math.max(width, height))) + 1;
    }

    // === Статичні методи завантаження ===

    /**
     * Завантажує текстуру з URL (асинхронно).
     * @param url Шлях до файлу текстури
     */
    public static async Load(url: string): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            
            loader.load(
                url,
                (threeTexture) => {
                    // Отримуємо розміри з завантаженого зображення
                    const image = threeTexture.image as HTMLImageElement;
                    const width = image.width;
                    const height = image.height;

                    // Створюємо Texture2D
                    const texture = new Texture2D(width, height, TextureFormat.RGBA32, true);
                    
                    // Замінюємо внутрішню THREE.Texture
                    (texture as any)._threeTexture.dispose();
                    (texture as any)._threeTexture = threeTexture;
                    
                    texture._width = width;
                    texture._height = height;
                    texture.name = url.split('/').pop() || "Loaded Texture2D";

                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(`Texture2D.Load: Не вдалося завантажити ${url}`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Створює текстуру з сирих даних.
     * @param data Масив кольорів
     * @param width Ширина
     * @param height Висота
     * @param format Формат
     */
    public static CreateFromData(
        data: Color[],
        width: number,
        height: number,
        format: TextureFormat = TextureFormat.RGBA32
    ): Texture2D {
        const texture = new Texture2D(width, height, format, false);
        texture.setPixels(data);
        texture.apply(false);
        return texture;
    }

    // === Вбудовані текстури ===

    private static _whiteTexture: Texture2D | null = null;
    private static _blackTexture: Texture2D | null = null;
    private static _grayTexture: Texture2D | null = null;
    private static _normalTexture: Texture2D | null = null;

    /** Текстура 1x1 білого кольору */
    public static get whiteTexture(): Texture2D {
        if (!Texture2D._whiteTexture) {
            Texture2D._whiteTexture = Texture2D.CreateSolidColor(Color.white, "White Texture");
        }
        return Texture2D._whiteTexture;
    }

    /** Текстура 1x1 чорного кольору */
    public static get blackTexture(): Texture2D {
        if (!Texture2D._blackTexture) {
            Texture2D._blackTexture = Texture2D.CreateSolidColor(Color.black, "Black Texture");
        }
        return Texture2D._blackTexture;
    }

    /** Текстура 1x1 сірого кольору */
    public static get grayTexture(): Texture2D {
        if (!Texture2D._grayTexture) {
            Texture2D._grayTexture = Texture2D.CreateSolidColor(Color.gray, "Gray Texture");
        }
        return Texture2D._grayTexture;
    }

    /** Текстура 1x1 нормалі (0.5, 0.5, 1.0) - вказує вгору */
    public static get normalTexture(): Texture2D {
        if (!Texture2D._normalTexture) {
            const normalColor = new Color(0.5, 0.5, 1.0, 1.0);
            Texture2D._normalTexture = Texture2D.CreateSolidColor(normalColor, "Normal Texture");
        }
        return Texture2D._normalTexture;
    }

    /**
     * Створює текстуру 1x1 одного кольору.
     */
    private static CreateSolidColor(color: Color, name: string): Texture2D {
        const texture = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        texture.setPixel(0, 0, color);
        texture.apply(false, true); // Не генеруємо mipmaps, робимо нечитабельною
        texture.name = name;
        return texture;
    }

    // === Кодування (опціонально) ===

    /**
     * Кодує текстуру в PNG формат.
     * Повертає Data URL.
     */
    public encodeToPNG(): string {
        const image = this._threeTexture.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            console.error("Texture2D.encodeToPNG: Текстура не має canvas!");
            return "";
        }
        return image.toDataURL('image/png');
    }

    /**
     * Кодує текстуру в JPEG формат.
     * @param quality Якість (0.0 - 1.0)
     */
    public encodeToJPG(quality: number = 0.92): string {
        const image = this._threeTexture.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            console.error("Texture2D.encodeToJPG: Текстура не має canvas!");
            return "";
        }
        return image.toDataURL('image/jpeg', quality);
    }

    /**
     * Створює Texture2D з THREE.Texture.
     * @param threeTexture Three.js текстура
     */
    public static fromThreeTexture(threeTexture: THREE.Texture): Texture2D {
        const image = threeTexture.image as HTMLImageElement | HTMLCanvasElement;
        const width = image?.width || 1;
        const height = image?.height || 1;

        const texture = new Texture2D(width, height, TextureFormat.RGBA32, true);

        // Замінюємо внутрішню текстуру
        texture._threeTexture.dispose();
        (texture as any)._threeTexture = threeTexture;
        texture._width = width;
        texture._height = height;

        return texture;
    }

    /**
     * Створює Texture2D з ArrayBuffer (бінарні дані зображення).
     * @param data ArrayBuffer з даними зображення (PNG, JPEG, etc.)
     */
    public static fromArrayBuffer(data: ArrayBuffer): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([data]);
            const url = URL.createObjectURL(blob);

            const img = new Image();

            img.onload = () => {
                // Звільняємо blob URL
                URL.revokeObjectURL(url);

                // Створюємо THREE.Texture
                const threeTexture = new THREE.Texture(img);
                threeTexture.needsUpdate = true;
                threeTexture.colorSpace = THREE.SRGBColorSpace;

                // Обгортаємо в Texture2D
                const texture = Texture2D.fromThreeTexture(threeTexture);
                texture.name = "Texture from ArrayBuffer";

                resolve(texture);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Failed to load texture from ArrayBuffer"));
            };

            img.src = url;
        });
    }
}
