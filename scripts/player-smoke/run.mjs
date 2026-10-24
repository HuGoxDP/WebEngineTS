// scripts/player-smoke/run.mjs
// ============================================================
// Player smoke: runs the real standalone engine bundle inside an opaque-origin
// sandboxed iframe, in Chromium, Firefox and WebKit, and reports what works.
//
//   npm run build                       # once: produces dist/WebEngineTS.standalone.js
//   npm run player-smoke                # capabilities, per browser
//   npm run player-smoke -- --dirty     # also remove each CSP directive / token in turn
//   npm run player-smoke -- --browsers chromium --markdown out.md --json out.json
//
// Phase 1 of the player-isolation plan uses it to MEASURE the player's minimal
// CSP and sandbox/allow tokens (design/player-sandbox.md); Phase 3 re-runs the
// capability table against the real player as a regression check. Exit code 1
// means a capability that should pass did not.
//
// Playwright is borrowed from virtual-lab's e2e/ (locate-playwright.mjs).
// ============================================================

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./locate-playwright.mjs";
import { buildRealZip, buildStreamedFiles, buildSyntheticZip, REPO } from "./fixtures.mjs";
import { ablations, allowAttribute, basePolicy, sandboxAttribute, withoutAllow } from "./policy.mjs";
import { startServer } from "./server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_FILE = join(REPO, "dist", "WebEngineTS.standalone.js");
const BASIS_DIR = join(REPO, "node_modules", "three", "examples", "jsm", "libs", "basis");

/** Capabilities known not to pass on a browser; a regression guard must not fail on them. Reasons in design/player-sandbox.md. */
const EXPECTED_FAILURES = {
    chromium: [],
    firefox: [],
    webkit: [],
};

const CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    // Desktop Chrome's default. Headless builds relax it, which would make every audio result read "running".
    "--autoplay-policy=document-user-activation-required"];

// ── arguments ─────────────────────────────────────────────────────────

function parseArgs(argv) {
    const args = { browsers: ["chromium", "firefox", "webkit"], dirty: false, json: null, markdown: null, real: true, only: null };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === "--dirty") args.dirty = true;
        else if (flag === "--no-real") args.real = false;
        else if (flag === "--only") args.only = argv[++i].split(",");
        else if (flag === "--browsers") args.browsers = argv[++i].split(",");
        else if (flag === "--json") args.json = resolve(argv[++i]);
        else if (flag === "--markdown") args.markdown = resolve(argv[++i]);
        else throw new Error(`[player-smoke] Unknown argument ${flag}. Known: --dirty --no-real --only id,id --browsers a,b --json file --markdown file`);
    }
    return args;
}

// ── one run ───────────────────────────────────────────────────────────

let runCounter = 0;
const clip = text => String(text).replace(/\s+/g, " ").slice(0, 220);

/**
 * Loads the host (which starts the player from its URL hash), optionally clicks
 * inside the frame, and returns everything the host reported.
 *
 * The page is never evaluated: Playwright runs script with a user gesture, which would
 * give the page the activation the audio and pointer-lock probes measure.
 * @param {{ policy: object, source?: string, diag?: boolean, gesture?: "frame"|"host"|"none", cors?: object, direct?: boolean, foreign?: boolean }} options
 */
