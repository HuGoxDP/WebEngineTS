// path: src/engine/core/diagnostics/MemoryProfiler.ts

import { Resources } from "../assets/Resources.ts";
import { EngineObject, type EngineObjectConstructor } from "../EngineObject.ts";
import { Texture } from "../graphics/Texture.ts";
import { Cubemap } from "../graphics/Cubemap.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { profilerHooks } from "./ProfilerHooks.ts";

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
        used: number;
        total: number;
        limit: number;
    } | null;

    /** Three.js renderer memory counters. */
    renderer: {
        textures: number;
        geometries: number;
        /**
         * Estimated VRAM occupied by all live engine textures (2D + cubemaps),
         * in bytes. Accounts for KTX2/Basis compression, so the compressed-vs-
         * uncompressed difference is visible — unlike the JS-heap metric. This
         * is an estimate and an upper bound: it counts every live engine texture
         * whether or not it is currently uploaded to the GPU, and excludes
         * render targets (shadow maps, post-processing buffers).
         */
        estimatedTextureVramBytes: number;
        /**
         * Estimated VRAM occupied by all live mesh vertex + index buffers, in
         * bytes. An estimate: counts every live engine {@link Mesh} whether or
         * not it is currently uploaded to the GPU.
         */
        estimatedGeometryVramBytes: number;
    } | null;

    /** Three.js renderer draw call info (last frame). */
    renderStats: {
        drawCalls: number;
        triangles: number;
    } | null;

    /** Engine Resources cache stats. */
    resources: {
        cacheEntries: number;
        estimatedBytes: number;
    };

    /** Rough estimate of browser RAM available (navigator.deviceMemory). */
    deviceMemoryGB: number | null;

    /**
     * Main-thread (CPU) time in ms spent in the last frame's loop body (the busy
     * portion, excluding idle/VSync wait). `null` when no Application is running.
     * Browsers cannot report OS-level CPU%; this is the meaningful load metric.
     */
    cpuFrameMs: number | null;

    /**
     * Unmasked GPU renderer string (via `WEBGL_debug_renderer_info`), e.g.
     * "NVIDIA GeForce RTX 3050..." or "Intel(R) UHD Graphics". `null` if no
     * renderer or the extension is unavailable. Lets a run record which GPU
     * served it — essential for cross-device benchmarking.
     */
    gpu: string | null;
}

