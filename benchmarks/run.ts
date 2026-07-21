// path: benchmarks/run.ts
//
// Browser entry point for the reproducible benchmark suite.
// Bundled by benchmarks/rollup.config.mjs into benchmarks/run.js and loaded
// by benchmarks/index.html over an import map that resolves "WebEngineTS" to
// the standalone build in dist/.
//
// Configuration is via URL query parameters, e.g.:
//   index.html?scene=1&count=5000&warmup=120&samples=600&dpr=1&shaderWarmup=1
//   index.html?scene=2&tris=434000
//   index.html?scene=3

import {
    Application, GraphicsPowerPreference, Benchmark, Texture2D, Transform,
    type BenchmarkResult,
} from "WebEngineTS";
import { buildProceduralGrid } from "./scenes/scene1Grid.ts";
import { buildHighPolyModel } from "./scenes/scene2HighPoly.ts";
import { buildSolarSystem } from "./scenes/scene3Solar.ts";
import { buildKtx2Test } from "./scenes/sceneKtx2.ts";
import { buildScenario } from "./scenes/sceneScenario.ts";
import type { SceneInfo } from "./scenes/common.ts";

// Read config from the query string, falling back to the URL hash. Some static
// servers (notably `serve` with clean URLs) 301-redirect `/index.html` and drop
// the query string; a hash fragment (`#scene=1&count=5000`) survives redirects
// and is never sent to the server, so it always works.
const rawParams = location.search.length > 1 ? location.search : location.hash.slice(1);
const params = new URLSearchParams(rawParams);
const out = document.getElementById("out") as HTMLDivElement;

function qp(name: string, fallback: string): string {
    return params.get(name) ?? fallback;
}

function log(line: string): void {
    out.textContent += line + "\n";
}

function vramTotal(r: BenchmarkResult): number {
    return (r.memory.estimatedTextureVramBytes ?? 0)
        + (r.memory.estimatedGeometryVramBytes ?? 0)
        + (r.memory.estimatedRenderTargetVramBytes ?? 0);
}

function formatResult(r: BenchmarkResult): string {
    const ft = r.frameTimeMs;
    const mb = (bytes: number | null) => (bytes == null ? "—" : `${(bytes / 1048576).toFixed(1)} MB`);
    return [
        ``,
        `── ${r.label} ──`,
        `GPU:         ${r.gpu ?? "—"}`,
        `FPS (avg):   ${r.fps.toFixed(1)}`,
        `CPU main:    ${r.cpuFrameMsMean.toFixed(2)} ms/frame (mean)`,
        `Frame time:  mean ${ft.mean.toFixed(2)}  median ${ft.median.toFixed(2)}  p95 ${ft.p95.toFixed(2)}  p99 ${ft.p99.toFixed(2)}`,
        `             max ${ft.max.toFixed(2)}  min ${ft.min.toFixed(2)}  stdDev ${ft.stdDev.toFixed(2)}  (ms)`,
        `JS heap:     ${mb(r.memory.jsHeapUsedBytes)}`,
        `Tex VRAM:    ${mb(r.memory.estimatedTextureVramBytes)}  (est.)`,
        `Geo VRAM:    ${mb(r.memory.estimatedGeometryVramBytes)}  (est.)`,
        `RT VRAM:     ${mb(r.memory.estimatedRenderTargetVramBytes)}  (est. shadow/post)`,
        `VRAM total:  ${mb(vramTotal(r))}  (est.)`,
        `GPU:         ${r.memory.gpuTextures ?? "—"} tex / ${r.memory.gpuGeometries ?? "—"} geo`,
        `Draw calls:  ${r.memory.drawCalls ?? "—"}   Triangles: ${(r.memory.triangles ?? 0).toLocaleString()}`,
    ].join("\n");
}

/** Short vendor tag derived from the unmasked GPU renderer string. */
function gpuTag(gpu: string | null): string {
    if (!gpu) return "unknown-gpu";
    const g = gpu.toLowerCase();
    if (/(nvidia|geforce|rtx|gtx)/.test(g)) return "nvidia";
    if (g.includes("intel")) return "intel";
    if (/(amd|radeon)/.test(g)) return "amd";
    if (g.includes("adreno")) return "adreno";
    if (g.includes("mali")) return "mali";
    if (g.includes("apple")) return "apple";
    return (g.match(/[a-z0-9]+/)?.[0]) ?? "gpu";
}

/**
 * Warns when the actual GPU doesn't match what `?gpu=` requested — the WebGL
 * powerPreference hint is advisory and often overridden by the OS.
 */
function gpuMismatchWarning(requested: string, gpu: string | null): string | null {
    if (!gpu) return null;
    const isIntegrated = /intel|uhd|iris|adreno|mali|apple|vivante|videocore/i.test(gpu);
    if (requested === "high-performance" && isIntegrated) {
        return "WARNING: requested the discrete GPU but got an integrated one. "
            + "In Windows: Settings > System > Display > Graphics > (add the browser) > "
            + "'High performance', then FULLY quit and reopen the browser.";
    }
    if (requested === "low-power" && !isIntegrated) {
        return "WARNING: requested the integrated GPU but got a discrete one. "
            + "Set the browser to 'Power saving' in Windows Graphics settings and fully restart it.";
    }
    return null;
}

