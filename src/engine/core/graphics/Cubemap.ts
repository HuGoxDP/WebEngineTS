// path: src/engine/core/graphics/Cubemap.ts

import * as THREE from "three";
import { EngineObject } from "../EngineObject.ts";
import { FilterMode } from "./Texture.ts";
import { Texture2D } from "./Texture2D.ts";
import { estimateThreeTextureVramBytes } from "./_TextureMemory.ts";

/**
 * A cube texture composed of six square images (one per face).
 *
 * Used primarily for skyboxes and environment reflections.
 * Each face corresponds to a direction: +X, −X, +Y, −Y, +Z, −Z.
 *
 * @remarks Equivalent to Unity's `UnityEngine.Cubemap`.
 *
 * **Three.js isolation:** The internal `THREE.CubeTexture` is never
 * exposed. Use {@link _internalThreeCubeTexture} only from engine internals.
 *
 * @example
 * ```ts
 * // From 6 image URLs (loaded from scenario ZIP via blob URLs)
 * const sky = await Cubemap.fromImages(
 *     assets.getBlobUrl("sky/px.jpg"),
 *     assets.getBlobUrl("sky/nx.jpg"),
 *     assets.getBlobUrl("sky/py.jpg"),
 *     assets.getBlobUrl("sky/ny.jpg"),
 *     assets.getBlobUrl("sky/pz.jpg"),
 *     assets.getBlobUrl("sky/nz.jpg"),
 * );
 * RenderSettings.skybox = sky;
 *
 * // From a single equirectangular panorama
 * const hdri = await Cubemap.fromEquirectangular(assets.getBlobUrl("sky.jpg"));
 * RenderSettings.skybox = hdri;
 * ```
 */
export class Cubemap extends EngineObject {

    /**
     * The internal Three.js texture. Either a CubeTexture (6-face)
     * or a regular Texture with equirectangular mapping.
     * @internal
     */
    private _threeTexture: THREE.CubeTexture | THREE.Texture;

    /** Whether this was created from an equirectangular source. */
    private _isEquirectangular: boolean = false;

    /** Face size in pixels (0 if equirectangular). */
    private _faceSize: number = 0;

    /**
     * Cached source width/height in pixels. Retained so VRAM can still be
     * estimated after {@link releaseSourceImage} nulls the backing image.
     * For a 6-face cube these equal {@link _faceSize}; for an equirectangular
     * panorama they are the full panorama dimensions.
     */
    private _srcWidth: number = 0;
    private _srcHeight: number = 0;

    // ==================== CONSTRUCTOR ====================

