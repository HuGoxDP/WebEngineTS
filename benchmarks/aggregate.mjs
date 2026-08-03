// path: benchmarks/aggregate.mjs
//
// Aggregates exported Benchmark JSON runs into per-configuration tables.
//
//   node benchmarks/aggregate.mjs <dir> [--keep-first] [--gap <seconds>] [--csv]
//
// Files are grouped by the configuration encoded in their filename (the harness
// writes `<config>_<gpuTag>_<HHMMSS>.json`). Within a group, runs more than
// `--gap` seconds apart are treated as separate sessions and reported
// separately — repeating the same config later, or running two configs whose
// flags are not both encoded in the name, shows up as distinct sessions.
//
// The first run of each session is dropped (cold JIT/caches) unless
// `--keep-first`. Values are mean ± population SD across the remaining runs.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ==================== ARGS ====================

const argv = process.argv.slice(2);
let dir = null;
let keepFirst = false;
let gapSeconds = 90;
let asCsv = false;

for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep-first") keepFirst = true;
    else if (a === "--csv") asCsv = true;
    else if (a === "--gap") gapSeconds = Number(argv[++i]);
    else if (!a.startsWith("--")) dir = a;
    else throw new Error(`Unknown option: ${a}`);
}

if (!dir) {
    console.error("usage: node benchmarks/aggregate.mjs <dir> [--keep-first] [--gap <s>] [--csv]");
    process.exit(1);
}

// ==================== LOAD ====================

/** Strips the trailing `_<gpuTag>_<HHMMSS>` from a result filename. */
function configKey(filename) {
    return filename.replace(/\.json$/i, "").replace(/_[A-Za-z0-9]+_\d{6}$/, "");
}

const runs = [];
for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(path.join(dir, entry), "utf8"));
    for (const r of Array.isArray(raw) ? raw : [raw]) {
        runs.push({ config: configKey(entry), file: entry, r });
    }
}

if (runs.length === 0) {
    console.error(`No .json results found in ${dir}`);
    process.exit(1);
}

// ==================== GROUP INTO SESSIONS ====================

const byConfig = new Map();
for (const run of runs) {
    if (!byConfig.has(run.config)) byConfig.set(run.config, []);
    byConfig.get(run.config).push(run);
}

const sessions = [];
for (const [config, list] of byConfig) {
    list.sort((a, b) => Date.parse(a.r.timestamp) - Date.parse(b.r.timestamp));
    let current = [];
    let prevTime = null;
    for (const run of list) {
        const t = Date.parse(run.r.timestamp);
        if (prevTime !== null && (t - prevTime) / 1000 > gapSeconds) {
            sessions.push({ config, runs: current });
            current = [];
        }
        current.push(run);
        prevTime = t;
    }
    if (current.length > 0) sessions.push({ config, runs: current });
}

// Label repeated sessions of the same config as "#1", "#2", ...
const seen = new Map();
for (const s of sessions) {
    const n = (seen.get(s.config) ?? 0) + 1;
    seen.set(s.config, n);
    s.index = n;
}
for (const s of sessions) {
    s.total = seen.get(s.config);
    s.label = s.total > 1 ? `${s.config}  [session ${s.index}/${s.total}]` : s.config;
}
sessions.sort((a, b) => a.config.localeCompare(b.config) || a.index - b.index);

// ==================== METRICS ====================

const MB = 1 / 1048576;

/** Metric definitions: label, extractor, decimals. */
const METRICS = [
    ["load_ms", (r) => r.loadTimeMs, 1],
    ["mean_ms", (r) => r.frameTimeMs.mean, 2],
    ["median_ms", (r) => r.frameTimeMs.median, 2],
    ["p95_ms", (r) => r.frameTimeMs.p95, 2],
    ["p99_ms", (r) => r.frameTimeMs.p99, 2],
    ["max_ms", (r) => r.frameTimeMs.max, 2],
    ["sd_ms", (r) => r.frameTimeMs.stdDev, 2],
    ["fps", (r) => r.fps, 1],
    ["cpu_ms", (r) => r.cpuFrameMsMean, 3],
    ["fixed_ms", (r) => r.phaseMsMean?.fixedUpdate ?? 0, 3],
    ["update_ms", (r) => r.phaseMsMean?.update ?? 0, 3],
    ["late_ms", (r) => r.phaseMsMean?.lateUpdate ?? 0, 3],
    ["render_ms", (r) => r.phaseMsMean?.render ?? 0, 3],
    ["first_render_ms", (r) => r.firstRenderCpuMs, 1],
    ["max_first10_ms", (r) => r.maxFirst10Ms, 2],
    ["heap_MB", (r) => (r.memory.jsHeapUsedBytes ?? 0) * MB, 1],
    ["texVram_MB", (r) => (r.memory.estimatedTextureVramBytes ?? 0) * MB, 2],
    ["geoVram_MB", (r) => (r.memory.estimatedGeometryVramBytes ?? 0) * MB, 2],
    ["rtVram_MB", (r) => (r.memory.estimatedRenderTargetVramBytes ?? 0) * MB, 2],
    ["drawCalls", (r) => r.memory.drawCalls ?? 0, 0],
    ["triangles", (r) => r.memory.triangles ?? 0, 0],
];

function meanSd(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, sd: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const varSum = values.reduce((a, b) => a + (b - mean) ** 2, 0);
    return { mean, sd: Math.sqrt(varSum / n) };
}

const rows = sessions.map((s) => {
    const used = keepFirst || s.runs.length <= 1 ? s.runs : s.runs.slice(1);
    const cells = {};
    for (const [name, get, dp] of METRICS) {
        const { mean, sd } = meanSd(used.map((u) => get(u.r)));
        cells[name] = { mean, sd, dp };
    }
    return {
        label: s.label,
        n: used.length,
        total: s.runs.length,
        gpu: used[0]?.r.gpu ?? "",
        cells,
    };
});

// ==================== OUTPUT ====================

if (asCsv) {
    const header = ["config", "runs_used", "runs_total", ...METRICS.flatMap(([n]) => [n, `${n}_sd`])];
    const lines = [header.join(",")];
    for (const row of rows) {
        lines.push([
            `"${row.label}"`, row.n, row.total,
            ...METRICS.flatMap(([name]) => {
                const c = row.cells[name];
                return [c.mean.toFixed(c.dp), c.sd.toFixed(c.dp)];
            }),
        ].join(","));
    }
    console.log(lines.join("\n"));
} else {
    const gpu = rows[0]?.gpu ?? "unknown";
    console.log(`# Aggregated benchmark results\n`);
    console.log(`Directory : ${dir}`);
    console.log(`GPU       : ${gpu}`);
    console.log(`Runs      : ${runs.length} files, ${sessions.length} config sessions`);
    console.log(`Protocol  : ${keepFirst ? "all runs" : "first run of each session dropped"}, mean ± SD\n`);

    const nameW = Math.max(...rows.map((r) => r.label.length), 6);
    for (const [name, , dp] of METRICS) {
        console.log(`\n## ${name}\n`);
        console.log(`${"config".padEnd(nameW)}  n   value`);
        console.log("-".repeat(nameW + 22));
        for (const row of rows) {
            const c = row.cells[name];
            const v = `${c.mean.toFixed(dp)} ± ${c.sd.toFixed(dp)}`;
            console.log(`${row.label.padEnd(nameW)}  ${String(row.n).padStart(2)}  ${v}`);
        }
    }
}
