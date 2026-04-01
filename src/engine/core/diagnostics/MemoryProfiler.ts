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

// ==================== OVERLAY STATE ====================

/** @internal */
let _overlayElement: HTMLDivElement | null = null;

/** @internal */
let _overlayIntervalId: number = 0;

// ==================== MEMORY PROFILER ====================

/**
 * Diagnostic utility for monitoring engine memory usage.
 *
 * Provides console reports, structured snapshots, and an optional
 * on-screen overlay showing live memory stats.
 *
 * All methods are static — `MemoryProfiler` is never instantiated.
 *
 * @remarks
 * `performance.memory` is only available in Chromium-based browsers
 * (Chrome, Edge, Opera). Firefox and Safari will show `null` for
 * JS heap stats.
 *
 * The on-screen overlay uses a fixed-position DOM element and does
 * not interfere with the WebGL canvas.
 *
 * @example
 * ```ts
 * import { MemoryProfiler } from "WebEngineTS";
 *
 * // One-shot console report
 * MemoryProfiler.logReport();
 *
 * // Live overlay (top-left corner, updates every 2 seconds)
 * MemoryProfiler.showOverlay();
 *
 * // Hide it later
 * MemoryProfiler.hideOverlay();
 *
 * // Get structured data for custom logging
 * const report = MemoryProfiler.snapshot();
 * console.log(`JS Heap: ${report.jsHeap?.used} bytes`);
 * ```
 */
export class MemoryProfiler {

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
     * Call this after asset loading to verify memory optimizations.
     *
     * @example
     * ```ts
     * async awake() {
     *     await this.loadAllAssets();
     *     MemoryProfiler.logReport(); // See what we're using
     *     this.releaseAll();
     *     MemoryProfiler.logReport(); // Verify reduction
     * }
     * ```
     */
    public static logReport(): void {
        const r = MemoryProfiler.snapshot();
        const fmt = MemoryProfiler._formatBytes;

        console.group(`%c[MemoryProfiler] ${r.timestamp}`, "color: #4FC3F7; font-weight: bold");

        // JS Heap
        if (r.jsHeap) {
            console.log(
                `JS Heap: ${fmt(r.jsHeap.used)} / ${fmt(r.jsHeap.total)}` +
                ` (limit: ${fmt(r.jsHeap.limit)})`
            );
        } else {
            console.log("JS Heap: N/A (not Chromium)");
        }

        // Renderer
        if (r.renderer) {
            console.log(
                `GPU Textures: ${r.renderer.textures}` +
                ` | Geometries: ${r.renderer.geometries}`
            );
        } else {
            console.log("Renderer: N/A (no active Application)");
        }

        // Render stats
        if (r.renderStats) {
            console.log(
                `Draw calls: ${r.renderStats.drawCalls}` +
                ` | Triangles: ${r.renderStats.triangles.toLocaleString()}`
            );
        }

        // Resources cache
        console.log(
            `Resources cache: ${r.resources.cacheEntries} assets` +
            ` (~${fmt(r.resources.estimatedBytes)} raw)`
        );

        // Device memory
        if (r.deviceMemoryGB !== null) {
            console.log(`Device RAM: ~${r.deviceMemoryGB} GB`);
        }

        console.groupEnd();
    }

    /**
     * Shows a live on-screen overlay with memory stats.
     *
     * The overlay is a small semi-transparent panel in the top-left
     * corner that updates every {@link intervalMs} milliseconds.
     *
     * @param intervalMs — update interval in milliseconds (default: 2000).
     */
    public static showOverlay(intervalMs: number = 2000): void {
        MemoryProfiler.hideOverlay();

        const el = document.createElement("div");
        el.id = "webengine-memory-overlay";
        el.style.cssText = [
            "position: fixed",
            "top: 8px",
            "left: 8px",
            "z-index: 99999",
            "background: rgba(0, 0, 0, 0.75)",
            "color: #e0e0e0",
            "font-family: monospace",
            "font-size: 11px",
            "line-height: 1.5",
            "padding: 8px 12px",
            "border-radius: 6px",
            "pointer-events: none",
            "white-space: pre",
        ].join(";");

        document.body.appendChild(el);
        _overlayElement = el;

        // Initial update
        MemoryProfiler._updateOverlay();

        // Periodic updates
        _overlayIntervalId = window.setInterval(
            () => MemoryProfiler._updateOverlay(),
            intervalMs
        );
    }

    /**
     * Hides the on-screen memory overlay.
     */
    public static hideOverlay(): void {
        if (_overlayIntervalId) {
            clearInterval(_overlayIntervalId);
            _overlayIntervalId = 0;
        }
        if (_overlayElement) {
            _overlayElement.remove();
            _overlayElement = null;
        }
    }

    /**
     * Whether the overlay is currently visible.
     */
    public static get isOverlayVisible(): boolean {
        return _overlayElement !== null;
    }

    // ==================== PRIVATE HELPERS ====================

    /** @internal */
    private static _getJSHeap(): MemoryReport["jsHeap"] {
        const perf = performance as any;
        if (!perf.memory) return null;
        return {
            used: perf.memory.usedJSHeapSize,
            total: perf.memory.totalJSHeapSize,
            limit: perf.memory.jsHeapSizeLimit,
        };
    }

    /** @internal */
    private static _getRendererMemory(): MemoryReport["renderer"] {
        const app = MemoryProfiler._getApplication();
        if (!app) return null;
        const info = (app as any)._threeRenderer?.info;
        if (!info?.memory) return null;
        return {
            textures: info.memory.textures ?? 0,
            geometries: info.memory.geometries ?? 0,
        };
    }

    /** @internal */
    private static _getRenderStats(): MemoryReport["renderStats"] {
        const app = MemoryProfiler._getApplication();
        if (!app) return null;
        const info = (app as any)._threeRenderer?.info;
        if (!info?.render) return null;
        return {
            drawCalls: info.render.calls ?? 0,
            triangles: info.render.triangles ?? 0,
        };
    }

    /**
     * @internal
     * Gets the Application singleton. Uses dynamic import-free access
     * via the known static pattern to avoid circular dependencies.
     */
    private static _getApplication(): any {
        // Access Application.current without importing Application
        // (avoids circular dependency). The global is set by Application constructor.
        return (globalThis as any).__webengine_application__ ?? null;
    }

    /** @internal */
    private static _updateOverlay(): void {
        if (!_overlayElement) return;

        const r = MemoryProfiler.snapshot();
        const fmt = MemoryProfiler._formatBytes;

        const lines: string[] = [];
        lines.push("═══ WebEngineTS Memory ═══");

        if (r.jsHeap) {
            lines.push(`Heap: ${fmt(r.jsHeap.used)} / ${fmt(r.jsHeap.total)}`);
        }

        if (r.renderer) {
            lines.push(`GPU:  ${r.renderer.textures} tex | ${r.renderer.geometries} geo`);
        }

        if (r.renderStats) {
            lines.push(`Draw: ${r.renderStats.drawCalls} calls | ${(r.renderStats.triangles / 1000).toFixed(1)}K tri`);
        }

        lines.push(`Cache: ${r.resources.cacheEntries} assets (${fmt(r.resources.estimatedBytes)})`);

        _overlayElement.textContent = lines.join("\n");
    }

    /**
     * @internal
     * Formats byte count as human-readable string.
     */
    private static _formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    /** @internal Static-only class. */
    private constructor() {}
}