async function runOnce(browser, server, options) {
    const { policy, source = "synthetic", diag = true, gesture = "frame", cors = {}, direct = false, foreign = false } = options;
    server.setPolicy(policy);
    server.setCors({ engine: true, player: true, basis: true, ...cors });

    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const console_ = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type()) && !NOISE.test(message.text())) console_.push(clip(message.text())); });
    page.on("pageerror", error => console_.push(clip(`pageerror: ${error.message}`) + (process.env.PLAYER_SMOKE_DEBUG ? `
${error.stack}` : "")));

    const run = { source, mode: gesture };
    server.resetExfil();
    const runId = String(++runCounter);
    try {
        const streamed = source === "stream";
        const zipUrl = streamed ? undefined : `/zip/${{ synthetic: "synthetic.zip", mechanics: "Mechanics.zip", solar: "solar-system-scenario.zip" }[source]}`;
        const hostOptions = {
            runId, sandbox: sandboxAttribute(policy), allow: allowAttribute(policy), zipUrl,
            manifestUrl: streamed ? `${server.origin}/stream/scenario.json` : undefined,
            engineUrl: `${server.origin}/engine/WebEngineTS.standalone.js`,
            transcoderPath: `${server.origin}/basis/`, diag, waitForHostGesture: gesture === "host",
            // An unsandboxed page can navigate the host away, which would end the run it is meant to measure.
            security: policy.sandbox !== null,
            exfilUrl: `${server.foreignOrigin}/exfil`,
        };
        await page.bringToFront();
        await page.goto(`${server.origin}/host.html#${encodeURIComponent(JSON.stringify(hostOptions))}`);

        run.hello = await server.waitFor(runId, "hello", 20_000);
        if (gesture === "host" && run.hello) await page.mouse.click(700, 560);

        run.loaded = await server.waitFor(runId, "loaded", source === "solar" ? 180_000 : 60_000);
        if (!run.loaded) run.timeout = true;

        if (gesture === "frame" && run.loaded?.scenarioLoaded) {
            await page.mouse.click(320, 240);
            run.gesture = await server.waitFor(runId, "gesture", 8000);
            if (!run.gesture) run.gestureTimeout = true;
        }
    } catch (error) {
        run.harnessError = clip(error.message);
    }
    run.console = [...new Set(console_)].slice(0, 6);
    run.exfil = server.exfilHits();
    run.csp = [...new Set(console_.filter(message => CSP_MESSAGE.test(message) && !message.includes(server.foreignOrigin)))].slice(0, 5);
    if (process.env.PLAYER_SMOKE_DEBUG) console.error(`[debug] run ${runId}:`, console_.join("\n  "));

    if (direct) run.direct = await openDirectly(context, server);
    if (foreign) run.foreign = await embedFromForeignSite(context, server);
    await context.close();
    return run;
}

/** Opens `player.html` as a top-level page; with `CSP: sandbox` its origin must still be opaque. */
async function openDirectly(context, server) {
    const page = await context.newPage();
    try {
        await page.goto(`${server.origin}/player.html`);
        await page.waitForFunction(() => window.__direct, null, { timeout: 8000 });
        return await page.evaluate(() => window.__direct);
    } catch {
        return { origin: null, note: "player script did not run" };
    } finally {
        await page.close();
    }
}

/** A page on another origin embeds the player; true if the player managed to say hello. */
async function embedFromForeignSite(context, server) {
    const page = await context.newPage();
    try {
        await page.goto(`${server.foreignOrigin}/evil.html`);
        return { framed: await page.evaluate(() => window.__framed) };
    } finally {
        await page.close();
    }
}

// ── capabilities ──────────────────────────────────────────────────────

const asset = (run, name) => run.loaded?.smoke?.assets?.[name];
/** Playwright's Windows WebKit has no Web Audio at all; that is the browser build, not the sandbox, so audio is not observable there. */
const noWebAudio = run => run.loaded?.audio?.webAudio === "missing";
const CSP_MESSAGE = /content[- ]security[- ]policy|violates the following|refused to|refusing to/i;
const allBlocked = security => !!security && Object.values(security).every(value => String(value).startsWith("blocked"));

