import { Selectable } from "./Selectable";
import { Color } from "../math/Color";
import { Mathf } from "../math/Mathf";
import { UIEvent } from "./UIEvent";
import { HASH_SEED, cssColor, hashBool, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { PointerEventData } from "./PointerEventData";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/**
 * Direction a {@link Scrollbar} handle travels as its value grows.
 *
 * @remarks
 * Because Y points down, **`TopToBottom` is the natural vertical direction** —
 * value 1 puts the handle at the bottom. Unity's natural vertical is
 * `BottomToTop`.
 */
export enum ScrollbarDirection {
    LeftToRight = "LeftToRight",
    RightToLeft = "RightToLeft",
    TopToBottom = "TopToBottom",
    BottomToTop = "BottomToTop",
}

/**
 * A draggable bar reporting a position within a larger range.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Scrollbar`. Draws its own track and
 * handle, like the other controls here.
 *
 * The handle's length reflects {@link size} — the fraction of the content that
 * is visible — so the bar doubles as an indicator of how much there is to
 * scroll. Wire it to a {@link ScrollRect} by hand:
 *
 * ```ts
 * bar.onValueChanged.addListener(v => { scroll.verticalNormalizedPosition = v; });
 * scroll.onValueChanged.addListener(p => { bar.setValueWithoutNotify(p.y); });
 * ```
 *
 * Clicking the track jumps one page toward the pointer; dragging the handle
 * tracks it directly.
 */
export class Scrollbar extends Selectable {

    /** Track color behind the handle. */
    public backgroundColor: Color = new Color(0.16, 0.16, 0.16, 1);

    /** Handle color. */
    public handleColor: Color = new Color(0.45, 0.45, 0.45, 1);

    /** Handle color while hovered or dragged. */
    public handleHighlightColor: Color = new Color(0.60, 0.60, 0.60, 1);

    /** Tint drawn over the control when it is not interactable. */
    public disabledColor: Color = new Color(0.35, 0.35, 0.35, 0.6);

    /** Corner radius of track and handle, in canvas units. */
    public borderRadius: number = 4;

    /** Which way the handle travels as {@link value} grows. */
    public direction: ScrollbarDirection = ScrollbarDirection.TopToBottom;

    /**
     * Number of discrete stops, or `0` for continuous movement.
     *
     * @remarks Equivalent to Unity's `Scrollbar.numberOfSteps`.
     */
    public numberOfSteps: number = 0;

    /** Fired whenever {@link value} changes. */
    public readonly onValueChanged: UIEvent<number> = new UIEvent<number>();

    private _value: number = 0;
    private _size: number = 0.2;

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onPointerDown.addListener(e => this._press(e));
        this.onDrag.addListener(e => this._dragTo(e));
    }

    /** Position within the range, `0`–`1`. */
    public get value(): number { return this._value; }

    public set value(input: number) {
        this._setValue(input, true);
    }

    /**
     * Sets {@link value} without firing {@link onValueChanged}.
     *
     * @remarks
     * Equivalent to Unity's `Scrollbar.SetValueWithoutNotify`. Use it when
     * mirroring a ScrollRect, so the bar following the view does not feed the
     * change straight back and fight it.
     *
     * @param input - the position to store.
     */
    public setValueWithoutNotify(input: number): void {
        this._setValue(input, false);
    }

    /**
     * Fraction of the range the handle covers, `0`–`1`.
     *
     * @remarks
     * `1` means everything is visible and there is nothing to scroll. Feed it
     * `viewportSize / contentSize` to make the handle read as a proportion.
     */
    public get size(): number { return this._size; }

    public set size(value: number) {
        this._size = Mathf.clamp01(value);
    }

    /** Whether the bar runs along Y rather than X. */
    public get isVertical(): boolean {
        return this.direction === ScrollbarDirection.TopToBottom
            || this.direction === ScrollbarDirection.BottomToTop;
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0) return;

        const radius = Math.min(this.borderRadius, rect.width * 0.5, rect.height * 0.5);

        ctx.fillStyle = cssColor(this.backgroundColor);
        roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
        ctx.fill();

        const vertical = this.isVertical;
        const span = vertical ? rect.height : rect.width;
        const handleSpan = Math.max(radius * 2, span * this._size);
        const travel = Math.max(0, span - handleSpan);
        const offset = travel * this._drawFraction();

        const hx = vertical ? rect.x : rect.x + offset;
        const hy = vertical ? rect.y + offset : rect.y;
        const hw = vertical ? rect.width : handleSpan;
        const hh = vertical ? handleSpan : rect.height;

        ctx.fillStyle = cssColor(
            this.isHovered || this.isPressed ? this.handleHighlightColor : this.handleColor,
        );
        roundedRectPath(ctx, hx, hy, hw, hh, radius);
        ctx.fill();

        if (!this.isInteractable()) {
            ctx.fillStyle = cssColor(this.disabledColor);
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
    }

    public override _visualHash(): number {
        let h = hashColor(HASH_SEED, this.backgroundColor);
        h = hashColor(h, this.handleColor);
        h = hashColor(h, this.handleHighlightColor);
        h = hashColor(h, this.disabledColor);
        h = hashNumber(h, this.borderRadius);
        h = hashString(h, this.direction);
        h = hashNumber(h, this._value);
        h = hashNumber(h, this._size);
        h = hashBool(h, this.isHovered || this.isPressed);
        return hashBool(h, this.isInteractable());
    }

    // ── private ──────────────────────────────────────────────────────

    /** Where the handle sits along the track, accounting for direction. */
    private _drawFraction(): number {
        return this.direction === ScrollbarDirection.RightToLeft
            || this.direction === ScrollbarDirection.BottomToTop
            ? 1 - this._value
            : this._value;
    }

    private _setValue(input: number, notify: boolean): void {
        let next = Mathf.clamp01(input);

        if (this.numberOfSteps > 1) {
            const steps = Math.round(this.numberOfSteps) - 1;
            next = Math.round(next * steps) / steps;
        }

        if (this._value === next) return;
        this._value = next;
        if (notify) this.onValueChanged.invoke(next);
    }

    /**
     * A press on the handle grabs it; a press on the track pages toward the
     * pointer, which is what a scrollbar is expected to do.
     */
    private _press(e: PointerEventData): void {
        if (!this.isInteractable()) return;

        const t = this._fractionAt(e);
        if (t < 0) return;

        const handleHalf = this._size * 0.5;
        if (Math.abs(t - this._drawFraction()) <= handleHalf) {
            // On the handle: leave the value alone so the grab does not jump.
            e.consumed = true;
            return;
        }

        const page = Math.max(0.01, this._size);
        this.value = t > this._drawFraction()
            ? this._pageToward(page)
            : this._pageToward(-page);
        e.consumed = true;
    }

    private _dragTo(e: PointerEventData): void {
        if (!this.isInteractable()) return;

        const t = this._fractionAt(e);
        if (t < 0) return;

        this.value = this.direction === ScrollbarDirection.RightToLeft
            || this.direction === ScrollbarDirection.BottomToTop
            ? 1 - t
            : t;
        e.consumed = true;
    }

    /** Steps the value by one page in draw-space, then back to value-space. */
    private _pageToward(delta: number): number {
        const drawn = Mathf.clamp01(this._drawFraction() + delta);
        return this.direction === ScrollbarDirection.RightToLeft
            || this.direction === ScrollbarDirection.BottomToTop
            ? 1 - drawn
            : drawn;
    }

    /**
     * The pointer's position along the track, `0`–`1` in draw space.
     * Returns `-1` when the track is too short to have a position at all.
     */
    private _fractionAt(e: PointerEventData): number {
        const rect = this.rectTransform._resolvedLocalRect;
        const vertical = this.isVertical;

        const span = vertical ? rect.height : rect.width;
        const handleSpan = Math.max(0, span * this._size);
        const travel = span - handleSpan;
        if (travel <= 0) return -1;

        // Measured from the centre of the handle, so grabbing it anywhere keeps
        // the pointer over the same part of it.
        const along = (vertical ? e.localPosition.y - rect.y : e.localPosition.x - rect.x)
            - handleSpan * 0.5;
        return Mathf.clamp01(along / travel);
    }
}
