// path: src/engine/core/graphics/Texture2D.ts

import * as THREE from "three";
import { Texture } from "./Texture.ts";
import { Color } from "../math/Color.ts";

/**
 * Texture formats.
 *
 * @remarks
 * Equivalent to Unity's `TextureFormat`.
 */
export enum TextureFormat {
    /** RGBA 32-bit (8 bits per channel). */
    RGBA32 = 0,
    /** RGB 24-bit (8 bits per channel, no alpha). */
    RGB24 = 1,
    /** Alpha only 8-bit. */
    Alpha8 = 2,
    /** ARGB 32-bit. */
    ARGB32 = 3,
    /** RGB 16-bit (5-6-5). */
    RGB565 = 4,
    /** 16-bit float, single channel. */
    R16 = 5,
    /** 32-bit float, single channel. */
    RFloat = 6,
    /** 32-bit float, two channels. */
    RGFloat = 7,
    /** 32-bit float, four channels (HDR). */
    RGBAFloat = 8
}

/**
 * Standard 2D texture for use in materials.
 *
 * Supports pixel read/write, encoding, bilinear sampling, and mipmap
 * generation. Internally backed by a `THREE.CanvasTexture`.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Texture2D`.
 *
 * @example
 * ```ts
 * // Create a solid red 64Ã—64 texture
 * const tex = new Texture2D(64, 64);
 * const pixels = new Array(64 * 64).fill(Color.red);
 * tex.setPixels(pixels);
 * tex.apply();
 * material.mainTexture = tex;
 * ```
 */
export class Texture2D extends Texture {

    // ==================== PRIVATE FIELDS ====================

    private _width: number;
    private _height: number;
    private _format: TextureFormat;
    private _isReadable: boolean;
    private _pixels: Color[] | null = null;
    private _mipmapCount: number = 1;

