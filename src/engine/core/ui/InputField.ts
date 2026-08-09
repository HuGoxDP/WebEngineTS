import { Selectable } from "./Selectable";
import { EventSystem } from "./EventSystem";
import { UIEvent } from "./UIEvent";
import { Color } from "../math/Color";
import { measureContext } from "./UIText";
import {
    HASH_SEED, cssColor, fontGeneration, hashBool, hashColor, hashNumber, hashString,
    roundedRectPath,
} from "./UIUtils";
import type { PointerEventData } from "./PointerEventData";
import type { Rect } from "../math/Rect";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/** What an {@link InputField} accepts, and how it presents what it holds. */
export enum InputFieldContentType {
    /** Anything. */
    Standard = "Standard",
    /** Digits and a leading sign. */
    IntegerNumber = "IntegerNumber",
    /** Digits, a leading sign and one decimal point. */
    DecimalNumber = "DecimalNumber",
    /** Anything, drawn as bullets and hidden from the browser's own UI. */
    Password = "Password",
    /** Anything; hints the mobile keyboard to offer an email layout. */
    EmailAddress = "EmailAddress",
}

/** The character drawn in place of each one in a password field. */
const PASSWORD_CHAR = "•";

/** Bullet-proofing for the DOM element's own font size — see `_syncElementBox`. */
const MOBILE_MIN_FONT_PX = 16;

/**
 * A single-line text entry control.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.InputField`. The field is *drawn* on the
 * canvas like every other control, but the typing itself goes through a real,
 * invisible DOM `<input>` held over it.
 *
 * That is deliberate and worth understanding before changing it. Reimplementing
 * text entry on top of raw key events means reimplementing IME composition for
 * Chinese/Japanese/Korean input, dead keys, the clipboard, autofill, text
 * selection gestures and the mobile virtual keyboard — each of which the
 * browser already does correctly. The hidden element gets all of that for free;
 * this component only mirrors its value and selection onto the canvas.
 *
 * ```ts
 * const field = go.addComponent(InputField);
 * field.placeholder = "Sample mass (kg)";
 * field.contentType = InputFieldContentType.DecimalNumber;
 * field.onEndEdit.addListener(v => runExperiment(Number(v)));
 * ```
 *
 * **Coordinate system:** like every UI component, this draws in a Y-down local
 * rect — the caret's `y` grows downward from the top edge of the field.
 *
 * **Focus:** clicking the field selects it, which is what opens the keyboard on
 * a phone (the browser only honours that inside a real user gesture). While it
 * holds focus the EventSystem stops using the arrows, Enter and Space for
 * navigation; Tab and Escape still move focus out.
 */
@Serializable({ typeName: "InputField", category: "UI" })
export class InputField extends Selectable {

    /** Raised whenever the text changes, with the new value. */
    public readonly onValueChanged: UIEvent<string> = new UIEvent<string>();

    /**
     * Raised when editing finishes — focus lost, or Enter on a single-line
     * field — with the final value.
     */
    public readonly onEndEdit: UIEvent<string> = new UIEvent<string>();

    /** Text shown, greyed, while the field is empty. */
    @SerializedField()
    public placeholder: string = "";

    /** Maximum number of characters, or `0` for no limit. */
    @SerializedField()
    public characterLimit: number = 0;

    /** Whether the field shows its value but refuses edits. */
    @SerializedField()
    public readOnly: boolean = false;

    /** Font size in canvas units. */
    @SerializedField()
    public fontSize: number = 16;

    /** CSS font family. */
    @SerializedField()
    public fontFamily: string = "sans-serif";

    /** Space between the field's edges and its text, in canvas units. */
    @SerializedField()
    public padding: number = 8;

    /** Corner radius of the background, in canvas units. */
    @SerializedField()
    public borderRadius: number = 4;

    /** Background fill. */
    @SerializedField({ type: FieldType.Color })
    public backgroundColor: Color = new Color(1, 1, 1, 0.08);

    /** Border stroke. */
    @SerializedField({ type: FieldType.Color })
    public borderColor: Color = new Color(1, 1, 1, 0.35);

    /** Border stroke while the field holds focus. */
    @SerializedField({ type: FieldType.Color })
    public focusedBorderColor: Color = new Color(0.35, 0.65, 1, 1);

    /** Colour of the value. */
    @SerializedField({ type: FieldType.Color })
    public textColor: Color = new Color(1, 1, 1, 1);

