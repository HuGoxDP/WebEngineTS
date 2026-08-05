import { Behaviour } from "../Behaviour";
import { RectTransform } from "./RectTransform";
import { UIEvent } from "./UIEvent";
import { CanvasGroup } from "./CanvasGroup";
import { RectMask2D } from "./RectMask2D";
import { Rect as RectImpl } from "../math/Rect";
import type { Canvas } from "./Canvas";
import type { PointerEventData } from "./PointerEventData";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";
import type { Transform } from "../Transform";

/** Depth cap for the CanvasGroup walk, matching the RectTransform ancestor walk. */
const MAX_GROUP_DEPTH = 64;

/**
 * @internal
 * The pointer events a {@link UIBehaviour} can receive. Used by the EventSystem
 * to ask whether an element handles a kind before resolving a target for it.
 */
export enum PointerEventKind {
    Enter = "Enter",
    Exit = "Exit",
    Down = "Down",
    Up = "Up",
    Click = "Click",
    BeginDrag = "BeginDrag",
    Drag = "Drag",
    EndDrag = "EndDrag",
}

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

    /**
     * @internal
     * Change-detection state owned by the owning {@link Canvas}: the hash and
     * the painted bounds this graphic was last seen with. Written only by
     * `Canvas._prepare`, and meaningless while {@link _repaintValid} is false.
     */
    public _repaintHash: number = 0;

    /** @internal See {@link _repaintHash}. */
    public _repaintValid: boolean = false;

    /** @internal See {@link _repaintHash}. */
    public readonly _repaintBounds: RectImpl = new RectImpl();

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

    // ── pointer events ───────────────────────────────────────────────
    //
    // Created on first access rather than up front: most graphics in a HUD are
    // decoration and subscribe to none of these, and eight event objects per
    // element adds up across a few hundred of them.

    private _evEnter: UIEvent<PointerEventData> | null = null;
    private _evExit: UIEvent<PointerEventData> | null = null;
    private _evDown: UIEvent<PointerEventData> | null = null;
    private _evUp: UIEvent<PointerEventData> | null = null;
    private _evClick: UIEvent<PointerEventData> | null = null;
    private _evBeginDrag: UIEvent<PointerEventData> | null = null;
    private _evDrag: UIEvent<PointerEventData> | null = null;
    private _evEndDrag: UIEvent<PointerEventData> | null = null;

    /**
     * Fired when a pointer moves onto this element.
     *
     * @remarks
     * Requires {@link raycastTarget}. Equivalent to Unity's `IPointerEnterHandler`.
     */
    public get onPointerEnter(): UIEvent<PointerEventData> {
        return this._evEnter ??= new UIEvent<PointerEventData>();
    }

    /** Fired when a pointer moves off this element. */
    public get onPointerExit(): UIEvent<PointerEventData> {
        return this._evExit ??= new UIEvent<PointerEventData>();
    }

    /** Fired when a pointer is pressed on this element. */
    public get onPointerDown(): UIEvent<PointerEventData> {
        return this._evDown ??= new UIEvent<PointerEventData>();
    }

    /**
     * Fired when a pointer that was pressed on this element is released,
     * wherever it happens to be at the time.
     */
    public get onPointerUp(): UIEvent<PointerEventData> {
        return this._evUp ??= new UIEvent<PointerEventData>();
    }

    /**
     * Fired when a pointer is pressed and released on this same element.
     *
     * @remarks
     * Not fired if the pointer was dragged away and released elsewhere.
     */
    public get onPointerClick(): UIEvent<PointerEventData> {
        return this._evClick ??= new UIEvent<PointerEventData>();
    }

    /**
     * Fired once when a press turns into a drag, i.e. the pointer has moved
     * further than the EventSystem's drag threshold.
     */
    public get onBeginDrag(): UIEvent<PointerEventData> {
        return this._evBeginDrag ??= new UIEvent<PointerEventData>();
    }

    /** Fired every frame a drag continues, with `delta` since the last frame. */
    public get onDrag(): UIEvent<PointerEventData> {
        return this._evDrag ??= new UIEvent<PointerEventData>();
    }

    /** Fired once when a drag ends. */
    public get onEndDrag(): UIEvent<PointerEventData> {
        return this._evEndDrag ??= new UIEvent<PointerEventData>();
    }

    /**
     * @internal
     * Whether this element has any subscriber for `kind`.
     *
     * Lets the EventSystem resolve a handler without forcing every event object
     * into existence just by looking.
     */
    public _hasListeners(kind: PointerEventKind): boolean {
        return this._event(kind)?.hasListeners === true;
    }

    /** @internal Dispatches `kind` to this element's subscribers, if any. */
    public _raise(kind: PointerEventKind, data: PointerEventData): void {
        const event = this._event(kind);
        if (event?.hasListeners) event.invoke(data);
    }

    private _event(kind: PointerEventKind): UIEvent<PointerEventData> | null {
        switch (kind) {
            case PointerEventKind.Enter:     return this._evEnter;
            case PointerEventKind.Exit:      return this._evExit;
            case PointerEventKind.Down:      return this._evDown;
            case PointerEventKind.Up:        return this._evUp;
            case PointerEventKind.Click:     return this._evClick;
            case PointerEventKind.BeginDrag: return this._evBeginDrag;
            case PointerEventKind.Drag:      return this._evDrag;
            default:                         return this._evEndDrag;
        }
    }

    // ── CanvasGroup resolution ───────────────────────────────────────
    //
    // Which groups sit above this element changes only on a re-parent or when a
    // group is added or removed, but their *values* change freely (a fade
    // animates alpha every frame). So the chain is cached and the values are
    // read fresh from it — the scan is the expensive half, not the arithmetic.

    private _groupChain: CanvasGroup[] | null = null;
    private _groupChainVersion: number = -1;

    /**
     * @internal
     * Combined opacity of every {@link CanvasGroup} above this element.
     * `1` when there are none.
     */
    public _groupAlpha(): number {
        const chain = this._resolveGroupChain();
        let alpha = 1;
        for (let i = 0; i < chain.length; i++) alpha *= chain[i].alpha;
        return alpha;
    }

    /** @internal Whether every group above this element allows interaction. */
    public _groupInteractable(): boolean {
        const chain = this._resolveGroupChain();
        for (let i = 0; i < chain.length; i++) {
            if (!chain[i].interactable) return false;
        }
        return true;
    }

    /** @internal Whether every group above this element blocks the pointer. */
    public _groupBlocksRaycasts(): boolean {
        const chain = this._resolveGroupChain();
        for (let i = 0; i < chain.length; i++) {
            if (!chain[i].blocksRaycasts) return false;
        }
        return true;
    }

    /** @internal Drops the cached group chain, e.g. after a re-parent. */
    public _invalidateGroupChain(): void {
        this._groupChainVersion = -1;
        this._groupChain = null;
        this._maskChainVersion = -1;
        this._maskChainCache = null;
    }

    // ── RectMask2D resolution ────────────────────────────────────────

    private _maskChainCache: RectMask2D[] | null = null;
    private _maskChainVersion: number = -1;

    /**
     * @internal
     * The active masks above this element, nearest first. Empty when nothing
     * clips it.
     */
    public _maskChain(): readonly RectMask2D[] {
        if (this._maskChainCache && this._maskChainVersion === RectMask2D._structureVersion) {
            return this._maskChainCache;
        }

        const chain: RectMask2D[] = [];
        let go: GameObject | null = this.gameObject;

        for (let depth = 0; go && depth < MAX_GROUP_DEPTH; depth++) {
            const mask = go.getComponent(RectMask2D);
            // A mask does not clip itself, only what is under it — otherwise a
            // scroll view's own background would vanish behind its own window.
            if (mask && mask.isActiveAndEnabled && go !== this.gameObject) chain.push(mask);
            go = go.transform.parent?.gameObject ?? null;
        }

        this._maskChainCache = chain;
        this._maskChainVersion = RectMask2D._structureVersion;
        return chain;
    }

    /** @internal Whether a canvas-space point survives every mask above this. */
    public _passesMasks(x: number, y: number): boolean {
        const chain = this._maskChain();
        for (let i = 0; i < chain.length; i++) {
            if (!chain[i]._containsCanvasPoint(x, y)) return false;
        }
        return true;
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
     * Coordinates are canvas units in the element's **local space**, where the
     * pivot is the origin — so `rect.x` is `-pivot.x * width`, not a screen
     * position. The context arrives already scaled to device pixels, already
     * carrying the element's rotation and scale, and wrapped in
     * `save()`/`restore()`, so drawing at `rect` is all a component has to do.
     *
     * @param rect - the element's resolved local rect. Owned by its
     *               RectTransform: read it, never store or mutate it.
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
     *
     * @remarks
     * Returning `false` also means "my painted area is not my rect", so the
     * canvas treats such an element as unbounded for
     * {@link Canvas.partialRepaint} — see {@link _drawOverflow}.
     */
    public get _allowCulling(): boolean {
        return true;
    }

    /**
     * @internal
     * How far outside its layout rect this element paints, in canvas units.
     *
     * @remarks
     * {@link Canvas.partialRepaint} redraws only the region that changed, and
     * derives that region from each element's bounds — so an element that
     * paints beyond them (a stroked outline, a label wider than its box) has to
     * say by how much, or it leaves stale pixels behind when it changes.
     *
     * Return `Infinity` when the painted area cannot be bounded cheaply; the
     * canvas then falls back to a full repaint whenever this element changes,
     * which is correct but gives up the optimization. `0` — the default —
     * asserts that everything is drawn inside the rect.
     */
    public _drawOverflow(): number {
        return 0;
    }

    /**
     * @internal
     * Whether this element's interactive area can reach outside its own rect.
     *
     * The EventSystem rejects pointers against the resolved bounds before
     * inverting the transform, which is a large saving across a HUD but wrong
     * for a control that draws beyond itself — an open dropdown list, say.
     * Returning `true` skips that shortcut and goes straight to
     * {@link _hitTest}, which is then the only thing defining the hit area.
     */
    public get _expandsHitArea(): boolean {
        return false;
    }

    /**
     * @internal
     * Tests a point against this element's interactive shape.
     *
     * Both the point and the rect are in the element's local space, the same
     * space {@link _draw} paints in, so an override never has to think about
     * the element's rotation or scale. Defaults to the layout rect; override
     * for non-rectangular controls.
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

    /**
     * The active CanvasGroups from this element upward, nearest first, stopping
     * at one that ignores its parents.
     */
    private _resolveGroupChain(): readonly CanvasGroup[] {
        if (this._groupChain && this._groupChainVersion === CanvasGroup._structureVersion) {
            return this._groupChain;
        }

        const chain: CanvasGroup[] = [];
        let go: GameObject | null = this.gameObject;

        for (let depth = 0; go && depth < MAX_GROUP_DEPTH; depth++) {
            const group = go.getComponent(CanvasGroup);
            if (group && group.isActiveAndEnabled) {
                chain.push(group);
                if (group.ignoreParentGroups) break;
            }
            go = go.transform.parent?.gameObject ?? null;
        }

        this._groupChain = chain;
        this._groupChainVersion = CanvasGroup._structureVersion;
        return chain;
    }

    /** Moves registration from the current canvas (if any) to `target`. */
    private _register(target: Canvas | null): void {
        if (this._registeredCanvas === target) return;

        this._registeredCanvas?._unregisterGraphic(this);
        this._registeredCanvas = target;
        this._lastParent = this.transform.parent ?? null;
        target?._registerGraphic(this);
    }
}