/** [id, label, check(run) -> true | false | null (not applicable / not run)]. */
const CAPABILITIES = [
    ["player-boots", "player script runs in the frame and says hello", run => !!run.hello],
    ["opaque-origin", "`self.origin` is `null`", run => run.loaded?.origin === undefined ? false : run.loaded.origin === "null"],
    ["hostile-access-blocked", "storage, cookie, IndexedDB, `parent.document`, top navigation, popup all blocked", run => run.loaded?.security === null ? null : allBlocked(run.loaded?.security)],
    ["webgl2", "WebGL2 context", run => run.loaded?.webgl2 === "ok"],
    ["engine-import", "`import(engineUrl)` of the standalone bundle, no import map", run => run.loaded?.engineImport === "ok"],
    ["zip-as-blob", "ZIP reaches the player as a `Blob` over a MessageChannel and loads", run => run.source === "stream" ? null : !!(run.loaded?.zip?.isBlob && run.loaded.scenarioLoaded)],
    ["scenario-loaded", "scenario loaded and entry point ran", run => !!run.loaded?.scenarioLoaded],
    ["blob-module-engine-url", "scenario `blob:` module imports the absolute engine URL", run => run.loaded?.smoke ? run.loaded.smoke.awake === true : null],
    ["same-engine-instance", "that import is the player's own engine instance", run => run.loaded?.smoke ? run.loaded.smoke.sameEngine === true : null],
    ["relative-import-relink", "relative import between scenario scripts (engine's blob re-link)", run => run.loaded?.smoke ? run.loaded.smoke.relativeImport === "relative-import-ok" : null],
    ["frames-advance", "frames advance (engine and scenario)", run => run.loaded?.frames ? run.loaded.frames.engine >= 5 && (run.loaded.frames.scenario === null || run.loaded.frames.scenario >= 5) : false],
    ["ktx2", "KTX2 transcodes in the frame", run => asset(run, "ktx2") ? asset(run, "ktx2").ok && asset(run, "ktx2").width === 16 : null],
    ["png", "PNG decodes (blob URL image)", run => asset(run, "png") ? asset(run, "png").ok : null],
    ["glb", "GLB loads with its embedded texture", run => asset(run, "glb") ? asset(run, "glb").ok && asset(run, "glb").hasMesh && asset(run, "glb").textured : null],
    ["audio-decode", "WAV decodes (`decodeAudioData`)", run => noWebAudio(run) ? null : asset(run, "wav") ? asset(run, "wav").ok : null],
    ["overlay", "`MemoryProfiler` overlay is built and positioned", run => run.loaded?.overlay ? run.loaded.overlay.present && run.loaded.overlay.positioned : null],
    ["no-csp-messages", "the browser logged no Content Security Policy message", run => run.loaded ? !run.csp.length && !run.loaded.violations?.length : false],
    ["no-exfiltration", "a hostile scenario's fetch, image, beacon, iframe and script to a third-party origin all fail", run => run.loaded ? run.exfil.length === 0 : false],
    ["pointer-lock", "`Input.lockCursor()` after a click in the frame locks the pointer", run => run.gesture ? run.gesture.pointer?.locked === true : null],
    ["audio-resume", "`AudioContext` runs after a click in the frame", run => noWebAudio(run) ? null : run.gesture ? run.gesture.audioAfter === "running" : null],
];

/** @returns {{ id: string, label: string, status: "pass"|"fail"|"n/a" }[]} */
function evaluate(run) {
    return CAPABILITIES.map(([id, label, check]) => {
        const verdict = check(run);
        return { id, label, status: verdict === null ? "n/a" : verdict ? "pass" : "fail" };
    });
}

const failing = caps => caps.filter(c => c.status === "fail").map(c => c.id);

/** Browser console messages that are not evidence of anything: the hostile probes are meant to be refused, and Firefox does not know `allow="autoplay"`. */
const NOISE = /unsafe attempt to initiate navigation|blocked opening 'about:blank'|feature policy: skipping unsupported/i;

/** The first thing worth quoting about why a run went wrong, given which capabilities it flipped. */
function evidence(run, flipped = []) {
    if (run.harnessError) return `harness: ${run.harnessError}`;
    if (flipped.includes("foreign-embed-refused")) return "a page on another origin embedded the player and received its hello";
    if (run.loaded?.noHello) return `no hello from the frame; console: ${run.console[0] ?? "(silent)"}`;
    if (flipped.includes("direct-open-opaque")) return `player.html opened top-level: self.origin = ${run.direct?.origin ?? "(its script was blocked)"}`;
    if (flipped.includes("pointer-lock")) return `lockCursor() after a click in the frame: ${JSON.stringify(run.gesture?.pointer)}`;
    if (run.loaded?.origin && run.loaded.origin !== "null") {
        const open = Object.entries(run.loaded.security ?? {}).filter(([, v]) => !String(v).startsWith("blocked")).map(([k]) => k);
        return `self.origin = ${run.loaded.origin}; reachable from scenario code: ${open.join(", ") || "nothing"}`;
    }
    if (run.timeout) return `timeout waiting for the player; console: ${run.console[0] ?? "(silent)"}`;
    const r = run.loaded ?? {};
    if (r.noHello) return `no hello from the frame; console: ${run.console[0] ?? "(silent)"}`;
    if (run.exfil.length) return `requests reached the third-party origin via: ${run.exfil.join(", ")}`;
    return clip(r.fatal ?? r.violations?.[0] ?? run.csp[0] ?? r.errors?.[0] ?? asset(run, "ktx2")?.error ?? run.console[0] ?? "");
}

