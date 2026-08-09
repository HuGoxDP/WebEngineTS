import { Behaviour } from "../Behaviour";
import { Application } from "../Application";
import { RectTransform } from "./RectTransform";
import { CanvasScaler } from "./CanvasScaler";
import { UIBehaviour } from "./UIBehaviour";
import { Rect } from "../math/Rect";
import { Vector2 } from "../math/Vector2";
import { Vector3 } from "../math/Vector3";
import { Camera } from "../components/Camera";
import { profilerHooks } from "../diagnostics/ProfilerHooks";
import { HASH_SEED, hashBool, hashNumber } from "./UIUtils";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";
import type { Transform } from "../Transform";

/**
 * Render mode for the Canvas.
 */
export enum CanvasRenderMode {
    /** Renders as a 2D overlay on top of the 3D scene. */
    ScreenSpaceOverlay = "ScreenSpaceOverlay",
    /**
     * Pins the canvas to its GameObject's world position — a label or callout
     * attached to part of a 3D model.
     *
     * @remarks
     * Equivalent in purpose to Unity's `RenderMode.WorldSpace`, implemented as a
     * **projected overlay**: the anchor point is projected to screen space each
     * frame and the UI is drawn around it, scaled by distance. The whole subtree
     * stays 2D drawing, so nothing in the UI subsystem touches the 3D renderer.
     *
     * What that buys and what it costs, versus Unity's textured quad:
     * - The UI stays screen-facing and perfectly legible — it never turns edge-on.
     * - It has no perspective of its own: a callout does not lie *on* a slanted
     *   surface, it hovers in front of it.
     * - It is **not depth-occluded**. A label pinned to the far side of a model
     *   draws over it rather than being hidden. Hide it from script when that
     *   matters — a raycast against the model is the usual test.
     *
     * See {@link Canvas.worldSize}, {@link Canvas.worldScale} and
     * {@link Canvas.distanceScaling} for how the anchor maps to canvas units.
     */
    WorldSpace = "WorldSpace",
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
 * Canvas units added around a repaint region, covering the pixels antialiasing
 * touches just outside a shape's mathematical bounds.
 */
const AA_PADDING = 2;

/**
 * Half-extent used as the painted bounds of an element that cannot say where it
 * paints. Large enough to cover any canvas, finite so rect arithmetic stays
 * free of `NaN`.
 */
const UNBOUNDED_EXTENT = 1e7;

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
@Serializable({ typeName: "Canvas", category: "UI" })
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
     * Refreshes every active canvas's placement on the render surface.
     * Called from Application._loop before the event pass, so a world-space
     * canvas hit-tests where this frame's camera puts it.
     */
    public static _updateTransforms(): void {
        for (let i = 0; i < Canvas._instances.length; i++) {
            const c = Canvas._instances[i];
            if (c.isActiveAndEnabled) c._updateBaseTransform();
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

    // ── world-space projection ───────────────────────────────────────

    private readonly _worldSize: Vector2 = new Vector2(200, 100);
    private readonly _worldPivot: Vector2 = new Vector2(0.5, 0.5);
    private _worldScale: number = 0.01;
    private _distanceScaling: boolean = true;
    private _worldCamera: Camera | null = null;
    private _worldDistance: number = 0;
    private _projected: boolean = true;

    /** Canvas units → CSS pixels, and the CSS-pixel origin of the canvas rect. */
    private _baseScale: number = 1;
    private _baseOffsetX: number = 0;
    private _baseOffsetY: number = 0;

    private readonly _projScratch: Vector3 = new Vector3();

    private _htmlCanvas: HTMLCanvasElement | null = null;
    private _ctx2d: CanvasRenderingContext2D | null = null;
    private _graphics: UIBehaviour[] = [];
    private _resizeObserver: ResizeObserver | null = null;
    private _scrollHandler: (() => void) | null = null;
    private _viewport: VisualViewport | null = null;

    private readonly _canvasRect: Rect = new Rect();

    private _partialRepaint: boolean = true;

    /** The region to repaint this frame, or null for the whole surface. */
    private _region: Rect | null = null;
    private readonly _regionScratch: Rect = new Rect();
    private static readonly _boundsScratch: Rect = new Rect();

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
    @SerializedField({ type: FieldType.Enum })
    public get renderMode(): CanvasRenderMode { return this._renderMode; }

    public set renderMode(value: CanvasRenderMode) {
        if (this._renderMode === value) return;
        this._renderMode = value;
        // The canvas rect every root element is laid out against changes size
        // with the mode, so nothing cached against the old one is still valid.
        this._dirty = true;
        this._adoptSubtree();
    }

    /**
     * Size of the canvas rect in canvas units, in
     * {@link CanvasRenderMode.WorldSpace}.
     *
     * @remarks
     * The "paper size" the UI is composed on — root elements lay out against
     * `(0, 0, worldSize.x, worldSize.y)` exactly as they lay out against the
     * screen in overlay mode. Multiply by {@link worldScale} for the size in
     * world units. Ignored in overlay mode, where the screen supplies the size.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public get worldSize(): Vector2 { return this._worldSize; }

    /**
     * World units per canvas unit, in {@link CanvasRenderMode.WorldSpace}.
     *
     * @remarks
     * The equivalent of the scale on Unity's world-space canvas Transform, and
     * kept small for the same reason: at the default `0.01`, a 200×100 canvas is
     * a 2×1 world-unit panel rather than a 200-unit wall. Only meaningful while
     * {@link distanceScaling} is on — with it off, size is in CSS pixels.
     */
    @SerializedField()
    public get worldScale(): number { return this._worldScale; }

    public set worldScale(value: number) {
        const v = Number.isFinite(value) ? Math.max(1e-6, value) : this._worldScale;
        if (this._worldScale === v) return;
        this._worldScale = v;
        this._dirty = true;
    }

    /**
     * Which point of the canvas rect lands on the projected anchor, normalized.
     *
     * @remarks
     * `(0.5, 0.5)` — the default — centres the panel on the anchor. Because Y
     * points down, `(0.5, 1)` puts the panel's **bottom** edge on the anchor,
     * which is how a callout floats above the thing it labels.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public get worldPivot(): Vector2 { return this._worldPivot; }

    /**
     * Whether a world-space canvas shrinks with distance like a real object.
     *
     * @remarks
     * On (the default) it behaves as a physical panel: {@link worldScale} sets
     * its world size and perspective does the rest. Off, it keeps a constant
     * pixel size and only its *position* is projected — the billboard-label
     * behaviour, which is what keeps a callout legible on a model the user can
     * zoom away from. One canvas unit is then one CSS pixel.
     */
    @SerializedField()
    public get distanceScaling(): boolean { return this._distanceScaling; }

    public set distanceScaling(value: boolean) {
        if (this._distanceScaling === value) return;
        this._distanceScaling = value;
        this._dirty = true;
    }

    /**
     * Camera used to project a world-space canvas. `null` (the default) follows
     * {@link Camera.main}.
     *
     * @remarks Equivalent to Unity's `Canvas.worldCamera`.
     */
    public get worldCamera(): Camera | null { return this._worldCamera; }

    public set worldCamera(value: Camera | null) {
        if (this._worldCamera === value) return;
        this._worldCamera = value;
        this._dirty = true;
    }

    /**
     * Distance from the projecting camera to the anchor, in world units. `0` in
     * overlay mode or while the anchor is not visible.
     *
     * @remarks
     * Exposed because it is the number a scenario needs to fade or hide distant
     * labels, and it has already been computed for the projection.
     */
    public get worldDistance(): number { return this._worldDistance; }

    /**
     * Whether the canvas is currently on screen at all.
     *
     * @remarks
     * Always true in overlay mode. In {@link CanvasRenderMode.WorldSpace} it
     * goes false when the anchor is behind the camera or no camera is available
     * — the canvas then neither draws nor hit-tests, rather than drawing at a
     * mirrored position.
     */
    public get isRenderable(): boolean { return this._projected; }

    /** When the 2D surface is rebuilt. */
    @SerializedField({ type: FieldType.Enum })
    public get repaintMode(): CanvasRepaintMode { return this._repaintMode; }

    public set repaintMode(value: CanvasRepaintMode) {
        if (this._repaintMode === value) return;
        this._repaintMode = value;
        this._dirty = true;
    }

    /**
     * Whether a repaint may be narrowed to the part of the surface that
     * changed, instead of clearing and redrawing everything. Defaults to `true`.
     *
     * @remarks
     * A score label ticking once a frame otherwise costs a full-HUD redraw.
     * With this on, the canvas unions the old and new bounds of the elements
     * that changed, clips to that, and redraws only what intersects it — so the
     * cost tracks what moved rather than what exists.
     *
     * Only applies in {@link CanvasRepaintMode.OnDemand}, which is where the
     * per-element change detection lives. The canvas falls back to a full
     * repaint by itself whenever the region cannot be trusted: a resize, a
     * scaler change, the canvas {@link alpha}, a change to the set of graphics
     * or their order, a world-space projection change, or any element whose
     * painted area is unbounded (see `UIBehaviour._drawOverflow`).
     *
     * Turn it off if a custom {@link UIBehaviour} paints outside its rect
     * without reporting how far — the symptom is stale pixels left behind.
     */
    @SerializedField()
    public get partialRepaint(): boolean { return this._partialRepaint; }

    public set partialRepaint(value: boolean) {
        if (this._partialRepaint === value) return;
        this._partialRepaint = value;
        this._dirty = true;
    }

    /**
     * The region redrawn by the most recent repaint, in canvas units, or `null`
     * when the whole surface was redrawn.
     *
     * @remarks
     * Diagnostic: what {@link partialRepaint} actually managed to narrow the
     * last frame to. Read it, never mutate it.
     */
    public get lastRepaintRegion(): Rect | null { return this._region; }

    /**
     * Draw order relative to other canvases. Higher values render on top.
     *
     * @remarks Equivalent to Unity's `Canvas.sortingOrder`.
     */
    @SerializedField()
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
    @SerializedField()
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
     *
     * @remarks
     * Forced to `1` in {@link CanvasRenderMode.WorldSpace}: a world-space canvas
     * has a fixed authored size ({@link worldSize}) and its on-screen scale comes
     * from the projection, so matching the screen resolution would fight it.
     * Unity draws the same line — its scale modes are screen-space only.
     */
    public get scaleFactor(): number { return this._scaleFactor; }

    /** Current canvas width in canvas units. */
    public get width(): number {
        if (this._renderMode === CanvasRenderMode.WorldSpace) return this._worldSize.x;
        return this._scaleFactor > 0 ? this._cssWidth / this._scaleFactor : 0;
    }

    /** Current canvas height in canvas units. */
    public get height(): number {
        if (this._renderMode === CanvasRenderMode.WorldSpace) return this._worldSize.y;
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

    /**
     * @internal
     * Viewport position of the surface's left edge, in CSS pixels. What a DOM
     * element held over a UI element (an `InputField`'s hidden `<input>`) has to
     * offset by, since the overlay is `position: fixed` at the render canvas.
     */
    public get _surfaceLeft(): number {
        return Number.isFinite(this._cssLeft) ? this._cssLeft : 0;
    }

    /** @internal See {@link _surfaceLeft}. */
    public get _surfaceTop(): number {
        return Number.isFinite(this._cssTop) ? this._cssTop : 0;
    }

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
     * @remarks
     * Inverts the same placement the paint pass applies, so a world-space canvas
     * hit-tests exactly where it is drawn.
     *
     * @param point - source point, e.g. `Input.mousePosition`.
     * @param out - vector to receive the result; `point` may be passed here.
     * @returns `out` for chaining.
     */
    public screenToCanvasPoint(point: Vector2, out: Vector2): Vector2 {
        const s = this._baseScale > 0 ? this._baseScale : 1;
        out.x = (point.x - this._baseOffsetX) / s;
        out.y = (point.y - this._baseOffsetY) / s;
        return out;
    }

    /**
     * Converts a point in canvas units to CSS pixels relative to the render
     * canvas — the inverse of {@link screenToCanvasPoint}.
     *
     * @param point - source point in canvas units.
     * @param out - vector to receive the result; `point` may be passed here.
     * @returns `out` for chaining.
     */
    public canvasToScreenPoint(point: Vector2, out: Vector2): Vector2 {
        out.x = point.x * this._baseScale + this._baseOffsetX;
        out.y = point.y * this._baseScale + this._baseOffsetY;
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
        const world = this._renderMode === CanvasRenderMode.WorldSpace;
        const factor = !world && scaler && scaler.isActiveAndEnabled
            ? scaler._computeScaleFactor(this._cssWidth, this._cssHeight, CanvasScaler._screenDPI())
            : 1;

        if (this._scaleFactor !== factor) {
            this._scaleFactor = factor;
            this._dirty = true;
        }
    }

    /**
     * @internal
     * Places the canvas rect on the render surface: identity in overlay mode,
     * the projected anchor in world space.
     *
     * @remarks
     * Runs from `Application._loop` before the event pass, so hit-testing and
     * painting agree within a frame. Idempotent, so a host driving the canvas
     * itself gets the same result by calling nothing at all.
     */
    public _updateBaseTransform(): void {
        if (this._renderMode !== CanvasRenderMode.WorldSpace) {
            this._baseScale = this._scaleFactor;
            this._baseOffsetX = 0;
            this._baseOffsetY = 0;
            this._worldDistance = 0;
            this._projected = true;
            return;
        }

        const camera = this._worldCamera ?? Camera.main;
        const p = this._projScratch;
        const pos = this.gameObject.transform.position;

        if (!camera || !camera._worldToViewportPoint(pos.x, pos.y, pos.z, p)) {
            this._projected = false;
            this._worldDistance = 0;
            return;
        }

        this._projected = true;
        this._worldDistance = p.z;

        // Distance scaling reproduces perspective: the share of the viewport one
        // world unit covers, times the world size of a canvas unit. With it off
        // the canvas keeps a constant pixel size and only its position tracks.
        let scale = 1;
        if (this._distanceScaling) {
            const frustumHeight = camera._frustumHeightAt(p.z);
            const cssPerWorldUnit = frustumHeight > 1e-6 ? this._cssHeight / frustumHeight : 0;
            scale = this._worldScale * cssPerWorldUnit;
        }
        this._baseScale = scale;

        // The anchor lands on worldPivot of the canvas rect, so the rect's
        // origin sits that far back from it.
        this._baseOffsetX = p.x * this._cssWidth - this._worldPivot.x * this._worldSize.x * scale;
        this._baseOffsetY = p.y * this._cssHeight - this._worldPivot.y * this._worldSize.y * scale;
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
        // Placement first: the hash below covers it, and both the cull test and
        // the pointer conversion read it.
        this._updateBaseTransform();

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

        if (onDemand) {
            hash = hashNumber(hash, this._cssWidth);
            hash = hashNumber(hash, this._cssHeight);
            hash = hashNumber(hash, this._scaleFactor);
            hash = hashNumber(hash, this._effectivePixelRatio);
            hash = hashNumber(hash, this._alpha);
            hash = hashNumber(hash, this._graphics.length);

            // A world-space canvas moves with the camera even when nothing in it
            // changed, so the placement is part of what "unchanged" means.
            hash = hashBool(hash, this._projected);
            hash = hashNumber(hash, this._baseScale);
            hash = hashNumber(hash, this._baseOffsetX);
            hash = hashNumber(hash, this._baseOffsetY);
        }

        if (!onDemand) {
            this._dirty = false;
            this._region = null;
            return true;
        }

        // A canvas-level change (a resize, a scaler, the projection, the set of
        // graphics) moves everything at once, so it is never worth localizing.
        let full = this._dirty || hash !== this._lastHash;
        this._lastHash = hash;

        const partial = this._partialRepaint;
        const region = this._regionScratch;
        let regionValid = false;
        let anyChanged = false;

        for (let i = 0; i < this._graphics.length; i++) {
            const g = this._graphics[i];

            if (!g.isActiveAndEnabled) {
                // A graphic that just went away has to have its old area
                // repainted, even though it contributes nothing to draw.
                if (g._repaintValid) {
                    g._repaintValid = false;
                    anyChanged = true;
                    if (regionValid) Canvas._union(region, g._repaintBounds);
                    else { region.copy(g._repaintBounds); regionValid = true; }
                }
                continue;
            }

            // The local rect plus the transform is the element's full
            // placement — the bounds alone would miss a pure rotation.
            const rt = g.rectTransform;
            const local = rt._resolvedLocalRect;
            const m = rt._canvasMatrix;

            let gh = HASH_SEED;
            gh = hashNumber(gh, local.x);
            gh = hashNumber(gh, local.y);
            gh = hashNumber(gh, local.width);
            gh = hashNumber(gh, local.height);
            for (let k = 0; k < 6; k++) gh = hashNumber(gh, m[k]);
            gh = hashNumber(gh, g._groupAlpha());

            const visual = g._visualHash();
            const unknown = Number.isNaN(visual);
            if (!unknown) gh = hashNumber(gh, visual);

            const overflow = g._drawOverflow();
            gh = hashNumber(gh, overflow);

            const changed = unknown || !g._repaintValid || gh !== g._repaintHash;
            if (changed) {
                anyChanged = true;

                // Unbounded elements cannot say where they painted, so there is
                // no region that provably covers them.
                if (!g._allowCulling || !Number.isFinite(overflow)) full = true;
                else if (partial && !full) {
                    if (g._repaintValid) {
                        if (regionValid) Canvas._union(region, g._repaintBounds);
                        else { region.copy(g._repaintBounds); regionValid = true; }
                    }
                    Canvas._inflate(Canvas._boundsScratch, rt._resolvedBounds, overflow + AA_PADDING);
                    if (regionValid) Canvas._union(region, Canvas._boundsScratch);
                    else { region.copy(Canvas._boundsScratch); regionValid = true; }
                }
            }

            g._repaintHash = gh;
            g._repaintValid = true;

            if (Number.isFinite(overflow)) {
                Canvas._inflate(g._repaintBounds, rt._resolvedBounds, overflow + AA_PADDING);
            } else {
                // Unbounded: it may have painted anywhere, so it takes part in
                // every partial redraw. Left unchanged it would be cleared by a
                // region another element dirtied and never drawn back.
                g._repaintBounds.set(-UNBOUNDED_EXTENT, -UNBOUNDED_EXTENT,
                    UNBOUNDED_EXTENT * 2, UNBOUNDED_EXTENT * 2);
            }
        }

        this._dirty = false;

        if (full) {
            this._region = null;
            return true;
        }
        if (!anyChanged) {
            this._region = null;
            return false;
        }
        if (!partial || !regionValid) {
            this._region = null;
            return true;
        }

        // Nothing outside the canvas can be seen, so a change that happened
        // entirely off-screen costs no repaint at all.
        if (!Canvas._intersect(region, this._canvasRect)) {
            this._region = null;
            return false;
        }

        this._region = region;
        return true;
    }

    /** Grows `target` to also contain `other`. */
    private static _union(target: Rect, other: Rect): void {
        const x0 = Math.min(target.x, other.x);
        const y0 = Math.min(target.y, other.y);
        const x1 = Math.max(target.x + target.width, other.x + other.width);
        const y1 = Math.max(target.y + target.height, other.y + other.height);
        target.set(x0, y0, x1 - x0, y1 - y0);
    }

    /** Writes `source` grown by `pad` on every side into `out`. */
    private static _inflate(out: Rect, source: Rect, pad: number): void {
        out.set(
            source.x - pad,
            source.y - pad,
            source.width + pad * 2,
            source.height + pad * 2,
        );
    }

    /** Clips `target` to `bounds`. Returns false when nothing is left. */
    private static _intersect(target: Rect, bounds: Rect): boolean {
        const x0 = Math.max(target.x, bounds.x);
        const y0 = Math.max(target.y, bounds.y);
        const x1 = Math.min(target.x + target.width, bounds.x + bounds.width);
        const y1 = Math.min(target.y + target.height, bounds.y + bounds.height);
        if (x1 <= x0 || y1 <= y0) return false;
        target.set(x0, y0, x1 - x0, y1 - y0);
        return true;
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
        // In world space it also carries the projected placement, so the same
        // single setTransform serves both modes.
        const ratio = this._effectivePixelRatio;
        const s = ratio * this._baseScale;
        const ox = ratio * this._baseOffsetX;
        const oy = ratio * this._baseOffsetY;

        // A partial repaint owns only its region, so everything below — the
        // clear, the cull test and the clip — is expressed against it. Snapped
        // outward to whole device pixels first, or a fractional edge would clear
        // and redraw slightly different pixels and leave a seam.
        const region = this._region;
        if (region !== null && s > 0) {
            Canvas._snapToPixels(region, s, ox, oy);
            ctx.setTransform(s, 0, 0, s, ox, oy);
            ctx.save();
            ctx.beginPath();
            ctx.rect(region.x, region.y, region.width, region.height);
            ctx.clip();
            ctx.clearRect(region.x, region.y, region.width, region.height);
        } else {
            // Cleared in surface space rather than through the transform: a
            // world-space canvas rect covers only part of the surface, and
            // clearing just that part would leave the previous frame's pixels
            // around it.
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._backingWidth, this._backingHeight);
            ctx.setTransform(s, 0, 0, s, ox, oy);
        }

        const clipped = region !== null && s > 0;

        if (this._alpha <= 0 || !this._projected) {
            if (clipped) ctx.restore();
            this._drawnGraphicCount = 0;
            return;
        }
        ctx.globalAlpha = this._alpha;

        // Everything that could paint into the region has to be redrawn, since
        // the region was just cleared — including elements that did not change.
        const visible = clipped ? region! : this._canvasRect;

        let drawn = 0;
        for (let i = 0; i < this._graphics.length; i++) {
            const g = this._graphics[i];
            if (!g.isActiveAndEnabled) continue;

            const rt = g.rectTransform;

            // Against the painted bounds, not the layout ones: an outline or a
            // label reaching into the region has to be drawn back after the
            // clear, even though its rect is outside.
            const bounds = clipped ? g._repaintBounds : rt._resolvedBounds;
            if (g._allowCulling && !bounds.overlaps(visible)) continue;

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
                ctx.setTransform(s, 0, 0, s, ox, oy);
                ctx.transform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]);
                ctx.beginPath();
                ctx.rect(mr.x, mr.y, mr.width, mr.height);
                ctx.clip();
            }
            if (masks.length > 0) ctx.setTransform(s, 0, 0, s, ox, oy);

            // Composes with the canvas-unit transform already on the context, so
            // components keep drawing in their own local rect and inherit the
            // element's rotation and scale without knowing about either.
            ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
            g._draw(ctx, rt._resolvedLocalRect);
            ctx.restore();
            drawn++;
        }

        if (clipped) ctx.restore();
        this._drawnGraphicCount = drawn;
    }

    /**
     * Grows `region` (canvas units) outward until its edges land on whole
     * device pixels under the `scale`/`offset` transform.
     */
    private static _snapToPixels(region: Rect, scale: number, ox: number, oy: number): void {
        const x0 = (Math.floor(region.x * scale + ox) - ox) / scale;
        const y0 = (Math.floor(region.y * scale + oy) - oy) / scale;
        const x1 = (Math.ceil((region.x + region.width) * scale + ox) - ox) / scale;
        const y1 = (Math.ceil((region.y + region.height) * scale + oy) - oy) / scale;
        region.set(x0, y0, x1 - x0, y1 - y0);
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