    /**
     * @internal — Use the static factory methods instead.
     */
    private constructor(texture: THREE.CubeTexture | THREE.Texture, name: string = "Cubemap") {
        super();
        this.name = name;
        this._threeTexture = texture;
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The pixel size of each face (width = height). 0 for equirectangular.
     */
    public get faceSize(): number {
        return this._faceSize;
    }

    /**
     * Whether this cubemap was created from an equirectangular panorama.
     */
    public get isEquirectangular(): boolean {
        return this._isEquirectangular;
    }

    /**
     * The filter mode for this cubemap.
     */
    public get filterMode(): FilterMode {
        const f = this._threeTexture.magFilter;
        if (f === THREE.NearestFilter) return FilterMode.Point;
        return FilterMode.Bilinear;
    }

    public set filterMode(value: FilterMode) {
        switch (value) {
            case FilterMode.Point:
                this._threeTexture.magFilter = THREE.NearestFilter;
                this._threeTexture.minFilter = THREE.NearestFilter;
                break;
            case FilterMode.Bilinear:
                this._threeTexture.magFilter = THREE.LinearFilter;
                this._threeTexture.minFilter = THREE.LinearFilter;
                break;
            case FilterMode.Trilinear:
                this._threeTexture.magFilter = THREE.LinearFilter;
                this._threeTexture.minFilter = THREE.LinearMipmapLinearFilter;
                break;
        }
        this._threeTexture.needsUpdate = true;
    }

    // ==================== STATIC FACTORIES ====================

    /**
     * Creates a cubemap from 6 face image URLs.
     *
     * The images are loaded asynchronously. The order follows the standard
     * cubemap convention: +X, −X, +Y, −Y, +Z, −Z.
     *
     * @param px — positive X (right) face URL.
     * @param nx — negative X (left) face URL.
     * @param py — positive Y (top) face URL.
     * @param ny — negative Y (bottom) face URL.
     * @param pz — positive Z (front) face URL.
     * @param nz — negative Z (back) face URL.
     * @returns a Promise that resolves to the loaded Cubemap.
     *
     * @remarks Equivalent to loading a Unity Cubemap from 6 textures.
     */
    public static async fromImages(
        px: string, nx: string,
        py: string, ny: string,
        pz: string, nz: string,
    ): Promise<Cubemap> {
        const urls = [px, nx, py, ny, pz, nz];
        const images = await Promise.all(urls.map(url => Cubemap._loadImage(url)));

        const cubeTexture = new THREE.CubeTexture(images);
        cubeTexture.needsUpdate = true;

        const cubemap = new Cubemap(cubeTexture, "Cubemap (6-face)");
        cubemap._faceSize = images[0].width;
        cubemap._srcWidth = images[0].width;
        cubemap._srcHeight = images[0].height;
        return cubemap;
    }

    /**
     * Creates a cubemap from a single equirectangular panoramic image.
     *
     * This is the most common format for HDR environment maps.
     * The image should be a 2:1 aspect ratio panorama.
     *
     * @param url — the panoramic image URL (JPEG, PNG, or HDR).
     * @returns a Promise that resolves to the loaded Cubemap.
     *
     * @remarks
     * Equivalent to importing an equirectangular panorama in Unity and
     * converting it to a Cubemap.
     *
     * @example
     * ```ts
     * const sky = await Cubemap.fromEquirectangular(
     *     assets.getBlobUrl("space_panorama.jpg")
     * );
     * RenderSettings.skybox = sky;
     * ```
     */
    public static async fromEquirectangular(url: string): Promise<Cubemap> {
        const image = await Cubemap._loadImage(url);
        const texture = new THREE.Texture(image);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.needsUpdate = true;

        const cubemap = new Cubemap(texture, "Cubemap (equirectangular)");
        cubemap._isEquirectangular = true;
        cubemap._srcWidth = image.width;
        cubemap._srcHeight = image.height;
        return cubemap;
    }

    /**
     * Creates a solid-color cubemap. Useful for simple uniform backgrounds.
     *
     * @param r — red component (0–1).
     * @param g — green component (0–1).
     * @param b — blue component (0–1).
     */
    public static fromColor(r: number, g: number, b: number): Cubemap {
        // Create a tiny 1×1 canvas for each face
        const faces: HTMLCanvasElement[] = [];
        for (let i = 0; i < 6; i++) {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
            ctx.fillRect(0, 0, 1, 1);
            faces.push(canvas);
        }

        const cubeTexture = new THREE.CubeTexture(faces);
        cubeTexture.needsUpdate = true;

        const cubemap = new Cubemap(cubeTexture, "Cubemap (solid color)");
        cubemap._faceSize = 1;
        cubemap._srcWidth = 1;
        cubemap._srcHeight = 1;
        return cubemap;
    }

    // ==================== MEMORY MANAGEMENT ====================

    /**
     * Releases CPU-side source images from the underlying GPU texture,
     * freeing significant memory.
     *
     * For an equirectangular skybox at 4096×2048, this frees ~32 MB.
     * For a 6-face cubemap at 1024 per face, this frees ~24 MB.
     *
     * Call this after the cubemap has been rendered at least once
     * (i.e. not in `awake()`, but in `start()` or later).
     *
     * After calling this method, the cubemap continues to render normally
     * from GPU memory. However, it cannot be re-uploaded if a WebGL
     * context loss occurs.
     *
     * @example
     * ```ts
     * // In start() — after first render:
     * const skybox = RenderSettings.skybox;
     * if (skybox) skybox.releaseSourceImage();
     * ```
     */
    public releaseSourceImage(): void {
        const tex = this._threeTexture;

        if ((tex as THREE.CubeTexture).isCubeTexture) {
            // 6-face CubeTexture — images are in .images array
            const cube = tex as THREE.CubeTexture;
            if (cube.images) {
                for (let i = 0; i < cube.images.length; i++) {
                    const img = cube.images[i];
                    if (img && typeof img === "object" && "close" in img
                        && typeof (img as ImageBitmap).close === "function") {
                        (img as ImageBitmap).close();
                    }
                    cube.images[i] = null as any;
                }
            }
        } else {
            // Equirectangular — single image in .image
            const image = (tex as THREE.Texture).image;
            if (image != null && typeof image === "object" && "close" in image
                && typeof (image as ImageBitmap).close === "function") {
                (image as ImageBitmap).close();
            }
            (tex as THREE.Texture).image = null;
        }

    }

    // ==================== CLEANUP ====================

    /**
     * Disposes the underlying GPU texture resources.
     *
     * Closes `ImageBitmap` source images if present (required because
     * `ImageBitmap` is not garbage-collected through normal dereferencing).
     */
    public dispose(): void {
        const image = (this._threeTexture as THREE.Texture).image;
        if (image != null && typeof image === "object" && "close" in image
            && typeof (image as ImageBitmap).close === "function") {
            (image as ImageBitmap).close();
        }
        (this._threeTexture as THREE.Texture).image = null;

        this._threeTexture.dispose();
    }

    // ==================== INTERNAL ====================

    /**
     * @internal
     * The underlying Three.js texture. Used by RenderSettings to set
     * `scene.background` and `scene.environment`.
     */
    public get _internalThreeTexture(): THREE.CubeTexture | THREE.Texture {
        return this._threeTexture;
    }

    /**
     * @internal
     * Estimates the GPU (VRAM) memory this cubemap occupies, in bytes.
     *
     * A 6-face cube counts all six faces; an equirectangular panorama counts
     * as a single 2D texture. Uses cached source dimensions so the estimate
     * survives {@link releaseSourceImage}.
     *
     * **NEVER use in user-facing code.**
     */
    public _estimateVramBytes(): number {
        if (this._isEquirectangular) {
            return estimateThreeTextureVramBytes(
                this._threeTexture, this._srcWidth, this._srcHeight, 1,
            );
        }
        return estimateThreeTextureVramBytes(
            this._threeTexture, this._srcWidth, this._srcHeight, 6,
        );
    }

    /**
     * Loads a single image from a URL, optionally downscaling if it
     * exceeds {@link Texture2D.maxSize}.
     *
     * @internal
     * @returns the loaded (and possibly downscaled) image source.
     */
    private static _loadImage(url: string): Promise<HTMLImageElement | HTMLCanvasElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";

            img.onload = () => {
                const maxSize = Texture2D.maxSize;
                if (maxSize > 0 && (img.width > maxSize || img.height > maxSize)) {
                    const scale = maxSize / Math.max(img.width, img.height);
                    const dstW = Math.round(img.width * scale);
                    const dstH = Math.round(img.height * scale);

                    const canvas = document.createElement("canvas");
                    canvas.width = dstW;
                    canvas.height = dstH;
                    const ctx = canvas.getContext("2d")!;
                    ctx.drawImage(img, 0, 0, dstW, dstH);

                    console.log(
                        `[Cubemap] Downscaled ${img.width}x${img.height}` +
                        ` -> ${dstW}x${dstH} (maxSize=${maxSize})`
                    );

                    resolve(canvas);
                } else {
                    resolve(img);
                }
            };

            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }
}