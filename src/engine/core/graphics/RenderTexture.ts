// path: src/engine/core/graphics/RenderTexture.ts

import * as THREE from "three";
import { Texture, FilterMode, TextureWrapMode } from "./Texture.ts";

// ==================== ENUMS ====================

/**
 * Pixel format of a render target's colour buffer.
 *
 * @remarks
 * Equivalent to Unity's `RenderTextureFormat`.
 *
 * Only the two formats the engine can allocate on every WebGL2 device are
 * supported. Anything else — a depth-only format, a compressed target, an
 * array or a cube — is not part of C6 and has no engine name, so there is
 * nothing to pass by mistake.
 *
 * The numeric values are Unity's, so a value written for Unity keeps its
 * meaning when it reaches the engine.
 */
export enum RenderTextureFormat {
    /** 8-bit RGBA, sRGB-encoded on write. Unity's default in a linear project. */
    ARGB32 = 0,
    /** 16-bit half-float RGBA, linear. Falls back to {@link ARGB32} where the device cannot render to float. */
    ARGBHalf = 2,
    /** The device default: 8-bit RGBA. Resolves to {@link ARGB32}. */
    Default = 7,
    /** The device default with HDR: half-float. Resolves to {@link ARGBHalf}. */
    DefaultHDR = 9
}

/** The depth resolutions a target may be created with, in bits. */
const DEPTH_BITS = [0, 16, 24, 32] as const;

/** The multi-sample counts a target may be created with. */
const SAMPLES = [1, 2, 4, 8] as const;

/** Bytes per pixel of each colour format, for the VRAM estimate. */
const BYTES_PER_PIXEL: Record<number, number> = {
    [RenderTextureFormat.ARGB32]: 4,
    [RenderTextureFormat.ARGBHalf]: 8
};

/** Bytes per pixel of each depth resolution, for the VRAM estimate. */
const DEPTH_BYTES_PER_PIXEL: Record<number, number> = {
    0: 0,
    16: 2,
    24: 4,
    32: 4
};

/**
 * Nudges `value` onto the nearest member of `allowed`, first one winning a tie,
 * and says so once when the value was not already allowed.
 */
