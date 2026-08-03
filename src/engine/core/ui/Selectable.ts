import { UIBehaviour } from "./UIBehaviour";
import { EventSystem } from "./EventSystem";
import { Color } from "../math/Color";
import { Mathf } from "../math/Mathf";
import { Time } from "../Time";
import { ColorBlock, SelectableTransition, SpriteState } from "./SelectableTransition";
import type { UIImage } from "./UIImage";
import type { Sprite } from "../graphics/Sprite";
import type { GameObject } from "../GameObject";

/** Interaction state of a {@link Selectable}. */
export enum SelectableState {
    Normal      = "Normal",
    Highlighted = "Highlighted",
    Pressed     = "Pressed",
    Disabled    = "Disabled",
}

/**
 * Base class for controls the pointer can interact with.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Selectable`. Holds the one piece of
 * state every control shares — am I enabled, hovered, held? — so
 * {@link Button}, {@link Slider} and {@link Toggle} do not each reimplement it.
 *
 * State is derived from this element's own pointer events, so a subclass gets
 * hover and press tracking for free and only has to decide what to draw for
 * each {@link state}.
 *
 * {@link interactable} is combined with any {@link CanvasGroup} above the
 * element: a control inside a disabled group reads as disabled without its own
 * flag being touched, which is how a whole panel greys out at once.
 */
export abstract class Selectable extends UIBehaviour {

    private static _instances: Selectable[] = [];

    /**
     * @internal
     * Advances every control's transition. Called from Application._loop after
     * the input pass has settled the states it reads.
     */
    public static _updateAll(): void {
        const all = Selectable._instances;
        for (let i = 0; i < all.length; i++) {
            const c = all[i];
            if (c.isActiveAndEnabled) c._applyTransition(Time.deltaTime);
        }
    }

    /** @internal */
    public static _reset(): void {
        Selectable._instances.length = 0;
    }

    /**
     * How this control shows its state automatically.
     *
     * @remarks
     * Defaults to {@link SelectableTransition.None}, because the built-in
     * controls draw their own states. Set it, together with
     * {@link targetGraphic}, when composing a control out of child graphics.
     */
    public transition: SelectableTransition = SelectableTransition.None;

    /** Colors used by {@link SelectableTransition.ColorTint}. */
    public readonly colors: ColorBlock = new ColorBlock();

    /** Sprites used by {@link SelectableTransition.SpriteSwap}. */
    public readonly spriteState: SpriteState = new SpriteState();

    /**
     * The graphic a transition drives.
     *
     * @remarks
     * Left null the transition does nothing, which is why the self-drawing
     * controls are unaffected by any of this.
     */
    public targetGraphic: UIImage | null = null;

    /** The tint currently applied, mid-fade included. */
    private readonly _currentColor: Color = Color.white.clone();

    /** The sprite the target carried before any swap, restored for Normal. */
    private _normalSprite: Sprite | null = null;
    private _hasNormalSprite: boolean = false;

    /**
     * Whether this control responds to pointer input.
     *
     * @remarks
     * Read {@link isInteractable} rather than this field when deciding whether
     * to act — a `CanvasGroup` above the element can veto it.
     */
    public interactable: boolean = true;