/** Filename stem encoding the scene, its settings, the GPU, and a UTC time tag. */
function downloadBaseName(result: BenchmarkResult): string {
    const scenarioUrl = qp("scenario", "");
    const parts: string[] = [];

    if (scenarioUrl) {
        const name = (scenarioUrl.split("/").pop() ?? "scenario")
            .replace(/\.zip$/i, "").replace(/[^A-Za-z0-9]+/g, "-");
        parts.push("scenario", name);
    } else {
        const scene = qp("scene", "1");
        parts.push(`scene${scene}`);
        if (scene === "1") {
            parts.push(`N${qp("count", "1000")}`);
            if (qp("instanced", "0") === "1") parts.push("instanced");
            parts.push(qp("dirty", "1") === "1" ? "dirtyOn" : "dirtyOff");
        } else if (scene === "2") {
            parts.push(`tris${qp("tris", "434000")}`);
        }
    }

    parts.push(gpuTag(result.gpu));
    // UTC HHMMSS so repeated runs of the same config don't collide.
    parts.push((result.timestamp.split("T")[1] ?? "").replace(/[:.]/g, "").slice(0, 6));
    return parts.join("_");
}

function wireDownloads(result: BenchmarkResult): void {
    const csvBtn = document.getElementById("csv") as HTMLButtonElement;
    const jsonBtn = document.getElementById("json") as HTMLButtonElement;
    const base = downloadBaseName(result);
    csvBtn.disabled = false;
    jsonBtn.disabled = false;
    csvBtn.onclick = () => Benchmark.downloadCSV(result, `${base}.csv`);
    jsonBtn.onclick = () => Benchmark.downloadJSON(result, `${base}.json`);
}

async function main(): Promise<void> {
    const canvas = document.getElementById("game") as HTMLCanvasElement;

    // GPU selection for dual-GPU laptops. Set BEFORE constructing Application.
    //   ?gpu=high-performance → discrete GPU (default)
    //   ?gpu=low-power        → integrated GPU
    //   ?gpu=default          → let the browser/OS decide
    const gpuParam = qp("gpu", "high-performance");
    Application.powerPreference =
        gpuParam === "low-power" ? GraphicsPowerPreference.LowPower
        : gpuParam === "default" ? GraphicsPowerPreference.Default
        : GraphicsPowerPreference.HighPerformance;

    const app = new Application(canvas);

    // Fixed device-pixel-ratio for reproducibility (paper used dpr = 1.0).
    app.pixelRatio = parseFloat(qp("dpr", "1"));

    // KTX2 transcoder path (only used if a scene loads .ktx2 assets).
    // Root-relative — served from the repo root at /public/basis/.
    Texture2D.ktx2TranscoderPath = "/public/basis/";

    // Dirty-flag transform batching (paper's Scene 1 optimization). Global, so
    // set before building the scene. ?dirty=0 reverts to immediate sync.
    const dirty = qp("dirty", "1") === "1";
    Transform._setDirtyTransformsEnabled(dirty);

    const scenarioUrl = qp("scenario", "");
    const sceneId = qp("scene", "1");
    const warmupFrames = parseInt(qp("warmup", "120"), 10);
    const sampleFrames = parseInt(qp("samples", "600"), 10);
    const doShaderWarmup = qp("shaderWarmup", "1") === "1";

    let info: SceneInfo;
    if (scenarioUrl) {
        // Faithful path: load a real scenario ZIP (starts the engine internally).
        info = await buildScenario(app, scenarioUrl);
    } else {
        switch (sceneId) {
            case "ktx2":
                // Async: fetches and transcodes the KTX2 texture on the active GPU.
                info = await buildKtx2Test();
                break;
            case "2":
                info = buildHighPolyModel({ targetTriangles: parseInt(qp("tris", "434000"), 10) });
                break;
            case "3":
                info = buildSolarSystem();
                break;
            default:
                info = buildProceduralGrid({
                    count: parseInt(qp("count", "1000"), 10),
                    instanced: qp("instanced", "0") === "1",
                });
                break;
        }
    }

    app.run(); // idempotent — a scenario has already started the loop
    if (doShaderWarmup) app.warmupShaders();

    log(`${info.label}`);
    log(`objects=${info.objects}${info.extra ? `  (${info.extra})` : ""}`);
    log(`warmup=${warmupFrames}  samples=${sampleFrames}  dpr=${app.pixelRatio}  shaderWarmup=${doShaderWarmup}  dirty=${dirty ? "on" : "off"}`);
    log(`measuring…`);

    const result = await Benchmark.run({
        label: info.label,
        warmupFrames,
        sampleFrames,
    });

    log(formatResult(result));

    const gpuWarn = gpuMismatchWarning(gpuParam, result.gpu);
    if (gpuWarn) {
        log(`\n${gpuWarn}`);
        if (out) out.style.color = "#e3b341";
    }

    wireDownloads(result);

    // Expose for manual/console-driven multi-config runs.
    (window as unknown as { __lastBenchmark: BenchmarkResult }).__lastBenchmark = result;
}

main().catch((err) => {
    const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
    log(`\n=== ERROR ===\n${detail}`);
    if (out) out.style.color = "#ff7b72";
    console.error(err);
});
