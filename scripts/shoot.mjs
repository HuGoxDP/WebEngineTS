// scripts/shoot.mjs
// ============================================================
// Loads a page in a real browser, records what the console said, and saves a
// screenshot. Exists because the parts of this engine that go wrong most
// expensively — handedness, winding, clipping, text orientation — are invisible
// to a unit test and only show up in a rendered frame.
//
// Uses the locally installed Edge (`channel: "msedge"`) rather than a
// Playwright-managed browser, so nothing has to be downloaded. Playwright itself
// is borrowed from testv/virtual-lab/e2e, the one place in the ecosystem that
// already depends on it.
//
//   node scripts/shoot.mjs <url> <out.png> [waitMs] [clip] [scale]
//
// `clip` is "x,y,w,h" in CSS pixels and `scale` a device pixel ratio — together
// they answer questions a full-frame shot cannot, such as which way a DNA helix
// actually winds.
//
// WebGL in headless Chromium needs ANGLE's software rasteriser; without the
// flags below the canvas comes back blank and the picture lies.
// ============================================================

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E = resolve(HERE, "../../testv/virtual-lab/e2e");
const require = createRequire(resolve(E2E, "package.json"));
const { chromium } = require("playwright");

const url = process.argv[2];
const out = process.argv[3] ?? "shot.png";
const waitMs = Number(process.argv[4] ?? 3500);
const clipArg = process.argv[5];
const scale = Number(process.argv[6] ?? 1);

const clip = clipArg
    ? (([x, y, width, height]) => ({ x, y, width, height }))(clipArg.split(",").map(Number))
    : undefined;

if (!url) {
    console.error("usage: node scripts/shoot.mjs <url> <out.png> [waitMs]");
    process.exit(2);
}

const browser = await chromium.launch({
    channel: "msedge",
    args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
    ],
});

const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: scale,
});

const logs = [];
page.on("console", m => logs.push(`  [${m.type()}] ${m.text()}`));
page.on("pageerror", e => logs.push(`  [pageerror] ${e.message}`));
page.on("requestfailed", r =>
    logs.push(`  [requestfailed] ${r.url()} — ${r.failure()?.errorText ?? "?"}`));

const response = await page.goto(url, { waitUntil: "load", timeout: 30000 });
console.log(`HTTP ${response?.status()} ${url}`);

// The engine needs frames on the clock before anything is on screen: textures
// upload during render, and the UI repaints on demand.
await page.waitForTimeout(waitMs);

await page.screenshot({ path: out, ...(clip ? { clip } : {}) });
console.log(`saved ${out}`);

console.log(logs.length ? "console:" : "console: (silent)");
for (const l of logs) console.log(l);

await browser.close();
