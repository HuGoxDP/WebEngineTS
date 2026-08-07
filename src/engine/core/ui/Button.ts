import { Selectable, SelectableState } from "./Selectable";
import { Color } from "../math/Color";
import { UIEvent } from "./UIEvent";
import { HASH_SEED, cssColor, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/**
 * Visual state of the button.
 *
 * @remarks
 * An alias of {@link SelectableState}, kept because it is the name existing
 * scenarios import. The values are identical.
 */
export const ButtonState = SelectableState;

/** Visual state of the button. See {@link ButtonState}. */
export type ButtonState = SelectableState;

/**
 * An interactive button that responds to pointer input.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Button`.
 * Uses {@link EventSystem} (called from Application._loop) for hit-testing, which
 * resolves the topmost button under the pointer — overlapping buttons no longer
 * all react to the same click.
 *
 * ```ts
 * const btn = go.addComponent(Button);
 * btn.text = "Start Game";
 * btn.onClick = () => loadScene();
 * ```
 */
export class Button extends Selectable {

    /** Background color when the button is idle. */
    public normalColor: Color     = new Color(0.25, 0.25, 0.25, 1);

    /** Background color when the pointer hovers over the button. */
    public highlightedColor: Color = new Color(0.40, 0.40, 0.40, 1);

    /** Background color while the button is held down. */
    public pressedColor: Color    = new Color(0.15, 0.15, 0.15, 1);

    /** Background color when `interactable` is false. */
    public disabledColor: Color   = new Color(0.20, 0.20, 0.20, 0.5);

    /** Corner radius in canvas units. */
    public borderRadius: number = 4;

    /** Label text drawn centred on the button. */
    public text: string = "";

    /** Font size for the button label. */
    public fontSize: number = 16;

    /** Label color. */
    public textColor: Color = Color.white.clone();

    /** Font family. */
    public fontFamily: string = "Arial, sans-serif";

    private readonly _onClick: UIEvent<void> = new UIEvent<void>();

    /**
     * Fired once per click — pointer pressed and released on this button while
     * it is interactable, without being dragged away in between.
     *
     * @remarks
     * Supports several subscribers:
     *
     * ```ts
     * button.onClick.addListener(() => advance());
     * button.onClick.addListener(() => playSound());
     * ```
     *
     * Assigning a function still works and replaces only the assigned handler,
     * leaving {@link UIEvent.addListener} subscribers in place. Assign `null`
     * to clear it.
     */
    public get onClick(): UIEvent<void> {
        return this._onClick;
    }

    public set onClick(value: UIEvent<void> | (() => void) | null) {
        // Assigning the event back to itself is what `btn.onClick.addListener()`
        // compiles to under some transpiler settings; treat it as a no-op.
        if (value === this._onClick) return;
        this._onClick._setAssigned(typeof value === "function" ? value : null);
    }

    constructor(gameObject: GameObject) {
        super(gameObject);

        // A click is press and release on this same element, already resolved
        // by the event surface — including being suppressed after a drag.
        this.onPointerClick.addListener(() => {
            if (this.isInteractable()) this._onClick.invoke(undefined);
        });

        // Keyboard activation is a click as far as a button is concerned.
        this.onSubmit.addListener(() => { this._onClick.invoke(undefined); });
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0) return;

        ctx.fillStyle = cssColor(this._stateColor());
        roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, this.borderRadius);
        ctx.fill();

        if (this.text) {
            // Clipped to the button: a caption wider than its box is cut at the
            // edges rather than running across whatever sits beside it. This is
            // also what keeps the control bounded — see {@link _drawOverflow}.
            ctx.save();
            roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, this.borderRadius);
            ctx.clip();

            ctx.fillStyle = cssColor(this.textColor);
            ctx.font = `${this.fontSize}px ${this.fontFamily}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                this.text,
                rect.x + rect.width  * 0.5,
                rect.y + rect.height * 0.5,
            );

            ctx.restore();
        }
    }

    public override _visualHash(): number {
        let h = hashColor(HASH_SEED, this._stateColor());
        h = hashNumber(h, this.borderRadius);
        h = hashString(h, this.text);
        h = hashNumber(h, this.fontSize);
        h = hashString(h, this.fontFamily);
        return hashColor(h, this.textColor);
    }

    // ── private ──────────────────────────────────────────────────────

    private _stateColor(): Color {
        switch (this.state) {
            case SelectableState.Disabled:    return this.disabledColor;
            case SelectableState.Highlighted: return this.highlightedColor;
            case SelectableState.Pressed:     return this.pressedColor;
            default:                          return this.normalColor;
        }
    }
}
