// path: src/engine/core/diagnostics/MemoryProfiler.ts

import { Resources } from "../assets/Resources.ts";

// ==================== TYPES ====================

/**
 * Snapshot of current memory usage across all engine subsystems.
 *
 * All byte values are estimates — exact accounting is impossible
 * in a browser environment due to GPU process separation and
 * Chromium's memory accounting quirks.
 */
export interface MemoryReport {
    /** ISO timestamp when the snapshot was taken. */
    timestamp: string;

    /** JS heap usage from `performance.memory` (Chromium only). */
    jsHeap: {
        /** Bytes currently allocated on the JS heap. */
        used: number;
        /** Total JS heap size including free space. */
        total: number;
        /** Maximum heap size allowed by the browser. */
        limit: number;
    } | null;

    /** Three.js renderer memory counters. */
    renderer: {
        /** Number of WebGLTexture objects alive. */
        textures: number;
        /** Number of WebGLBuffer objects alive (geometry). */
        geometries: number;
    } | null;

    /** Three.js renderer draw call info (last frame). */
    renderStats: {
        /** Draw calls in the last rendered frame. */
        drawCalls: number;
        /** Triangles rendered in the last frame. */
        triangles: number;
    } | null;

    /** Engine Resources cache stats. */
    resources: {
        /** Number of cached assets. */
        cacheEntries: number;
        /** Sum of raw byte sizes passed to decoders (compressed-ish). */
        estimatedBytes: number;
    };

    /** Rough estimate of browser RAM available (navigator.deviceMemory). */
    deviceMemoryGB: number | null;
}

// ==================== MINI-GRAPH ====================

/**
 * @internal
 * Canvas-based scrolling mini-graph in the stats.js style.
 *
 * Each frame the graph self-copies 1px left and draws a new bar
 * on the rightmost column. Header shows current/min/max values.
 *
 * Optimization:
 * - Single `drawImage` for scroll (GPU-composited blit)
 * - Two `fillRect` per frame (clear + bar)
 * - Text redrawn only in header region
 * - Zero allocation in `update()`
 */
class MiniGraph {
    public readonly canvas: HTMLCanvasElement;

    private readonly _ctx: CanvasRenderingContext2D;
    private readonly _fg: string;
    private readonly _bg: string;
    private readonly _name: string;
    private readonly _dpr: number;

    private static readonly _W = 80;
    private static readonly _H = 48;
    private static readonly _TH = 18;
    private static readonly _GH = 30;

    private _min = Infinity;
    private _max = 0;

    constructor(name: string, fg: string, bg: string) {
        this._name = name;
        this._fg = fg;
        this._bg = bg;
        this._dpr = Math.min(window.devicePixelRatio || 1, 2);

        const W = MiniGraph._W;
        const H = MiniGraph._H;

        const c = document.createElement("canvas");
        c.width = W * this._dpr;
        c.height = H * this._dpr;
        c.style.cssText = `width:${W}px;height:${H}px;display:block`;

        const ctx = c.getContext("2d")!;
        ctx.scale(this._dpr, this._dpr);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = fg;
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "top";
        ctx.fillText(name, 3, 2);

        this.canvas = c;
        this._ctx = ctx;
    }

    /** Push a new value. Zero-allocation hot path. */
    public update(value: number, maxScale: number): void {
        if (value < this._min) this._min = value;
        if (value > this._max) this._max = value;

        const ctx = this._ctx;
        const W = MiniGraph._W;
        const TH = MiniGraph._TH;
        const GH = MiniGraph._GH;
        const dpr = this._dpr;

        // Header text
        ctx.fillStyle = this._bg;
        ctx.fillRect(0, 0, W, TH);
        ctx.fillStyle = this._fg;
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "top";
        ctx.fillText(
            `${Math.round(value)} ${this._name} (${Math.round(this._min)}-${Math.round(this._max)})`,
            3, 2
        );

        // Scroll graph 1px left via self-blit
        ctx.drawImage(
            this.canvas,
            1 * dpr, TH * dpr, (W - 1) * dpr, GH * dpr,
            0, TH, W - 1, GH
        );

        // Clear rightmost column, draw new bar
        ctx.fillStyle = this._bg;
        ctx.fillRect(W - 1, TH, 1, GH);

        const barH = Math.round(Math.min(value / maxScale, 1) * GH);
        if (barH > 0) {
            ctx.fillStyle = this._fg;
            ctx.fillRect(W - 1, TH + GH - barH, 1, barH);
        }
    }