// ==================== MINI-GRAPH ====================

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

    public update(value: number, maxScale: number): void {
        if (value < this._min) this._min = value;
        if (value > this._max) this._max = value;

        const ctx = this._ctx;
        const W = MiniGraph._W;
        const TH = MiniGraph._TH;
        const GH = MiniGraph._GH;
        const dpr = this._dpr;

        ctx.fillStyle = this._bg;
        ctx.fillRect(0, 0, W, TH);
        ctx.fillStyle = this._fg;
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "top";
        ctx.fillText(
            `${Math.round(value)} ${this._name} (${Math.round(this._min)}-${Math.round(this._max)})`,
            3, 2
        );

        ctx.drawImage(
            this.canvas,
            1 * dpr, TH * dpr, (W - 1) * dpr, GH * dpr,
            0, TH, W - 1, GH
        );

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

let _s: OverlayState | null = null;
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;
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
 * - **Stats** — FPS/MS/MB graphs + rendering & audio metrics
 * - **Memory** — JS heap, Resources cache, GPU resources, device info
 * - **Engine** — scene hierarchy, cameras, lights, physics, animation, audio
 *
 * @example
 * ```ts
 * import { MemoryProfiler } from "WebEngineTS";
 * MemoryProfiler.enableToggle();   // backtick to toggle
 * MemoryProfiler.showOverlay();    // or manually
 * MemoryProfiler.logReport();      // one-shot console dump
 * ```
 */
export class MemoryProfiler {

    // ==================== SNAPSHOT & LOGGING ====================

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
            cpuFrameMs: MemoryProfiler._getCpuFrameMs(),
            gpu: MemoryProfiler._getGpuName(),
        };
    }

    /** Main-thread frame time from the active Application, or null. */
    private static _getCpuFrameMs(): number | null {
        const app = (globalThis as any).__webengine_application__;
        return app != null && typeof app._cpuFrameMs === "number" ? app._cpuFrameMs : null;
    }

    /** Unmasked GPU renderer string via WEBGL_debug_renderer_info, or null. */
    private static _getGpuName(): string | null {
        const r = MemoryProfiler._renderer();
        const gl = r?.getContext?.() as WebGL2RenderingContext | null;
        if (!gl) return null;
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (!ext) return null;
        return (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) ?? null;
    }

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
            console.log(
                `Est. VRAM: ~${f(r.renderer.estimatedTextureVramBytes)} textures`
                + ` + ~${f(r.renderer.estimatedGeometryVramBytes)} geometry`
                + ` = ~${f(r.renderer.estimatedTextureVramBytes + r.renderer.estimatedGeometryVramBytes)}`
            );
        } else {
            console.log("Renderer: N/A (no active Application)");
        }

        if (r.renderStats) {
            console.log(`Draw calls: ${r.renderStats.drawCalls} | Triangles: ${r.renderStats.triangles.toLocaleString()}`);
        }

        console.log(`Resources cache: ${r.resources.cacheEntries} assets (~${f(r.resources.estimatedBytes)} raw)`);

        if (r.deviceMemoryGB !== null) console.log(`Device RAM: ~${r.deviceMemoryGB} GB`);
        if (r.cpuFrameMs !== null) console.log(`CPU main-thread: ${r.cpuFrameMs.toFixed(1)} ms/frame`);
        if (r.gpu !== null) console.log(`GPU: ${r.gpu}`);

        // Subsystem counts
        const h = profilerHooks;
        console.log(`Cameras: ${h.cameraCount?.() ?? "—"} | Lights: ${h.lightCount?.() ?? "—"}`);
        console.log(`Rigidbodies: ${h.rigidbodyCount?.() ?? "—"} | Colliders: ${h.colliderCount?.() ?? "—"}`);
        console.log(`Animations: ${h.animationPlayingCount?.() ?? "—"} | AudioSources: ${h.audioSourceCount?.() ?? "—"}`);

        console.groupEnd();
    }

    // ==================== OVERLAY: SHOW / HIDE / TOGGLE ====================

    public static showOverlay(): void {
        if (_s) return;

        const root = _el("div", _PANEL);
        root.id = "webengine-profiler";

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

        // Tab 0: Stats
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

        // Tab 1: Memory
        const t1 = _el("div", "display:none");
        const mt = _el("div", _BODY);
        t1.appendChild(mt);
        root.appendChild(t1);
        tabs.push(t1 as HTMLDivElement);

        // Tab 2: Engine
        const t2 = _el("div", "display:none");
        const et = _el("div", _BODY);
        t2.appendChild(et);
        root.appendChild(t2);
        tabs.push(t2 as HTMLDivElement);

        // Stop pointer/wheel events from bubbling to the game canvas.
        // MUST use bubble phase so child handlers (tabs, close, drag) fire first.
        // keydown/keyup are NOT stopped — otherwise the backtick toggle breaks.
        const stop = (e: Event) => e.stopPropagation();
        for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel"] as const) {
            root.addEventListener(ev, stop);
        }

        MemoryProfiler._drag(root, header);
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

    public static hideOverlay(): void {
        if (!_s) return;
        if (_s.rafId) cancelAnimationFrame(_s.rafId);
        _s.root.remove();
        _s = null;
    }

    public static toggleOverlay(): void {
        _s ? MemoryProfiler.hideOverlay() : MemoryProfiler.showOverlay();
    }

    public static get isOverlayVisible(): boolean {
        return _s !== null;
    }

    // ==================== KEYBOARD TOGGLE ====================

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

    public static disableToggle(): void {
        if (!_keyHandler) return;
        document.removeEventListener("keydown", _keyHandler);
        _keyHandler = null;
    }

    // ==================== PRIVATE: TAB SWITCHING ====================

    private static _setTab(i: number): void {
        if (!_s) return;
        _s.activeTab = i;
        for (let k = 0; k < 3; k++) {
            _s.tabs[k].style.display = k === i ? "" : "none";
            _s.tabBtns[k].style.borderBottomColor = k === i ? "#58a6ff" : "transparent";
            _s.tabBtns[k].style.color = k === i ? "#58a6ff" : "#8b949e";
        }
        _s.textUpdateTime = 0;
    }

    // ==================== PRIVATE: DATA ACCESS ====================

    private static _getJSHeap(): MemoryReport["jsHeap"] {
        const m = (performance as any).memory;
        if (!m) return null;
        return { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit };
    }

    private static _getRendererMemory(): MemoryReport["renderer"] {
        const info = MemoryProfiler._info();
        if (!info?.memory) return null;
        return {
            textures: info.memory.textures ?? 0,
            geometries: info.memory.geometries ?? 0,
            estimatedTextureVramBytes: MemoryProfiler._estimateTextureVram(),
            estimatedGeometryVramBytes: MemoryProfiler._estimateGeometryVram(),
        };
    }

    /**
     * Sums the estimated VRAM of every live engine mesh's vertex/index buffers.
     */
    private static _estimateGeometryVram(): number {
        let total = 0;
        for (const m of EngineObject.FindObjectsOfType(Mesh)) {
            total += m._estimateVramBytes();
        }
        return total;
    }

    /**
     * Sums the estimated VRAM of every live engine texture. Texture2D and any
     * other {@link Texture} subclass are enumerated via the EngineObject
     * registry; {@link Cubemap} extends EngineObject directly and is summed
     * separately (the skybox is often the single largest texture in a scene).
     */
    private static _estimateTextureVram(): number {
        let total = 0;
        for (const t of EngineObject.FindObjectsOfType(Texture)) {
            total += t._estimateVramBytes();
        }
        // Cubemap has a private constructor, so it does not satisfy the
        // EngineObjectConstructor signature; FindObjectsOfType only uses it for
        // a runtime `instanceof` check, which works regardless. Cast is safe.
        const cubemapCtor = Cubemap as unknown as EngineObjectConstructor<Cubemap>;
        for (const c of EngineObject.FindObjectsOfType(cubemapCtor)) {
            total += c._estimateVramBytes();
        }
        return total;
    }

    private static _getRenderStats(): MemoryReport["renderStats"] {
        const info = MemoryProfiler._info();
        if (!info?.render) return null;
        return { drawCalls: info.render.calls ?? 0, triangles: info.render.triangles ?? 0 };
    }

    private static _info(): any {
        return (globalThis as any).__webengine_application__?._threeRenderer?.info ?? null;
    }

    private static _renderer(): any {
        return (globalThis as any).__webengine_application__?._threeRenderer ?? null;
    }

    private static _canvas(): HTMLCanvasElement | null {
        return (globalThis as any).__webengine_application__?.canvas ?? null;
    }

    private static _scene(): any {
        return (globalThis as any).__webengine_scene_manager__?.activeScene ?? null;
    }

    // ==================== PRIVATE: TICK ====================

    private static _tick(): void {
        if (!_s) return;

        const now = performance.now();
        const dt = now - _s.prevTime;
        _s.prevTime = now;

        _s.frames++;
        const fpsElapsed = now - _s.fpsUpdateTime;
        if (fpsElapsed >= 500) {
            _s.fps = (_s.frames / fpsElapsed) * 1000;
            _s.frames = 0;
            _s.fpsUpdateTime = now;
        }

        if (_s.activeTab === 0) {
            _s.fpsGraph.update(_s.fps, 120);
            _s.msGraph.update(dt, 50);
            const m = (performance as any).memory;
            if (m) {
                _s.memGraph.update(m.usedJSHeapSize / 1048576, m.totalJSHeapSize / 1048576);
            }
        }

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

    private static _statsTab(): void {
        if (!_s) return;
        const f = MemoryProfiler._fmtB;
        const n = MemoryProfiler._fmtN;
        const info = MemoryProfiler._info();
        const canvas = MemoryProfiler._canvas();
        const h = profilerHooks;

        _L.length = 0;

        // ── Graphics ──
        const fps = _s.fps;
        const ms = fps > 0 ? 1000 / fps : 0;
        _L.push(`Graphics:      ${fps.toFixed(1)} FPS (${ms.toFixed(1)}ms)`);

        const cpu = MemoryProfiler._getCpuFrameMs();
        if (cpu !== null) {
            const load = ms > 0 ? Math.min(100, (cpu / ms) * 100) : 0;
            _L.push(`CPU: main ${cpu.toFixed(1)}ms (${load.toFixed(0)}% of frame)`);
        } else {
            _L.push(`CPU: main —`);
        }

        if (info) {
            const dc = info.render?.calls ?? 0;
            _L.push(`Batches: ${dc}`);

            const tri = info.render?.triangles ?? 0;
            _L.push(`Tris: ${n(tri)}`);
        } else {
            _L.push(`Batches: —`);
            _L.push(`Tris: —`);
        }

        // ── Screen ──
        if (canvas) {
            const w = canvas.width;
            const ht = canvas.height;
            const pr = window.devicePixelRatio || 1;
            const fbBytes = w * ht * 8;
            _L.push(`Screen: ${Math.round(w / pr)}x${Math.round(ht / pr)} @${pr.toFixed(1)}x ~${f(fbBytes)}`);
        }

        if (info) {
            const progs = info.programs?.length ?? 0;
            _L.push(`SetPass calls: ${progs}`);
            _L.push(`Textures: ${info.memory?.textures ?? 0}   Geometries: ${info.memory?.geometries ?? 0}`);
        }

        // ── Animation ──
        const animCount = h.animationPlayingCount?.() ?? 0;
        _L.push(`Animations playing: ${animCount}`);

        // ── Audio ──
        _L.push(``);
        const srcCount = h.audioSourceCount?.() ?? 0;
        const lisCount = h.audioListenerCount?.() ?? 0;
        _L.push(`Audio:`);
        _L.push(`  Sources: ${srcCount}   Listeners: ${lisCount}`);

        _s.statsText.textContent = _L.join("\n");
    }

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
        const texVram = MemoryProfiler._estimateTextureVram();
        const geoVram = MemoryProfiler._estimateGeometryVram();
        _L.push(`Est. tex VRAM:   ${f(texVram)}`);
        _L.push(`Est. geo VRAM:   ${f(geoVram)}`);
        _L.push(`Est. VRAM total: ${f(texVram + geoVram)}`);
        _L.push(`Shader programs: ${info?.programs?.length ?? "—"}`);

        _L.push(``);
        _L.push(`─── Device ───`);
        const devMem = (navigator as any).deviceMemory;
        _L.push(`RAM:   ${devMem ? `~${devMem} GB` : "N/A"}`);
        _L.push(`Cores: ${navigator.hardwareConcurrency ?? "N/A"}`);

        const gpu = MemoryProfiler._getGpuName();
        _L.push(`GPU:   ${gpu ?? "N/A"}`);

        _s.memText.textContent = _L.join("\n");
    }

    private static _engTab(): void {
        if (!_s) return;
        const h = profilerHooks;

        _L.length = 0;

        // ── Scene ──
        _L.push(`─── Scene ───`);
        const scene = MemoryProfiler._scene();
        if (scene) {
            _L.push(`GameObjects:   ${scene.gameObjectCount ?? "—"}`);
            _L.push(`Root objects:  ${scene.rootCount ?? "—"}`);
        } else {
            _L.push(`N/A — no active scene`);
        }

        _L.push(``);
        _L.push(`─── Cameras ───`);
        _L.push(`Active cameras:  ${h.cameraCount?.() ?? 0}`);

        _L.push(``);
        _L.push(`─── Lights ───`);
        _L.push(`Active lights:   ${h.lightCount?.() ?? 0}`);

        _L.push(``);
        _L.push(`─── Physics ───`);
        _L.push(`Rigidbodies:     ${h.rigidbodyCount?.() ?? 0}`);
        _L.push(`Colliders:       ${h.colliderCount?.() ?? 0}`);
        _L.push(`Active contacts: ${h.physicsContactCount?.() ?? 0}`);

        _L.push(``);
        _L.push(`─── Animation ───`);
        _L.push(`Playing:         ${h.animationPlayingCount?.() ?? 0}`);

        _L.push(``);
        _L.push(`─── Audio ───`);
        _L.push(`Sources:         ${h.audioSourceCount?.() ?? 0}`);
        _L.push(`Listeners:       ${h.audioListenerCount?.() ?? 0}`);

        _L.push(``);
        _L.push(`─── Particles ───`);
        _L.push(`Systems:         ${h.particleSystemCount?.() ?? 0}`);
        _L.push(`Alive particles: ${h.aliveParticleCount?.() ?? 0}`);

        _s.engText.textContent = _L.join("\n");
    }

    // ==================== PRIVATE: DRAG ====================

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

    private static _fmtB(bytes: number): string {
        if (bytes === 0) return "0 B";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
        return `${(bytes / 1073741824).toFixed(2)} GB`;
    }

    private static _fmtN(n: number): string {
        if (n < 1000) return String(n);
        if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
        return `${(n / 1000000).toFixed(1)}M`;
    }

    private constructor() {}
}

// ==================== HELPER ====================

function _el(tag: string, css: string): HTMLDivElement {
    const e = document.createElement(tag) as HTMLDivElement;
    if (css) e.style.cssText = css;
    return e;
}

