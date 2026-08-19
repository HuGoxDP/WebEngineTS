// path: src/engine/core/graphics/Cubemap.ts

import * as THREE from "three";
import { EngineObject } from "../EngineObject.ts";
import { FilterMode, type ITextureReferent, type Texture } from "./Texture.ts";
import { Texture2D } from "./Texture2D.ts";
import { estimateThreeTextureVramBytes } from "./_TextureMemory.ts";
import { TextureRelease } from "./TextureRelease.ts";

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
 *
 * // From a panorama already loaded through Resources — the only way to get a
 * // KTX2 skybox, since no image decoder reads KTX2
 * const panorama = await Resources.load(Texture2D, "skybox/stars_panorama");
 * RenderSettings.skybox = await Cubemap.fromEquirectangular(panorama);
 * ```
 */
export class Cubemap extends EngineObject implements ITextureReferent {

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

    /**
     * The texture this cubemap borrows its pixels from, or null when it decoded
     * its own. Set only by {@link fromEquirectangular} when handed a
     * {@link Texture2D}.
     *
     * A borrowed cubemap owns no pixels: it holds a second Three.js texture over
     * the *same* GPU upload, differing only in mapping. That is what keeps the
     * skybox to one upload, and what makes freeing or counting its memory the
     * source's business rather than this object's.
     */
    private _borrowedFrom: Texture2D | null = null;

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
     * Accepts either a URL or an already-decoded {@link Texture2D}:
     *
     * - **URL** — decoded here with the browser's image decoder, so the format
     *   must be one an `<img>` can read (JPEG, PNG, WebP). {@link Texture2D.maxSize}
     *   is honoured on this path.
     * - **Texture2D** — the pixels are taken as they are. This is the only way
     *   to build a cubemap from a format the browser cannot decode, KTX2/Basis
     *   above all: load it through {@link Resources}, which transcodes it, and
     *   hand the result over. The texture keeps its own format, so a compressed
     *   panorama stays compressed in VRAM. `maxSize` does **not** apply — it was
     *   already applied (or not) when the texture was loaded.
     *
     * A borrowed texture is not copied and not modified: the cubemap holds a
     * second Three.js handle over the same GPU upload. The caller keeps
     * ownership, and must keep the texture alive for as long as the cubemap is
     * in use — destroying it frees the pixels both are drawing from.
     *
     * @param source — the panoramic image URL, or a decoded panorama texture.
     * @returns a Promise that resolves to the loaded Cubemap.
     *
     * @remarks
     * Equivalent to importing an equirectangular panorama in Unity and
     * converting it to a Cubemap.
     *
     * @example
     * ```ts
     * // From a URL:
     * const sky = await Cubemap.fromEquirectangular(
     *     assets.getBlobUrl("space_panorama.jpg")
     * );
     *
     * // From an asset, which is what a KTX2 panorama requires. No extension,
     * // so Resources.preferExtension decides which variant is read:
     * const panorama = await Resources.load(Texture2D, "skybox/space_panorama");
     * RenderSettings.skybox = await Cubemap.fromEquirectangular(panorama);
     * ```
     */
    public static async fromEquirectangular(source: string | Texture2D): Promise<Cubemap> {
        if (typeof source !== "string") {
            return Cubemap._fromEquirectangularTexture(source);
        }

        const image = await Cubemap._loadImage(source);
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
     * Builds an equirectangular cubemap over a texture someone else owns.
     *
     * @remarks
     * The handle is cloned rather than used directly. A clone shares the
     * Three.js `Source`, so there is still exactly one GPU upload and one entry
     * in `renderer.info.memory.textures`; what it does not share is `mapping`,
     * which has to become equirectangular here and must not become
     * equirectangular on a cached asset that something else may be sampling as
     * an ordinary map.
     */
    private static _fromEquirectangularTexture(source: Texture2D): Cubemap {
        const cubemap = new Cubemap(
            Cubemap._equirectHandleFor(source), "Cubemap (equirectangular)",
        );
        cubemap._isEquirectangular = true;
        cubemap._borrowedFrom = source;
        cubemap._srcWidth = source.width;
        cubemap._srcHeight = source.height;

        // A streamed texture is re-decoded in place at another detail level;
        // without this the cubemap would keep drawing the level that was
        // replaced. Dropped again in dispose().
        source._addReferent(cubemap);

        return cubemap;
    }

    /** A private handle over a borrowed texture's pixels, mapped as a panorama. */
    private static _equirectHandleFor(source: Texture2D): THREE.Texture {
        const handle = source._internalThreeTexture.clone();
        handle.mapping = THREE.EquirectangularReflectionMapping;
        handle.needsUpdate = true;
        return handle;
    }

    /**
     * @internal
     * Re-points this cubemap at a borrowed texture's replacement handle.
     *
     * **NEVER use in user-facing code.**
     */
    public _onTextureSwapped(texture: Texture): void {
        if (texture !== this._borrowedFrom) return;

        // Only the clone is disposed. It shares the previous upload's refcount,
        // which the source drops on its own side.
        this._threeTexture.dispose();
        this._threeTexture = Cubemap._equirectHandleFor(this._borrowedFrom);
        this._srcWidth = this._borrowedFrom.width;
        this._srcHeight = this._borrowedFrom.height;
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
     * A cubemap built from a {@link Texture2D} does not own those pixels, so
     * this forwards to that texture — which frees them once and keeps its own
     * `isReadable` bookkeeping straight, instead of blanking a texture its owner
     * still holds.
     *
     * @example
     * ```ts
     * // In start() — after first render:
     * const skybox = RenderSettings.skybox;
     * if (skybox) skybox.releaseSourceImage();
     * ```
     */
    public releaseSourceImage(): void {
        if (this._borrowedFrom) {
            this._borrowedFrom.releaseSourceImage();
            return;
        }
        TextureRelease.schedule(this);
    }

    /** @internal The texture whose upload state gates the release. */
    public _threeTextureForUpload(): THREE.Texture | null {
        return this._threeTexture;
    }

    /** @internal Frees the pixels. Called by {@link TextureRelease} when safe. */
    public _releaseSourceImageNow(): void {
        const tex = this._threeTexture;

        if (this._borrowedFrom) {
            // Borrowed pixels: the source frees them, so that its own readable
            // state matches and nothing is freed twice.
            this._borrowedFrom._releaseSourceImageNow();
            return;
        }

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
     *
     * A cubemap built from a {@link Texture2D} disposes only its own handle.
     * The pixels belong to that texture and are left intact; Three.js reference
     * -counts the shared upload, so the GPU copy survives for as long as the
     * source still points at it.
     */
    public dispose(): void {
        if (this._borrowedFrom) {
            this._borrowedFrom._removeReferent(this);
            this._borrowedFrom = null;
            this._threeTexture.dispose();
            return;
        }

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
     * A cubemap borrowing a {@link Texture2D} reports zero. There is one upload,
     * and the source already reports it — `MemoryProfiler` sums live textures
     * and live cubemaps into the same figure, so counting it here as well would
     * inflate `estimatedTextureVramBytes` by the size of what is usually the
     * largest texture in the scene.
     *
     * **NEVER use in user-facing code.**
     */
    public _estimateVramBytes(): number {
        if (this._borrowedFrom) return 0;

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