    /**
     * @internal
     * When true, the constructor skips canvas allocation.
     * Used by {@link _wrapThreeTexture} to avoid creating a
     * throwaway Canvas that would leak memory.
     */
    private static _skipCanvasAllocation: boolean = false;

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a new 2D texture.
     *
     * @param width â€” width in pixels.
     * @param height â€” height in pixels.
     * @param format â€” pixel format.
     * @param mipChain â€” whether to generate mipmaps.
     */
    constructor(
        width: number,
        height: number,
        format: TextureFormat = TextureFormat.RGBA32,
        mipChain: boolean = true
    ) {
        super();

        this._width = width;
        this._height = height;
        this._format = format;
        this._isReadable = true;
        this._mipmapCount = mipChain ? Texture2D._calcMipmapCount(width, height) : 1;

        if (Texture2D._skipCanvasAllocation) {
            // Fast path: caller will replace the Three.js texture immediately
            // via _setInternalThreeTexture(). Skip canvas allocation to avoid
            // creating a large throwaway Canvas that leaks memory.
            return;
        }

        // Create a canvas-backed Three.js texture
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, width, height);
        }

        const canvasTexture = new THREE.CanvasTexture(canvas);
        canvasTexture.generateMipmaps = mipChain;
        canvasTexture.needsUpdate = true;

        // Replace the default empty texture from Texture base
        this._internalThreeTexture.dispose();
        this._setInternalThreeTexture(canvasTexture);

        this.name = `Texture2D ${width}x${height}`;
    }

    // ==================== PUBLIC PROPERTIES ====================

    /** Width in pixels. */
    public get width(): number {
        return this._width;
    }

    /** Height in pixels. */
    public get height(): number {
        return this._height;
    }

    /** Pixel format. */
    public get format(): TextureFormat {
        return this._format;
    }

    /** Whether pixel data can be read/written. */
    public get isReadable(): boolean {
        return this._isReadable;
    }

    /** Number of mipmap levels. */
    public get mipmapCount(): number {
        return this._mipmapCount;
    }

    // ==================== PIXEL ACCESS ====================

    /**
     * Gets the color of a pixel.
     *
     * @param x â€” x coordinate (0 to widthâˆ’1).
     * @param y â€” y coordinate (0 to heightâˆ’1).
     * @returns a copy of the pixel color.
     */
    public getPixel(x: number, y: number): Color {
        if (!this._isReadable) {
            console.warn("[Texture2D] Cannot read from non-readable texture");
            return Color.black;
        }

        if (x < 0 || x >= this._width || y < 0 || y >= this._height) {
            console.warn(`[Texture2D] getPixel: coords (${x}, ${y}) out of bounds`);
            return Color.clear;
        }

        this._ensurePixelData();
        return this._pixels![y * this._width + x].clone();
    }

    /**
     * Sets the color of a pixel.
     *
     * Call {@link apply} after all changes to push data to the GPU.
     *
     * @param x â€” x coordinate.
     * @param y â€” y coordinate.
     * @param color â€” the color to set.
     */
    public setPixel(x: number, y: number, color: Color): void {
        if (!this._isReadable) {
            console.warn("[Texture2D] Cannot write to non-readable texture");
            return;
        }

        if (x < 0 || x >= this._width || y < 0 || y >= this._height) return;

        this._ensurePixelData();
        this._pixels![y * this._width + x].copy(color);
    }

    /**
     * Gets a bilinearly interpolated color at normalized UV coordinates.
     *
     * @param u â€” horizontal coordinate (0.0â€“1.0).
     * @param v â€” vertical coordinate (0.0â€“1.0).
     * @returns the interpolated color.
     */
    public getPixelBilinear(u: number, v: number): Color {
        if (!this._isReadable) {
            console.warn("[Texture2D] Cannot read from non-readable texture");
            return Color.black;
        }

        this._ensurePixelData();

        const x = u * (this._width - 1);
        const y = v * (this._height - 1);

        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(x0 + 1, this._width - 1);
        const y1 = Math.min(y0 + 1, this._height - 1);

        const fx = x - x0;
        const fy = y - y0;

        const c00 = this.getPixel(x0, y0);
        const c10 = this.getPixel(x1, y0);
        const c01 = this.getPixel(x0, y1);
        const c11 = this.getPixel(x1, y1);

        const c0 = c00.clone().lerp(c10, fx);
        const c1 = c01.clone().lerp(c11, fx);
        return c0.lerp(c1, fy);
    }

    /**
     * Gets all pixels as an array of Color values.
     * @returns a clone of every pixel.
     */
    public getPixels(): Color[] {
        if (!this._isReadable) {
            console.warn("[Texture2D] Cannot read from non-readable texture");
            return [];
        }

        this._ensurePixelData();
        return this._pixels!.map(c => c.clone());
    }

    /**
     * Sets all pixels from a Color array.
     *
     * @param colors â€” must be exactly `width Ã— height` colors.
     */
    public setPixels(colors: Color[]): void {
        if (!this._isReadable) {
            console.warn("[Texture2D] Cannot write to non-readable texture");
            return;
        }

        const expected = this._width * this._height;
        if (colors.length !== expected) {
            console.error(`[Texture2D] setPixels: expected ${expected} pixels, got ${colors.length}`);
            return;
        }

        this._ensurePixelData();
        for (let i = 0; i < expected; i++) {
            this._pixels![i].copy(colors[i]);
        }
    }

    // ==================== APPLY ====================

    /**
     * Pushes pixel changes to the GPU texture.
     *
     * @param updateMipmaps â€” whether to regenerate mipmaps.
     * @param makeNoLongerReadable â€” if true, frees CPU pixel data (optimization).
     *
     * @remarks
     * Equivalent to Unity's `Texture2D.Apply()`.
     */
    public apply(updateMipmaps: boolean = true, makeNoLongerReadable: boolean = false): void {
        if (!this._pixels) {
            console.warn("[Texture2D] apply: no pixel data to apply");
            return;
        }

        const threeTex = this._internalThreeTexture;
        const image = threeTex.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            console.error("[Texture2D] apply: texture has no canvas backing");
            return;
        }

        const ctx = image.getContext("2d");
        if (!ctx) {
            console.error("[Texture2D] apply: failed to get 2D context");
            return;
        }

        // Write pixel data to canvas
        const imageData = ctx.createImageData(this._width, this._height);
        const data = imageData.data;

        for (let i = 0; i < this._pixels.length; i++) {
            const color = this._pixels[i];
            const offset = i * 4;
            data[offset + 0] = Math.floor(color.r * 255);
            data[offset + 1] = Math.floor(color.g * 255);
            data[offset + 2] = Math.floor(color.b * 255);
            data[offset + 3] = Math.floor(color.a * 255);
        }

        ctx.putImageData(imageData, 0, 0);

        // Mark Three.js texture for upload
        threeTex.needsUpdate = true;
        if (updateMipmaps && threeTex.generateMipmaps) {
            threeTex.generateMipmaps = true;
        }

        // Optionally release CPU data
        if (makeNoLongerReadable) {
            this._pixels = null;
            this._isReadable = false;
        }
    }

    // ==================== ENCODING ====================

    /**
     * Encodes the texture as a PNG data URL.
     * @returns a data:image/png;base64 string.
     */
    public encodeToPNG(): string {
        const image = this._internalThreeTexture.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            console.error("[Texture2D] encodeToPNG: no canvas backing");
            return "";
        }
        return image.toDataURL("image/png");
    }

    /**
     * Encodes the texture as a JPEG data URL.
     * @param quality â€” compression quality (0.0â€“1.0).
     * @returns a data:image/jpeg;base64 string.
     */
    public encodeToJPG(quality: number = 0.92): string {
        const image = this._internalThreeTexture.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            console.error("[Texture2D] encodeToJPG: no canvas backing");
            return "";
        }
        return image.toDataURL("image/jpeg", quality);
    }

    // ==================== STATIC LOADERS ====================

    /**
     * Loads a texture from a URL (async).
     *
     * @param url â€” path to the image file.
     * @returns the loaded Texture2D.
     *
     * @remarks
     * Equivalent to Unity's `Resources.Load<Texture2D>()`.
     */
    public static async Load(url: string): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();

            loader.load(
                url,
                (threeTexture: THREE.Texture) => {
                    const image = threeTexture.image as HTMLImageElement;
                    const width = image.width;
                    const height = image.height;

                    const texture = Texture2D._wrapThreeTexture(threeTexture, width, height);
                    texture.name = url.split("/").pop() || "Loaded Texture2D";

                    resolve(texture);
                },
                undefined,
                (error: unknown) => {
                    console.error(`[Texture2D] Failed to load "${url}"`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Creates a Texture2D from raw pixel data.
     *
     * @param data â€” array of Color values (width Ã— height).
     * @param width â€” texture width.
     * @param height â€” texture height.
     * @param format â€” pixel format.
     * @returns the new Texture2D with data applied.
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

    /**
     * @internal
     * Creates a Texture2D from an existing Three.js texture.
     *
     * Used by asset loaders (GLTF, OBJ, etc.) that produce THREE.Texture
     * objects from external sources.
     *
     * @param threeTexture â€” the Three.js texture to wrap.
     * @returns a new Texture2D wrapping the given handle.
     */
    public static override _fromThreeTexture(threeTexture: THREE.Texture): Texture2D {
        const image = threeTexture.image as HTMLImageElement | HTMLCanvasElement;
        const width = image?.width || 1;
        const height = image?.height || 1;

        const texture = Texture2D._wrapThreeTexture(threeTexture, width, height);
        texture.name = `Texture2D ${width}x${height}`;

        return texture;
    }

    /**
     * Creates a Texture2D from an ArrayBuffer (binary image data).
     *
     * @param data â€” ArrayBuffer containing PNG, JPEG, etc.
     * @returns a Promise resolving to the loaded Texture2D.
     */
    public static fromArrayBuffer(data: ArrayBuffer): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([data]);
            const url = URL.createObjectURL(blob);

            const img = new Image();

            img.onload = () => {
                URL.revokeObjectURL(url);

                const threeTexture = new THREE.Texture(img);
                threeTexture.needsUpdate = true;
                threeTexture.colorSpace = THREE.SRGBColorSpace;

                const texture = Texture2D._wrapThreeTexture(
                    threeTexture, img.width, img.height
                );
                texture.name = "Texture from ArrayBuffer";

                resolve(texture);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("[Texture2D] Failed to load texture from ArrayBuffer"));
            };

            img.src = url;
        });
    }

    // ==================== BUILT-IN TEXTURES ====================

    private static _whiteTexture: Texture2D | null = null;
    private static _blackTexture: Texture2D | null = null;
    private static _grayTexture: Texture2D | null = null;
    private static _normalTexture: Texture2D | null = null;

    /** 1Ã—1 white texture. */
    public static get whiteTexture(): Texture2D {
        if (!Texture2D._whiteTexture) {
            Texture2D._whiteTexture = Texture2D._createSolidColor(Color.white, "White Texture");
        }
        return Texture2D._whiteTexture;
    }

    /** 1Ã—1 black texture. */
    public static get blackTexture(): Texture2D {
        if (!Texture2D._blackTexture) {
            Texture2D._blackTexture = Texture2D._createSolidColor(Color.black, "Black Texture");
        }
        return Texture2D._blackTexture;
    }

    /** 1Ã—1 gray texture. */
    public static get grayTexture(): Texture2D {
        if (!Texture2D._grayTexture) {
            Texture2D._grayTexture = Texture2D._createSolidColor(Color.gray, "Gray Texture");
        }
        return Texture2D._grayTexture;
    }

    /** 1Ã—1 default normal map (flat surface pointing up). */
    public static get normalTexture(): Texture2D {
        if (!Texture2D._normalTexture) {
            const normalColor = new Color(0.5, 0.5, 1.0, 1.0);
            Texture2D._normalTexture = Texture2D._createSolidColor(normalColor, "Normal Texture");
        }
        return Texture2D._normalTexture;
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * @internal
     * Wraps an existing Three.js texture into a Texture2D without
     * allocating an intermediate canvas.
     *
     * This is the core factory used by all asset-loading paths
     * ({@link _fromThreeTexture}, {@link Load}, {@link fromArrayBuffer}).
     * It avoids the canvas leak that occurs when the regular constructor
     * creates a full-size Canvas only to immediately discard it.
     *
     * Asset-loaded textures are non-readable by default (no CPU pixel
     * data). Call {@link _ensurePixelData} to make them readable if needed.
     *
     * @param threeTexture — the Three.js texture to wrap.
     * @param width — width in pixels.
     * @param height — height in pixels.
     * @returns a new Texture2D wrapping the given handle.
     */
    private static _wrapThreeTexture(
        threeTexture: THREE.Texture,
        width: number,
        height: number,
    ): Texture2D {
        Texture2D._skipCanvasAllocation = true;
        const texture = new Texture2D(width, height, TextureFormat.RGBA32, true);
        Texture2D._skipCanvasAllocation = false;

        // Replace the default empty texture with the real one
        texture._internalThreeTexture.dispose();
        texture._setInternalThreeTexture(threeTexture);

        // Asset-loaded textures start non-readable — no CPU pixel data kept
        texture._isReadable = false;

        return texture;
    }

    /**
     * Lazily loads pixel data from the canvas into the _pixels array.
     */
    private _ensurePixelData(): void {
        if (this._pixels) return;

        this._pixels = [];

        const threeTex = this._internalThreeTexture;
        const image = threeTex.image as HTMLCanvasElement;
        if (!image || !(image instanceof HTMLCanvasElement)) {
            // Fill with white if no canvas available
            for (let i = 0; i < this._width * this._height; i++) {
                this._pixels.push(Color.white);
            }
            return;
        }

        const ctx = image.getContext("2d");
        if (!ctx) {
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

    /** Calculates the number of mipmap levels. */
    private static _calcMipmapCount(width: number, height: number): number {
        return Math.floor(Math.log2(Math.max(width, height))) + 1;
    }

    /** Creates a 1Ã—1 solid-color texture. */
    private static _createSolidColor(color: Color, name: string): Texture2D {
        const texture = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        texture.setPixel(0, 0, color);
        texture.apply(false, true);
        texture.name = name;
        return texture;
    }
}