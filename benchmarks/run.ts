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
    Application, GraphicsPowerPreference, Benchmark, Texture2D, type BenchmarkResult,
} from "WebEngineTS";
import { buildProceduralGrid } from "./scenes/scene1Grid.ts";
import { buildHighPolyModel } from "./scenes/scene2HighPoly.ts";
import { buildSolarSystem } from "./scenes/scene3Solar.ts";
import { buildKtx2Test } from "./scenes/sceneKtx2.ts";
import type { SceneInfo } from "./scenes/common.ts";

const params = new URLSearchParams(location.search);
const out = document.getElementById("out") as HTMLDivElement;

function qp(name: string, fallback: string): string {
    return params.get(name) ?? fallback;
}

function log(line: string): void {
    out.textContent += line + "\n";
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
        `GPU:         ${r.memory.gpuTextures ?? "—"} tex / ${r.memory.gpuGeometries ?? "—"} geo`,
        `Draw calls:  ${r.memory.drawCalls ?? "—"}   Triangles: ${(r.memory.triangles ?? 0).toLocaleString()}`,
    ].join("\n");
}

function wireDownloads(result: BenchmarkResult): void {
    const csvBtn = document.getElementById("csv") as HTMLButtonElement;
    const jsonBtn = document.getElementById("json") as HTMLButtonElement;
    const base = `scene${qp("scene", "1")}`;
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

    const sceneId = qp("scene", "1");
    const warmupFrames = parseInt(qp("warmup", "120"), 10);
    const sampleFrames = parseInt(qp("samples", "600"), 10);
    const doShaderWarmup = qp("shaderWarmup", "1") === "1";

    let info: SceneInfo;
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

    app.run();
    if (doShaderWarmup) app.warmupShaders();

    log(`${info.label}`);
    log(`objects=${info.objects}${info.extra ? `  (${info.extra})` : ""}`);
    log(`warmup=${warmupFrames}  samples=${sampleFrames}  dpr=${app.pixelRatio}  shaderWarmup=${doShaderWarmup}`);
    log(`measuring…`);

    const result = await Benchmark.run({
        label: info.label,
        warmupFrames,
        sampleFrames,
    });

    log(formatResult(result));
    wireDownloads(result);

    // Expose for manual/console-driven multi-config runs.
    (window as unknown as { __lastBenchmark: BenchmarkResult }).__lastBenchmark = result;
}

main().catch((err) => {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
});
