import { Behaviour } from "../Behaviour";
import { Application } from "../Application";
import { RectTransform } from "./RectTransform";
import { CanvasScaler } from "./CanvasScaler";
import { Rect } from "../math/Rect";
import { HASH_SEED, hashBool, hashNumber } from "./UIUtils";
import type { UIBehaviour } from "./UIBehaviour";
import type { GameObject } from "../GameObject";
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

    /** @internal */
    public static _reset(): void {
        // HTML elements are cleaned up in onDestroy of each instance.
        Canvas._instances.length = 0;
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

    /** Scratch layout rects, one slot per entry in {@link _graphics}. */
    private _rects: Rect[] = [];
    private readonly _canvasRect: Rect = new Rect();

    private _cssWidth: number = 0;
    private _cssHeight: number = 0;
    private _cssLeft: number = Number.NaN;
    private _cssTop: number = Number.NaN;
    private _scaleFactor: number = 1;
    private _effectivePixelRatio: number = 1;

    private _sortDirty: boolean = false;
    private _dirty: boolean = true;
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

        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(() => this._syncSurface());
            this._resizeObserver.observe(glCanvas ?? document.documentElement);
        }

        if (typeof window !== "undefined") {
            this._scrollHandler = () => this._syncSurface();
            window.addEventListener("scroll", this._scrollHandler, { passive: true });
        }
    }

    protected override onEnable(): void {
        if (!Canvas._instances.includes(this)) {
            Canvas._instances.push(this);
            Canvas._orderDirty = true;
        }
        this._dirty = true;
        if (this._htmlCanvas) this._htmlCanvas.style.display = "";
    }

    protected override onDisable(): void {
        const idx = Canvas._instances.indexOf(this);
        if (idx >= 0) Canvas._instances.splice(idx, 1);
        if (this._htmlCanvas) this._htmlCanvas.style.display = "none";
    }

    protected override onDestroy(): void {
        const idx = Canvas._instances.indexOf(this);
        if (idx >= 0) Canvas._instances.splice(idx, 1);

        this._resizeObserver?.disconnect();
        this._resizeObserver = null;

        if (this._scrollHandler && typeof window !== "undefined") {
            window.removeEventListener("scroll", this._scrollHandler);
        }
        this._scrollHandler = null;

        this._htmlCanvas?.parentElement?.removeChild(this._htmlCanvas);
        this._htmlCanvas = null;
        this._ctx2d = null;
        this._graphics.length = 0;
        this._rects.length = 0;
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

        this._syncSurface();

        this._repaintedLastFrame = this._prepare();
        if (this._repaintedLastFrame) this._paint();
    }

    /**
     * Refreshes layout rects and decides whether a repaint is required.
     * @returns true when the surface must be redrawn this frame.
     */
    private _prepare(): boolean {
        if (this._sortDirty) {
            // Array.prototype.sort is stable, so equal orders keep registration
            // order — which follows the hierarchy for a normally-built UI.
            this._graphics.sort((a, b) => a.sortingOrder - b.sortingOrder);
            this._sortDirty = false;
        }

        this._revalidateParents();

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

            const rect = this._rectAt(i);
            g.rectTransform.getScreenRect(rect);

            if (onDemand) {
                hash = hashNumber(hash, rect.x);
                hash = hashNumber(hash, rect.y);
                hash = hashNumber(hash, rect.width);
                hash = hashNumber(hash, rect.height);

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
            g._revalidateCanvas();
        }
    }

    private _paint(): void {
        const ctx = this._ctx2d;
        if (!ctx) return;

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

            const rect = this._rectAt(i);
            if (g._allowCulling && !rect.overlaps(this._canvasRect)) continue;

            ctx.save();
            g._draw(ctx, rect);
            ctx.restore();
            drawn++;
        }

        this._drawnGraphicCount = drawn;
    }

    private _rectAt(index: number): Rect {
        let r = this._rects[index];
        if (!r) {
            r = new Rect();
            this._rects[index] = r;
        }
        return r;
    }

    private _applyZIndex(): void {
        if (this._htmlCanvas) {
            this._htmlCanvas.style.zIndex = `${BASE_Z_INDEX + this._sortingOrder}`;
        }
    }
}

// Break the Canvas ↔ RectTransform circular import at module-load.
RectTransform._registerCanvasCtor(Canvas as unknown as new (...args: any[]) => Canvas & { width: number; height: number });
