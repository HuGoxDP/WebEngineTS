// path: src/engine/core/graphics/Texture.ts

import * as THREE from "three";
import { EngineObject } from "../EngineObject.ts";
import { estimateThreeTextureVramBytes } from "./_TextureMemory.ts";

// ==================== ENUMS ====================

/**
 * Texture filtering mode.
 *
 * @remarks
 * Equivalent to Unity's `FilterMode`.
 * Values are engine-owned â€” Three.js mapping is internal.
 */
export enum FilterMode {
    /** Nearest-neighbour (pixelated). */
    Point = 0,
    /** Bilinear interpolation. */
    Bilinear = 1,
    /** Trilinear with mipmaps. */
    Trilinear = 2
}

/**
 * Texture edge wrapping mode.
 *
 * @remarks
 * Equivalent to Unity's `TextureWrapMode`.
 */
export enum TextureWrapMode {
    /** Tile the texture. */
    Repeat = 0,
    /** Clamp to edge pixels. */
    Clamp = 1,
    /** Mirror at each boundary. */
    Mirror = 2
}

// ==================== INTERNAL MAPPING ====================
// Maps engine enums â†’ Three.js constants. Never exposed.

/** @internal */
function filterModeToThreeMag(mode: FilterMode): THREE.MagnificationTextureFilter {
    switch (mode) {
        case FilterMode.Point: return THREE.NearestFilter;
        case FilterMode.Bilinear:
        case FilterMode.Trilinear: return THREE.LinearFilter;
        default: return THREE.LinearFilter;
    }
}

/** @internal */
function filterModeToThreeMin(mode: FilterMode): THREE.MinificationTextureFilter {
    switch (mode) {
        case FilterMode.Point: return THREE.NearestFilter;
        case FilterMode.Bilinear: return THREE.LinearFilter;
        case FilterMode.Trilinear: return THREE.LinearMipmapLinearFilter;
        default: return THREE.LinearFilter;
    }
}

/** @internal */
function wrapModeToThree(mode: TextureWrapMode): THREE.Wrapping {
    switch (mode) {
        case TextureWrapMode.Repeat: return THREE.RepeatWrapping;
        case TextureWrapMode.Clamp: return THREE.ClampToEdgeWrapping;
        case TextureWrapMode.Mirror: return THREE.MirroredRepeatWrapping;
        default: return THREE.RepeatWrapping;
    }
}

/** @internal */
function threeMagToFilterMode(filter: THREE.MagnificationTextureFilter): FilterMode {
    switch (filter) {
        case THREE.NearestFilter: return FilterMode.Point;
        case THREE.LinearFilter: return FilterMode.Bilinear;
        default: return FilterMode.Bilinear;
    }
}

/** @internal */
function threeWrapToWrapMode(wrap: THREE.Wrapping): TextureWrapMode {
    switch (wrap) {
        case THREE.RepeatWrapping: return TextureWrapMode.Repeat;
        case THREE.ClampToEdgeWrapping: return TextureWrapMode.Clamp;
        case THREE.MirroredRepeatWrapping: return TextureWrapMode.Mirror;
        default: return TextureWrapMode.Repeat;
    }
}

// ==================== TEXTURE CLASS ====================

/**
 * Base class for all texture types.
 *
 * Stores filter and wrap settings and provides the internal Three.js
 * texture handle. Users interact only with engine enums and properties.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Texture`.
 *
 * Subclasses:
 * - {@link Texture2D} â€” standard 2D image texture.
 *
 * **Engine-first design:** The underlying `THREE.Texture` is hidden.
 * All public API uses engine-owned types.
 */
export class Texture extends EngineObject {

    // ==================== PRIVATE FIELDS ====================

    /**
     * The underlying Three.js texture.
     * @internal â€” NEVER expose to engine users.
     */
    private _threeTexture: THREE.Texture;

    /** Cached engine-side filter mode (avoids reverse-mapping from Three). */
    private _filterMode: FilterMode = FilterMode.Bilinear;

    /** Cached engine-side wrap mode. */
    private _wrapMode: TextureWrapMode = TextureWrapMode.Repeat;

    /** Source URL (if loaded from a file). */
    private _url: string = "";

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a new Texture.
     *
     * @remarks
     * End users should prefer {@link Texture2D} or {@link Texture.load}.
     * The raw constructor is primarily for internal/subclass use.
     */
    constructor() {
        super("Texture");
        this._threeTexture = new THREE.Texture();
        this._syncFilterMode();
        this._syncWrapMode();
    }

    // ==================== INTERNAL THREE.JS ACCESSORS ====================

    /**
     * @internal
     * The underlying Three.js texture handle.
     *
     * Used by:
     * - {@link Material} â€” to assign textures to Three.js material slots
     * - {@link Texture2D} â€” to replace the texture handle after loading
     *
     * **NEVER use in user-facing code.**
     */
    public get _internalThreeTexture(): THREE.Texture {
        return this._threeTexture;
    }

    /**
     * @internal
     * Replaces the underlying Three.js texture.
     *
     * Used by {@link Texture2D} when loading from URL or creating from
     * canvas, where the texture handle must be swapped after construction.
     *
     * @param tex â€” the new Three.js texture. The old one is NOT disposed
     *              (caller must handle disposal if needed).
     */
    public _setInternalThreeTexture(tex: THREE.Texture): void {
        this._threeTexture = tex;
        this._syncFilterMode();
        this._syncWrapMode();
    }

