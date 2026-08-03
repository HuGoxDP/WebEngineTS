import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { Mathf } from "../math/Mathf";
import { UIEvent } from "./UIEvent";
import { HASH_SEED, cssColor, hashBool, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { PointerEventData } from "./PointerEventData";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/**
 * Axis and orientation a {@link Slider} fills along.
 *
 * @remarks
 * Because Y points down, **`TopToBottom` is the natural vertical direction**
 * here — increasing value moves toward larger Y. Unity's natural vertical is
 * `BottomToTop`, so a layout ported from it wants the opposite constant.
 */
export enum SliderDirection {
    LeftToRight = "LeftToRight",
    RightToLeft = "RightToLeft",
    TopToBottom = "TopToBottom",
    BottomToTop = "BottomToTop",
}

/**
 * A draggable value slider.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Slider`. Unlike Unity's, which is
 * assembled from child Image objects, this one draws its own track, fill and
 * handle — the same self-contained approach {@link Button} takes.
 *
 * Pressing anywhere on the track jumps the handle there and begins a drag, so a
 * value can be set with one gesture.
 *
 * ```ts
 * const slider = go.addComponent(Slider);
 * slider.minValue = 0;
 * slider.maxValue = 100;
 * slider.value = 50;
 * slider.onValueChanged.addListener(v => setTemperature(v));
 * ```
 */
export class Slider extends UIBehaviour {

    /** Track color behind the fill. */
    public backgroundColor: Color = new Color(0.20, 0.20, 0.20, 1);

    /** Color of the filled portion, from the low end up to {@link value}. */
    public fillColor: Color = new Color(0.30, 0.60, 0.95, 1);

    /** Handle color. */
    public handleColor: Color = Color.white.clone();

    /** Tint applied to the whole control when `interactable` is false. */
    public disabledColor: Color = new Color(0.35, 0.35, 0.35, 0.6);

    /** Handle diameter in canvas units. */
    public handleSize: number = 20;

    /** Track thickness in canvas units, across the fill axis. */
    public trackThickness: number = 6;

    /** Which way the fill grows. */
    public direction: SliderDirection = SliderDirection.LeftToRight;

    /** Whether the slider responds to pointer input. */
    public interactable: boolean = true;

    /** Snap {@link value} to integers. */
    public wholeNumbers: boolean = false;

    /** Fired whenever {@link value} changes, by drag or by assignment. */
    public readonly onValueChanged: UIEvent<number> = new UIEvent<number>();

    private _minValue: number = 0;
    private _maxValue: number = 1;
    private _value: number = 0;
    private _hovered: boolean = false;
    private _pressed: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onPointerEnter.addListener(() => { this._hovered = true; });
        this.onPointerExit.addListener(() => { this._hovered = false; });
        this.onPointerUp.addListener(() => { this._pressed = false; });

        // A press anywhere on the track moves the handle to it, then the same
        // gesture keeps dragging — one motion to pick a value.
        this.onPointerDown.addListener(e => this._grab(e));
        this.onDrag.addListener(e => this._grab(e));
    }

    /** Lowest value the slider can take. */
    public get minValue(): number { return this._minValue; }

    public set minValue(value: number) {
        if (this._minValue === value) return;
        this._minValue = value;
        this.value = this._value;
    }

    /** Highest value the slider can take. */
    public get maxValue(): number { return this._maxValue; }

    public set maxValue(value: number) {
        if (this._maxValue === value) return;
        this._maxValue = value;
        this.value = this._value;
    }

    /**
     * The current value, clamped into `[minValue, maxValue]` and rounded when
     * {@link wholeNumbers} is set. Assigning fires {@link onValueChanged} only
     * when the stored value actually moves.
     */
    public get value(): number { return this._value; }

    public set value(input: number) {
        const clamped = this._sanitize(input);
        if (this._value === clamped) return;
        this._value = clamped;
        this.onValueChanged.invoke(clamped);
    }

    /**
     * The value expressed as `0..1` across the range.
     *
     * @remarks
     * `0` is always the {@link minValue} end regardless of {@link direction} —
     * direction affects only which way that end is drawn.
     */
    public get normalizedValue(): number {
        const span = this._maxValue - this._minValue;
        return span === 0 ? 0 : (this._value - this._minValue) / span;
    }

    public set normalizedValue(t: number) {
        this.value = Mathf.lerp(this._minValue, this._maxValue, Mathf.clamp01(t));
    }

    /** Whether the slider is currently being dragged. */
    public get isPressed(): boolean { return this._pressed; }

    /** Whether the control fills along Y rather than X. */
    public get isVertical(): boolean {
        return this.direction === SliderDirection.TopToBottom
            || this.direction === SliderDirection.BottomToTop;
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0) return;

        const vertical = this.isVertical;
        const half = this.handleSize * 0.5;
        const thickness = Math.min(
            this.trackThickness,
            vertical ? rect.width : rect.height,
        );

        // The track is inset by the handle radius so the handle stays inside the
        // element's rect at both extremes.
        const trackX = vertical ? rect.x + (rect.width - thickness) * 0.5 : rect.x + half;
        const trackY = vertical ? rect.y + half : rect.y + (rect.height - thickness) * 0.5;
        const trackW = vertical ? thickness : Math.max(0, rect.width - this.handleSize);
        const trackH = vertical ? Math.max(0, rect.height - this.handleSize) : thickness;

        const t = this._drawFraction();
        const radius = thickness * 0.5;

        ctx.fillStyle = cssColor(this.backgroundColor);
        roundedRectPath(ctx, trackX, trackY, trackW, trackH, radius);
        ctx.fill();

        if (t > 0) {
            ctx.fillStyle = cssColor(this.fillColor);
            if (vertical) {
                roundedRectPath(ctx, trackX, trackY, trackW, trackH * t, radius);
            } else {
                roundedRectPath(ctx, trackX, trackY, trackW * t, trackH, radius);
            }
            ctx.fill();
        }

        const cx = vertical ? trackX + trackW * 0.5 : trackX + trackW * t;
        const cy = vertical ? trackY + trackH * t : trackY + trackH * 0.5;

        ctx.fillStyle = cssColor(this.handleColor);
        ctx.beginPath();
        ctx.arc(cx, cy, half * this._handleScale(), 0, Math.PI * 2);
        ctx.fill();

        if (!this.interactable) {
            ctx.fillStyle = cssColor(this.disabledColor);
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
    }

    public override _visualHash(): number {
        let h = hashColor(HASH_SEED, this.backgroundColor);
        h = hashColor(h, this.fillColor);
        h = hashColor(h, this.handleColor);
        h = hashColor(h, this.disabledColor);
        h = hashNumber(h, this.handleSize);
        h = hashNumber(h, this.trackThickness);
        h = hashString(h, this.direction);
        h = hashNumber(h, this._drawFraction());
        h = hashNumber(h, this._handleScale());
        return hashBool(h, this.interactable);
    }

    // ── private ──────────────────────────────────────────────────────

    /** Where along the track the handle sits, accounting for direction. */
    private _drawFraction(): number {
        const t = this.normalizedValue;
        return this.direction === SliderDirection.RightToLeft
            || this.direction === SliderDirection.BottomToTop
            ? 1 - t
            : t;
    }

    /** Handle grows slightly on hover and press, so the state is legible. */
    private _handleScale(): number {
        if (!this.interactable) return 1;
        if (this._pressed) return 1.15;
        return this._hovered ? 1.08 : 1;
    }

    /** Maps a pointer position in local space onto the value range. */
    private _grab(e: PointerEventData): void {
        if (!this.interactable) return;
        this._pressed = true;

        const rect = this.rectTransform._resolvedLocalRect;
        const vertical = this.isVertical;
        const span = (vertical ? rect.height : rect.width) - this.handleSize;
        if (span <= 0) return;

        const start = (vertical ? rect.y : rect.x) + this.handleSize * 0.5;
        const along = (vertical ? e.localPosition.y : e.localPosition.x) - start;

        let t = Mathf.clamp01(along / span);
        if (this.direction === SliderDirection.RightToLeft
            || this.direction === SliderDirection.BottomToTop) {
            t = 1 - t;
        }

        this.normalizedValue = t;

        // A slider owns its drag outright; an enclosing scroll view must not
        // also pan while the handle is being moved.
        e.consumed = true;
    }

    private _sanitize(input: number): number {
        const lo = Math.min(this._minValue, this._maxValue);
        const hi = Math.max(this._minValue, this._maxValue);
        const clamped = Mathf.clamp(input, lo, hi);
        return this.wholeNumbers ? Math.round(clamped) : clamped;
    }
}