// ── per-browser plan ──────────────────────────────────────────────────

function log(browserName, message) {
    console.log(`[player-smoke] ${browserName.padEnd(8)} ${message}`);
}

async function capabilityRuns(browser, name, server, base, hasReal, quick) {
    const out = {};
    const record = async (key, options) => {
        const run = await runOnce(browser, server, options);
        out[key] = { run, caps: evaluate(run) };
        log(name, `${key.padEnd(24)} ${failing(out[key].caps).length ? `FAIL ${failing(out[key].caps).join(", ")}` : "ok"}`);
    };

    await record("baseline", { policy: base, direct: true, foreign: true });
    await record("stream", { policy: base, source: "stream" });
    await record("control:unsandboxed", { policy: unsandboxed(base), diag: false });
    if (quick) return finishObservability(out);
    if (hasReal.mechanics) await record("mechanics", { policy: base, source: "mechanics", diag: false, gesture: "none" });
    if (hasReal.solar) await record("solar-system", { policy: base, source: "solar", diag: false, gesture: "none" });
    for (const gesture of ["none", "host", "frame"]) {
        for (const autoplay of [true, false]) {
            await record(`audio:${gesture}-gesture:${autoplay ? "autoplay" : "no-allow"}`, {
                policy: autoplay ? base : withoutAllow(base, "autoplay"), diag: false, gesture,
            });
        }
    }

    return finishObservability(out);
}

/** What fails with no sandbox at all is the browser build's limit, not the sandbox's: report it as unobservable. */
function finishObservability(out) {
    const control = out["control:unsandboxed"].caps;
    out.unobservable = ["pointer-lock", "audio-resume"].filter(id => control.find(c => c.id === id).status === "fail");
    for (const [key, entry] of Object.entries(out)) {
        if (key === "control:unsandboxed" || key === "unobservable") continue;
        for (const cap of entry.caps) if (out.unobservable.includes(cap.id) && cap.status === "fail") cap.status = "n/a";
    }
    return out;
}

/** No sandbox anywhere: what the browser can do at all, so a sandboxed failure can be told from a build that never could. */
const unsandboxed = base => ({ ...base, sandbox: null, attr: null });

const CORS_ABLATIONS = [
    { id: "-ACAO:engine bundle", label: "serve the engine bundle without `Access-Control-Allow-Origin`", cors: { engine: false } },
    { id: "-ACAO:player.js", label: "serve `player.js` without `Access-Control-Allow-Origin`", cors: { player: false } },
    { id: "-ACAO:transcoder", label: "serve the basis transcoder without `Access-Control-Allow-Origin`", cors: { basis: false } },
];

async function dirtyRuns(browser, name, server, base, runs, only) {
    const passing = source => new Set(runs[source === "stream" ? "stream" : "baseline"].caps.filter(c => c.status === "pass").map(c => c.id));
    const out = [];
    const items = [
        ...ablations(base),
        ...CORS_ABLATIONS.map(a => ({ ...a, policy: base })),
    ];

    for (const item of items.filter(i => !only || only.some(fragment => i.id.includes(fragment)))) {
        const sources = item.alsoStream ? ["synthetic", "stream"] : ["synthetic"];
        const flips = new Set();
        let firstEvidence = "";
        for (const source of sources) {
            const run = await runOnce(browser, server, {
                policy: item.policy, source, cors: item.cors, direct: item.direct, foreign: item.foreign,
            });
            const flipped = failing(evaluate(run)).filter(id => passing(source).has(id));
            if (run.direct && run.direct.origin !== "null") flipped.push("direct-open-opaque");
            if (run.foreign?.framed) flipped.push("foreign-embed-refused");
            for (const id of flipped) flips.add(id + (source === "stream" ? " (stream)" : ""));
            if (flipped.length) firstEvidence ||= evidence(run, flipped);
        }
        out.push({ id: item.id, label: item.label, control: !!item.control, flips: [...flips], evidence: firstEvidence });
        log(name, `${item.id.padEnd(40)} ${flips.size ? `flips: ${[...flips].join(", ")}` : "no effect"}`);
    }
    return out;
}

