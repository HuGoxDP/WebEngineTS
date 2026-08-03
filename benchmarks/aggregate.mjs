// path: benchmarks/aggregate.mjs
//
// Aggregates exported Benchmark JSON runs into tables.
//
//   node benchmarks/aggregate.mjs <dir> [--runs] [--keep-first] [--gap <s>] [--csv]
//
// Default: one row per configuration (mean ± SD across its runs).
// `--runs`: one row per individual run with every recorded metric, grouped by
// scene with a blank line between scenes.
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
let perRun = false;

for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep-first") keepFirst = true;
    else if (a === "--csv") asCsv = true;
    else if (a === "--runs") perRun = true;
    else if (a === "--gap") gapSeconds = Number(argv[++i]);
    else if (!a.startsWith("--")) dir = a;
    else throw new Error(`Unknown option: ${a}`);
}

if (!dir) {
    console.error("usage: node benchmarks/aggregate.mjs <dir> [--runs] [--keep-first] [--gap <s>] [--csv]");
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
    s.label = s.total > 1 ? `${s.config}  [session ${s.index} of ${s.total}]` : s.config;
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

// ==================== OUTPUT: PER-RUN ====================

/** Scene bucket a config belongs to, for grouping the per-run table. */
function sceneOf(config) {
    if (/^scene1/.test(config)) return "Scene 1 — primitives grid";
    if (/Benchscene2/i.test(config)) return "Scene 2 — complex model";
    if (/Benchscene3/i.test(config)) return "Scene 3 — solar system";
    if (/^scene2/.test(config)) return "Scene 2 — procedural high-poly";
    if (/^scene3/.test(config)) return "Scene 3 — procedural solar";
    if (/ktx2/i.test(config)) return "KTX2 fallback";
    return "Other";
}

/**
 * Decodes the optimization flags a run used from its config name, so each
 * toggle reads as an explicit on/off column instead of a packed string.
 *
 * `dirty` is reported as "?" for scenario runs recorded before the flag was
 * added to result filenames — it is genuinely unknown there, not off.
 */
function flagsOf(config) {
    const has = (re) => re.test(config);
    const isScenario = /^scenario_/.test(config);
    const objects = config.match(/_N(\d+)/)?.[1] ?? "";
    const maxSize = config.match(/_max(\d+)/)?.[1] ?? "0";

    const dirty = has(/_dirtyOn/) ? "on"
        : has(/_dirtyOff/) ? "off"
        : isScenario ? "?" : "off";

    return {
        objects,
        instanced: /^scene1/.test(config) ? (has(/_instanced/) ? "on" : "off") : "",
        maxSize,
        relArc: isScenario ? (has(/_relArc/) ? "on" : "off") : "",
        relSrc: isScenario ? (has(/_relSrc/) ? "on" : "off") : "",
        ktx2: isScenario ? (has(/_ktx2/) ? "on" : "off") : "",
        warmup: has(/_nowarm/) ? "off" : has(/_warm/) ? "on" : "?",
        dirty,
        cold: has(/_cold/) ? "on" : "off",
    };
}

if (perRun) {
    const RUN_COLS = [
        ["scene", (x) => x.scene],
        // ── explicit per-flag columns (what was actually enabled) ──
        ["objects", (x) => flagsOf(x.config).objects],
        ["instanced", (x) => flagsOf(x.config).instanced],
        ["maxSize", (x) => flagsOf(x.config).maxSize],
        ["relArc", (x) => flagsOf(x.config).relArc],
        ["relSrc", (x) => flagsOf(x.config).relSrc],
        ["ktx2", (x) => flagsOf(x.config).ktx2],
        ["warmup", (x) => flagsOf(x.config).warmup],
        ["dirty", (x) => flagsOf(x.config).dirty],
        ["cold", (x) => flagsOf(x.config).cold],
        ["session", (x) => x.session],
        ["sessions_total", (x) => x.sessionsTotal],
        ["run", (x) => x.run],
        // Colons/slashes make spreadsheets coerce cells into times/dates, so the
        // timestamp is emitted as unambiguous text plus a numeric epoch.
        ["time_utc", (x) => x.r.timestamp.split("T")[1]?.replace("Z", "").replace(/:/g, "-") ?? ""],
        ["epoch_ms", (x) => Date.parse(x.r.timestamp)],
        ["warmup_frames", (x) => x.r.warmupFrames],
        ["sample_frames", (x) => x.r.sampleFrames],
        ["load_ms", (x) => x.r.loadTimeMs.toFixed(1)],
        ["mean_ms", (x) => x.r.frameTimeMs.mean.toFixed(3)],
        ["median_ms", (x) => x.r.frameTimeMs.median.toFixed(3)],
        ["p95_ms", (x) => x.r.frameTimeMs.p95.toFixed(3)],
        ["p99_ms", (x) => x.r.frameTimeMs.p99.toFixed(3)],
        ["min_ms", (x) => x.r.frameTimeMs.min.toFixed(3)],
        ["max_ms", (x) => x.r.frameTimeMs.max.toFixed(3)],
        ["sd_ms", (x) => x.r.frameTimeMs.stdDev.toFixed(3)],
        ["fps", (x) => x.r.fps.toFixed(2)],
        ["cpu_ms", (x) => x.r.cpuFrameMsMean.toFixed(3)],
        ["fixed_ms", (x) => (x.r.phaseMsMean?.fixedUpdate ?? 0).toFixed(3)],
        ["update_ms", (x) => (x.r.phaseMsMean?.update ?? 0).toFixed(3)],
        ["late_ms", (x) => (x.r.phaseMsMean?.lateUpdate ?? 0).toFixed(3)],
        ["render_ms", (x) => (x.r.phaseMsMean?.render ?? 0).toFixed(3)],
        ["first_render_ms", (x) => x.r.firstRenderCpuMs.toFixed(1)],
        ["max_first10_ms", (x) => x.r.maxFirst10Ms.toFixed(3)],
        ["heap_MB", (x) => ((x.r.memory.jsHeapUsedBytes ?? 0) * MB).toFixed(2)],
        ["texVram_MB", (x) => ((x.r.memory.estimatedTextureVramBytes ?? 0) * MB).toFixed(2)],
        ["geoVram_MB", (x) => ((x.r.memory.estimatedGeometryVramBytes ?? 0) * MB).toFixed(3)],
        ["rtVram_MB", (x) => ((x.r.memory.estimatedRenderTargetVramBytes ?? 0) * MB).toFixed(2)],
        ["gpuTextures", (x) => x.r.memory.gpuTextures ?? ""],
        ["gpuGeometries", (x) => x.r.memory.gpuGeometries ?? ""],
        ["drawCalls", (x) => x.r.memory.drawCalls ?? ""],
        ["triangles", (x) => x.r.memory.triangles ?? ""],
        ["gpu", (x) => x.r.gpu ?? ""],
        ["config", (x) => x.config],
        ["file", (x) => x.file],
    ];

    // Flatten sessions back to runs, carrying session/run numbering.
    const flat = [];
    for (const s of sessions) {
        s.runs.forEach((run, i) => {
            flat.push({
                scene: sceneOf(s.config),
                config: s.config,
                session: s.index,
                sessionsTotal: s.total,
                run: i + 1,
                file: run.file,
                r: run.r,
            });
        });
    }

    const scenes = [...new Set(flat.map((x) => x.scene))].sort();
    const header = RUN_COLS.map(([n]) => n);

    if (asCsv) {
        const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        const out = [header.join(",")];
        for (const scene of scenes) {
            for (const x of flat.filter((f) => f.scene === scene)) {
                out.push(RUN_COLS.map(([, get]) => esc(get(x))).join(","));
            }
            out.push(""); // blank line between scenes
        }
        console.log(out.join("\n"));
    } else {
        // Width per column across ALL rows so the blocks stay aligned.
        const widths = header.map((h, i) =>
            Math.max(h.length, ...flat.map((x) => String(RUN_COLS[i][1](x)).length)));
        const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");

        console.log(line(header));
        console.log(widths.map((w) => "-".repeat(w)).join("  "));
        for (const scene of scenes) {
            for (const x of flat.filter((f) => f.scene === scene)) {
                console.log(line(RUN_COLS.map(([, get]) => get(x))));
            }
            console.log(""); // blank line between scenes
        }
    }
    process.exit(0);
}

// ==================== OUTPUT: PER-CONFIG ====================

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
