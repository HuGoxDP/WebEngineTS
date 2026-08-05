import { Behaviour } from "../Behaviour";
import { Application } from "../Application";
import { RectTransform } from "./RectTransform";
import { CanvasScaler } from "./CanvasScaler";
import { UIBehaviour } from "./UIBehaviour";
import { Rect } from "../math/Rect";
import { profilerHooks } from "../diagnostics/ProfilerHooks";
import { HASH_SEED, hashBool, hashNumber } from "./UIUtils";
import type { GameObject } from "../GameObject";
import type { Transform } from "../Transform";
import type { Vector2 } from "../math/Vector2";

/**
 * Render mode for the Canvas.
 */
export enum CanvasRenderMode {
    /** Renders as a 2D overlay on top of the 3D scene. */
    ScreenSpaceOverlay = "ScreenSpaceOverlay",
    // WorldSpace — planned for a future phase
}

/**
 * When a Canvas rebuilds its 2D surface.
 */
export enum CanvasRepaintMode {
    /** Clear and redraw every frame, unconditionally. */
    Always = "Always",
    /**
     * Redraw only when the UI actually changed.
     *
     * @remarks
     * Change detection hashes each graphic's layout rect and its
     * `UIBehaviour._visualHash()`. Components that do not implement a hash are
     * treated as always-changed, so correctness never depends on the opt-in.
     */
    OnDemand = "OnDemand",
}

/** Lowest z-index used by canvas overlays; `sortingOrder` offsets from here. */
const BASE_Z_INDEX = 1000;

/** Node cap for the hierarchy-order walk — guards against pathological trees. */
const MAX_HIERARCHY_NODES = 100000;

/**
 * How often the overlay re-measures the render canvas when no resize or scroll
 * event has fired, in milliseconds.
 *
 * @remarks
 * `getBoundingClientRect` forces a style recalculation, so it must not run every
 * frame. Observers cover every case the browser reports; this backstop catches
 * the ones it does not (a host animating its own layout with transforms, for
 * instance) without putting a synchronous layout in the frame loop.
 */
const SURFACE_REVALIDATE_MS = 500;

/**
 * `getComponentsInChildren` takes a construct signature and `UIBehaviour` is
 * abstract, so the query needs a concrete-looking view of it.
 */
const UI_BEHAVIOUR_TYPE = UIBehaviour as unknown as new (...args: never[]) => UIBehaviour;

/**
 * Root container for all UI elements.
 *
 * @remarks
 * Equivalent to Unity's `Canvas` component.
 * Maintains an HTML `<canvas>` element overlaid on the WebGL canvas.
 * All child UI components (Image, Text, Button) register with this canvas
 * and are drawn each frame in {@link _renderAll}.
 *
 * ```ts
 * const uiGO = scene.createGameObject("UI");
 * const canvas = uiGO.addComponent(Canvas);
 * ```
 *
 * **Resolution:** the backing surface is allocated at the device pixel ratio, so
 * text and shapes stay sharp on HiDPI screens, while layout stays in canvas
 * units. Add a {@link CanvasScaler} to the same GameObject to make those units
 * resolution-independent.
 *
 * **Repainting:** {@link repaintMode} defaults to
 * {@link CanvasRepaintMode.OnDemand} — a static HUD costs one repaint, not one
 * per frame.
 */
export class Canvas extends Behaviour {

    private static _instances: Canvas[] = [];
    private static _live: Canvas[] = [];
    private static _orderDirty: boolean = false;

    /**
     * @internal
     * Redraws all active canvases that need it.
     * Called from Application._loop after the 3D render pass.
     */
    public static _renderAll(): void {
        if (Canvas._orderDirty) Canvas._sortInstances();
        for (let i = 0; i < Canvas._instances.length; i++) {
            const c = Canvas._instances[i];
            if (c.isActiveAndEnabled) c._renderFrame();
        }
    }

    /**
     * @internal
     * Active canvases ordered back-to-front by {@link sortingOrder}.
     */
    public static _sortedInstances(): readonly Canvas[] {
        if (Canvas._orderDirty) Canvas._sortInstances();
        return Canvas._instances;
    }