// ── report ────────────────────────────────────────────────────────────

/** "player never starts" instead of the dozen capabilities that follow from it. */
function summarizeFlips(flips) {
    if (flips.length === 0) return "no effect";
    const never = flips.filter(id => id.startsWith("player-boots"));
    if (never.length) return never.length > 1 ? "player never starts (ZIP and stream)" : "player never starts";
    return `flips: ${flips.join(", ")}`;
}

const cell = status => ({ pass: "pass", fail: "FAIL", "n/a": "-" }[status]);

function renderMarkdown(results, meta) {
    const names = results.map(r => r.name);
    const lines = [];
    const table = (header, rows) => {
        lines.push(`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map(row => `| ${row.join(" | ")} |`), "");
    };

    lines.push(`Engine build \`${meta.builtAt}\`; browsers: ${results.map(r => `${r.name} ${r.version}`).join(", ")}.`, "");
    lines.push("### Capabilities (baseline policy, synthetic ZIP)", "");
    table(["Capability", ...names], CAPABILITIES.map(([id, label]) => [
        `${label} (\`${id}\`)`, ...results.map(r => cell(r.baseline.caps.find(c => c.id === id).status)),
    ]));

    for (const r of results.filter(r => r.unobservable.length)) {
        const why = r["control:unsandboxed"].run.console.find(message => /focus/i.test(message)) ?? "see the JSON results";
        lines.push(`**${r.name}: ${r.unobservable.map(id => `\`${id}\``).join(", ")} not observable here.** ` +
            `It fails identically with no sandbox at all (\`${why}\`), so the cause is the browser build, not the policy.`, "");
    }

    const extra = ["baseline", "stream", "mechanics", "solar-system", "control:unsandboxed"].filter(key => results.some(r => r[key]));
    const SOURCE_LABELS = {
        baseline: "synthetic ZIP", stream: "streamed manifest", mechanics: "Mechanics.zip (real)",
        "solar-system": "solar-system-scenario.zip (real)", "control:unsandboxed": "control: no sandbox at all (not a policy)",
    };
    lines.push("### Capabilities by source", "");
    table(["Source", ...names], extra.map(key => [
        SOURCE_LABELS[key],
        ...results.map(r => r[key] ? (failing(r[key].caps).length ? `FAIL: ${failing(r[key].caps).join(", ")}` : "all pass") : "not run"),
    ]));

    lines.push("### Direct open and foreign embedding", "");
    table(["Check", ...names], [
        ["`player.html` opened top-level: origin", ...results.map(r => `\`${r.baseline.run.direct?.origin}\``)],
        ["`player.html` opened top-level: hostile probes", ...results.map(r => allBlocked(r.baseline.run.direct?.security) ? "all blocked" : "ACCESSIBLE")],
        ["embedded by a foreign origin (`frame-ancestors 'self'`)", ...results.map(r => r.baseline.run.foreign?.framed ? "FRAMED" : "refused")],
        ["engine texture formats the KTX2 became", ...results.map(r => `\`${JSON.stringify(r.baseline.run.loaded?.textureFormats)}\``)],
    ]);

    lines.push("### Audio and pointer lock (observed)", "");
    const audioKeys = Object.keys(results[0].audio ?? {});
    table(["Gesture / `allow`", ...names.map(n => `${n}: before -> after gesture`)], audioKeys.map(key => [
        `\`${key.slice(6)}\``,
        ...results.map(r => {
            const run = r.audio[key].run;
            const g = run.gesture;
            return noWebAudio(run) ? "no Web Audio" : `${run.loaded?.audio?.afterWait ?? "?"}${g ? ` -> ${g.audioAfter}` : ""}`;
        }),
    ]));
    table(["Pointer lock (baseline)", ...names], [[
        "result", ...results.map(r => {
            const p = r.baseline.run.gesture?.pointer;
            return p ? (p.locked ? "locked" : `not locked (${p.error})`) : "not observed";
        }),
    ]]);

    if (results.some(r => r.dirty)) {
        lines.push("### Dirty run: one piece removed at a time", "");
        const ids = results.find(r => r.dirty).dirty.map(d => d.id);
        table(["Removed / added", ...names], ids.map(id => {
            const first = results.find(r => r.dirty).dirty.find(d => d.id === id);
            return [`${first.control ? "**control** " : ""}${first.label}`, ...results.map(r => {
                const item = r.dirty?.find(d => d.id === id);
                return item ? summarizeFlips(item.flips) : "not run";
            })];
        }));

        lines.push("### Dirty run: first evidence per removal", "");
        table(["Removed", ...names.map(n => `${n} evidence`)], ids.map(id => {
            const first = results.find(r => r.dirty).dirty.find(d => d.id === id);
            return [first.label, ...results.map(r => {
                const item = r.dirty?.find(d => d.id === id);
                return item?.evidence ? `\`${item.evidence.replaceAll("|", "/")}\`` : "";
            })];
        }));
    }
    return lines.join("\n");
}

