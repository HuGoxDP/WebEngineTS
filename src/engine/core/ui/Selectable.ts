import { UIBehaviour } from "./UIBehaviour";
import { EventSystem } from "./EventSystem";
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
        this.onPointerDown.addListener(() => { this._pressCount++; });
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

    protected override onEnable(): void {
        super.onEnable();
        EventSystem._registerSelectable(this);
    }

    protected override onDisable(): void {
        super.onDisable();
        // A control disabled mid-press would otherwise come back stuck.
        this._hoverCount = 0;
        this._pressCount = 0;
        EventSystem._unregisterSelectable(this);
    }

    protected override onDestroy(): void {
        super.onDestroy();
        EventSystem._unregisterSelectable(this);
    }
}
