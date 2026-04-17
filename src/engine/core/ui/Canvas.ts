import { Behaviour } from "../Behaviour";
import { Application } from "../Application";
import type { UIBehaviour } from "./UIBehaviour";
import type { GameObject } from "../GameObject";

/**
 * Render mode for the Canvas.
 */
export enum CanvasRenderMode {
    /** Renders as a 2D overlay on top of the 3D scene. */
    ScreenSpaceOverlay = "ScreenSpaceOverlay",
    // WorldSpace — planned for a future phase
}

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
 */
export class Canvas extends Behaviour {

    private static _instances: Set<Canvas> = new Set();

    /**
     * @internal
     * Clears and redraws all active canvases.
     * Called from Application._loop after the 3D render pass.
     */
    public static _renderAll(): void {
        for (const c of Canvas._instances) {
            if (c.isActiveAndEnabled) c._renderFrame();
        }
    }

    /** @internal */
    public static _reset(): void {
        // HTML elements are cleaned up in onDestroy of each instance.
        Canvas._instances.clear();
    }

    // ── instance fields ──────────────────────────────────────────────

    private _renderMode: CanvasRenderMode = CanvasRenderMode.ScreenSpaceOverlay;
    private _htmlCanvas: HTMLCanvasElement | null = null;
    private _ctx2d: CanvasRenderingContext2D | null = null;
    private _graphics: UIBehaviour[] = [];
    private _resizeObserver: ResizeObserver | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ── properties ───────────────────────────────────────────────────

    /** How the canvas is rendered relative to the scene. */
    public get renderMode(): CanvasRenderMode { return this._renderMode; }
    public set renderMode(value: CanvasRenderMode) { this._renderMode = value; }

    /** Current canvas width in pixels. */
    public get width(): number { return this._htmlCanvas?.width ?? 0; }

    /** Current canvas height in pixels. */
    public get height(): number { return this._htmlCanvas?.height ?? 0; }

    /** @internal The 2D rendering context. */
    public get _context(): CanvasRenderingContext2D | null { return this._ctx2d; }

    // ── lifecycle ────────────────────────────────────────────────────

    protected override onAwake(): void {
        if (typeof document === "undefined") return;

        this._htmlCanvas = document.createElement("canvas");
        this._ctx2d = this._htmlCanvas.getContext("2d");

        const style = this._htmlCanvas.style;
        style.position = "fixed";
        style.top = "0";
        style.left = "0";
        style.pointerEvents = "none";
        style.zIndex = "1000";

        this._syncSize();

        // Insert after the WebGL canvas so it layers on top.
        const glCanvas = Application.current?.canvas ?? null;
        const container = glCanvas?.parentElement ?? document.body;
        if (glCanvas?.parentElement) {
            glCanvas.parentElement.insertBefore(this._htmlCanvas, glCanvas.nextSibling);
        } else {
            document.body.appendChild(this._htmlCanvas);
        }

        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(() => this._syncSize());
            const target = glCanvas ?? document.documentElement;
            this._resizeObserver.observe(target);
        }
    }

    protected override onEnable(): void {
        Canvas._instances.add(this);
        if (this._htmlCanvas) this._htmlCanvas.style.display = "";
    }

    protected override onDisable(): void {
        Canvas._instances.delete(this);
        if (this._htmlCanvas) this._htmlCanvas.style.display = "none";
    }

    protected override onDestroy(): void {
        Canvas._instances.delete(this);
        this._resizeObserver?.disconnect();
        this._htmlCanvas?.parentElement?.removeChild(this._htmlCanvas);
        this._htmlCanvas = null;
        this._ctx2d = null;
        this._graphics.length = 0;
    }

    // ── internal registration ────────────────────────────────────────

    /** @internal Called by UIBehaviour.onEnable. */
    public _registerGraphic(graphic: UIBehaviour): void {
        if (!this._graphics.includes(graphic)) {
            this._graphics.push(graphic);
            this._sortGraphics();
        }
    }

    /** @internal Called by UIBehaviour.onDisable / onDestroy. */
    public _unregisterGraphic(graphic: UIBehaviour): void {
        const idx = this._graphics.indexOf(graphic);
        if (idx >= 0) this._graphics.splice(idx, 1);
    }

    // ── private ──────────────────────────────────────────────────────

    private _syncSize(): void {
        if (!this._htmlCanvas) return;
        const glCanvas = Application.current?.canvas;
        const w = glCanvas?.clientWidth  ?? window.innerWidth;
        const h = glCanvas?.clientHeight ?? window.innerHeight;
        if (this._htmlCanvas.width !== w || this._htmlCanvas.height !== h) {
            this._htmlCanvas.width  = w;
            this._htmlCanvas.height = h;
            this._htmlCanvas.style.width  = `${w}px`;
            this._htmlCanvas.style.height = `${h}px`;
        }
    }

    private _sortGraphics(): void {
        this._graphics.sort((a, b) => a.sortingOrder - b.sortingOrder);
    }

    private _renderFrame(): void {
        if (!this._ctx2d || !this._htmlCanvas) return;
        this._ctx2d.clearRect(0, 0, this._htmlCanvas.width, this._htmlCanvas.height);
        for (const g of this._graphics) {
            if (!g.isActiveAndEnabled) continue;
            this._ctx2d.save();
            g._draw(this._ctx2d);
            this._ctx2d.restore();
        }
    }
}
