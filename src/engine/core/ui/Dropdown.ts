import { Selectable, SelectableState } from "./Selectable";
import { Color } from "../math/Color";
import { Mathf } from "../math/Mathf";
import { UIEvent } from "./UIEvent";
import { HASH_SEED, cssColor, hashBool, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { PointerEventData } from "./PointerEventData";
import type { Rect } from "../math/Rect";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/** Nothing selected, matching Unity's convention for an empty dropdown. */
const NO_SELECTION = -1;

/**
 * A closed list that opens to let one option be picked.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Dropdown`, but self-contained: it draws
 * its own closed field, arrow and open list rather than instantiating a
 * template hierarchy of child objects. That keeps it usable from a scenario
 * without any prefab wiring, which is the point of every control here.
 *
 * The open list is drawn **below the field within the same element**, so give
 * the dropdown a RectTransform tall enough for the list, or leave
 * {@link maxVisibleItems} low. A list longer than that scrolls with the wheel
 * once open.
 *
 * ```ts
 * const dd = go.addComponent(Dropdown);
 * dd.options = ["Nitrogen", "Oxygen", "Argon"];
 * dd.onValueChanged.addListener(i => selectGas(dd.options[i]));
 * ```
 */
@Serializable({ typeName: "Dropdown", category: "UI" })
export class Dropdown extends Selectable {

    /** Background of the closed field. */
    @SerializedField({ type: FieldType.Color })
    public backgroundColor: Color = new Color(0.20, 0.20, 0.20, 1);

    /** Background of the open list. */
    @SerializedField({ type: FieldType.Color })
    public listColor: Color = new Color(0.14, 0.14, 0.14, 1);

    /** Background of the option under the pointer. */
    @SerializedField({ type: FieldType.Color })
    public highlightColor: Color = new Color(0.30, 0.45, 0.70, 1);

    /** Background of the option that is currently selected. */
    @SerializedField({ type: FieldType.Color })
    public selectedColor: Color = new Color(0.24, 0.34, 0.52, 1);

    /** Label and arrow color. */
    @SerializedField({ type: FieldType.Color })
    public textColor: Color = Color.white.clone();

    /** Tint drawn over the control when it is not interactable. */
    @SerializedField({ type: FieldType.Color })
    public disabledColor: Color = new Color(0.35, 0.35, 0.35, 0.6);

    /** Corner radius of the field and the list, in canvas units. */
    @SerializedField()
    public borderRadius: number = 4;

    /** Height of the closed field and of each option, in canvas units. */
    @SerializedField()
    public itemHeight: number = 28;

    /** Inset of the label from the field's left edge, in canvas units. */
    @SerializedField()
    public padding: number = 10;

    /** Label font size in canvas units. */
    @SerializedField()
    public fontSize: number = 16;

    /** Label font family. */
    @SerializedField()
    public fontFamily: string = "Arial, sans-serif";

    /** Text shown when nothing is selected. */
    @SerializedField()
    public placeholder: string = "Select…";

    /** How many options the open list shows before it needs scrolling. */
    @SerializedField()
    public maxVisibleItems: number = 6;

    /** Fired with the new index whenever the selection changes. */
    public readonly onValueChanged: UIEvent<number> = new UIEvent<number>();

    private _options: string[] = [];
    private _value: number = NO_SELECTION;
    private _open: boolean = false;
    private _hoveredIndex: number = NO_SELECTION;
    private _scroll: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onPointerClick.addListener(e => this._click(e));
        this.onPointerExit.addListener(() => { this._hoveredIndex = NO_SELECTION; });
        this.onPointerDown.addListener(e => this._track(e));
    }

    /**
     * The selectable options.
     *
     * @remarks
     * Assigning a shorter list than the current selection clears the selection
     * rather than leaving it dangling past the end.
     */
    @SerializedField({ type: FieldType.Array, elementType: FieldType.String })
    public get options(): readonly string[] { return this._options; }

    public set options(value: readonly string[]) {
        this._options = [...value];
        this._scroll = 0;
        if (this._value >= this._options.length) this._setValue(NO_SELECTION, true);
    }

    /**
     * Index of the selected option, or `-1` for none.
     *
     * @remarks
     * Assigning out of range selects nothing rather than throwing.
     */
    @SerializedField()
    public get value(): number { return this._value; }

    public set value(index: number) {
        this._setValue(index, true);
    }

    /**
     * Sets {@link value} without firing {@link onValueChanged}.
     *
     * @remarks
     * Equivalent to Unity's `Dropdown.SetValueWithoutNotify`. Use it when
     * restoring saved state.
     *
     * @param index - the option to select, or `-1`.
     */
    public setValueWithoutNotify(index: number): void {
        this._setValue(index, false);
    }

    /** The selected option's text, or an empty string when nothing is picked. */
    public get selectedText(): string {
        return this._value >= 0 && this._value < this._options.length
            ? this._options[this._value]
            : "";
    }

    /** Whether the list is currently open. */
    public get isOpen(): boolean { return this._open; }

    /** Opens the list. Does nothing when the control is not interactable. */
    public open(): void {
        if (!this.isInteractable() || this._options.length === 0) return;
        this._open = true;
        this._scrollTo(this._value);
    }

    /** Closes the list. */
    public close(): void {
        this._open = false;
        this._hoveredIndex = NO_SELECTION;
    }

    /** Opens the list if closed, closes it if open. */
    public toggle(): void {
        if (this._open) this.close();
        else this.open();
    }

    /**
     * @internal
     * An open list is drawn past the element's own rect, so both the pointer
     * shortcut and the draw cull have to stop assuming the rect bounds it.
     */
    public override get _expandsHitArea(): boolean {
        return this._open;
    }

    /** @internal An open list can extend past the canvas edge; never cull it. */
    public override get _allowCulling(): boolean {
        return !this._open;
    }

    /**
     * @internal
     * The open list has to stay clickable outside the closed field's bounds, so
     * the hit area grows to cover it.
     */
    public override _hitTest(x: number, y: number, rect: Rect): boolean {
        const height = this._open ? this._totalHeight() : this.itemHeight;
        return x >= rect.x && x <= rect.x + rect.width
            && y >= rect.y && y <= rect.y + height;
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0) return;

        this._drawField(ctx, rect);
        if (this._open) this._drawList(ctx, rect);

        if (!this.isInteractable()) {
            ctx.fillStyle = cssColor(this.disabledColor);
            ctx.fillRect(rect.x, rect.y, rect.width, this._totalHeight());
        }
    }

    public override _visualHash(): number {
        let h = hashColor(HASH_SEED, this.backgroundColor);
        h = hashColor(h, this.listColor);
        h = hashColor(h, this.highlightColor);
        h = hashColor(h, this.selectedColor);
        h = hashColor(h, this.textColor);
        h = hashNumber(h, this.itemHeight);
        h = hashNumber(h, this.fontSize);
        h = hashString(h, this.fontFamily);
        h = hashString(h, this.placeholder);
        h = hashNumber(h, this._value);
        h = hashNumber(h, this._hoveredIndex);
        h = hashNumber(h, this._scroll);
        h = hashNumber(h, this._options.length);
        h = hashString(h, this.selectedText);
        h = hashBool(h, this._open);
        return hashBool(h, this.isInteractable());
    }

    protected override onDisable(): void {
        super.onDisable();
        this.close();
    }

    /**
     * @internal
     * Closes the list when focus moves elsewhere — another control being
     * clicked, Tab, Escape.
     *
     * @remarks
     * An open list is not a decoration: it draws over whatever is beneath it
     * and, through {@link _expandsHitArea} and {@link _hitTest}, swallows
     * pointer input across its whole height. Left open after the user has
     * plainly moved on, it covers the control they moved on to.
     */
    public override _onFocusLost(): void {
        super._onFocusLost();
        this.close();
    }

    // ── private ──────────────────────────────────────────────────────

    /** Total drawn height: the field, plus the list when it is open. */
    private _totalHeight(): number {
        if (!this._open) return this.itemHeight;
        return this.itemHeight + this._visibleCount() * this.itemHeight;
    }

    private _visibleCount(): number {
        return Math.min(this._options.length, Math.max(1, Math.floor(this.maxVisibleItems)));
    }

    private _drawField(ctx: CanvasRenderingContext2D, rect: Rect): void {
        roundedRectPath(ctx, rect.x, rect.y, rect.width, this.itemHeight, this.borderRadius);
        ctx.fillStyle = cssColor(this.backgroundColor);
        ctx.fill();

        const label = this.selectedText || this.placeholder;
        ctx.fillStyle = cssColor(this.textColor);
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, rect.x + this.padding, rect.y + this.itemHeight * 0.5);

        this._drawArrow(ctx, rect);
    }

    /** A small triangle, pointing down when closed and up when open. */
    private _drawArrow(ctx: CanvasRenderingContext2D, rect: Rect): void {
        const size = Math.min(8, this.itemHeight * 0.3);
        const cx = rect.x + rect.width - this.padding - size;
        const cy = rect.y + this.itemHeight * 0.5;
        const dir = this._open ? -1 : 1;

        ctx.fillStyle = cssColor(this.textColor);
        ctx.beginPath();
        ctx.moveTo(cx - size, cy - (size * 0.5 * dir));
        ctx.lineTo(cx + size, cy - (size * 0.5 * dir));
        ctx.lineTo(cx, cy + (size * 0.5 * dir));
        ctx.closePath();
        ctx.fill();
    }

    private _drawList(ctx: CanvasRenderingContext2D, rect: Rect): void {
        const visible = this._visibleCount();
        const top = rect.y + this.itemHeight;
        const height = visible * this.itemHeight;

        roundedRectPath(ctx, rect.x, top, rect.width, height, this.borderRadius);
        ctx.fillStyle = cssColor(this.listColor);
        ctx.fill();

        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        for (let row = 0; row < visible; row++) {
            const index = this._scroll + row;
            if (index >= this._options.length) break;

            const y = top + row * this.itemHeight;

            if (index === this._hoveredIndex || index === this._value) {
                ctx.fillStyle = cssColor(
                    index === this._hoveredIndex ? this.highlightColor : this.selectedColor,
                );
                ctx.fillRect(rect.x, y, rect.width, this.itemHeight);
            }

            ctx.fillStyle = cssColor(this.textColor);
            ctx.fillText(
                this._options[index],
                rect.x + this.padding,
                y + this.itemHeight * 0.5,
            );
        }
    }

    /** Which option a local-space point falls on, or -1 for the field. */
    private _indexAt(localY: number, rect: Rect): number {
        const listTop = rect.y + this.itemHeight;
        if (localY < listTop) return NO_SELECTION;

        const row = Math.floor((localY - listTop) / this.itemHeight);
        if (row < 0 || row >= this._visibleCount()) return NO_SELECTION;

        const index = this._scroll + row;
        return index < this._options.length ? index : NO_SELECTION;
    }

    /** Keeps the highlighted row in step with the pointer while open. */
    private _track(e: PointerEventData): void {
        if (!this._open) return;
        this._hoveredIndex = this._indexAt(
            e.localPosition.y,
            this.rectTransform._resolvedLocalRect,
        );
    }

    private _click(e: PointerEventData): void {
        if (!this.isInteractable()) return;

        const rect = this.rectTransform._resolvedLocalRect;

        if (!this._open) {
            this.open();
            e.consumed = true;
            return;
        }

        const index = this._indexAt(e.localPosition.y, rect);
        if (index >= 0) this.value = index;

        // Clicking the field again, or an empty row, just closes it.
        this.close();
        e.consumed = true;
    }

    private _setValue(index: number, notify: boolean): void {
        const next = index >= 0 && index < this._options.length
            ? Math.floor(index)
            : NO_SELECTION;

        if (this._value === next) return;
        this._value = next;
        if (notify) this.onValueChanged.invoke(next);
    }

    /** Scrolls the list so `index` is visible, when it is not already. */
    private _scrollTo(index: number): void {
        if (index < 0) return;

        const visible = this._visibleCount();
        const maxScroll = Math.max(0, this._options.length - visible);

        if (index < this._scroll) this._scroll = index;
        else if (index >= this._scroll + visible) this._scroll = index - visible + 1;

        this._scroll = Mathf.clamp(this._scroll, 0, maxScroll);
    }

    /** @internal Exposed for the state machine; a dropdown has no extra states. */
    public get isExpanded(): boolean {
        return this._open && this.state !== SelectableState.Disabled;
    }
}