// ── main ──────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!existsSync(ENGINE_FILE)) throw new Error(`[player-smoke] ${ENGINE_FILE} not found. Run \`npm run build\` first.`);

    const playwright = loadPlaywright(HERE);
    const server = await startServer({ engineFile: ENGINE_FILE, basisDir: BASIS_DIR });
    const engineUrl = `${server.origin}/engine/WebEngineTS.standalone.js`;
    server.addZip("synthetic.zip", await buildSyntheticZip(engineUrl));
    server.addStreamFiles(buildStreamedFiles(engineUrl));
    const hasReal = {};
    if (args.real) {
        for (const [key, file] of [["mechanics", "Mechanics.zip"], ["solar", "solar-system-scenario.zip"]]) {
            const bytes = await buildRealZip(file, engineUrl);
            if (bytes) server.addZip(file, bytes);
            hasReal[key] = !!bytes;
        }
        if (!hasReal.mechanics) console.warn("[player-smoke] ScenarioCreator/ReleaseScenarios not found; real ZIPs skipped.");
    }

    const base = basePolicy(server.origin);
    const results = [];
    let regressions = 0;
    try {
        for (const name of args.browsers) {
            const browser = await playwright[name].launch(name === "chromium" ? { args: CHROMIUM_ARGS } : {});
            try {
                const runs = await capabilityRuns(browser, name, server, base, hasReal, !!args.only);
                const { unobservable, ...rest } = runs;
                const entry = { name, version: browser.version(), unobservable, ...rest, audio: Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith("audio:"))) };
                if (args.dirty) entry.dirty = await dirtyRuns(browser, name, server, base, rest, args.only);
                results.push(entry);

                const expected = new Set(EXPECTED_FAILURES[name] ?? []);
                const unexpected = failing(rest.baseline.caps).filter(id => !expected.has(id));
                if (unexpected.length) { regressions++; log(name, `UNEXPECTED FAILURES: ${unexpected.join(", ")}`); }
            } finally {
                await browser.close();
            }
        }
    } finally {
        await server.close();
    }

    const builtAt = results[0]?.baseline.run.loaded?.engineBuiltAt ?? "unknown";
    if (args.markdown) writeFileSync(args.markdown, renderMarkdown(results, { builtAt }));
    if (args.json) writeFileSync(args.json, JSON.stringify({ builtAt, results }, null, 2));
    console.log(renderMarkdown(results, { builtAt }));
    process.exitCode = regressions ? 1 : 0;
}

main().catch(error => {
    console.error(error.message);
    process.exit(2);
});