    /**
     * @internal
     * Creates a Texture wrapping an existing Three.js texture.
     *
     * Used by asset loaders and converters that produce THREE.Texture
     * objects from external sources (GLTF, image files, etc.).
     *
     * @param threeTexture â€” the Three.js texture to wrap.
     * @returns a new Texture wrapping the given handle.
     */
    public static _fromThreeTexture(threeTexture: THREE.Texture): Texture {
        const tex = new Texture();
        tex._threeTexture.dispose(); // dispose the default empty texture
        tex._threeTexture = threeTexture;
        // Read back Three.js state into engine fields
        tex._filterMode = threeMagToFilterMode(threeTexture.magFilter);
        tex._wrapMode = threeWrapToWrapMode(threeTexture.wrapS);
        return tex;
    }

    /**
     * @internal
     * Estimates the GPU (VRAM) memory this texture occupies, in bytes.
     *
     * Accounts for the backing format — a KTX2/Basis compressed texture stays
     * compressed in VRAM (typically 8 bpp for BC7/ASTC), whereas an ordinary
     * image is uploaded as RGBA8 at 32 bpp. Used by the diagnostics subsystem
     * to report a VRAM figure that the JS-heap metric cannot reveal.
     *
     * Subclasses override to supply cached dimensions (which survive
     * {@link Texture2D.releaseSourceImage}).
     *
     * **NEVER use in user-facing code.**
     */
    public _estimateVramBytes(): number {
        const image = this._threeTexture.image as { width?: number; height?: number } | null;
        return estimateThreeTextureVramBytes(
            this._threeTexture,
            image?.width ?? 0,
            image?.height ?? 0,
            1,
        );
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The source URL of this texture, or empty string if not loaded from URL.
     */
    public get url(): string {
        return this._url;
    }

    /**
     * The texture filtering mode.
     *
     * @remarks
     * Equivalent to Unity's `Texture.filterMode`.
     */
    public get filterMode(): FilterMode {
        return this._filterMode;
    }

    public set filterMode(value: FilterMode) {
        if (this._filterMode === value) return;
        this._filterMode = value;
        this._syncFilterMode();
    }

    /**
     * The texture edge wrapping mode.
     *
     * @remarks
     * Equivalent to Unity's `Texture.wrapMode`.
     */
    public get wrapMode(): TextureWrapMode {
        return this._wrapMode;
    }

    public set wrapMode(value: TextureWrapMode) {
        if (this._wrapMode === value) return;
        this._wrapMode = value;
        this._syncWrapMode();
    }

    // ==================== PUBLIC METHODS ====================

    /**
     * Sets the UV offset for this texture.
     *
     * @param x â€” horizontal offset.
     * @param y â€” vertical offset.
     *
     * @remarks
     * Equivalent to setting `Material.mainTextureOffset` when this
     * texture is the main texture.
     */
    public setOffset(x: number, y: number): void {
        this._threeTexture.offset.set(x, y);
    }

    /**
     * Sets the UV tiling (repeat) for this texture.
     *
     * @param x â€” horizontal repeat count.
     * @param y â€” vertical repeat count.
     *
     * @remarks
     * Equivalent to setting `Material.mainTextureScale` when this
     * texture is the main texture.
     */
    public setTiling(x: number, y: number): void {
        this._threeTexture.repeat.set(x, y);
    }

    /**
     * Loads a texture from a URL.
     *
     * @param url â€” path to the texture file.
     * @returns a new Texture (loading completes asynchronously).
     *
     * @remarks
     * For more control (async/await, pixel access), use {@link Texture2D.Load}.
     */
    public static load(url: string): Texture {
        const texture = new Texture();
        texture._url = url;
        texture.name = url.split("/").pop() || "Loaded Texture";

        const loader = new THREE.TextureLoader();
        loader.load(url, (loaded: THREE.Texture) => {
            // Replace internal handle with loaded texture
            texture._threeTexture.dispose();
            texture._threeTexture = loaded;
            texture._syncFilterMode();
            texture._syncWrapMode();
            texture._threeTexture.needsUpdate = true;
        });

        return texture;
    }

    // ==================== LIFECYCLE ====================

    protected override onDestroy(): void {
        // Close ImageBitmap if present — unlike HTMLImageElement,
        // ImageBitmap is not garbage-collected and requires explicit .close()
        // to release its backing pixel buffer. Three.js dispose() does NOT
        // do this (see three.js#23953).
        const image = this._threeTexture.image;
        if (image != null && typeof image === "object" && "close" in image
            && typeof (image as ImageBitmap).close === "function") {
            (image as ImageBitmap).close();
        }
        this._threeTexture.image = null;

        this._threeTexture.dispose();
    }

    // ==================== PRIVATE SYNC ====================

    /**
     * Pushes the engine-side filter mode to the Three.js texture.
     */
    private _syncFilterMode(): void {
        this._threeTexture.magFilter = filterModeToThreeMag(this._filterMode);
        this._threeTexture.minFilter = filterModeToThreeMin(this._filterMode);
        this._threeTexture.generateMipmaps = (this._filterMode === FilterMode.Trilinear);
        this._threeTexture.needsUpdate = true;
    }

    /**
     * Pushes the engine-side wrap mode to the Three.js texture.
     */
    private _syncWrapMode(): void {
        const threeWrap = wrapModeToThree(this._wrapMode);
        this._threeTexture.wrapS = threeWrap;
        this._threeTexture.wrapT = threeWrap;
        this._threeTexture.needsUpdate = true;
    }
}