    /**
     * Number of canvases holding a backing store, including disabled ones.
     *
     * @remarks
     * Disabling a Canvas hides its surface but does not free it, so this counts
     * every canvas that still owns memory — see {@link backingStoreBytes}.
     */
    public static get liveCanvasCount(): number { return Canvas._live.length; }

    /**
     * Summed {@link backingStoreBytes} of every live canvas, in bytes.
     *
     * @remarks
     * What {@link MemoryProfiler} reports as UI surface memory. Two full-screen
     * canvases cost twice one, which is the trade-off behind giving a panel its
     * own Canvas rather than a {@link CanvasGroup}.
     */
    public static get totalBackingStoreBytes(): number {
        let total = 0;
        for (let i = 0; i < Canvas._live.length; i++) {
            total += Canvas._live[i].backingStoreBytes;
        }
        return total;
    }

    /** @internal */
    public static _reset(): void {
        // HTML elements are cleaned up in onDestroy of each instance.
        Canvas._instances.length = 0;
        Canvas._live.length = 0;
        Canvas._orderDirty = false;
    }

    private static _sortInstances(): void {
        Canvas._instances.sort((a, b) => a._sortingOrder - b._sortingOrder);
        Canvas._orderDirty = false;
    }

    // ── instance fields ──────────────────────────────────────────────

    private _renderMode: CanvasRenderMode = CanvasRenderMode.ScreenSpaceOverlay;
    private _repaintMode: CanvasRepaintMode = CanvasRepaintMode.OnDemand;
    private _sortingOrder: number = 0;
    private _alpha: number = 1;
    private _pixelRatioOverride: number | null = null;

    private _htmlCanvas: HTMLCanvasElement | null = null;
    private _ctx2d: CanvasRenderingContext2D | null = null;
    private _graphics: UIBehaviour[] = [];
    private _resizeObserver: ResizeObserver | null = null;
    private _scrollHandler: (() => void) | null = null;
    private _viewport: VisualViewport | null = null;

    private readonly _canvasRect: Rect = new Rect();

    /** Reusable scratch for the hierarchy-order walk; never live across calls. */
    private readonly _orderScratch: Map<GameObject, number> = new Map();
    private readonly _walkStack: Transform[] = [];

    private _cssWidth: number = 0;
    private _cssHeight: number = 0;
    private _backingWidth: number = 0;
    private _backingHeight: number = 0;
    private _cssLeft: number = Number.NaN;
    private _cssTop: number = Number.NaN;
    private _scaleFactor: number = 1;
    private _effectivePixelRatio: number = 1;

    private _sortDirty: boolean = false;
    private _dirty: boolean = true;
    private _surfaceDirty: boolean = true;
    private _lastSurfaceCheckMs: number = 0;
    private _lastHash: number = 0;
    private _drawnGraphicCount: number = 0;
    private _repaintedLastFrame: boolean = false;
    private _scaler: CanvasScaler | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ── properties ───────────────────────────────────────────────────

    /** How the canvas is rendered relative to the scene. */
    public get renderMode(): CanvasRenderMode { return this._renderMode; }
    public set renderMode(value: CanvasRenderMode) { this._renderMode = value; }

    /** When the 2D surface is rebuilt. */
    public get repaintMode(): CanvasRepaintMode { return this._repaintMode; }

    public set repaintMode(value: CanvasRepaintMode) {
        if (this._repaintMode === value) return;
        this._repaintMode = value;
        this._dirty = true;
    }

    /**
     * Draw order relative to other canvases. Higher values render on top.
     *
     * @remarks Equivalent to Unity's `Canvas.sortingOrder`.
     */
    public get sortingOrder(): number { return this._sortingOrder; }

    public set sortingOrder(value: number) {
        if (this._sortingOrder === value) return;
        this._sortingOrder = value;
        Canvas._orderDirty = true;
        this._applyZIndex();
    }

