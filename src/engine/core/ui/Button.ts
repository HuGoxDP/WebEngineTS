import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { EventSystem } from "./EventSystem";
import { HASH_SEED, cssColor, hashColor, hashNumber, hashString, roundedRectPath } from "./UIUtils";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/** Visual state of the button. */
export enum ButtonState {
    Normal      = "Normal",
    Highlighted = "Highlighted",
    Pressed     = "Pressed",
    Disabled    = "Disabled",
}

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
export class Button extends UIBehaviour {

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

    /** Whether the button responds to pointer input. */
    public interactable: boolean = true;

    /** Fired once per click (pointer released inside the rect while interactable). */
    public onClick: (() => void) | null = null;

    /** @internal Current visual state. Updated by EventSystem each frame. */
    public _state: ButtonState = ButtonState.Normal;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The current display state of the button. */
    public get state(): ButtonState { return this._state; }

    protected override onEnable(): void {
        super.onEnable();
        EventSystem._registerButton(this);
    }

    protected override onDisable(): void {
        super.onDisable();
        EventSystem._unregisterButton(this);
    }

    protected override onDestroy(): void {
        super.onDestroy();
        EventSystem._unregisterButton(this);
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0) return;

        ctx.fillStyle = cssColor(this._stateColor());
        roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, this.borderRadius);
        ctx.fill();

        if (this.text) {
            ctx.fillStyle = cssColor(this.textColor);
            ctx.font = `${this.fontSize}px ${this.fontFamily}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                this.text,
                rect.x + rect.width  * 0.5,
                rect.y + rect.height * 0.5,
            );
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
        if (!this.interactable) return this.disabledColor;
        switch (this._state) {
            case ButtonState.Highlighted: return this.highlightedColor;
            case ButtonState.Pressed:     return this.pressedColor;
            default:                      return this.normalColor;
        }
    }
}