function nearestAllowed(value: number, allowed: readonly number[], what: string): number {
    let best = allowed[0];
    let bestDistance = Math.abs(value - best);
    for (const candidate of allowed) {
        const distance = Math.abs(value - candidate);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    if (best !== value) {
        console.warn(`[RenderTexture] ${what} ${value} is not supported; using ${best}.`);
    }
    return best;
}

// ==================== RENDER TEXTURE CLASS ====================

/**
 * A texture a camera can render into (Unity's `RenderTexture`).
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.RenderTexture`.
 *
 * A `RenderTexture` is a {@link Texture} whose GPU image is produced by
 * rendering a camera into it, not by decoding a file — a mirror, a security
 * monitor or a camera preview. Assign it to `Camera.targetTexture` (C6 phase 3)
 * and to a material's main-texture slot to show what that camera sees.
 *
 * Three things distinguish it from an image texture, and they are the whole
 * reason this type exists:
 *
 * 1. **It is a resource, not an asset.** Nothing loads it and nothing writes
 *    it: a script or the editor constructs it, and it dies with the scene.
 * 2. **Its GPU allocation is lazy.** Constructing one allocates nothing on the
 *    GPU; `create()` marks it wanted and the backend initialises it on the
 *    first render into it. `release()` gives the allocation back and leaves the
 *    object usable.
 * 3. **It is allocated for a format**, not decoded into one: `depth`,
 *    `format` and `antiAliasing` are fixed once the GPU image exists, because
 *    they describe the buffers the renderer created. Resizing is
 *    `release()` → set → `create()`, and the contents do not survive it.
 *
 * **Engine-first design:** the underlying `THREE.WebGLRenderTarget` is hidden
 * behind {@link _internalThreeRenderTarget}. No public signature names it, and
 * no engine code outside the WebGL backend reaches for it.
 *
 * ```ts
 * const monitor = new RenderTexture(512, 512);
 * monitor.create();
 * camera.targetTexture = monitor;
 * const screen = new UnlitMaterial();
 * screen.mainTexture = monitor;   // a quad with this material shows the camera's view
 * ```
 */
export class RenderTexture extends Texture {

    // ==================== PUBLIC ENUM-LIKE STATE ====================

    /**
     * The render target a readback reads from, or null.
     *
     * @remarks
     * Unity's `RenderTexture.active`: the source of
     * `Texture2D.readPixels` (C6 phase 5). A script makes one target active,
     * reads from a `Texture2D`, and clears it again — the synchronous
     * GPU → CPU copy the engine supports.
     *
     * A destroyed target clears itself here (see {@link onDestroy}), so a
     * dangling reference cannot be read from.
     */
    public static active: RenderTexture | null = null;

    // ==================== PRIVATE FIELDS ====================

    private _width: number;
    private _height: number;
    private _depth: number;
    private _format: RenderTextureFormat;
    private _antiAliasing: number;

    /** Whether the GPU image is wanted. Set by `create()`, cleared by `release()`. */
    private _created: boolean = false;

    private _threeRenderTarget: THREE.WebGLRenderTarget;

    /** Properties already refused this run while the texture was created, so the warning is once per property. */
    private readonly _refusedImmutable: Set<string> = new Set();

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a render target of `width` x `height` pixels.
     *
     * @param width — width in pixels. Non-finite or below 1 is a programming
     *                 error and throws `RangeError`; a fraction is floored.
     * @param height — height in pixels, as `width`.
     * @param depth — depth-buffer resolution in bits: 0 (none), 16, 24 or 32.
     *                Anything else snaps to the nearest and warns once.
     * @param format — {@link RenderTextureFormat}. `Default` resolves to
     *                 `ARGB32` and `DefaultHDR` to `ARGBHalf`, so the format
     *                 the object reports is the one that will be allocated.
     *
     * @remarks
     * No GPU memory is allocated here. `create()` marks the image wanted; the
     * backend initialises it on the first render into this target.
     *
     * @throws RangeError — a width or height that is not a usable size.
     */
    constructor(width: number, height: number, depth: number = 24, format: RenderTextureFormat = RenderTextureFormat.Default) {
        super();
        this.name = "RenderTexture";

        this._width = RenderTexture._requireSize("width", width);
        this._height = RenderTexture._requireSize("height", height);
        this._depth = depth === 0 ? 0 : nearestAllowed(depth, DEPTH_BITS, "depth");
        this._format = RenderTexture._resolveFormat(format);
        this._antiAliasing = 1;

        // The base constructor made a plain THREE.Texture; the target's own
        // texture takes its place, so only one GPU texture exists.
        this._threeRenderTarget = this._buildTarget();
        this._internalThreeTexture.dispose();
        this._setInternalThreeTexture(this._threeRenderTarget.texture);
    }

    /** @internal — a size is a positive, finite, integer pixel count. */
    private static _requireSize(what: string, value: number): number {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
            throw new RangeError(`[RenderTexture] ${what} must be a finite pixel count of at least 1, got ${value}.`);
        }
        return Math.floor(value);
    }

    /** @internal — Unity's `Default` / `DefaultHDR` name a family; the engine allocates one member of it. */
    private static _resolveFormat(format: RenderTextureFormat): RenderTextureFormat {
        if (format === RenderTextureFormat.Default) return RenderTextureFormat.ARGB32;
        if (format === RenderTextureFormat.DefaultHDR) return RenderTextureFormat.ARGBHalf;
        return format;
    }

    // ==================== INTERNAL THREE.JS ACCESSORS ====================

    /**
     * @internal
     * The underlying Three.js render target.
     *
     * The WebGL backend binds this to render into it and reads it back. No
     * other subsystem — and never user code — may reach for it: a target is a
     * GPU resource, and the seam that reaches the GPU is engine-typed
     * (`renderScene(scene, camera, target)`).
     *
     * **NEVER use in user-facing code.**
     */
    public get _internalThreeRenderTarget(): THREE.WebGLRenderTarget {
        return this._threeRenderTarget;
    }

    /**
     * @internal
     * Marks this target as created because the backend is about to use it.
     *
     * @remarks
     * Unity creates a target the first time a camera renders into it, whether
     * or not `create()` was called first. The backend says so through here, so
     * `isCreated()` answers what the GPU is actually holding.
     *
     * **NEVER use in user-facing code.**
     */
    public _markCreatedByBackend(): void {
        this._created = true;
    }

    /** Builds the Three.js target from the descriptor, disposing the one it replaces. */
    private _buildTarget(): THREE.WebGLRenderTarget {
        const target = new THREE.WebGLRenderTarget(this._width, this._height, {
            // A target holds colour the renderer encoded; sampling decodes it.
            type: this._format === RenderTextureFormat.ARGBHalf ? THREE.HalfFloatType : THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            colorSpace: this._format === RenderTextureFormat.ARGBHalf ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace,
            depthBuffer: this._depth > 0,
            stencilBuffer: this._depth >= 24,
            samples: this._antiAliasing > 1 ? this._antiAliasing : 0,
            // Mipmaps of a live target are not generated: three would have to
            // re-render into each level, and no consumer asks for one.
            generateMipmaps: false
        });
        target.texture.name = this.name;
        return target;
    }

    /**
     * Replaces the descriptor textures with a freshly built target, leaking nothing.
     * Only legal while the GPU image does not exist.
     */
    private _rebuildTarget(): void {
        const previous = this._threeRenderTarget;
        this._threeRenderTarget = this._buildTarget();
        previous.dispose();
        this._setInternalThreeTexture(this._threeRenderTarget.texture);
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * Width in pixels.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.width`. Immutable while the GPU
     * image exists: setting it then is refused with one `console.error` and the
     * value is ignored. Resize is `release()`, set, `create()` — and the
     * contents do not survive it.
     */
    public get width(): number {
        return this._width;
    }

    public set width(value: number) {
        if (this._refuseImmutable("width")) return;
        this._width = RenderTexture._requireSize("width", value);
        this._rebuildTarget();
    }

    /**
     * Height in pixels.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.height`, with the same
     * created-texture rule as {@link width}.
     */
    public get height(): number {
        return this._height;
    }

    public set height(value: number) {
        if (this._refuseImmutable("height")) return;
        this._height = RenderTexture._requireSize("height", value);
        this._rebuildTarget();
    }

    /**
     * Depth-buffer resolution in bits: 0 (none), 16, 24 or 32.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.depth`. A value outside the set
     * snaps to the nearest and warns once — at construction and on every later
     * assignment. The resolved value is what this reports, so there is no way
     * to observe the request that was refused.
     */
    public get depth(): number {
        return this._depth;
    }

    public set depth(value: number) {
        if (this._refuseImmutable("depth")) return;
        this._depth = value === 0 ? 0 : nearestAllowed(value, DEPTH_BITS, "depth");
        this._rebuildTarget();
    }

    /**
     * The pixel format that will be allocated — never `Default` or `DefaultHDR`.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.format`, resolved: a request for a
     * device default names a family, and the object reports the member the
     * engine allocates. Immutable while the GPU image exists, as {@link width}.
     */
    public get format(): RenderTextureFormat {
        return this._format;
    }

    public set format(value: RenderTextureFormat) {
        if (this._refuseImmutable("format")) return;
        this._format = RenderTexture._resolveFormat(value);
        this._rebuildTarget();
    }

    /**
     * Multi-sample count: 1 (off), 2, 4 or 8.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.antiAliasing`. A value outside the
     * set snaps to the nearest and warns once, and the device's `MAX_SAMPLES`
     * may lower what is actually allocated. The multisampled colour buffer is
     * what the VRAM estimate accounts for.
     */
    public get antiAliasing(): number {
        return this._antiAliasing;
    }

    public set antiAliasing(value: number) {
        if (this._refuseImmutable("antiAliasing")) return;
        this._antiAliasing = nearestAllowed(value, SAMPLES, "antiAliasing");
        this._rebuildTarget();
    }

    /**
     * Whether a refusal was logged for this property on a created texture.
     * @returns true when the caller should give up (the value was ignored).
     */
    private _refuseImmutable(what: string): boolean {
        if (!this._created) return false;
        if (!this._refusedImmutable.has(what)) {
            this._refusedImmutable.add(what);
            console.error(`[RenderTexture] ${what} cannot change while the target is created; `
                + `release() it first (contents do not survive a resize).`);
        }
        return true;
    }

    // ==================== PUBLIC METHODS ====================

    /**
     * The texture filtering mode.
     *
     * @remarks
     * Equivalent to Unity's `Texture.filterMode`. A change on a **created**
     * target reallocates it, because three uploads a render target's filter
     * parameters once, when it first binds the target, and never again — so the
     * contents are lost. On a target that is not created nothing is reallocated
     * and the change is simply pending.
     */
    public override get filterMode(): FilterMode {
        return super.filterMode;
    }

    public override set filterMode(value: FilterMode) {
        const changed = this.filterMode !== value;
        super.filterMode = value;
        if (changed) this.release();
    }

    /**
     * The texture edge wrapping mode.
     *
     * @remarks
     * Equivalent to Unity's `Texture.wrapMode`, with the same reallocation rule
     * as {@link filterMode}.
     */
    public override get wrapMode(): TextureWrapMode {
        return super.wrapMode;
    }

    public override set wrapMode(value: TextureWrapMode) {
        const changed = this.wrapMode !== value;
        super.wrapMode = value;
        if (changed) this.release();
    }

    /**
     * Marks this target wanted, so the backend initialises it on first use.
     *
     * @returns true when the target exists and can be created.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.Create`. Idempotent: creating twice
     * leaves the GPU image as it is. No GPU memory is allocated here — three
     * allocates the framebuffer on the first `setRenderTarget` — so this only
     * states the intent, and a render into a not-created target creates it
     * regardless (Unity's behaviour).
     *
     * After `destroy()` it answers false and warns, because a destroyed target
     * has nothing left to allocate.
     */
    public create(): boolean {
        if (!this.exists()) {
            console.warn("[RenderTexture] create() on a destroyed RenderTexture; the object is dead.");
            return false;
        }
        this._created = true;
        return true;
    }

    /**
     * Gives the GPU image back and leaves the object usable.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.Release`. Idempotent: releasing
     * twice is the second one doing nothing. A camera still holding this
     * target keeps it — the next render creates it again — and a material
     * still sampling it samples whatever a render put there last, which after a
     * release is nothing.
     */
    public release(): void {
        if (!this._created) return;
        this._created = false;
        // A fresh empty image, so the base texture stays a live THREE.Texture
        // (anything still sampling this target stops reading freed memory).
        this._rebuildTarget();
    }

    /**
     * Whether the GPU image is wanted.
     *
     * @remarks
     * Equivalent to Unity's `RenderTexture.IsCreated`. False before
     * `create()`, true after it or after a render into this target, and false
     * again after `release()`.
     */
    public isCreated(): boolean {
        return this._created;
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * The active target a readback should read from, or null.
     *
     * @remarks
     * Unity's `RenderTexture.active` is a plain static; this is the read that
     * guards it, so a call with no active target — or an active one that has been
     * destroyed, or one whose storage format has no readable form — answers null
     * or false rather than reading freed memory. Phase 5's `Texture2D.readPixels`
     * is the only caller.
     *
     * **NEVER use in user-facing code.**
     */
    public static _activeForReadback(): RenderTexture | null {
        const active = RenderTexture.active;
        if (active === null) return null;
        if (!active.exists()) return null;
        return active;
    }

    /**
     * @internal
     * Copies `width * height * 4` bytes out of this target into `out`, top row first.
     *
     * @returns true when the pixels were read. False — with the buffer untouched —
     *          when there is no running {@link Application} to read through, or the
     *          backend cannot read this target.
     *
     * **NEVER use in user-facing code.**
     */
    public _readBack(x: number, y: number, width: number, height: number, out: Uint8Array): boolean {
        if (RenderTexture._readHook === null) return false;
        return RenderTexture._readHook(this, x, y, width, height, out);
    }

    /**
     * @internal
     * Reads a render target's pixels through the running Application.
     *
     * @remarks
     * A callback rather than an import: `Application` installs it at construction
     * and clears it on `dispose()`, the same pattern `Camera._renderHook` uses —
     * the graphics modules must not import `Application`, which imports them.
     *
     * **NEVER use in user-facing code.**
     */
    public static _readHook: ((target: RenderTexture, x: number, y: number, width: number, height: number, out: Uint8Array) => boolean) | null = null;

    protected override onDestroy(): void {
        this._created = false;
        this._threeRenderTarget.dispose();
        // `active` is a global slot pointing at GPU memory; a destroyed target
        // must clear it rather than leave a readback reading freed bytes.
        if (RenderTexture.active === this) RenderTexture.active = null;
        // The base disposes `_internalThreeTexture`, which here is the target's
        // own texture (already disposed with the target).
        super.onDestroy();
        this._threeRenderTarget.texture.dispose();
    }

    // ==================== OVERRIDES ====================

    /**
     * @internal
     * Does nothing: a target's storage format is fixed at allocation.
     *
     * @remarks
     * Overriding matters because the base changes `colorSpace`, and a material
     * slot that calls this for a data map (a normal map, a metallic map) would
     * otherwise re-tag a target's texture as linear — making an ARGB32 target
     * sample as raw values instead of sRGB, and showing a dark monitor.
     *
     * **NEVER use in user-facing code.**
     */
    public override _setLinearData(_linear: boolean): void {
        // Intentionally empty. See the remarks.
    }

    /**
     * @internal
     * Estimates the GPU (VRAM) memory this target occupies, in bytes.
     *
     * @remarks
     * Pure arithmetic — no GL call — so the diagnostics subsystem can report a
     * figure for a target that was never rendered into. Accounts for the
     * multisampled colour renderbuffer and the depth buffer as well as colour,
     * and reports 0 while the target is not created, which is the state the
     * memory profiler's total has to agree with.
     *
     * **NEVER use in user-facing code.**
     */
    public override _estimateVramBytes(): number {
        if (!this._created) return 0;
        const pixels = this._width * this._height;
        const bpp = BYTES_PER_PIXEL[this._format] ?? 4;
        const mipFactor = this.filterMode === FilterMode.Trilinear ? 4 / 3 : 1;
        const samples = this._antiAliasing > 1 ? this._antiAliasing : 1;

        let bytes = pixels * bpp * mipFactor;
        if (this._antiAliasing > 1) bytes += pixels * bpp * samples;
        const depthBpp = DEPTH_BYTES_PER_PIXEL[this._depth] ?? 0;
        bytes += pixels * depthBpp * samples;
        return Math.round(bytes);
    }
}
