import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import type { Texture2D } from "../graphics/Texture2D";
import type { GameObject } from "../GameObject";

/**
 * Renders a solid color rectangle or a sprite inside a RectTransform.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Image`.
 *
 * When `sprite` is null the rect is filled with `color`.
 * `fillAmount` (0–1) clips the image horizontally, useful for progress bars.
 *
 * ```ts
 * const img = go.addComponent(UIImage);
 * img.color = new Color(0.2, 0.6, 1, 0.9);
 * img.fillAmount = 0.75;
 * ```
 */
export class UIImage extends UIBehaviour {

    /** Fill color (used when no sprite is assigned, or as a tint). */
    public color: Color = Color.white.clone();

    /** Optional sprite texture. When set, draws the texture instead of a solid color. */
    public sprite: Texture2D | null = null;

    /**
     * Horizontal fill amount (0 = empty, 1 = full).
     * Values between 0 and 1 clip the right side of the image.
     */
    public fillAmount: number = 1;

    /** Corner radius in pixels. 0 = sharp corners. */
    public borderRadius: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public override _draw(ctx: CanvasRenderingContext2D): void {
        const rect = this.rectTransform.screenRect;
        if (rect.width <= 0 || rect.height <= 0) return;

        const x = rect.x;
        const y = rect.y;
        const w = rect.width  * Math.max(0, Math.min(1, this.fillAmount));
        const h = rect.height;

        const cssColor = this._toCSSColor(this.color);

        ctx.save();

        if (this.sprite) {
            const img = (this.sprite as any)._threeTexture?.image as
                (HTMLImageElement | HTMLCanvasElement | ImageBitmap | null | undefined);
            if (img) {
                ctx.globalAlpha = this.color.a;
                this._clipRect(ctx, x, y, w, h);
                ctx.drawImage(img, x, y, w, h);
                ctx.restore();
                return;
            }
        }

        // Solid color fill
        ctx.fillStyle = cssColor;
        this._clipRect(ctx, x, y, w, h);
        ctx.fill();

        ctx.restore();
    }

    // ── private ──────────────────────────────────────────────────────

    private _clipRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
        const r = Math.min(this.borderRadius, w / 2, h / 2);
        if (r <= 0) {
            ctx.rect(x, y, w, h);
            ctx.beginPath();
            ctx.rect(x, y, w, h);
        } else {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arcTo(x + w, y,     x + w, y + r,     r);
            ctx.lineTo(x + w, y + h - r);
            ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h);
            ctx.arcTo(x,     y + h, x,     y + h - r, r);
            ctx.lineTo(x, y + r);
            ctx.arcTo(x,     y,     x + r, y,         r);
            ctx.closePath();
        }
    }

    private _toCSSColor(c: Color): string {
        const r = Math.round(c.r * 255);
        const g = Math.round(c.g * 255);
        const b = Math.round(c.b * 255);
        return `rgba(${r},${g},${b},${c.a})`;
    }
}
