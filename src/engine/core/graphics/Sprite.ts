import { Rect } from "../math/Rect";
import { Vector2 } from "../math/Vector2";
import type { Texture2D } from "./Texture2D";

/**
 * Fixed margins of a {@link Sprite}, in texture pixels.
 *
 * @remarks
 * A non-zero border turns the sprite into a nine-slice: the corners are drawn
 * at their natural size, the edges stretch along one axis, and the middle
 * stretches both ways. That is how one small texture makes a panel of any size
 * without its rounded corners smearing.
 */
export class SpriteBorder {

    /** Margin on the left edge, in texture pixels. */
    public left: number = 0;

    /** Margin on the right edge, in texture pixels. */
    public right: number = 0;

    /** Margin on the **top** edge — low Y, since sprite rects are Y-down. */
    public top: number = 0;

    /** Margin on the **bottom** edge — high Y. */
    public bottom: number = 0;

    /** Whether any margin is set, i.e. whether this sprite slices at all. */
    public get isEmpty(): boolean {
        return this.left <= 0 && this.right <= 0 && this.top <= 0 && this.bottom <= 0;
    }

    /**
     * Sets all four margins.
     *
     * @param left - left margin in texture pixels.
     * @param right - right margin.
     * @param top - top (low-Y) margin.
     * @param bottom - bottom (high-Y) margin.
     * @returns this, for chaining.
     */
    public set(left: number, right: number, top: number, bottom: number): this {
        this.left = left;
        this.right = right;
        this.top = top;
        this.bottom = bottom;
        return this;
    }

    /** Sets every margin to the same value. */
    public setAll(value: number): this {
        return this.set(value, value, value, value);
    }
}

/**
 * A drawable region of a texture, with optional nine-slice margins.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Sprite`, and what {@link UIImage} draws.
 * Two things it buys that a bare {@link Texture2D} cannot:
 *
 * - **Atlases.** Many sprites share one texture, each taking a different
 *   {@link rect} — one upload, one bind, no seams between unrelated art.
 * - **Nine-slice.** {@link border} lets a 48×48 rounded panel stretch to any
 *   size with its corners intact.
 *
 * **Coordinates are Y-down from the texture's top-left**, matching the 2D
 * context's source rectangles and the rest of this UI. Unity measures sprite
 * rects from the bottom-left, so a rect ported from it needs its Y flipped.
 *
 * ```ts
 * const panel = new Sprite(atlas, new Rect(0, 0, 48, 48));
 * panel.border.setAll(16);          // 16px corners that never stretch
 * image.sprite = panel;
 * image.type = ImageType.Sliced;
 * ```
 */
export class Sprite {

    /** The texture this sprite is cut from. */
    public readonly texture: Texture2D;

    /**
     * The region of {@link texture} to draw, in pixels from its top-left.
     *
     * @remarks
     * A zero-sized rect means "the whole texture", which is what
     * {@link fromTexture} leaves it as — the texture may not have finished
     * decoding when the sprite is built, so its size cannot be baked in.
     */
    public readonly rect: Rect;

    /** Nine-slice margins. Empty by default, i.e. a plain stretched sprite. */
    public readonly border: SpriteBorder = new SpriteBorder();

    /**
     * Normalized pivot within {@link rect}. `(0.5, 0.5)` is the centre.
     *
     * @remarks
     * Carried for parity with Unity and for world-space use; UI layout takes
     * its pivot from the {@link RectTransform} instead.
     */
    public readonly pivot: Vector2 = new Vector2(0.5, 0.5);

    /**
     * Texture pixels per world unit, for non-UI use.
     *
     * @remarks Equivalent to Unity's sprite import setting `Pixels Per Unit`.
     */
    public pixelsPerUnit: number = 100;

    /**
     * @param texture - the texture to cut from.
     * @param rect - region in pixels from the texture's top-left; omit for the
     *               whole texture.
     */
    constructor(texture: Texture2D, rect?: Rect) {
        this.texture = texture;
        this.rect = rect ? rect.clone() : new Rect(0, 0, 0, 0);
    }

    /** Wraps a whole texture as a sprite, with no border. */
    public static fromTexture(texture: Texture2D): Sprite {
        return new Sprite(texture);
    }

    /** Width of the drawn region in texture pixels. */
    public get width(): number {
        return this.rect.width > 0 ? this.rect.width : this.texture.width;
    }

    /** Height of the drawn region in texture pixels. */
    public get height(): number {
        return this.rect.height > 0 ? this.rect.height : this.texture.height;
    }

    /**
     * @internal
     * Writes the source rectangle to sample, resolving "whole texture" against
     * the texture's current size.
     *
     * @param out - rect to receive the result.
     * @returns `out` for chaining.
     */
    public _sourceRect(out: Rect): Rect {
        if (this.rect.width > 0 && this.rect.height > 0) return out.copy(this.rect);
        return out.set(0, 0, this.texture.width, this.texture.height);
    }
}
