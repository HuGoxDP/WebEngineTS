import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { HASH_SEED, cssColor, hashBool, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import { Rect } from "../math/Rect";
import { TintCache } from "./TintCache";
import { Sprite } from "../graphics/Sprite";
import type { Texture2D } from "../graphics/Texture2D";
import type { GameObject } from "../GameObject";

/** How {@link UIImage.fillAmount} clips the image. */
export enum ImageFillMethod {
    /** Clips along X. */
    Horizontal = "Horizontal",
    /** Clips along Y. */
    Vertical = "Vertical",
    /** A quarter-circle wedge anchored at a corner. */
    Radial90 = "Radial90",
    /** A half-circle wedge anchored at an edge. */
    Radial180 = "Radial180",
    /** A full circular sweep — a cooldown dial. */
    Radial360 = "Radial360",
}

/**
 * Where {@link UIImage.fillAmount} grows from.
 *
 * @remarks
 * Linear fills use the four edges. Radial fills use them as the direction the
 * sweep starts in; {@link ImageFillMethod.Radial90} uses the corners instead,
 * since a quarter wedge is anchored at one.
 */
export enum ImageFillOrigin {
    /** Horizontal fill grows left → right; radial sweeps start pointing left. */
    Left = "Left",
    /** Horizontal fill grows right → left; radial sweeps start pointing right. */
    Right = "Right",
    /** Vertical fill grows top → bottom; radial sweeps start pointing up. */
    Top = "Top",
    /** Vertical fill grows bottom → top; radial sweeps start pointing down. */
    Bottom = "Bottom",
    /** Radial90 only: the wedge is anchored at the top-left corner. */
    TopLeft = "TopLeft",
    /** Radial90 only: anchored at the top-right corner. */
    TopRight = "TopRight",
    /** Radial90 only: anchored at the bottom-right corner. */
    BottomRight = "BottomRight",
    /** Radial90 only: anchored at the bottom-left corner. */
    BottomLeft = "BottomLeft",
}

/** Half a turn in radians, used by the radial sweeps. */
const HALF_TURN = Math.PI;

/** How a sprite is fitted to the element's rect. */
export enum ImageType {
    /** Stretched to the rect as a single quad. */
    Simple = "Simple",
    /**
     * Nine-slice: corners keep their size, edges stretch along one axis, the
     * middle stretches both ways. Needs a {@link Sprite.border}.
     */
    Sliced = "Sliced",
    /** The sprite repeats to fill the rect at its natural pixel size. */
    Tiled = "Tiled",
}

/**
 * Safety cap on how many tiles one Tiled image may draw.
 *
 * @remarks
 * A sprite a few pixels across stretched over a full screen would otherwise
 * issue hundreds of thousands of draws and lock the frame. Past the cap the
 * image falls back to stretching, which is wrong but visible and cheap.
 */
const MAX_TILES = 4096;

/** Bitmap sources the 2D context can draw directly. */
type DrawableSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/**
 * Textures already reported as undrawable, so the warning fires once each
 * instead of on every frame of every element using them.
 */
const _warnedTextures: Set<number> = new Set();

/**
 * Renders a solid color rectangle or a sprite inside a RectTransform.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Image`.
 *
 * When `sprite` is null the rect is filled with `color`; otherwise the sprite is
 * drawn and `color` tints it. `fillAmount` (0–1) clips the image along
 * {@link fillMethod}, which is how progress bars and cooldown meters are built.
 *
 * ```ts
 * const img = go.addComponent(UIImage);
 * img.color = new Color(0.2, 0.6, 1, 0.9);
 * img.fillAmount = 0.75;
 * img.borderRadius = 8;
 * ```
 */
export class UIImage extends UIBehaviour {

    /** Fill color when no sprite is assigned, or the tint applied to one. */
    public color: Color = Color.white.clone();

    private _sprite: Sprite | null = null;

    /**
     * The sprite to draw. When null the rect is filled with {@link color};
     * otherwise the sprite is drawn and `color` tints it.
     *
     * @remarks
     * Assigning a bare {@link Texture2D} still works and wraps it as a
     * whole-texture sprite, so existing scenarios need no change. Assign a
     * {@link Sprite} to draw one region of an atlas, or to nine-slice.
     *
     * **Do not use a compressed (KTX2/Basis) texture here.** The canvas draws
     * through the 2D context, which can only read pixels the CPU holds; a
     * transcoded texture's pixels live only on the GPU, so there is nothing to
     * draw and the element falls back to a flat {@link color} fill (with a
     * console warning, once per texture). KTX2 is the right choice for 3D
     * materials, where its VRAM saving is the whole point — UI sprites should
     * stay uncompressed PNG/WebP.
     */
    public get sprite(): Sprite | null { return this._sprite; }

    public set sprite(value: Sprite | Texture2D | null) {
        if (value === null) {
            this._sprite = null;
            return;
        }
        this._sprite = value instanceof Sprite ? value : Sprite.fromTexture(value);
    }

    /** The texture behind {@link sprite}, or null. */
    public get texture(): Texture2D | null {
        return this._sprite?.texture ?? null;
    }

    /**
     * How the sprite is fitted to the rect.
     *
     * @remarks
     * {@link ImageType.Sliced} needs the sprite to carry a border; without one
     * it draws as {@link ImageType.Simple}.
     */
    public type: ImageType = ImageType.Simple;

    /**
     * Fill amount (0 = empty, 1 = full), clipped along {@link fillMethod}.
     */
    public fillAmount: number = 1;

    /** Axis the fill is clipped along. */
    public fillMethod: ImageFillMethod = ImageFillMethod.Horizontal;

    /** Edge or corner the fill grows from. */
    public fillOrigin: ImageFillOrigin = ImageFillOrigin.Left;

    /**
     * Whether a radial fill sweeps clockwise.
     *
     * @remarks
     * Clockwise on screen, which in this Y-down system means increasing angle —
     * the same direction the 2D context measures in. Ignored by the linear
     * fill methods.
     */
    public fillClockwise: boolean = true;

    /** Corner radius in canvas units. 0 = sharp corners. */
    public borderRadius: number = 0;

    /**
     * Whether the sprite keeps its aspect ratio, letterboxed inside the rect.
     *
     * @remarks Equivalent to Unity's `Image.preserveAspect`.
     */
    public preserveAspect: boolean = false;

    /**
     * Whether the sprite is filtered when scaled.
     * Turn off for crisp pixel art.
     */
    public imageSmoothing: boolean = true;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * Memory held by tinted sprite copies across every UIImage, in bytes.
     *
     * @remarks
     * A tint cannot be applied while drawing, so a tinted sprite is composited
     * into an offscreen buffer once and reused. Those buffers are shared by
     * (texture, tint), so twenty tinted copies of one icon cost one buffer, and
     * every sprite drawn from one atlas with one tint shares a single tinted
     * atlas. Also reported by `MemoryProfiler`.
     */
    public static get tintCacheBytes(): number { return TintCache.bytes; }

    /** Number of tinted buffers currently cached. */
    public static get tintCacheCount(): number { return TintCache.count; }

    /**
     * Upper bound on {@link tintCacheBytes}. Defaults to 32 MB.
     *
     * @remarks
     * Least-recently-used buffers are dropped when the bound is exceeded, and
     * rebuilt on demand if they are needed again. Lower it on a
     * memory-constrained target; raise it for a UI that cycles through many
     * tints of a large atlas.
     */
    public static get tintCacheLimitBytes(): number { return TintCache.limitBytes; }

    public static set tintCacheLimitBytes(value: number) { TintCache.limitBytes = value; }

    /** Drops every cached tinted copy. They are rebuilt on the next draw. */
    public static clearTintCache(): void { TintCache.clear(); }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        const w = rect.width;
        const h = rect.height;
        if (w <= 0 || h <= 0) return;

        const fill = this.fillAmount <= 0 ? 0 : this.fillAmount >= 1 ? 1 : this.fillAmount;
        if (fill <= 0 || this.color.a <= 0) return;

        // Rounded corners come from a clip region, so they apply to sprites and
        // solid fills alike.
        if (this.borderRadius > 0) {
            roundedRectPath(ctx, rect.x, rect.y, w, h, this.borderRadius);
            ctx.clip();
        }

        if (fill < 1) {
            if (this.fillMethod === ImageFillMethod.Horizontal
                || this.fillMethod === ImageFillMethod.Vertical) {
                this._clipToFill(ctx, rect, fill);
            } else {
                this._clipToRadialFill(ctx, rect, fill);
            }
        }

        const source = this._resolveSource();
        if (source) {
            ctx.globalAlpha *= this.color.a;
            ctx.imageSmoothingEnabled = this.imageSmoothing;
            this._drawSprite(ctx, source, rect);
            return;
        }

        ctx.fillStyle = cssColor(this.color);
        ctx.fillRect(rect.x, rect.y, w, h);
    }

    public override _visualHash(): number {
        let h = hashColor(HASH_SEED, this.color);
        h = hashNumber(h, this.fillAmount);
        h = hashString(h, this.fillMethod);
        h = hashString(h, this.fillOrigin);
        h = hashBool(h, this.fillClockwise);
        h = hashNumber(h, this.borderRadius);
        h = hashBool(h, this.preserveAspect);
        h = hashBool(h, this.imageSmoothing);

        const sprite = this._sprite;
        if (!sprite) return hashNumber(h, 0);

        h = hashString(h, this.type);
        h = hashNumber(h, sprite.texture.getInstanceID());
        h = hashNumber(h, sprite.rect.x);
        h = hashNumber(h, sprite.rect.y);
        h = hashNumber(h, sprite.rect.width);
        h = hashNumber(h, sprite.rect.height);
        h = hashNumber(h, sprite.border.left);
        h = hashNumber(h, sprite.border.right);
        h = hashNumber(h, sprite.border.top);
        h = hashNumber(h, sprite.border.bottom);

        // A texture assigned before its bitmap decoded, or repainted through
        // Texture2D.apply(), keeps the same identity — so track the upload
        // counter and the decoded size, or the canvas would never redraw it.
        const source = this._spriteImage();
        h = hashNumber(h, sprite.texture._internalThreeTexture.version);
        h = hashNumber(h, source ? UIImage._sourceWidth(source) : -1);
        return hashNumber(h, source ? UIImage._sourceHeight(source) : -1);
    }

    // ── private ──────────────────────────────────────────────────────

    /** Narrows the clip region to the visible portion for `fillAmount < 1`. */
    private _clipToFill(ctx: CanvasRenderingContext2D, rect: Rect, fill: number): void {
        let x = rect.x;
        let y = rect.y;
        let w = rect.width;
        let h = rect.height;

        if (this.fillMethod === ImageFillMethod.Vertical) {
            h = rect.height * fill;
            if (this.fillOrigin === ImageFillOrigin.Bottom) y = rect.y + rect.height - h;
        } else {
            w = rect.width * fill;
            if (this.fillOrigin === ImageFillOrigin.Right) x = rect.x + rect.width - w;
        }

        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
    }

    /**
     * Narrows the clip region to a wedge for the radial fill methods.
     *
     * @remarks
     * The wedge is a pie slice from the anchor point, cut with a radius long
     * enough to reach past any corner of the rect, so the visible shape is the
     * intersection of the slice with the rect — which is what a cooldown dial
     * or a quarter meter looks like.
     */
    private _clipToRadialFill(ctx: CanvasRenderingContext2D, rect: Rect, fill: number): void {
        const quarter = this.fillMethod === ImageFillMethod.Radial90;
        const sweep = quarter
            ? HALF_TURN * 0.5
            : this.fillMethod === ImageFillMethod.Radial180 ? HALF_TURN : HALF_TURN * 2;

        let cx: number;
        let cy: number;
        let start: number;

        if (quarter) {
            cx = UIImage._cornerX(this.fillOrigin, rect);
            cy = UIImage._cornerY(this.fillOrigin, rect);
            start = UIImage._cornerAngle(this.fillOrigin);
        } else {
            cx = rect.x + rect.width * 0.5;
            cy = rect.y + rect.height * 0.5;
            start = UIImage._edgeAngle(this.fillOrigin);
        }

        // The diagonal reaches every corner from any point inside the rect, and
        // from a corner anchor too.
        const radius = Math.sqrt(rect.width * rect.width + rect.height * rect.height);
        const delta = sweep * fill * (this.fillClockwise ? 1 : -1);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + delta, !this.fillClockwise);
        ctx.closePath();
        ctx.clip();
    }

    /**
     * Direction an edge origin points, in radians.
     *
     * @remarks
     * Angle `0` is +X and grows clockwise on screen, because Y points down —
     * so "up" is negative, not positive as it would be in a Y-up system.
     */
    private static _edgeAngle(origin: ImageFillOrigin): number {
        switch (origin) {
            case ImageFillOrigin.Top:    return -HALF_TURN * 0.5;
            case ImageFillOrigin.Right:  return 0;
            case ImageFillOrigin.Bottom: return HALF_TURN * 0.5;
            default:                     return HALF_TURN;
        }
    }

    /** Angle a corner-anchored quarter wedge starts sweeping from. */
    private static _cornerAngle(origin: ImageFillOrigin): number {
        switch (origin) {
            case ImageFillOrigin.TopRight:    return HALF_TURN * 0.5;
            case ImageFillOrigin.BottomRight: return HALF_TURN;
            case ImageFillOrigin.BottomLeft:  return -HALF_TURN * 0.5;
            default:                          return 0;   // TopLeft
        }
    }

    private static _cornerX(origin: ImageFillOrigin, rect: Rect): number {
        return origin === ImageFillOrigin.TopRight || origin === ImageFillOrigin.BottomRight
            ? rect.x + rect.width
            : rect.x;
    }

    private static _cornerY(origin: ImageFillOrigin, rect: Rect): number {
        return origin === ImageFillOrigin.BottomLeft || origin === ImageFillOrigin.BottomRight
            ? rect.y + rect.height
            : rect.y;
    }

    private _drawSprite(ctx: CanvasRenderingContext2D, source: DrawableSource, rect: Rect): void {
        const sprite = this._sprite!;
        const src = sprite._sourceRect(UIImage._srcScratch);

        // The sprite may name a region of a texture that has not decoded yet.
        if (src.width <= 0 || src.height <= 0) return;

        if (this.type === ImageType.Sliced && !sprite.border.isEmpty) {
            UIImage._drawSliced(ctx, source, src, sprite, rect);
            return;
        }

        if (this.type === ImageType.Tiled) {
            UIImage._drawTiled(ctx, source, src, rect);
            return;
        }

        if (!this.preserveAspect) {
            ctx.drawImage(
                source, src.x, src.y, src.width, src.height,
                rect.x, rect.y, rect.width, rect.height,
            );
            return;
        }

        const scale = Math.min(rect.width / src.width, rect.height / src.height);
        const dw = src.width * scale;
        const dh = src.height * scale;
        ctx.drawImage(
            source, src.x, src.y, src.width, src.height,
            rect.x + (rect.width - dw) * 0.5,
            rect.y + (rect.height - dh) * 0.5,
            dw, dh,
        );
    }

    /**
     * Draws the nine regions of a bordered sprite.
     *
     * @remarks
     * Corners keep their pixel size, edges stretch along one axis and the middle
     * stretches both ways. Destination corners shrink together when the rect is
     * too small to hold them, so a squeezed panel degrades to squashed corners
     * rather than to slices drawn over each other.
     */
    private static _drawSliced(
        ctx: CanvasRenderingContext2D,
        source: DrawableSource,
        src: Rect,
        sprite: Sprite,
        rect: Rect,
    ): void {
        const b = sprite.border;

        const sl = Math.min(b.left, src.width);
        const sr = Math.min(b.right, src.width - sl);
        const st = Math.min(b.top, src.height);
        const sb = Math.min(b.bottom, src.height - st);

        const hScale = Math.min(1, rect.width / Math.max(1e-6, sl + sr));
        const vScale = Math.min(1, rect.height / Math.max(1e-6, st + sb));
        const dl = sl * hScale;
        const dr = sr * hScale;
        const dt = st * vScale;
        const db = sb * vScale;

        const sxs = [src.x, src.x + sl, src.x + src.width - sr];
        const sws = [sl, src.width - sl - sr, sr];
        const sys = [src.y, src.y + st, src.y + src.height - sb];
        const shs = [st, src.height - st - sb, sb];

        const dxs = [rect.x, rect.x + dl, rect.x + rect.width - dr];
        const dws = [dl, rect.width - dl - dr, dr];
        const dys = [rect.y, rect.y + dt, rect.y + rect.height - db];
        const dhs = [dt, rect.height - dt - db, db];

        for (let row = 0; row < 3; row++) {
            if (shs[row] <= 0 || dhs[row] <= 0) continue;
            for (let col = 0; col < 3; col++) {
                if (sws[col] <= 0 || dws[col] <= 0) continue;
                ctx.drawImage(
                    source,
                    sxs[col], sys[row], sws[col], shs[row],
                    dxs[col], dys[row], dws[col], dhs[row],
                );
            }
        }
    }

    /** Repeats the sprite at its natural size, clipped to the rect. */
    private static _drawTiled(
        ctx: CanvasRenderingContext2D,
        source: DrawableSource,
        src: Rect,
        rect: Rect,
    ): void {
        const cols = Math.ceil(rect.width / src.width);
        const rows = Math.ceil(rect.height / src.height);

        if (cols * rows > MAX_TILES) {
            ctx.drawImage(
                source, src.x, src.y, src.width, src.height,
                rect.x, rect.y, rect.width, rect.height,
            );
            return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                ctx.drawImage(
                    source, src.x, src.y, src.width, src.height,
                    rect.x + col * src.width,
                    rect.y + row * src.height,
                    src.width, src.height,
                );
            }
        }

        ctx.restore();
    }

    /** Scratch for the resolved source rectangle; never live across a call. */
    private static readonly _srcScratch: Rect = new Rect();

    /**
     * Returns the bitmap to draw: the sprite itself when untinted, otherwise a
     * tinted copy from the shared cache, built on the first miss.
     */
    private _resolveSource(): DrawableSource | null {
        const raw = this._spriteImage();
        if (!raw) return null;

        const c = this.color;
        if (c.r >= 1 && c.g >= 1 && c.b >= 1) return raw;

        // Alpha is applied while drawing, so two elements differing only in
        // opacity share one tinted buffer.
        const rgb = (Math.round(Math.max(0, Math.min(1, c.r)) * 255) << 16)
            | (Math.round(Math.max(0, Math.min(1, c.g)) * 255) << 8)
            | Math.round(Math.max(0, Math.min(1, c.b)) * 255);

        // The upload counter is part of the identity so a Texture2D.apply()
        // cannot leave a stale tinted copy behind.
        const texture = this._sprite!.texture;
        const textureId = texture.getInstanceID();
        const version = texture._internalThreeTexture.version;

        const cached = TintCache.get(textureId, version, rgb);
        if (cached) return cached;

        const tinted = UIImage._buildTinted(raw, rgb);
        if (!tinted) return raw;

        TintCache.put(textureId, version, rgb, tinted);
        return tinted;
    }

    /** Multiplies a bitmap by `rgb` into a fresh offscreen buffer. */
    private static _buildTinted(source: DrawableSource, rgb: number): HTMLCanvasElement | null {
        if (typeof document === "undefined") return null;

        const w = UIImage._sourceWidth(source);
        const h = UIImage._sourceHeight(source);
        if (w <= 0 || h <= 0) return null;

        const buffer = document.createElement("canvas");
        const bctx = buffer.getContext("2d");
        if (!bctx) return null;

        buffer.width = w;
        buffer.height = h;

        bctx.clearRect(0, 0, w, h);
        bctx.globalCompositeOperation = "source-over";
        bctx.drawImage(source, 0, 0, w, h);

        // Multiply keeps the sprite's shading; the second pass restores the
        // original alpha, which `multiply` would otherwise flatten.
        bctx.globalCompositeOperation = "multiply";
        bctx.fillStyle = `rgb(${(rgb >> 16) & 0xff},${(rgb >> 8) & 0xff},${rgb & 0xff})`;
        bctx.fillRect(0, 0, w, h);

        bctx.globalCompositeOperation = "destination-in";
        bctx.drawImage(source, 0, 0, w, h);

        return buffer;
    }

    private _spriteImage(): DrawableSource | null {
        const texture = this._sprite?.texture;
        if (!texture) return null;

        const image = texture._internalThreeTexture.image as unknown;
        if (!image) return null;

        if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) return image;
        if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) return image;
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) return image;

        // Compressed (KTX2) textures expose only { width, height } — the GPU
        // holds the pixels, so there is nothing the 2D context can draw. Without
        // a warning the element silently degrades to a solid `color` fill, which
        // looks like a layout bug rather than a format problem.
        const id = texture.getInstanceID();
        if (!_warnedTextures.has(id)) {
            _warnedTextures.add(id);
            console.warn(
                `[UIImage] Texture "${texture.name}" cannot be drawn on a Canvas: `
                + `its pixels live only on the GPU (compressed/KTX2 format). `
                + `Falling back to a solid "color" fill — use an uncompressed `
                + `texture for UI sprites.`,
            );
        }
        return null;
    }

    private static _isImageElement(source: DrawableSource): source is HTMLImageElement {
        return typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement;
    }

    private static _sourceWidth(source: DrawableSource): number {
        return UIImage._isImageElement(source)
            ? (source.naturalWidth || source.width)
            : source.width;
    }

    private static _sourceHeight(source: DrawableSource): number {
        return UIImage._isImageElement(source)
            ? (source.naturalHeight || source.height)
            : source.height;
    }
}
