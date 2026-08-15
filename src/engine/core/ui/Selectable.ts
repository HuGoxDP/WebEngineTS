import { UIBehaviour } from "./UIBehaviour";
import { UIEvent } from "./UIEvent";
import { EventSystem } from "./EventSystem";
import { Color } from "../math/Color";
import { Mathf } from "../math/Mathf";
import { Time } from "../Time";
import { ColorBlock, SelectableTransition, SpriteState } from "./SelectableTransition";
import { Navigation, NavigationDirection, NavigationMode, directionVector } from "./Navigation";
import { Rect } from "../math/Rect";
import { Vector2 } from "../math/Vector2";
import type { UIImage } from "./UIImage";
import type { Sprite } from "../graphics/Sprite";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
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
     * Advances every control's transition and per-frame work. Called from
     * Application._loop after the input pass has settled the states it reads.
     */
    public static _updateAll(): void {
        const all = Selectable._instances;
        const dt = Time.deltaTime;
        for (let i = 0; i < all.length; i++) {
            const c = all[i];
            if (!c.isActiveAndEnabled) continue;
            c._applyTransition(dt);
            c._onControlUpdate(dt);
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
    @SerializedField({ type: FieldType.Enum })
    public transition: SelectableTransition = SelectableTransition.None;

    /** Colors used by {@link SelectableTransition.ColorTint}. */
    public readonly colors: ColorBlock = new ColorBlock();

    /** Sprites used by {@link SelectableTransition.SpriteSwap}. */
    public readonly spriteState: SpriteState = new SpriteState();

    /** Where keyboard focus goes from this control. */
    public readonly navigation: Navigation = new Navigation();

    /**
     * Fired when this control is activated from the keyboard.
     *
     * @remarks
     * Raised by the EventSystem on the focused control when the submit key is
     * pressed. {@link Button} turns it into a click; other controls decide for
     * themselves what activation means.
     */
    public readonly onSubmit: UIEvent<void> = new UIEvent<void>();

    /**
     * The graphic a transition drives.
     *
     * @remarks
     * Left null the transition does nothing, which is why the self-drawing
     * controls are unaffected by any of this.
     */
    @SerializedField({ type: FieldType.Component })
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
    @SerializedField()
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

    /**
     * The control focus should move to in `direction`, or null to stay put.
     *
     * @remarks
     * Equivalent to Unity's `Selectable.FindSelectable`. Automatic mode scores
     * candidates by how far along the direction they sit versus how far off to
     * the side, so a control directly below wins over one further away
     * diagonally — which is what makes arrow keys feel predictable in a grid.
     *
     * @param direction - the direction focus is moving in.
     * @returns the next control, or null.
     */
    public findSelectable(direction: NavigationDirection): Selectable | null {
        if (this.navigation.mode === NavigationMode.None) return null;
        if (this.navigation.mode === NavigationMode.Explicit) {
            // An explicit link is a reference a scenario set once, and the
            // control it names can since have been destroyed or switched off.
            // The automatic search below cannot hit that: it walks the
            // EventSystem's registry, which those events maintain. This path
            // has to ask. Unity requires the same pair — `IsActive()` and
            // `IsInteractable()` — for exactly this reason.
            const linked = this.navigation.get(direction);
            if (!linked || !linked.isActiveAndEnabled) return null;
            return linked.isInteractable() ? linked : null;
        }

        const dir = directionVector(direction, Selectable._dirScratch);
        const from = this.rectTransform.getScreenRect(Selectable._rectScratch);
        const fx = from.x + from.width * 0.5;
        const fy = from.y + from.height * 0.5;

        let best: Selectable | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const candidate of EventSystem._allSelectables()) {
            if (candidate === this || !candidate.isInteractable()) continue;
            if (candidate.navigation.mode === NavigationMode.None) continue;

            const to = candidate.rectTransform.getScreenRect(Selectable._otherScratch);
            const dx = (to.x + to.width * 0.5) - fx;
            const dy = (to.y + to.height * 0.5) - fy;

            const along = dx * dir.x + dy * dir.y;
            // Strictly ahead: a control level with this one is not "below" it.
            if (along <= 0) continue;

            const aside = Math.abs(dx * dir.y - dy * dir.x);

            // Sideways distance is weighted heavily so the search prefers a
            // control in line over a nearer one off to the side.
            const score = along + aside * 3;
            if (score < bestScore) {
                bestScore = score;
                best = candidate;
            }
        }

        return best;
    }

    /**
     * Moves focus one step in `direction`, if there is anywhere to go.
     *
     * @param direction - the direction focus is moving in.
     * @returns whether focus actually moved.
     */
    public navigate(direction: NavigationDirection): boolean {
        const next = this.findSelectable(direction);
        if (!next) return false;
        next.select();
        return true;
    }

    /**
     * @internal
     * Activates this control from the keyboard. Raises {@link onSubmit}.
     */
    public _submit(): void {
        if (this.isInteractable()) this.onSubmit.invoke(undefined);
    }

    /**
     * @internal
     * Whether this control needs the keys navigation would otherwise take.
     *
     * A text field types with the arrows, Enter and Space, so the EventSystem
     * stands aside while one holds focus — all but Tab and Escape, which are
     * how the user gets back out.
     */
    public get _consumesKeyboard(): boolean {
        return false;
    }

    /** @internal Called by the EventSystem when this control gains focus. */
    public _onFocusGained(): void {}

    /** @internal Called by the EventSystem when this control loses focus. */
    public _onFocusLost(): void {}

    /**
     * @internal
     * Per-frame work for controls that need it, driven by {@link _updateAll}
     * alongside the transitions. Empty by default.
     *
     * @param dt - seconds since the last frame.
     */
    public _onControlUpdate(dt: number): void {}

    private static readonly _dirScratch: Vector2 = new Vector2();
    private static readonly _rectScratch: Rect = new Rect();
    private static readonly _otherScratch: Rect = new Rect();

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
