import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { HASH_SEED, cssColor, hashBool, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { Rect } from "../math/Rect";
import type { Texture2D } from "../graphics/Texture2D";
import type { GameObject } from "../GameObject";

/** Axis along which {@link UIImage.fillAmount} clips the image. */
export enum ImageFillMethod {
    Horizontal = "Horizontal",
    Vertical = "Vertical",
}

/** Edge {@link UIImage.fillAmount} grows from. */
export enum ImageFillOrigin {
    /** Horizontal fill grows left → right. */
    Left = "Left",
    /** Horizontal fill grows right → left. */
    Right = "Right",
    /** Vertical fill grows top → bottom. */
    Top = "Top",
    /** Vertical fill grows bottom → top. */
    Bottom = "Bottom",
}

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

    /** Optional sprite texture. When set, draws the texture instead of a solid color. */
    public sprite: Texture2D | null = null;

    /**
     * Fill amount (0 = empty, 1 = full), clipped along {@link fillMethod}.
     */
    public fillAmount: number = 1;

    /** Axis the fill is clipped along. */
    public fillMethod: ImageFillMethod = ImageFillMethod.Horizontal;

    /** Edge the fill grows from. */
    public fillOrigin: ImageFillOrigin = ImageFillOrigin.Left;

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

    /** Offscreen buffer holding the tinted copy of {@link sprite}. */
    private _tintCanvas: HTMLCanvasElement | null = null;
    private _tintSourceId: number = -1;
    private _tintKey: number = -1;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

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
            this._clipToFill(ctx, rect, fill);
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
        h = hashNumber(h, this.borderRadius);
        h = hashBool(h, this.preserveAspect);
        h = hashBool(h, this.imageSmoothing);

        if (!this.sprite) return hashNumber(h, 0);

        h = hashNumber(h, this.sprite.getInstanceID());

        // A texture assigned before its bitmap decoded, or repainted through
        // Texture2D.apply(), keeps the same identity — so track the upload
        // counter and the decoded size, or the canvas would never redraw it.
        const source = this._spriteImage();
        h = hashNumber(h, this.sprite._internalThreeTexture.version);
        h = hashNumber(h, source ? UIImage._sourceWidth(source) : -1);
        return hashNumber(h, source ? UIImage._sourceHeight(source) : -1);
    }

    protected override onDestroy(): void {
        super.onDestroy();
        this._tintCanvas = null;
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

    private _drawSprite(ctx: CanvasRenderingContext2D, source: DrawableSource, rect: Rect): void {
        if (!this.preserveAspect) {
            ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
            return;
        }

        const srcW = UIImage._sourceWidth(source);
        const srcH = UIImage._sourceHeight(source);
        if (srcW <= 0 || srcH <= 0) {
            ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
            return;
        }

        const scale = Math.min(rect.width / srcW, rect.height / srcH);
        const dw = srcW * scale;
        const dh = srcH * scale;
        ctx.drawImage(
            source,
            rect.x + (rect.width - dw) * 0.5,
            rect.y + (rect.height - dh) * 0.5,
            dw, dh,
        );
    }

    /**
     * Returns the bitmap to draw: the sprite itself when untinted, otherwise a
     * cached tinted copy. Rebuilt only when the sprite or the color changes.
     */
    private _resolveSource(): DrawableSource | null {
        const raw = this._spriteImage();
        if (!raw) return null;

        const c = this.color;
        if (c.r >= 1 && c.g >= 1 && c.b >= 1) return raw;

        const key = hashColor(HASH_SEED, c);
        // The texture version is part of the key so a Texture2D.apply() does not
        // leave a stale tinted copy behind.
        const sourceId = this.sprite!.getInstanceID() * 397 + this.sprite!._internalThreeTexture.version;
        if (this._tintCanvas && this._tintKey === key && this._tintSourceId === sourceId) {
            return this._tintCanvas;
        }

        const tinted = this._buildTinted(raw, sourceId, key);
        return tinted ?? raw;
    }

    /** Multiplies the sprite by the tint color into an offscreen buffer. */
    private _buildTinted(source: DrawableSource, sourceId: number, key: number): HTMLCanvasElement | null {
        if (typeof document === "undefined") return null;

        const w = UIImage._sourceWidth(source);
        const h = UIImage._sourceHeight(source);
        if (w <= 0 || h <= 0) return null;

        const buffer = this._tintCanvas ?? document.createElement("canvas");
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
        bctx.fillStyle = `rgb(${Math.round(this.color.r * 255)},${Math.round(this.color.g * 255)},${Math.round(this.color.b * 255)})`;
        bctx.fillRect(0, 0, w, h);

        bctx.globalCompositeOperation = "destination-in";
        bctx.drawImage(source, 0, 0, w, h);

        this._tintCanvas = buffer;
        this._tintSourceId = sourceId;
        this._tintKey = key;
        return buffer;
    }

    private _spriteImage(): DrawableSource | null {
        if (!this.sprite) return null;

        const image = this.sprite._internalThreeTexture.image as unknown;
        if (!image) return null;

        if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) return image;
        if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) return image;
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) return image;

        // Compressed (KTX2) textures expose only { width, height } — the GPU
        // holds the pixels, so there is nothing the 2D context can draw. Without
        // a warning the element silently degrades to a solid `color` fill, which
        // looks like a layout bug rather than a format problem.
        const id = this.sprite.getInstanceID();
        if (!_warnedTextures.has(id)) {
            _warnedTextures.add(id);
            console.warn(
                `[UIImage] Texture "${this.sprite.name}" cannot be drawn on a Canvas: `
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