    public reset(): void {
        this._min = Infinity;
        this._max = 0;
    }
}

// ==================== OVERLAY STATE ====================

/**
 * @internal
 * All mutable overlay state consolidated into one object.
 * Null when overlay is hidden — avoids scattered module vars.
 */
interface OverlayState {
    root: HTMLDivElement;
    tabs: HTMLDivElement[];
    tabBtns: HTMLSpanElement[];
    activeTab: number;
    statsText: HTMLDivElement;
    memText: HTMLDivElement;
    engText: HTMLDivElement;
    fpsGraph: MiniGraph;
    msGraph: MiniGraph;
    memGraph: MiniGraph;
    rafId: number;
    prevTime: number;
    frames: number;
    fpsUpdateTime: number;
    fps: number;
    textUpdateTime: number;
}

/** @internal */
let _s: OverlayState | null = null;

/** @internal */
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;

/** @internal Shared line buffer — reused every text update to avoid allocation. */
const _L: string[] = [];

// ==================== STYLE CONSTANTS ====================

const _PANEL = "position:fixed;top:8px;left:8px;z-index:99999;"
    + "background:rgba(13,17,23,0.92);border:1px solid rgba(255,255,255,0.08);"
    + "border-radius:6px;font:10px/1.5 'SF Mono',ui-monospace,Consolas,monospace;"
    + "color:#c9d1d9;user-select:none;overflow:hidden;"
    + "backdrop-filter:blur(4px);min-width:260px";

const _HEADER = "padding:4px 8px;background:rgba(255,255,255,0.06);"
    + "cursor:move;font-weight:bold;font-size:10px;color:#58a6ff;"
    + "display:flex;justify-content:space-between;align-items:center;"
    + "border-bottom:1px solid rgba(255,255,255,0.06)";

const _TABBAR = "display:flex;border-bottom:1px solid rgba(255,255,255,0.06);"
    + "background:rgba(0,0,0,0.3)";

const _TAB = "padding:3px 10px;cursor:pointer;font-size:10px;"
    + "border-bottom:2px solid transparent";

const _BODY = "padding:4px 8px 6px;white-space:pre;line-height:1.55;"
    + "font-variant-numeric:tabular-nums;min-height:40px";

// ==================== MEMORY PROFILER ====================

/**
 * Diagnostic utility for monitoring engine performance and memory.
 *
 * Provides console reports, structured snapshots, and a draggable
 * tabbed on-screen overlay with live stats and scrolling mini-graphs.
 *
 * **Tabs:**
 * - **Stats** — FPS/MS/MB graphs + rendering metrics
 *   (mirrors Unity's Game-view Statistics window)
 * - **Memory** — JS heap breakdown, Resources cache, GPU resources,
 *   device info
 * - **Engine** — scene hierarchy counts, cameras, physics objects
 *
 * All methods are static — `MemoryProfiler` is never instantiated.
 *
 * **Optimization guarantees:**
 * - Zero allocation in the per-frame tick (reused `_L` array,
 *   no object literals, no closures created per frame)
 * - Text DOM updates throttled to 500 ms via timestamp comparison
 * - Graphs update per-frame via canvas pixel ops only when the
 *   Stats tab is active (no DOM mutation)
 * - Single `requestAnimationFrame` callback
 * - Input isolation via `stopPropagation` on capture phase
 *
 * @example
 * ```ts
 * import { MemoryProfiler } from "WebEngineTS";
 *
 * // Enable backtick toggle (once at startup)
 * MemoryProfiler.enableToggle();
 *
 * // Or control manually:
 * MemoryProfiler.showOverlay();
 * MemoryProfiler.hideOverlay();
 *
 * // One-shot console report:
 * MemoryProfiler.logReport();
 * ```
 */
export class MemoryProfiler {

    // ==================== SNAPSHOT & LOGGING ====================

