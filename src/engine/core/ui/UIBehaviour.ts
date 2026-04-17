import { Behaviour } from "../Behaviour";
import { RectTransform } from "./RectTransform";
import type { Canvas } from "./Canvas";
import type { GameObject } from "../GameObject";

/**
 * Base class for all visual UI components (Image, Text, Button).
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Graphic` base class.
 * Automatically adds a {@link RectTransform} sibling when the component wakes up.
 * Registers with the nearest Canvas ancestor for rendering.
 *
 * Override {@link _draw} to render into the Canvas 2D context.
 */
export abstract class UIBehaviour extends Behaviour {

    private _rectTransform: RectTransform | null = null;

    /** The sorting order within the Canvas. Lower values render first (behind). */
    public sortingOrder: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The RectTransform on this GameObject (auto-added if missing). */
    public get rectTransform(): RectTransform {
        if (!this._rectTransform) {
            this._rectTransform = this.gameObject.getComponent(RectTransform)
                ?? this.gameObject.addComponent(RectTransform);
        }
        return this._rectTransform;
    }

    /** The nearest Canvas ancestor, or null. */
    public get canvas(): Canvas | null {
        return this.rectTransform.canvas;
    }

    protected override onAwake(): void {
        // Ensure RectTransform exists immediately.
        void this.rectTransform;
    }

    protected override onEnable(): void {
        this.canvas?._registerGraphic(this);
    }

    protected override onDisable(): void {
        this.canvas?._unregisterGraphic(this);
    }

    protected override onDestroy(): void {
        this.canvas?._unregisterGraphic(this);
    }

    /**
     * @internal
     * Called by the Canvas each frame to draw this element.
     * Receives the 2D context already transformed to the element's rect origin.
     */
    public abstract _draw(ctx: CanvasRenderingContext2D): void;
}