    /** Colour of {@link placeholder}. */
    @SerializedField({ type: FieldType.Color })
    public placeholderColor: Color = new Color(1, 1, 1, 0.4);

    /** Colour of the caret. */
    @SerializedField({ type: FieldType.Color })
    public caretColor: Color = new Color(1, 1, 1, 1);

    /** Fill drawn behind selected characters. */
    @SerializedField({ type: FieldType.Color })
    public selectionColor: Color = new Color(0.35, 0.65, 1, 0.5);

    /**
     * Full caret blink cycles per second. `0` keeps the caret solid.
     *
     * @remarks Equivalent to Unity's `InputField.caretBlinkRate`.
     */
    @SerializedField()
    public caretBlinkRate: number = 1.7;

    /** Caret width in canvas units. */
    @SerializedField()
    public caretWidth: number = 1;

    private _text: string = "";
    private _contentType: InputFieldContentType = InputFieldContentType.Standard;

    private _caret: number = 0;
    private _anchor: number = 0;
    private _scrollX: number = 0;

    private _editing: boolean = false;
    private _blinkTime: number = 0;

    private _element: HTMLInputElement | null = null;
    private readonly _onDomInput = (): void => { this._pullFromElement(); };
    private readonly _onDomKeyDown = (e: KeyboardEvent): void => { this._handleDomKey(e); };

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onPointerDown.addListener((data) => { this._placeCaretFrom(data); });
        this.onDrag.addListener((data) => { this._extendSelectionTo(data); });
    }

    // ── properties ───────────────────────────────────────────────────

    /**
     * The field's value.
     *
     * @remarks
     * Assigning filters the value the same way typing does — a
     * {@link contentType} of `IntegerNumber` will not hold "12a" however it is
     * set — and raises {@link onValueChanged} when the result differs.
     */
    @SerializedField()
    public get text(): string { return this._text; }

    public set text(value: string) {
        this._applyText(this._filter(value ?? ""), true);
        this._caret = this._text.length;
        this._anchor = this._caret;
        if (this._element) this._element.value = this._text;
    }

    /** What the field accepts. Changing it re-filters the current value. */
    @SerializedField({ type: FieldType.Enum })
    public get contentType(): InputFieldContentType { return this._contentType; }

    public set contentType(value: InputFieldContentType) {
        if (this._contentType === value) return;
        this._contentType = value;
        this._applyElementType();
        this._applyText(this._filter(this._text), true);
    }

    /** Caret position as an index into {@link text}. */
    public get caretPosition(): number { return this._caret; }

    public set caretPosition(value: number) {
        this._caret = this._clampIndex(value);
        this._anchor = this._caret;
        this._pushSelectionToElement();
    }

    /** The other end of the selection; equal to {@link caretPosition} when none. */
    public get selectionAnchorPosition(): number { return this._anchor; }

    /** The currently selected substring, empty when nothing is selected. */
    public get selectedText(): string {
        const from = Math.min(this._caret, this._anchor);
        const to = Math.max(this._caret, this._anchor);
        return this._text.substring(from, to);
    }

    /** Whether the field is currently accepting input. */
    public get isEditing(): boolean { return this._editing; }

    // ── public API ───────────────────────────────────────────────────

    /**
     * Gives the field focus and opens the on-screen keyboard where there is one.
     *
     * @remarks
     * Equivalent to Unity's `InputField.ActivateInputField`. Mobile browsers
     * only open the keyboard from inside a real user gesture, so calling this
     * from a pointer handler works and calling it from a timer may not.
     */
    public activate(): void {
        if (!this.isInteractable()) return;
        this.select();
    }

    /**
     * Ends editing and raises {@link onEndEdit}.
     *
     * @remarks Equivalent to Unity's `InputField.DeactivateInputField`.
     */
    public deactivate(): void {
        // Routed through the EventSystem so focus stays single-sourced: it calls
        // back into _onFocusLost, which is what actually ends the edit.
        if (this.isSelected) EventSystem._setSelected(null);
        else this._endEdit();
    }

    /** Selects the whole value. */
    public selectAll(): void {
        this._anchor = 0;
        this._caret = this._text.length;
        this._pushSelectionToElement();
    }

    // ── Selectable overrides ─────────────────────────────────────────

    public override get _consumesKeyboard(): boolean {
        return this._editing;
    }

    public override _onFocusGained(): void {
        if (!this.isInteractable()) return;
        this._editing = true;
        this._blinkTime = 0;
        this._attachElement();
    }

    public override _onFocusLost(): void {
        this._endEdit();
    }

    public override _onControlUpdate(dt: number): void {
        if (!this._editing) return;

        // The DOM element is the source of truth while editing: it is what the
        // browser's own editing, IME and clipboard write into.
        this._pullFromElement();
        this._syncElementBox();

        this._blinkTime += dt;
    }

    protected override onDisable(): void {
        super.onDisable();
        this._endEdit();
    }

    protected override onDestroy(): void {
        super.onDestroy();
        this._detachElement();
    }

    // ── drawing ──────────────────────────────────────────────────────

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0) return;

        roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, this.borderRadius);
        ctx.fillStyle = cssColor(this.backgroundColor);
        ctx.fill();
        ctx.strokeStyle = cssColor(this._editing ? this.focusedBorderColor : this.borderColor);
        ctx.lineWidth = this._editing ? 2 : 1;
        ctx.stroke();

        // Everything below is clipped to the field, which is what lets a long
        // value scroll instead of spilling across the panel — and what keeps
        // this component bounded for partial repaints.
        ctx.save();
        roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, this.borderRadius);
        ctx.clip();

        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const display = this._displayText();
        const innerX = rect.x + this.padding;
        const midY = rect.y + rect.height * 0.5;

        if (display.length === 0 && !this._editing && this.placeholder) {
            ctx.fillStyle = cssColor(this.placeholderColor);
            ctx.fillText(this.placeholder, innerX, midY);
            ctx.restore();
            return;
        }

        this._updateScroll(ctx, display, rect);
        const textX = innerX - this._scrollX;

        if (this._editing && this._caret !== this._anchor) {
            const from = Math.min(this._caret, this._anchor);
            const to = Math.max(this._caret, this._anchor);
            const x0 = textX + ctx.measureText(display.substring(0, from)).width;
            const x1 = textX + ctx.measureText(display.substring(0, to)).width;
            ctx.fillStyle = cssColor(this.selectionColor);
            ctx.fillRect(x0, rect.y + this.padding * 0.5, x1 - x0, rect.height - this.padding);
        }

        ctx.fillStyle = cssColor(this.textColor);
        ctx.fillText(display, textX, midY);

        if (this._editing && this._caretVisible()) {
            const caretX = textX + ctx.measureText(display.substring(0, this._caret)).width;
            ctx.fillStyle = cssColor(this.caretColor);
            ctx.fillRect(
                caretX,
                rect.y + this.padding * 0.5,
                this.caretWidth,
                rect.height - this.padding,
            );
        }

        ctx.restore();
    }

    public override _visualHash(): number {
        let h = hashString(HASH_SEED, this._text);
        h = hashString(h, this.placeholder);
        h = hashString(h, this._contentType);
        h = hashNumber(h, this.fontSize);
        h = hashString(h, this.fontFamily);
        h = hashNumber(h, this.padding);
        h = hashNumber(h, this.borderRadius);
        h = hashColor(h, this.backgroundColor);
        h = hashColor(h, this._editing ? this.focusedBorderColor : this.borderColor);
        h = hashColor(h, this.textColor);
        h = hashColor(h, this.placeholderColor);
        h = hashColor(h, this.selectionColor);
        h = hashColor(h, this.caretColor);
        h = hashBool(h, this._editing);
        h = hashBool(h, this._caretVisible());
        h = hashNumber(h, this._caret);
        h = hashNumber(h, this._anchor);
        h = hashNumber(h, this._scrollX);
        return hashNumber(h, fontGeneration());
    }

    // ── private ──────────────────────────────────────────────────────

    private _endEdit(): void {
        if (!this._editing) return;
        this._editing = false;
        this._detachElement();
        this.onEndEdit.invoke(this._text);
    }

    /** True while the caret should be painted this frame. */
    private _caretVisible(): boolean {
        if (!this._editing) return false;
        if (this.caretBlinkRate <= 0) return true;
        return (this._blinkTime * this.caretBlinkRate) % 1 < 0.5;
    }

    /** What is actually painted — bullets for a password field. */
    private _displayText(): string {
        return this._contentType === InputFieldContentType.Password
            ? PASSWORD_CHAR.repeat(this._text.length)
            : this._text;
    }

    /**
     * Scrolls the text so the caret stays inside the field.
     *
     * @remarks
     * The field is the viewport and the text is the content, so this is the
     * same job a ScrollRect does — kept local because it is one axis, always
     * caret-driven, and never user-scrollable.
     */
    private _updateScroll(ctx: CanvasRenderingContext2D, display: string, rect: Rect): void {
        const inner = rect.width - this.padding * 2;
        if (inner <= 0) { this._scrollX = 0; return; }

        const total = ctx.measureText(display).width;
        if (total <= inner) { this._scrollX = 0; return; }

        const caretX = ctx.measureText(display.substring(0, this._caret)).width;
        if (caretX - this._scrollX > inner) this._scrollX = caretX - inner;
        else if (caretX < this._scrollX) this._scrollX = caretX;

        // Never leave blank space on the right when there is text to fill it.
        const max = total - inner;
        if (this._scrollX > max) this._scrollX = max;
        if (this._scrollX < 0) this._scrollX = 0;
    }

    /** Writes `value`, honouring the character limit, and raises the event. */
    private _applyText(value: string, notify: boolean): void {
        const limited = this.characterLimit > 0
            ? value.substring(0, this.characterLimit)
            : value;
        if (limited === this._text) return;

        this._text = limited;
        this._caret = this._clampIndex(this._caret);
        this._anchor = this._clampIndex(this._anchor);
        if (notify) this.onValueChanged.invoke(limited);
    }

    private _clampIndex(index: number): number {
        if (!Number.isFinite(index) || index < 0) return 0;
        return Math.min(Math.floor(index), this._text.length);
    }

    /** Strips whatever {@link contentType} does not allow. */
    private _filter(value: string): string {
        switch (this._contentType) {
            case InputFieldContentType.IntegerNumber:
                return InputField._filterNumber(value, false);
            case InputFieldContentType.DecimalNumber:
                return InputField._filterNumber(value, true);
            default:
                return value;
        }
    }

    private static _filterNumber(value: string, allowPoint: boolean): string {
        let out = "";
        let seenPoint = false;

        for (let i = 0; i < value.length; i++) {
            const c = value[i];
            if (c >= "0" && c <= "9") { out += c; continue; }
            // A sign is only a sign in front.
            if ((c === "-" || c === "+") && out.length === 0) { out += c; continue; }
            if (allowPoint && (c === "." || c === ",") && !seenPoint) {
                seenPoint = true;
                out += ".";
            }
        }
        return out;
    }

    // ── the hidden DOM element ───────────────────────────────────────

    /**
     * Creates (or revives) the invisible `<input>` and focuses it.
     *
     * @remarks
     * `opacity: 0` rather than `display: none` or an off-screen position: a
     * hidden or displaced element cannot be focused reliably, and mobile
     * browsers scroll the *focused* element into view, which is exactly what
     * should happen to the field the user tapped.
     */
    private _attachElement(): void {
        if (typeof document === "undefined") return;

        if (!this._element) {
            const el = document.createElement("input");
            const s = el.style;
            s.position = "fixed";
            s.opacity = "0";
            s.padding = "0";
            s.margin = "0";
            s.border = "none";
            s.outline = "none";
            s.background = "transparent";
            // Clicks are routed by the canvas hit-test, not by this element.
            s.pointerEvents = "none";
            s.zIndex = "0";

            el.autocomplete = "off";
            el.spellcheck = false;
            el.addEventListener("input", this._onDomInput);
            el.addEventListener("keydown", this._onDomKeyDown);

            this._element = el;
            document.body.appendChild(el);
        }

        const el = this._element;
        el.readOnly = this.readOnly;
        el.value = this._text;
        this._applyElementType();
        this._syncElementBox();
        this._pushSelectionToElement();
        el.focus({ preventScroll: false });
    }

    private _detachElement(): void {
        const el = this._element;
        if (!el) return;

        el.removeEventListener("input", this._onDomInput);
        el.removeEventListener("keydown", this._onDomKeyDown);
        el.blur();
        el.parentElement?.removeChild(el);
        this._element = null;
    }

    private _applyElementType(): void {
        const el = this._element;
        if (!el) return;

        switch (this._contentType) {
            case InputFieldContentType.Password:
                el.type = "password";
                break;
            case InputFieldContentType.EmailAddress:
                el.type = "email";
                break;
            case InputFieldContentType.IntegerNumber:
            case InputFieldContentType.DecimalNumber:
                // `type=number` would let the browser hold "12e5" and report an
                // empty value for it, so the text type plus a numeric keyboard
                // hint is the honest combination.
                el.type = "text";
                el.inputMode = this._contentType === InputFieldContentType.IntegerNumber
                    ? "numeric"
                    : "decimal";
                break;
            default:
                el.type = "text";
                el.inputMode = "text";
                break;
        }
    }

    /** Positions the invisible element over the field, in CSS pixels. */
    private _syncElementBox(): void {
        const el = this._element;
        const canvas = this.canvas;
        if (!el || !canvas) return;

        const rect = this.rectTransform._resolvedBounds;
        const scale = canvas.scaleFactor > 0 ? canvas.scaleFactor : 1;
        const s = el.style;

        s.left = `${canvas._surfaceLeft + rect.x * scale}px`;
        s.top = `${canvas._surfaceTop + rect.y * scale}px`;
        s.width = `${Math.max(1, rect.width * scale)}px`;
        s.height = `${Math.max(1, rect.height * scale)}px`;
        // iOS zooms the page in when a focused input's font is under 16px.
        s.fontSize = `${Math.max(MOBILE_MIN_FONT_PX, this.fontSize * scale)}px`;
    }

    /** Reads value and selection back out of the DOM element. */
    private _pullFromElement(): void {
        const el = this._element;
        if (!el) return;

        const filtered = this._filter(el.value);
        const limited = this.characterLimit > 0
            ? filtered.substring(0, this.characterLimit)
            : filtered;

        if (limited !== el.value) {
            // Rejected characters are removed from the element too, or it and
            // the drawn field would disagree about what the value is.
            const caret = el.selectionEnd ?? limited.length;
            el.value = limited;
            const moved = Math.max(0, caret - (filtered.length - limited.length));
            el.setSelectionRange(moved, moved);
        }

        const changed = limited !== this._text;
        this._applyText(limited, true);
        this._anchor = this._clampIndex(el.selectionStart ?? this._anchor);
        this._caret = this._clampIndex(el.selectionEnd ?? this._caret);

        // Any edit restarts the blink, so the caret is never invisible at the
        // moment the user is looking for it.
        if (changed) this._blinkTime = 0;
    }

    private _pushSelectionToElement(): void {
        const el = this._element;
        if (!el) return;
        el.setSelectionRange(Math.min(this._anchor, this._caret), Math.max(this._anchor, this._caret));
    }

    private _handleDomKey(e: KeyboardEvent): void {
        if (e.key !== "Enter") return;

        // Single-line fields commit on Enter, which is also what raises the
        // inherited onSubmit — so a scenario can bind either.
        e.preventDefault();
        this._pullFromElement();
        this.onSubmit.invoke(undefined);
        this._endEdit();
    }

    // ── caret placement from the pointer ─────────────────────────────

    private _placeCaretFrom(data: PointerEventData): void {
        if (!this.isInteractable()) return;
        const index = this._indexAt(data.position.x);
        this._caret = index;
        this._anchor = index;
        this._blinkTime = 0;
        this._pushSelectionToElement();
    }

    private _extendSelectionTo(data: PointerEventData): void {
        if (!this.isInteractable() || !this._editing) return;
        this._caret = this._indexAt(data.position.x);
        this._pushSelectionToElement();
    }

    /**
     * The character index nearest a canvas-space X coordinate.
     *
     * @remarks
     * Walks the string measuring prefixes and picks the nearest boundary, so
     * clicking the left half of a glyph puts the caret before it — the
     * behaviour every text field has.
     */
    private _indexAt(canvasX: number): number {
        const ctx = measureContext();
        const display = this._displayText();
        if (!ctx || display.length === 0) return 0;

        ctx.font = `${this.fontSize}px ${this.fontFamily}`;

        const bounds = this.rectTransform._resolvedBounds;
        const local = canvasX - bounds.x - this.padding + this._scrollX;
        if (local <= 0) return 0;

        let previous = 0;
        for (let i = 1; i <= display.length; i++) {
            const width = ctx.measureText(display.substring(0, i)).width;
            if (local < (previous + width) * 0.5) return i - 1;
            previous = width;
        }
        return display.length;
    }
}
