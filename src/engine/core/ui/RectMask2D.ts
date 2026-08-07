import { Behaviour } from "../Behaviour";
import { Rect } from "../math/Rect";
import { Vector2 } from "../math/Vector2";
import { RectTransform } from "./RectTransform";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * Clips everything beneath it to its own rectangle.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.RectMask2D`. Nothing in the toolkit
 * clipped to its parent before this: a label longer than its panel simply drew
 * past the edge. It is also the prerequisite for a scroll view, which is
 * entirely a matter of moving content behind a fixed window.
 *
 * Clipping applies to drawing *and* to hit-testing, so a button scrolled out of
 * view cannot be clicked through the mask.
 *
 * Unlike Unity's, this mask follows the element's full transform: a rotated or
 * scaled mask clips to its actual quad rather than to its bounding box, because
 * the 2D context can clip to an arbitrary path just as cheaply.
 *
 * ```ts
 * const view = panel.addComponent(RectMask2D);
 * view.padding.set(4, 4, 4, 4);   // inset the window slightly
 * ```
 */
@Serializable({ typeName: "RectMask2D", category: "UI" })
export class RectMask2D extends Behaviour {

    /**
     * Bumped whenever a mask appears or disappears.
     *
     * @remarks
     * Elements cache which masks are above them; a mask added to an existing
     * parent changes no transform link, so nothing else would tell them to look
     * again. Same mechanism as {@link CanvasGroup}.
     */
    private static _version: number = 0;

    /** @internal Counter elements compare their cached mask chain against. */
    public static get _structureVersion(): number {
        return RectMask2D._version;
    }

    /** @internal */
    public static _invalidate(): void {
        RectMask2D._version++;
    }

    /** Inset of the clipping window from this element's rect, in canvas units. */
    @SerializedField({ type: FieldType.Object })
    public readonly padding: MaskPadding = new MaskPadding();

    private _rectTransform: RectTransform | null = null;
    private readonly _clip: Rect = new Rect();

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The RectTransform defining the clipping window (auto-added). */
    public get rectTransform(): RectTransform {
        if (!this._rectTransform) {
            this._rectTransform = this.gameObject.getComponent(RectTransform)
                ?? this.gameObject.addComponent(RectTransform);
        }
        return this._rectTransform;
    }

    protected override onEnable(): void {
        RectMask2D._invalidate();
    }

    protected override onDisable(): void {
        RectMask2D._invalidate();
    }

    protected override onDestroy(): void {
        RectMask2D._invalidate();
    }

    /**
     * @internal
     * The clipping window in this mask's own local space, padding applied.
     * Returns an internal rect — read it, never keep it.
     */
    public _clipRect(): Rect {
        const r = this.rectTransform._resolvedLocalRect;
        const out = this._clip;
        out.set(
            r.x + this.padding.left,
            r.y + this.padding.top,
            Math.max(0, r.width - this.padding.left - this.padding.right),
            Math.max(0, r.height - this.padding.top - this.padding.bottom),
        );
        return out;
    }

    /**
     * @internal
     * Whether a canvas-space point falls inside this mask's window.
     *
     * Goes through the inverse transform, so a rotated mask tests against its
     * real quad rather than its bounds.
     */
    public _containsCanvasPoint(x: number, y: number): boolean {
        const local = RectMask2D._scratchPoint;
        if (!this.rectTransform.canvasToLocalPoint(x, y, local)) return false;

        const clip = this._clipRect();
        return local.x >= clip.x && local.x <= clip.x + clip.width
            && local.y >= clip.y && local.y <= clip.y + clip.height;
    }

    /** Scratch for the point test; never live across a call. */
    private static readonly _scratchPoint: Vector2 = new Vector2();
}

/** Inset of a {@link RectMask2D} window from the element's rect. */
export class MaskPadding {

    /** Inset on the low-X edge. */
    public left: number = 0;

    /** Inset on the high-X edge. */
    public right: number = 0;

    /** Inset on the low-Y edge, which is the **top** in this Y-down system. */
    public top: number = 0;

    /** Inset on the high-Y edge, which is the **bottom**. */
    public bottom: number = 0;

    /**
     * Sets all four insets.
     *
     * @param left - low-X inset.
     * @param right - high-X inset.
     * @param top - low-Y (visually top) inset.
     * @param bottom - high-Y (visually bottom) inset.
     * @returns this, for chaining.
     */
    public set(left: number, right: number, top: number, bottom: number): this {
        this.left = left;
        this.right = right;
        this.top = top;
        this.bottom = bottom;
        return this;
    }

    /** Sets every inset to the same value. */
    public setAll(value: number): this {
        return this.set(value, value, value, value);
    }
}