    /**
     * Takes a structured snapshot of current memory usage.
     *
     * @returns a {@link MemoryReport} with all available metrics.
     */
    public static snapshot(): MemoryReport {
        return {
            timestamp: new Date().toISOString(),
            jsHeap: MemoryProfiler._getJSHeap(),
            renderer: MemoryProfiler._getRendererMemory(),
            renderStats: MemoryProfiler._getRenderStats(),
            resources: {
                cacheEntries: Resources.cacheSize,
                estimatedBytes: Resources.estimatedMemory,
            },
            deviceMemoryGB: (navigator as any).deviceMemory ?? null,
        };
    }

    /**
     * Logs a formatted memory report to the browser console.
     *
     * Groups metrics by subsystem with human-readable byte formatting.
     */
    public static logReport(): void {
        const r = MemoryProfiler.snapshot();
        const f = MemoryProfiler._fmtB;

        console.group(`%c[MemoryProfiler] ${r.timestamp}`, "color:#4FC3F7;font-weight:bold");

        if (r.jsHeap) {
            console.log(`JS Heap: ${f(r.jsHeap.used)} / ${f(r.jsHeap.total)} (limit: ${f(r.jsHeap.limit)})`);
        } else {
            console.log("JS Heap: N/A (not Chromium)");
        }

        if (r.renderer) {
            console.log(`GPU Textures: ${r.renderer.textures} | Geometries: ${r.renderer.geometries}`);
        } else {
            console.log("Renderer: N/A (no active Application)");
        }

        if (r.renderStats) {
            console.log(`Draw calls: ${r.renderStats.drawCalls} | Triangles: ${r.renderStats.triangles.toLocaleString()}`);
        }

        console.log(`Resources cache: ${r.resources.cacheEntries} assets (~${f(r.resources.estimatedBytes)} raw)`);

        if (r.deviceMemoryGB !== null) console.log(`Device RAM: ~${r.deviceMemoryGB} GB`);

        console.groupEnd();
    }

    // ==================== OVERLAY: SHOW / HIDE / TOGGLE ====================