    /**
     * Pointers currently over this control, and pointers currently holding it.
     * Counted rather than flagged because several fingers can do either at once,
     * and a boolean would be cleared by the first one to leave.
     */
    private _hoverCount: number = 0;
    private _pressCount: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onPointerEnter.addListener(() => { this._hoverCount++; });
        this.onPointerExit.addListener(() => {
            this._hoverCount = Math.max(0, this._hoverCount - 1);
        });
        // Pressing a control focuses it, which is what a keyboard user expects
        // to continue from and what Selected styling follows.
        this.onPointerDown.addListener(() => {
            this._pressCount++;
            this.select();
        });
        this.onPointerUp.addListener(() => {
            this._pressCount = Math.max(0, this._pressCount - 1);
        });
    }

    /**
     * Whether this control is interactive right now, accounting for any
     * {@link CanvasGroup} above it.
     */
    public isInteractable(): boolean {
        return this.interactable && this._groupInteractable();
    }

    /** The control's current interaction state. */
    public get state(): SelectableState {
        if (!this.isInteractable()) return SelectableState.Disabled;
        if (this._pressCount > 0) return SelectableState.Pressed;
        if (this._hoverCount > 0) return SelectableState.Highlighted;
        return SelectableState.Normal;
    }

    /** Whether a pointer is currently over this control. */
    public get isHovered(): boolean { return this._hoverCount > 0; }

    /** Whether a pointer is currently holding this control down. */
    public get isPressed(): boolean { return this._pressCount > 0; }

    /**
     * Gives this control focus, which is what {@link SelectableState.Selected}
     * styling and (later) keyboard navigation follow.
     *
     * @remarks Equivalent to Unity's `Selectable.Select`.
     */
    public select(): void {
        if (this.isInteractable()) EventSystem._setSelected(this);
    }

    /** Whether this control currently holds focus. */
    public get isSelected(): boolean {
        return EventSystem.currentSelected === this;
    }

    protected override onEnable(): void {
        super.onEnable();
        EventSystem._registerSelectable(this);
        if (!Selectable._instances.includes(this)) Selectable._instances.push(this);

        this._currentColor.copy(this._targetColor());
    }

    protected override onDisable(): void {
        super.onDisable();
        // A control disabled mid-press would otherwise come back stuck.
        this._hoverCount = 0;
        this._pressCount = 0;
        EventSystem._unregisterSelectable(this);

        const idx = Selectable._instances.indexOf(this);
        if (idx >= 0) Selectable._instances.splice(idx, 1);
    }

    protected override onDestroy(): void {
        super.onDestroy();
        EventSystem._unregisterSelectable(this);

        const idx = Selectable._instances.indexOf(this);
        if (idx >= 0) Selectable._instances.splice(idx, 1);
    }

    // -- transitions --------------------------------------------------

    /**
     * @internal
     * Moves the target graphic toward what the current state calls for.
     *
     * @param dt - seconds since the previous frame.
     */
    public _applyTransition(dt: number): void {
        const target = this.targetGraphic;
        if (!target || this.transition === SelectableTransition.None) return;

        if (this.transition === SelectableTransition.ColorTint) {
            const wanted = this._targetColor();
            const fade = this.colors.fadeDuration;

            // Exponential approach: framerate-independent, and it cannot
            // overshoot the way a fixed step toward the target can.
            const t = fade <= 0 || dt <= 0 ? 1 : 1 - Math.exp(-dt / fade);
            this._currentColor.set(
                Mathf.lerp(this._currentColor.r, wanted.r, t),
                Mathf.lerp(this._currentColor.g, wanted.g, t),
                Mathf.lerp(this._currentColor.b, wanted.b, t),
                Mathf.lerp(this._currentColor.a, wanted.a, t),
            );

            const m = this.colors.colorMultiplier;
            target.color.set(
                this._currentColor.r * m,
                this._currentColor.g * m,
                this._currentColor.b * m,
                this._currentColor.a,
            );
            return;
        }

        // SpriteSwap. The Normal sprite is whatever the target started with, so
        // it is captured once rather than configured twice.
        if (!this._hasNormalSprite) {
            this._normalSprite = target.sprite;
            this._hasNormalSprite = true;
        }
        target.sprite = this._stateSprite() ?? this._normalSprite;
    }

    /** The tint the current state calls for, before the multiplier. */
    private _targetColor(): Color {
        const c = this.colors;
        switch (this.state) {
            case SelectableState.Disabled:    return c.disabledColor;
            case SelectableState.Pressed:     return c.pressedColor;
            case SelectableState.Highlighted: return c.highlightedColor;
            default: return this.isSelected ? c.selectedColor : c.normalColor;
        }
    }

    /** The sprite the current state calls for, or null to keep the normal one. */
    private _stateSprite(): Sprite | null {
        const s = this.spriteState;
        switch (this.state) {
            case SelectableState.Disabled:    return s.disabledSprite;
            case SelectableState.Pressed:     return s.pressedSprite;
            case SelectableState.Highlighted: return s.highlightedSprite;
            default: return this.isSelected ? s.selectedSprite : null;
        }
    }
}
