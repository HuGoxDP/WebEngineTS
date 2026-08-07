import { Selectable } from "./Selectable";
import { Color } from "../math/Color";
import { UIEvent } from "./UIEvent";
import { HASH_SEED, cssColor, hashBool, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { ToggleGroup } from "./ToggleGroup";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/**
 * A checkbox that flips between on and off when clicked.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Toggle`. Draws its own box, checkmark
 * and label rather than relying on child graphics, the same way {@link Button}
 * does.
 *
 * Assign a {@link group} to get radio-button behaviour, which is what a
 * single-answer question needs.
 *
 * ```ts
 * const toggle = go.addComponent(Toggle);
 * toggle.label = "Show gridlines";
 * toggle.onValueChanged.addListener(on => grid.setActive(on));
 * ```
 */
export class Toggle extends Selectable {

    /** Box fill color when off. */
    public backgroundColor: Color = new Color(0.18, 0.18, 0.18, 1);

    /** Box fill color when on. */
    public checkedColor: Color = new Color(0.30, 0.60, 0.95, 1);

    /** Box outline color. */
    public borderColor: Color = new Color(0.55, 0.55, 0.55, 1);

    /** Checkmark color. */
    public checkColor: Color = Color.white.clone();

    /** Label color. */
    public labelColor: Color = Color.white.clone();

    /** Tint applied over the whole control when `interactable` is false. */
    public disabledColor: Color = new Color(0.35, 0.35, 0.35, 0.6);

    /** Side length of the box in canvas units. */
    public boxSize: number = 20;

    /** Corner radius of the box. `boxSize / 2` gives a round radio button. */
    public borderRadius: number = 4;

    /** Gap between the box and the label, in canvas units. */
    public labelSpacing: number = 8;

    /** Text drawn beside the box. Empty draws the box alone. */
    public label: string = "";

    /** Label font size in canvas units. */
    public fontSize: number = 16;

    /** Label font family. */
    public fontFamily: string = "Arial, sans-serif";

    /** Fired whenever {@link isOn} changes, by click or by assignment. */
    public readonly onValueChanged: UIEvent<boolean> = new UIEvent<boolean>();

    private _isOn: boolean = false;
    private _group: ToggleGroup | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onPointerClick.addListener(() => {
            if (this.isInteractable()) this.isOn = !this._isOn;
        });
    }

    /**
     * Whether the toggle is checked.
     *
     * @remarks
     * Assigning fires {@link onValueChanged} only when the state actually
     * changes. Inside a {@link group}, turning one on turns its siblings off.
     */
    public get isOn(): boolean { return this._isOn; }

    public set isOn(value: boolean) {
        this._setIsOn(value, true);
    }

    /**
     * Sets the state without firing {@link onValueChanged}.
     *
     * @remarks
     * Equivalent to Unity's `Toggle.SetIsOnWithoutNotify`. Use it when
     * restoring saved state, so loading a scenario does not look like the user
     * clicking every control in it.
     *
     * @param value - the state to store.
     */
    public setIsOnWithoutNotify(value: boolean): void {
        this._setIsOn(value, false);
    }

    /**
     * The group this toggle belongs to, or null.
     *
     * @remarks
     * Members of a group behave as radio buttons: at most one is on.
     */
    public get group(): ToggleGroup | null { return this._group; }

    public set group(value: ToggleGroup | null) {
        if (this._group === value) return;

        this._group?._unregister(this);
        this._group = value;
        value?._register(this);

        if (value && this._isOn) value._notifyTurnedOn(this);
    }

    protected override onEnable(): void {
        super.onEnable();
        this._group?._register(this);
    }

    protected override onDisable(): void {
        super.onDisable();
        this._group?._unregister(this);
    }

    protected override onDestroy(): void {
        super.onDestroy();
        this._group?._unregister(this);
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0) return;

        const size = Math.min(this.boxSize, rect.width, rect.height);
        const bx = rect.x;
        const by = rect.y + (rect.height - size) * 0.5;

        roundedRectPath(ctx, bx, by, size, size, Math.min(this.borderRadius, size * 0.5));
        ctx.fillStyle = cssColor(this._isOn ? this.checkedColor : this.backgroundColor);
        ctx.fill();

        ctx.strokeStyle = cssColor(this.borderColor);
        ctx.lineWidth = this.isHovered && this.isInteractable() ? 2 : 1;
        ctx.stroke();

        if (this._isOn) this._drawCheck(ctx, bx, by, size);

        if (this.label) {
            // Clipped to the control: a long label is cut at the right edge
            // instead of running across its neighbours, and the control stays
            // bounded — see {@link _drawOverflow}.
            ctx.save();
            ctx.beginPath();
            ctx.rect(rect.x, rect.y, rect.width, rect.height);
            ctx.clip();

            ctx.fillStyle = cssColor(this.labelColor);
            ctx.font = `${this.fontSize}px ${this.fontFamily}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(
                this.label,
                bx + size + this.labelSpacing,
                rect.y + rect.height * 0.5,
            );

            ctx.restore();
        }

        if (!this.isInteractable()) {
            ctx.fillStyle = cssColor(this.disabledColor);
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
    }

    public override _visualHash(): number {
        let h = hashBool(HASH_SEED, this._isOn);
        h = hashBool(h, this.isHovered);
        h = hashBool(h, this.isInteractable());
        h = hashColor(h, this.backgroundColor);
        h = hashColor(h, this.checkedColor);
        h = hashColor(h, this.borderColor);
        h = hashColor(h, this.checkColor);
        h = hashColor(h, this.labelColor);
        h = hashNumber(h, this.boxSize);
        h = hashNumber(h, this.borderRadius);
        h = hashNumber(h, this.labelSpacing);
        h = hashNumber(h, this.fontSize);
        h = hashString(h, this.fontFamily);
        return hashString(h, this.label);
    }

    /** @internal Group-driven state change; never re-enters the group. */
    public _setFromGroup(value: boolean): void {
        if (this._isOn === value) return;
        this._isOn = value;
        this.onValueChanged.invoke(value);
    }

    // ── private ──────────────────────────────────────────────────────

    private _setIsOn(value: boolean, notify: boolean): void {
        if (this._isOn === value) return;

        // A grouped toggle cannot switch itself off by being clicked — that is
        // what leaves a radio group with no answer selected. The group decides.
        if (!value && this._group && !this._group.allowSwitchOff
            && this._group._isOnlyActive(this)) {
            return;
        }

        this._isOn = value;
        if (value) this._group?._notifyTurnedOn(this);
        if (notify) this.onValueChanged.invoke(value);
    }

    private _drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
        ctx.strokeStyle = cssColor(this.checkColor);
        ctx.lineWidth = Math.max(1.5, size * 0.12);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(x + size * 0.24, y + size * 0.52);
        ctx.lineTo(x + size * 0.44, y + size * 0.72);
        ctx.lineTo(x + size * 0.78, y + size * 0.28);
        ctx.stroke();
    }
}
