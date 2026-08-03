import { Behaviour } from "../Behaviour";
import { RectTransform } from "./RectTransform";
import type { Canvas } from "./Canvas";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";
import type { Transform } from "../Transform";

/**
 * Base class for all visual UI components (Image, Text, Button).
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Graphic` base class.
 * Automatically adds a {@link RectTransform} sibling when the component wakes up.
 * Registers with the nearest Canvas ancestor for rendering.
 *
 * Override {@link _draw} to render into the Canvas 2D context.
 *
 * **Repainting:** a Canvas in {@link CanvasRepaintMode.OnDemand} only redraws
 * when something changed. Custom subclasses are conservatively treated as
 * "always changed" unless they override {@link _visualHash} to fold every value
 * their {@link _draw} reads into a hash, or call {@link setDirty} whenever they
 * change. Built-in components implement {@link _visualHash}.
 */
export abstract class UIBehaviour extends Behaviour {

    private _rectTransform: RectTransform | null = null;
    private _sortingOrder: number = 0;

    /** The canvas this graphic is currently registered with. */
    private _registeredCanvas: Canvas | null = null;

    /**
     * Whether the pointer hit-test treats this element as solid.
     *
     * @remarks
     * Equivalent to Unity's `Graphic.raycastTarget`. Used by
     * `EventSystem.isPointerOverUI` so scenarios can stop a click that landed on
     * the HUD from also reaching the 3D scene.
     */
    public raycastTarget: boolean = true;

    /** @internal Parent transform observed at the last canvas re-validation. */
    public _lastParent: Transform | null = null;

    /**
     * @internal
     * Depth-first position of this graphic's GameObject within the owning
     * canvas's hierarchy. Assigned by the Canvas whenever its graphic set or
     * hierarchy changes, and used as the tiebreaker when {@link sortingOrder}
     * is equal — so draw order follows the hierarchy, as it does in Unity,
     * rather than the order components happened to be enabled in.
     */
    public _hierarchyIndex: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * The sorting order within the Canvas. Lower values render first (behind).
     *
     * @remarks Changing this re-sorts the owning Canvas on its next frame.
     */
    public get sortingOrder(): number { return this._sortingOrder; }

    public set sortingOrder(value: number) {
        if (this._sortingOrder === value) return;
        this._sortingOrder = value;
        this._registeredCanvas?._setSortingDirty();
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

    /**
     * Requests a repaint of the owning Canvas.
     *
     * @remarks
     * Only relevant in {@link CanvasRepaintMode.OnDemand}; harmless otherwise.
     * Built-in components detect their own changes via {@link _visualHash}, so
     * this is for custom subclasses that draw from external state.
     */
    public setDirty(): void {
        this._registeredCanvas?._setDirty();
    }

    protected override onAwake(): void {
        // Ensure RectTransform exists immediately.
        void this.rectTransform;
    }

    protected override onEnable(): void {
        this._register(this.canvas);
    }

    protected override onDisable(): void {
        this._register(null);
    }

    protected override onDestroy(): void {
        this._register(null);
    }

    /**
     * @internal
     * Called by the Canvas each frame to draw this element.
     *
     * Coordinates are canvas units; the context is already scaled to device
     * pixels and wrapped in `save()`/`restore()`.
     *
     * @param rect - the element's resolved layout rect. Shared scratch owned by
     *               the Canvas: read it, never store it.
     */
    public abstract _draw(ctx: CanvasRenderingContext2D, rect: Rect): void;

    /**
     * @internal
     * A hash of everything {@link _draw} reads, used to skip redundant repaints.
     *
     * Returns `NaN` by default, meaning "unknown state" — a Canvas in
     * {@link CanvasRepaintMode.OnDemand} then repaints every frame, which is
     * correct but not cheap. Built-in components override this.
     */
    public _visualHash(): number {
        return Number.NaN;
    }

    /**
     * @internal
     * Whether the Canvas may skip {@link _draw} when the element's rect lies
     * fully outside the canvas. Components that do work other than drawing in
     * {@link _draw} (such as polling input) must return `false`.
     */
    public get _allowCulling(): boolean {
        return true;
    }

    /**
     * @internal
     * Tests a canvas-space point against this element's interactive shape.
     * Defaults to the layout rect; override for non-rectangular controls.
     */
    public _hitTest(x: number, y: number, rect: Rect): boolean {
        return x >= rect.x && x <= rect.x + rect.width
            && y >= rect.y && y <= rect.y + rect.height;
    }

    /**
     * @internal
     * Re-registers this graphic with the canvas it currently belongs to.
     * Called by the Canvas when the element has been re-parented.
     */
    public _revalidateCanvas(): void {
        if (!this.isActiveAndEnabled) return;
        const current = this.canvas;
        if (current !== this._registeredCanvas) this._register(current);
    }

    // ── private ──────────────────────────────────────────────────────

    /** Moves registration from the current canvas (if any) to `target`. */
    private _register(target: Canvas | null): void {
        if (this._registeredCanvas === target) return;

        this._registeredCanvas?._unregisterGraphic(this);
        this._registeredCanvas = target;
        this._lastParent = this.transform.parent ?? null;
        target?._registerGraphic(this);
    }
}