    /**
     * Opacity applied to every element on this canvas (0–1).
     *
     * @remarks
     * Equivalent to a Unity `CanvasGroup.alpha` on the canvas root — the cheap
     * way to fade a whole HUD in or out.
     */
    public get alpha(): number { return this._alpha; }

    public set alpha(value: number) {
        const a = value < 0 ? 0 : value > 1 ? 1 : value;
        if (this._alpha === a) return;
        this._alpha = a;
        this._dirty = true;
    }

    /**
     * Backing-surface resolution multiplier.
     *
     * @remarks
     * Defaults to the {@link Application.pixelRatio} used for the 3D render, so
     * one quality knob drives both. Assign a number to override, or `null` to
     * follow the application again. Values are clamped to `[0.5, 4]`.
     */
    public get pixelRatio(): number { return this._effectivePixelRatio; }

    public set pixelRatio(value: number | null) {
        this._pixelRatioOverride = value === null
            ? null
            : Math.max(0.5, Math.min(4, value));
        this._dirty = true;
    }

    /**
     * CSS pixels per canvas unit, as computed by the {@link CanvasScaler} on
     * this GameObject. `1` when there is no scaler.
     */
    public get scaleFactor(): number { return this._scaleFactor; }

    /** Current canvas width in canvas units. */
    public get width(): number {
        return this._scaleFactor > 0 ? this._cssWidth / this._scaleFactor : 0;
    }

    /** Current canvas height in canvas units. */
    public get height(): number {
        return this._scaleFactor > 0 ? this._cssHeight / this._scaleFactor : 0;
    }

    /**
     * Memory held by this canvas's backing store, in bytes.
     *
     * @remarks
     * The surface is allocated at `cssSize × pixelRatio` and browsers back it
     * with an RGBA8 GPU surface, so a full-screen 1920×1080 canvas at
     * {@link pixelRatio} 2 costs ~33 MB — comparable to a large texture, and
     * invisible in the JS heap. `0` before the surface exists (no DOM).
     */
    public get backingStoreBytes(): number {
        return this._backingWidth * this._backingHeight * 4;
    }

    /** Number of graphics drawn during the most recent repaint. */
    public get drawnGraphicCount(): number { return this._drawnGraphicCount; }

    /** Whether the last frame triggered an actual repaint. */
    public get repaintedLastFrame(): boolean { return this._repaintedLastFrame; }

    /** @internal The 2D rendering context. */
    public get _context(): CanvasRenderingContext2D | null { return this._ctx2d; }

    /** @internal Graphics registered with this canvas, back-to-front. */
    public get _graphicList(): readonly UIBehaviour[] { return this._graphics; }

    // ── lifecycle ────────────────────────────────────────────────────

    protected override onAwake(): void {
        // Tracked before the DOM check so the accounting covers every canvas the
        // engine knows about, whether or not it got a surface.
        if (!Canvas._live.includes(this)) Canvas._live.push(this);

        if (typeof document === "undefined") return;

        this._htmlCanvas = document.createElement("canvas");
        this._ctx2d = this._htmlCanvas.getContext("2d");

        const style = this._htmlCanvas.style;
        style.position = "fixed";
        style.pointerEvents = "none";
        this._applyZIndex();

        // Insert after the WebGL canvas so it layers on top.
        const glCanvas = Application.current?.canvas ?? null;
        if (glCanvas?.parentElement) {
            glCanvas.parentElement.insertBefore(this._htmlCanvas, glCanvas.nextSibling);
        } else {
            document.body.appendChild(this._htmlCanvas);
        }

        this._syncSurface();

        // Observers only flag the surface; the re-measure itself happens in the
        // frame loop, so a burst of resize events costs one layout, not one each.
        const invalidate = () => { this._surfaceDirty = true; };

        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(invalidate);
            this._resizeObserver.observe(glCanvas ?? document.documentElement);
        }

