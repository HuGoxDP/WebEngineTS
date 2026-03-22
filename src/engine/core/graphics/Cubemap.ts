// path: src/engine/core/graphics/Cubemap.ts

import * as THREE from "three";
import { EngineObject } from "../EngineObject.ts";
import { FilterMode } from "./Texture.ts";

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
        return cubemap;
    }

    // ==================== CLEANUP ====================

    /**
     * Disposes the underlying GPU texture resources.
     */
    public dispose(): void {
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
     * Loads a single image from a URL as an HTMLImageElement.
     * @internal
     */
    private static _loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }
}