    /**
     * Shows the live tabbed profiler overlay.
     *
     * Creates a fixed-position DOM panel with:
     * - Draggable header bar
     * - Tab bar: Stats / Memory / Engine
     * - Three scrolling mini-graphs (FPS, MS, MB) on the Stats tab
     * - Detailed text metrics on each tab
     *
     * Idempotent — calling while already visible is a no-op.
     */
    public static showOverlay(): void {
        if (_s) return;

        // ── Root ──
        const root = _el("div", _PANEL);
        root.id = "webengine-profiler";

        // ── Header ──
        const header = _el("div", _HEADER);
        header.textContent = "⚡ WebEngineTS Profiler";
        const closeBtn = _el("span", "cursor:pointer;opacity:0.5;font-size:12px;padding:0 2px");
        closeBtn.textContent = "✕";
        closeBtn.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            MemoryProfiler.hideOverlay();
        });
        header.appendChild(closeBtn);
        root.appendChild(header);

        // ── Tab bar ──
        const bar = _el("div", _TABBAR);
        const names = ["Stats", "Memory", "Engine"];
        const btns: HTMLSpanElement[] = [];
        const tabs: HTMLDivElement[] = [];

        for (let i = 0; i < 3; i++) {
            const b = _el("span", _TAB) as HTMLSpanElement;
            b.textContent = names[i];
            b.dataset.i = String(i);
            b.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                MemoryProfiler._setTab(Number((e.currentTarget as HTMLElement).dataset.i));
            });
            bar.appendChild(b);
            btns.push(b);
        }
        root.appendChild(bar);

        // ── Tab 0: Stats ──
        const t0 = _el("div", "");
        const fG = new MiniGraph("FPS", "#0ff", "#002");
        const mG = new MiniGraph("MS", "#0f0", "#020");
        const hG = new MiniGraph("MB", "#f0f", "#201");
        const gBox = _el("div", "display:flex;gap:2px;padding:4px");
        gBox.appendChild(fG.canvas);
        gBox.appendChild(mG.canvas);
        gBox.appendChild(hG.canvas);
        t0.appendChild(gBox);
        const st = _el("div", _BODY);
        t0.appendChild(st);
        root.appendChild(t0);
        tabs.push(t0 as HTMLDivElement);

        // ── Tab 1: Memory ──
        const t1 = _el("div", "display:none");
        const mt = _el("div", _BODY);
        t1.appendChild(mt);
        root.appendChild(t1);
        tabs.push(t1 as HTMLDivElement);

        // ── Tab 2: Engine ──
        const t2 = _el("div", "display:none");
        const et = _el("div", _BODY);
        t2.appendChild(et);
        root.appendChild(t2);
        tabs.push(t2 as HTMLDivElement);

        // ── Input isolation (capture phase) ──
        const stop = (e: Event) => e.stopPropagation();
        for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "keyup"] as const) {
            root.addEventListener(ev, stop, true);
        }

        // ── Drag ──
        MemoryProfiler._drag(root, header);

        // ── Mount ──
        document.body.appendChild(root);

        const now = performance.now();
        _s = {
            root,
            tabs,
            tabBtns: btns,
            activeTab: 0,
            statsText: st as HTMLDivElement,
            memText: mt as HTMLDivElement,
            engText: et as HTMLDivElement,
            fpsGraph: fG,
            msGraph: mG,
            memGraph: hG,
            rafId: 0,
            prevTime: now,
            frames: 0,
            fpsUpdateTime: now,
            fps: 0,
            textUpdateTime: 0,
        };

        MemoryProfiler._setTab(0);
        MemoryProfiler._tick();
    }

    /**
     * Hides the profiler overlay and releases all DOM resources.
     */
    public static hideOverlay(): void {
        if (!_s) return;
        if (_s.rafId) cancelAnimationFrame(_s.rafId);
        _s.root.remove();
        _s = null;
    }

    /**
     * Toggles the overlay on or off.
     */
    public static toggleOverlay(): void {
        _s ? MemoryProfiler.hideOverlay() : MemoryProfiler.showOverlay();
    }

    /**
     * Whether the overlay is currently visible.
     */
    public static get isOverlayVisible(): boolean {
        return _s !== null;
    }

    // ==================== KEYBOARD TOGGLE ====================

    /**
     * Registers a global keyboard listener that toggles the overlay
     * when the **backtick** key (`` ` ``) is pressed.
     *
     * Call once at engine startup. Idempotent.
     *
     * @remarks
     * Ignores key events originating from `<input>`, `<textarea>`,
     * or `contentEditable` elements.
     */
    public static enableToggle(): void {
        if (_keyHandler) return;
        _keyHandler = (e: KeyboardEvent) => {
            if (e.repeat || e.code !== "Backquote") return;
            const t = e.target as HTMLElement;
            if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
            e.preventDefault();
            MemoryProfiler.toggleOverlay();
        };
        document.addEventListener("keydown", _keyHandler);
    }

    /**
     * Removes the keyboard toggle listener.
     */
    public static disableToggle(): void {
        if (!_keyHandler) return;
        document.removeEventListener("keydown", _keyHandler);
        _keyHandler = null;
    }

    // ==================== PRIVATE: TAB SWITCHING ====================

    /** @internal */
    private static _setTab(i: number): void {
        if (!_s) return;
        _s.activeTab = i;
        for (let k = 0; k < 3; k++) {
            _s.tabs[k].style.display = k === i ? "" : "none";
            _s.tabBtns[k].style.borderBottomColor = k === i ? "#58a6ff" : "transparent";
            _s.tabBtns[k].style.color = k === i ? "#58a6ff" : "#8b949e";
        }
        _s.textUpdateTime = 0; // force immediate text refresh
    }

    // ==================== PRIVATE: DATA ACCESS ====================

    /** @internal */
    private static _getJSHeap(): MemoryReport["jsHeap"] {
        const m = (performance as any).memory;
        if (!m) return null;
        return { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit };
    }

    /** @internal */
    private static _getRendererMemory(): MemoryReport["renderer"] {
        const info = MemoryProfiler._info();
        if (!info?.memory) return null;
        return { textures: info.memory.textures ?? 0, geometries: info.memory.geometries ?? 0 };
    }

    /** @internal */
    private static _getRenderStats(): MemoryReport["renderStats"] {
        const info = MemoryProfiler._info();
        if (!info?.render) return null;
        return { drawCalls: info.render.calls ?? 0, triangles: info.render.triangles ?? 0 };
    }

    /** @internal Raw Three.js renderer.info — single access point. */
    private static _info(): any {
        return (globalThis as any).__webengine_application__?._threeRenderer?.info ?? null;
    }

    /** @internal Raw Three.js renderer. */
    private static _renderer(): any {
        return (globalThis as any).__webengine_application__?._threeRenderer ?? null;
    }

    /** @internal Canvas element from the Application. */
    private static _canvas(): HTMLCanvasElement | null {
        return (globalThis as any).__webengine_application__?.canvas ?? null;
    }

    /**
     * @internal
     * Scene access via SceneManager. Requires a `__webengine_scene_manager__`
     * global to be set by SceneManager (same pattern as Application).
     *
     * If the global is not set, this returns `null` — the Engine tab
     * will show "N/A" until the prerequisite patch is applied.
     */
    private static _scene(): any {
        return (globalThis as any).__webengine_scene_manager__?.activeScene ?? null;
    }

    // ==================== PRIVATE: TICK ====================

    /**
     * @internal
     * Per-frame tick. Graphs every frame (active tab only),
     * text every 500 ms. Zero allocation.
     */
    private static _tick(): void {
        if (!_s) return;

        const now = performance.now();
        const dt = now - _s.prevTime;
        _s.prevTime = now;

        // ── FPS counter (500 ms rolling window) ──
        _s.frames++;
        const fpsElapsed = now - _s.fpsUpdateTime;
        if (fpsElapsed >= 500) {
            _s.fps = (_s.frames / fpsElapsed) * 1000;
            _s.frames = 0;
            _s.fpsUpdateTime = now;
        }

        // ── Graphs (only on Stats tab) ──
        if (_s.activeTab === 0) {
            _s.fpsGraph.update(_s.fps, 120);
            _s.msGraph.update(dt, 50);
            const m = (performance as any).memory;
            if (m) {
                _s.memGraph.update(m.usedJSHeapSize / 1048576, m.totalJSHeapSize / 1048576);
            }
        }

        // ── Text (throttled 500 ms) ──
        if (now - _s.textUpdateTime >= 500) {
            _s.textUpdateTime = now;
            switch (_s.activeTab) {
                case 0: MemoryProfiler._statsTab(); break;
                case 1: MemoryProfiler._memTab(); break;
                case 2: MemoryProfiler._engTab(); break;
            }
        }

        _s.rafId = requestAnimationFrame(MemoryProfiler._tick);
    }

    // ==================== PRIVATE: TAB RENDERERS ====================

    /**
     * @internal
     * Tab 0 — Stats. Mirrors Unity's Game-view Statistics panel.
     * Metrics marked with "—" have TODO comments explaining why.
     */
    private static _statsTab(): void {
        if (!_s) return;
        const f = MemoryProfiler._fmtB;
        const n = MemoryProfiler._fmtN;
        const info = MemoryProfiler._info();
        const canvas = MemoryProfiler._canvas();

        _L.length = 0;

        // ── Graphics ──
        const fps = _s.fps;
        const ms = fps > 0 ? 1000 / fps : 0;
        _L.push(`Graphics:      ${fps.toFixed(1)} FPS (${ms.toFixed(1)}ms)`);

        // Unity shows "CPU: main Xms  render thread Yms".
        // Browser JS is single-threaded — we can only show total frame time.
        // TODO: Per-subsystem timing via Profiler.beginSample/endSample markers
        //       in the engine loop (Physics, Update, LateUpdate, Render).
        _L.push(`CPU: main ${ms.toFixed(1)}ms  render thread —`);

        if (info) {
            const dc = info.render?.calls ?? 0;
            // TODO: "Saved by batching" — requires a draw-call batching/
            //       instancing system in the renderer.
            _L.push(`Batches: ${dc}      Saved by batching: —`);

            const tri = info.render?.triangles ?? 0;
            // TODO: Vertex count — Three.js renderer.info tracks only triangles.
            //       Counting verts requires iterating all rendered geometry
            //       attributes, which is too expensive per-frame.
            //       Alternative: accumulate in MeshRenderer._syncToThree().
            _L.push(`Tris: ${n(tri)}   Verts: —`);
        } else {
            _L.push(`Batches: —      Saved by batching: —`);
            _L.push(`Tris: —    Verts: —`);
        }

        // ── Screen ──
        if (canvas) {
            const w = canvas.width;
            const h = canvas.height;
            const pr = window.devicePixelRatio || 1;
            // Rough framebuffer VRAM: w*h*4 (color RGBA) + w*h*4 (depth+stencil)
            const fbBytes = w * h * 8;
            _L.push(`Screen: ${Math.round(w / pr)}x${Math.round(h / pr)} @${pr.toFixed(1)}x ~${f(fbBytes)}`);
        }

        if (info) {
            // SetPass ≈ number of distinct shader programs used
            const progs = info.programs?.length ?? 0;
            // TODO: Shadow casters count — requires a static shadow-caster
            //       registry in the Light base class or ShadowMap system.
            _L.push(`SetPass calls: ${progs}  Shadow casters: —`);
            _L.push(`Textures: ${info.memory?.textures ?? 0}   Geometries: ${info.memory?.geometries ?? 0}`);
        }

        // TODO: Visible skinned meshes — requires SkinnedMeshRenderer component.
        _L.push(`Visible skinned meshes: —`);

        // TODO: Animation / Animator components — requires Animation system.
        _L.push(`Animation components playing: —`);
        _L.push(`Animator components playing: —`);

        _L.push(``);
        // TODO: Audio subsystem — Level (dB), DSP load, Clipping, Stream load.
        //       Requires AudioSource/AudioListener components and Web Audio API
        //       integration with AnalyserNode for level metering.
        _L.push(`Audio:`);
        _L.push(`  Level: —          DSP load: —`);
        _L.push(`  Clipping: —       Stream load: —`);

        _s.statsText.textContent = _L.join("\n");
    }

    /**
     * @internal
     * Tab 1 — Memory.
     */
    private static _memTab(): void {
        if (!_s) return;
        const f = MemoryProfiler._fmtB;
        const m = (performance as any).memory;
        const info = MemoryProfiler._info();

        _L.length = 0;

        _L.push(`─── JS Heap (Chromium only) ───`);
        if (m) {
            const pct = ((m.usedJSHeapSize / m.totalJSHeapSize) * 100).toFixed(1);
            _L.push(`Used:  ${f(m.usedJSHeapSize)} (${pct}%)`);
            _L.push(`Total: ${f(m.totalJSHeapSize)}`);
            _L.push(`Limit: ${f(m.jsHeapSizeLimit)}`);
        } else {
            _L.push(`N/A — not a Chromium browser`);
        }

        _L.push(``);
        _L.push(`─── Resources Cache ───`);
        _L.push(`Assets cached: ${Resources.cacheSize}`);
        _L.push(`Est. raw size: ${f(Resources.estimatedMemory)}`);

        _L.push(``);
        _L.push(`─── GPU Resources ───`);
        if (info?.memory) {
            _L.push(`Textures:        ${info.memory.textures}`);
            _L.push(`Geometries:      ${info.memory.geometries}`);
        } else {
            _L.push(`N/A — no renderer`);
        }
        _L.push(`Shader programs: ${info?.programs?.length ?? "—"}`);

        // TODO: Per-texture VRAM estimate — track width*height*bpp*mipmaps
        //       in Texture2D instances and expose a static sum.
        //       Also track Cubemap face sizes.
        _L.push(`Est. texture VRAM: —`);

        _L.push(``);
        _L.push(`─── Device ───`);
        const devMem = (navigator as any).deviceMemory;
        _L.push(`RAM:   ${devMem ? `~${devMem} GB` : "N/A"}`);
        _L.push(`Cores: ${navigator.hardwareConcurrency ?? "N/A"}`);

        // GPU model via WEBGL_debug_renderer_info
        const r = MemoryProfiler._renderer();
        if (r) {
            const gl = r.getContext?.() as WebGL2RenderingContext | null;
            if (gl) {
                const ext = gl.getExtension("WEBGL_debug_renderer_info");
                if (ext) {
                    const gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
                    _L.push(`GPU:   ${gpu}`);
                } else {
                    _L.push(`GPU:   N/A (ext unavailable)`);
                }
            }
        }

        _s.memText.textContent = _L.join("\n");
    }

    /**
     * @internal
     * Tab 2 — Engine.
     *
     * Requires `__webengine_scene_manager__` global to be set by
     * SceneManager (prerequisite: add one line to SceneManager constructor).
     */
    private static _engTab(): void {
        if (!_s) return;

        _L.length = 0;

        // ── Scene ──
        _L.push(`─── Scene ───`);
        const scene = MemoryProfiler._scene();
        if (scene) {
            _L.push(`GameObjects: ${scene.gameObjectCount ?? "—"}`);
            _L.push(`Root objects: ${scene.rootCount ?? "—"}`);
        } else {
            // Prerequisite: SceneManager must expose itself via global.
            // Add to SceneManager._createScene() or static initializer:
            //   (globalThis as any).__webengine_scene_manager__ = SceneManager;
            _L.push(`N/A — SceneManager global not set`);
            _L.push(`(add __webengine_scene_manager__ global)`);
        }

        // TODO: Total Component count — add a static counter in
        //       Component.constructor (increment) and Component.onDestroy (decrement).
        _L.push(`Components: —`);

        _L.push(``);
        _L.push(`─── Cameras ───`);
        // TODO: Camera needs a __webengine_cameras__ global or
        //       read Camera.allCameras via the existing import-free pattern.
        //       Prerequisite: add to Camera class:
        //         (globalThis as any).__webengine_cameras__ = Camera._activeCameras;
        _L.push(`Active cameras: —`);

        _L.push(``);
        _L.push(`─── Lights ───`);
        // TODO: Add a static Light._activeLights registry and expose count.
        _L.push(`Active lights: —`);

        _L.push(``);
        _L.push(`─── Physics ───`);
        // TODO: Expose Physics._bodies.size and Physics._colliders.size
        //       via a __webengine_physics__ global or static getters.
        _L.push(`Rigidbodies: —`);
        _L.push(`Colliders: —`);
        // TODO: Physics broadphase pair count, active contacts.

        _s.engText.textContent = _L.join("\n");
    }

    // ==================== PRIVATE: DRAG ====================

    /**
     * @internal
     * Pointer Events drag with `setPointerCapture`.
     * Only the header handle is draggable.
     */
    private static _drag(panel: HTMLElement, handle: HTMLElement): void {
        let on = false, ox = 0, oy = 0;

        handle.addEventListener("pointerdown", (e: PointerEvent) => {
            if (e.button !== 0) return;
            on = true;
            const r = panel.getBoundingClientRect();
            ox = e.clientX - r.left;
            oy = e.clientY - r.top;
            handle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        handle.addEventListener("pointermove", (e: PointerEvent) => {
            if (!on) return;
            panel.style.left = `${Math.max(0, Math.min(e.clientX - ox, innerWidth - panel.offsetWidth))}px`;
            panel.style.top = `${Math.max(0, Math.min(e.clientY - oy, innerHeight - panel.offsetHeight))}px`;
        });

        handle.addEventListener("pointerup", () => { on = false; });
        handle.addEventListener("lostpointercapture", () => { on = false; });
        handle.addEventListener("dragstart", (e) => e.preventDefault());
    }

    // ==================== PRIVATE: FORMATTERS ====================

    /** @internal Human-readable bytes. */
    private static _fmtB(bytes: number): string {
        if (bytes === 0) return "0 B";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
        return `${(bytes / 1073741824).toFixed(2)} GB`;
    }

    /** @internal 1234 → "1.2K", 1234567 → "1.2M" */
    private static _fmtN(n: number): string {
        if (n < 1000) return String(n);
        if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
        return `${(n / 1000000).toFixed(1)}M`;
    }

    /** @internal Static-only class. */
    private constructor() {}
}

// ==================== HELPER ====================

/** @internal Create a typed DOM element with inline styles. */
function _el(tag: string, css: string): HTMLDivElement {
    const e = document.createElement(tag) as HTMLDivElement;
    if (css) e.style.cssText = css;
    return e;
}