        if (typeof window !== "undefined") {
            this._scrollHandler = invalidate;
            window.addEventListener("scroll", this._scrollHandler, { passive: true });

            // Pinch-zoom and the mobile keyboard move the canvas without firing
            // either of the above.
            this._viewport = window.visualViewport ?? null;
            this._viewport?.addEventListener("resize", this._scrollHandler);
            this._viewport?.addEventListener("scroll", this._scrollHandler);
        }
    }

    protected override onEnable(): void {
        if (!Canvas._instances.includes(this)) {
            Canvas._instances.push(this);
            Canvas._orderDirty = true;
        }
        this._dirty = true;
        this._surfaceDirty = true;
        if (this._htmlCanvas) this._htmlCanvas.style.display = "";

        this._adoptSubtree();
    }

    protected override onDisable(): void {
        const idx = Canvas._instances.indexOf(this);
        if (idx >= 0) Canvas._instances.splice(idx, 1);
        if (this._htmlCanvas) this._htmlCanvas.style.display = "none";
    }

    protected override onDestroy(): void {
        const idx = Canvas._instances.indexOf(this);
        if (idx >= 0) Canvas._instances.splice(idx, 1);

        const live = Canvas._live.indexOf(this);
        if (live >= 0) Canvas._live.splice(live, 1);

        this._resizeObserver?.disconnect();
        this._resizeObserver = null;

        if (this._scrollHandler && typeof window !== "undefined") {
            window.removeEventListener("scroll", this._scrollHandler);
            this._viewport?.removeEventListener("resize", this._scrollHandler);
            this._viewport?.removeEventListener("scroll", this._scrollHandler);
        }
        this._scrollHandler = null;
        this._viewport = null;

        this._htmlCanvas?.parentElement?.removeChild(this._htmlCanvas);
        this._htmlCanvas = null;
        this._ctx2d = null;
        this._graphics.length = 0;
    }

    // ── public API ───────────────────────────────────────────────────

    /**
     * Forces a repaint on the next frame.
     *
     * @remarks
     * Only needed in {@link CanvasRepaintMode.OnDemand} for custom graphics that
     * draw from state the canvas cannot hash.
     */
    public setDirty(): void {
        this._dirty = true;
    }

    /**
     * Converts a viewport point (CSS pixels, relative to the render canvas)
     * into canvas units.
     *
     * @param point - source point, e.g. `Input.mousePosition`.
     * @param out - vector to receive the result; `point` may be passed here.
     * @returns `out` for chaining.
     */
    public screenToCanvasPoint(point: Vector2, out: Vector2): Vector2 {
        const s = this._scaleFactor > 0 ? this._scaleFactor : 1;
        out.x = point.x / s;
        out.y = point.y / s;
        return out;
    }

    // ── internal registration ────────────────────────────────────────

    /** @internal Called by UIBehaviour when it attaches to this canvas. */
    public _registerGraphic(graphic: UIBehaviour): void {
        if (this._graphics.includes(graphic)) return;
        this._graphics.push(graphic);
        this._sortDirty = true;
        this._dirty = true;
    }

    /** @internal Called by UIBehaviour when it detaches from this canvas. */
    public _unregisterGraphic(graphic: UIBehaviour): void {
        const idx = this._graphics.indexOf(graphic);
        if (idx >= 0) {
            this._graphics.splice(idx, 1);
            this._dirty = true;
        }
    }

    /** @internal Called when a registered graphic changes its sorting order. */
    public _setSortingDirty(): void {
        this._sortDirty = true;
        this._dirty = true;
    }

    /** @internal Called by UIBehaviour.setDirty. */
    public _setDirty(): void {
        this._dirty = true;
    }

    // ── private ──────────────────────────────────────────────────────

    /** Positions the overlay over the render canvas and sizes its backing store. */
    private _syncSurface(): void {
        if (!this._htmlCanvas) return;

        const glCanvas = Application.current?.canvas ?? null;
        const style = this._htmlCanvas.style;

        let cssW: number;
        let cssH: number;
        let cssLeft: number;
        let cssTop: number;

        if (glCanvas) {
            // Track the render canvas exactly — it is not always at the viewport
            // origin (hosts embed it inside their own page layout).
            const box = glCanvas.getBoundingClientRect();
            cssW = box.width;
            cssH = box.height;
            cssLeft = box.left;
            cssTop = box.top;
        } else {
            cssW = typeof window !== "undefined" ? window.innerWidth : 0;
            cssH = typeof window !== "undefined" ? window.innerHeight : 0;
            cssLeft = 0;
            cssTop = 0;
        }

        // Style writes are guarded: an unconditional assignment every frame
        // would invalidate layout right before the next getBoundingClientRect.
        if (this._cssLeft !== cssLeft || this._cssTop !== cssTop) {
            this._cssLeft = cssLeft;
            this._cssTop = cssTop;
            style.left = `${cssLeft}px`;
            style.top = `${cssTop}px`;
        }

        const ratio = this._resolvePixelRatio();
        const backingW = Math.max(1, Math.round(cssW * ratio));
        const backingH = Math.max(1, Math.round(cssH * ratio));

        if (this._htmlCanvas.width !== backingW || this._htmlCanvas.height !== backingH) {
            // Resizing the backing store also clears it and resets the context.
            this._htmlCanvas.width = backingW;
            this._htmlCanvas.height = backingH;
            this._dirty = true;
        }

        this._backingWidth = backingW;
        this._backingHeight = backingH;

        if (this._cssWidth !== cssW || this._cssHeight !== cssH) {
            style.width = `${cssW}px`;
            style.height = `${cssH}px`;
            this._cssWidth = cssW;
            this._cssHeight = cssH;
            this._dirty = true;
        }

        if (this._effectivePixelRatio !== ratio) {
            this._effectivePixelRatio = ratio;
            this._dirty = true;
        }

        this._updateScaleFactor();
        this._canvasRect.set(0, 0, this.width, this.height);
    }

    private _resolvePixelRatio(): number {
        if (this._pixelRatioOverride !== null) return this._pixelRatioOverride;

        const appRatio = Application.current?.pixelRatio ?? 0;
        if (appRatio > 0) return appRatio;

        const deviceRatio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
        return deviceRatio > 0 ? Math.min(4, deviceRatio) : 1;
    }

    private _updateScaleFactor(): void {
        // A scaler is usually added right after the Canvas, so a missing one is
        // re-checked until found (and dropped again if it gets destroyed).
        if (this._scaler === null || !this._scaler.exists()) {
            this._scaler = this.gameObject.getComponent(CanvasScaler);
        }

        const scaler = this._scaler;
        const factor = scaler && scaler.isActiveAndEnabled
            ? scaler._computeScaleFactor(this._cssWidth, this._cssHeight, CanvasScaler._screenDPI())
            : 1;

        if (this._scaleFactor !== factor) {
            this._scaleFactor = factor;
            this._dirty = true;
        }
    }

    private _renderFrame(): void {
        if (!this._ctx2d || !this._htmlCanvas) return;

        this._maybeSyncSurface();

        // Cheap and not a layout read, so it stays per-frame: a scaler property
        // assigned from script must take effect on the very next repaint.
        this._updateScaleFactor();

        this._repaintedLastFrame = this._prepare();
        if (this._repaintedLastFrame && this._ctx2d) this._paint(this._ctx2d);
    }

    /**
     * Re-measures the render canvas, but only when something may have moved it.
     *
     * @remarks
     * `_syncSurface` calls `getBoundingClientRect`, which forces a synchronous
     * style recalculation. Running that every frame would put a layout in the
     * frame loop of a subsystem whose whole point is to do nothing when nothing
     * changed, so it is driven by the resize/scroll observers plus a slow
     * backstop poll.
     */
    private _maybeSyncSurface(): void {
        const now = performance.now();

        if (!this._surfaceDirty && now - this._lastSurfaceCheckMs < SURFACE_REVALIDATE_MS) {
            return;
        }

        this._surfaceDirty = false;
        this._lastSurfaceCheckMs = now;
        this._syncSurface();
    }

    /**
     * @internal
     * Refreshes draw order and layout rects, and decides whether a repaint is
     * required. Runs every frame; `_paint` is what it gates.
     *
     * @returns true when the surface must be redrawn this frame.
     */
    public _prepare(): boolean {
        // The visible area is part of layout, not of painting: the cull test in
        // `_paint` reads it, and so does anything asking what is on screen.
        this._canvasRect.set(0, 0, this.width, this.height);

        // Re-parenting is resolved before sorting, so an element that moved this
        // frame is drawn in its new hierarchy position on this frame.
        this._revalidateParents();

        if (this._sortDirty) {
            this._assignHierarchyOrder();
            // Array.prototype.sort is stable, so several graphics on one
            // GameObject (an Image and a Text, say) keep registration order.
            this._graphics.sort((a, b) => a.sortingOrder !== b.sortingOrder
                ? a.sortingOrder - b.sortingOrder
                : a._hierarchyIndex - b._hierarchyIndex);
            this._sortDirty = false;
        }

        const onDemand = this._repaintMode === CanvasRepaintMode.OnDemand;
        let hash = HASH_SEED;
        let unknown = false;

        if (onDemand) {
            hash = hashNumber(hash, this._cssWidth);
            hash = hashNumber(hash, this._cssHeight);
            hash = hashNumber(hash, this._scaleFactor);
            hash = hashNumber(hash, this._effectivePixelRatio);
            hash = hashNumber(hash, this._alpha);
            hash = hashNumber(hash, this._graphics.length);
        }

        for (let i = 0; i < this._graphics.length; i++) {
            const g = this._graphics[i];
            const active = g.isActiveAndEnabled;

            if (onDemand) hash = hashBool(hash, active);
            if (!active) continue;

            if (onDemand) {
                // The local rect plus the transform is the element's full
                // placement — the bounds alone would miss a pure rotation.
                const rt = g.rectTransform;
                const local = rt._resolvedLocalRect;
                const m = rt._canvasMatrix;

                hash = hashNumber(hash, local.x);
                hash = hashNumber(hash, local.y);
                hash = hashNumber(hash, local.width);
                hash = hashNumber(hash, local.height);
                for (let k = 0; k < 6; k++) hash = hashNumber(hash, m[k]);
                hash = hashNumber(hash, g._groupAlpha());

                const gh = g._visualHash();
                if (Number.isNaN(gh)) unknown = true;
                else hash = hashNumber(hash, gh);
            }
        }

        if (!onDemand) {
            this._dirty = false;
            return true;
        }

        const changed = this._dirty || unknown || hash !== this._lastHash;
        this._lastHash = hash;
        this._dirty = false;
        return changed;
    }

    /**
     * Re-homes graphics that were re-parented onto another canvas since the
     * last frame. Detected by identity, so it costs one comparison each.
     */
    private _revalidateParents(): void {
        for (let i = this._graphics.length - 1; i >= 0; i--) {
            const g = this._graphics[i];
            const parent = g.transform.parent ?? null;
            if (parent === g._lastParent) continue;

            g._lastParent = parent;
            g.rectTransform.invalidateLayoutCache();
            g._invalidateGroupChain();
            g._revalidateCanvas();

            // A moved element sits somewhere else in the hierarchy, so the draw
            // order it implies is stale.
            this._sortDirty = true;
            this._dirty = true;
        }
    }

    /**
     * Numbers this canvas's subtree depth-first and stamps each registered
     * graphic with its GameObject's position.
     *
     * @remarks
     * Runs only when the graphic set or the hierarchy changed, never per frame.
     * Graphics whose GameObject is not reached by the walk (possible for one
     * frame while a re-parent is being resolved) sort last rather than at an
     * arbitrary position.
     */
    private _assignHierarchyOrder(): void {
        const order = this._orderScratch;
        const stack = this._walkStack;
        order.clear();
        stack.length = 0;

        let next = 0;
        stack.push(this.gameObject.transform);

        while (stack.length > 0 && next < MAX_HIERARCHY_NODES) {
            const t = stack.pop()!;
            order.set(t.gameObject, next++);
            // Pushed in reverse so the pop order is first child first.
            for (let i = t.childCount - 1; i >= 0; i--) stack.push(t.getChild(i));
        }

        stack.length = 0;

        for (let i = 0; i < this._graphics.length; i++) {
            const g = this._graphics[i];
            const idx = order.get(g.gameObject);
            g._hierarchyIndex = idx === undefined ? Number.MAX_SAFE_INTEGER : idx;
        }

        order.clear();
    }

    /**
     * Registers graphics that already existed in this canvas's subtree when the
     * canvas itself came online.
     *
     * @remarks
     * A graphic resolves its canvas in `onEnable`. Adding a Canvas component to
     * an ancestor afterwards changes no parent pointer, so `_revalidateParents`
     * never fires and those descendants would stay unregistered — invisible and
     * un-clickable — forever. Unity solves the same problem with
     * `OnCanvasHierarchyChanged`.
     */
    private _adoptSubtree(): void {
        const graphics = this.gameObject.getComponentsInChildren(UI_BEHAVIOUR_TYPE, true);
        for (let i = 0; i < graphics.length; i++) {
            graphics[i].rectTransform.invalidateLayoutCache();
            graphics[i]._revalidateCanvas();
        }
    }

    /**
     * @internal
     * Draws every visible graphic. Takes the context rather than reading the
     * field so the paint path can be exercised without a DOM.
     */
    public _paint(ctx: CanvasRenderingContext2D): void {
        // One transform maps canvas units → device pixels: layout math and every
        // component's draw code stay in units and gain HiDPI sharpness for free.
        const s = this._effectivePixelRatio * this._scaleFactor;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.clearRect(0, 0, this._canvasRect.width, this._canvasRect.height);

        if (this._alpha <= 0) {
            this._drawnGraphicCount = 0;
            return;
        }
        ctx.globalAlpha = this._alpha;

        let drawn = 0;
        for (let i = 0; i < this._graphics.length; i++) {
            const g = this._graphics[i];
            if (!g.isActiveAndEnabled) continue;

            const rt = g.rectTransform;
            if (g._allowCulling && !rt._resolvedBounds.overlaps(this._canvasRect)) continue;

            const groupAlpha = g._groupAlpha();
            if (groupAlpha <= 0) continue;

            const m = rt._canvasMatrix;
            ctx.save();
            ctx.globalAlpha = this._alpha * groupAlpha;

            // Each mask clips in its own space, so a rotated one clips to its
            // real quad. Clips intersect, so applying them in turn is enough.
            const masks = g._maskChain();
            for (let k = masks.length - 1; k >= 0; k--) {
                const mask = masks[k];
                const mm = mask.rectTransform._canvasMatrix;
                const mr = mask._clipRect();
                ctx.setTransform(s, 0, 0, s, 0, 0);
                ctx.transform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]);
                ctx.beginPath();
                ctx.rect(mr.x, mr.y, mr.width, mr.height);
                ctx.clip();
            }
            if (masks.length > 0) ctx.setTransform(s, 0, 0, s, 0, 0);

            // Composes with the canvas-unit transform already on the context, so
            // components keep drawing in their own local rect and inherit the
            // element's rotation and scale without knowing about either.
            ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
            g._draw(ctx, rt._resolvedLocalRect);
            ctx.restore();
            drawn++;
        }

        this._drawnGraphicCount = drawn;
    }

    private _applyZIndex(): void {
        if (this._htmlCanvas) {
            this._htmlCanvas.style.zIndex = `${BASE_Z_INDEX + this._sortingOrder}`;
        }
    }
}

// Break the Canvas ↔ RectTransform circular import at module-load.
RectTransform._registerCanvasCtor(Canvas as unknown as new (...args: any[]) => Canvas & { width: number; height: number });

profilerHooks.uiCanvasCount = () => Canvas.liveCanvasCount;
profilerHooks.uiCanvasBytes = () => Canvas.totalBackingStoreBytes;
