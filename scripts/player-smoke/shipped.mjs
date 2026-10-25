// scripts/player-smoke/shipped.mjs
// ============================================================
// The shipped run: a ZIP through the artifacts the engine ACTUALLY ships - dist/player-host.js
// (`WebEngineTS/player-host`), dist/player/player.html + player.js, served with the headers of
// dist/player/player.nginx.conf - in Chromium, Firefox and WebKit.
//
// What it proves that the unit tests cannot: that the snippet's CSP and `ACAO: *` are enough for the real
// player to boot in an opaque origin, import the real engine, run a real archive whose scripts say a bare
// `from "WebEngineTS"` (the player's `Scenario.engineModuleUrl` makes that resolve), and that a restart gives
// a NEW frame which runs again. The page that drives it is shipped-host.js; it records checks as data.
//
// Exit code 1 if any check fails in any browser.
// ============================================================

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browsers.mjs";
import { buildSyntheticZip, REPO } from "./fixtures.mjs";
import { loadPlaywright } from "./locate-playwright.mjs";
import { startServer } from "./server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(REPO, "dist");
const ENGINE_FILE = join(DIST, "WebEngineTS.standalone.js");
const BASIS_DIR = join(REPO, "node_modules", "three", "examples", "jsm", "libs", "basis");
const SHIPPED = { playerDir: join(DIST, "player"), hostFile: join(DIST, "player-host.js") };

const clip = text => String(text).replace(/\s+/g, " ").slice(0, 240);
/** Messages that are a browser's unsupported-feature note, not evidence. */
const NOISE = /feature policy: skipping unsupported/i;

/** Loads the host page, waits for its "done" report, returns it with what the browser logged. */
async function runOnce(browser, server, runId, zipName) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const logged = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type()) && !NOISE.test(message.text())) logged.push(clip(message.text())); });
    page.on("pageerror", error => logged.push(clip(`pageerror: ${error.message}`)));
    try {
        const hostOptions = {
            runId, zipUrl: `/zip/${zipName}`,
            engineUrl: `${server.origin}/engine/WebEngineTS.standalone.js`,
            transcoderPath: `${server.origin}/basis/`,
        };
        await page.goto(`${server.origin}/shipped-host.html#${encodeURIComponent(JSON.stringify(hostOptions))}`);
        const done = await server.waitFor(runId, "done", 120_000);
        return { done, logged: [...new Set(logged)].slice(0, 6) };
    } finally {
        await context.close();
    }
}

/** @returns {Promise<number>} the process exit code */
export async function runShipped({ browsers, json, markdown }) {
    for (const file of [ENGINE_FILE, SHIPPED.hostFile, join(SHIPPED.playerDir, "player.js"), join(SHIPPED.playerDir, "player.html"), join(SHIPPED.playerDir, "player.nginx.conf")]) {
        if (!existsSync(file)) throw new Error(`[player-smoke] ${file} not found. Run \`npm run build\` first.`);
    }

    const playwright = loadPlaywright(HERE);
    const server = await startServer({ engineFile: ENGINE_FILE, basisDir: BASIS_DIR, shipped: SHIPPED });
    // Bare specifier on purpose: the player's Scenario.engineModuleUrl is what must make it resolve.
    server.addZip("synthetic-bare.zip", await buildSyntheticZip("WebEngineTS"));

    const results = [];
    let runCounter = 0;
    try {
        for (const name of browsers) {
            const browser = await launchBrowser(playwright, name);
            try {
                const run = await runOnce(browser, server, `shipped-${++runCounter}`, "synthetic-bare.zip");
                const checks = run.done?.checks ?? {};
                const failed = Object.entries(checks).filter(([, c]) => !c.ok).map(([id]) => id);
                if (!run.done) failed.push("no-report-from-host-page");
                if (run.done?.fatal) failed.push(`fatal: ${run.done.fatal}`);
                results.push({ name, version: browser.version(), checks, failed, fatal: run.done?.fatal ?? null, logged: run.logged, metrics: run.done?.metrics ?? null });
                console.log(`[player-smoke] ${name.padEnd(8)} shipped artifacts: ${failed.length ? `FAIL ${failed.join(", ")}` : `ok (${Object.keys(checks).length} checks)`}`);
            } finally {
                await browser.close();
            }
        }
    } finally {
        await server.close();
    }

    const report = render(results);
    if (markdown) writeFileSync(resolve(markdown), report);
    if (json) writeFileSync(resolve(json), JSON.stringify({ results }, null, 2));
    console.log(report);
    return results.some(r => r.failed.length) ? 1 : 0;
}

function render(results) {
    const ids = [...new Set(results.flatMap(r => Object.keys(r.checks)))];
    const lines = [
        `Shipped player artifacts; browsers: ${results.map(r => `${r.name} ${r.version}`).join(", ")}.`, "",
        `| Check | ${results.map(r => r.name).join(" | ")} |`, `|---|${results.map(() => "---").join("|")}|`,
        ...ids.map(id => `| \`${id}\` | ${results.map(r => (r.checks[id] ? (r.checks[id].ok ? "pass" : "FAIL") : "-")).join(" | ")} |`), "",
    ];
    for (const r of results) {
        for (const id of r.failed) lines.push(`- ${r.name}: \`${id}\` ${clip(r.checks[id]?.detail ?? r.fatal ?? "")}`);
        for (const message of r.logged) lines.push(`- ${r.name} console: \`${message}\``);
    }
    return lines.join("\n");
}
