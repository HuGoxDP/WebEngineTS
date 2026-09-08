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
//   node scripts/shoot.mjs <url> <out.png> [waitMs] [clip] [scale] [--do "steps"]
//
// `clip` is "x,y,w,h" in CSS pixels and `scale` a device pixel ratio — together
// they answer questions a full-frame shot cannot, such as which way a DNA helix
// actually winds.
//
// `--do` runs input before the shot, as semicolon-separated steps — a UI that
// only appears once something is clicked cannot be verified from a still frame
// of the untouched page:
//
//   click:x,y   move:x,y   drag:x1,y1,x2,y2   key:Space   wheel:notches   wait:ms
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

const argv = process.argv.slice(2);
const doAt = argv.indexOf("--do");
const steps = doAt === -1 ? [] : (argv.splice(doAt, 2)[1] ?? "").split(";").map(s => s.trim()).filter(Boolean);

const url = argv[0];
const out = argv[1] ?? "shot.png";
const waitMs = Number(argv[2] ?? 3500);
const clipArg = argv[3];
const scale = Number(argv[4] ?? 1);

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
// With the stack: the message alone ("reading 'elements'") names neither the
// call nor the file, and these fire once a frame.
page.on("pageerror", e => logs.push(`  [pageerror] ${e.message}\n${(e.stack ?? "").split("\n").slice(1, 5).join("\n")}`));
page.on("requestfailed", r =>
    logs.push(`  [requestfailed] ${r.url()} — ${r.failure()?.errorText ?? "?"}`));

const response = await page.goto(url, { waitUntil: "load", timeout: 30000 });
console.log(`HTTP ${response?.status()} ${url}`);

// The engine needs frames on the clock before anything is on screen: textures
// upload during render, and the UI repaints on demand.
await page.waitForTimeout(waitMs);

for (const step of steps) {
    const [verb, rest = ""] = step.split(":");
    const n = rest.split(",").map(Number);
    switch (verb) {
        case "click": await page.mouse.click(n[0], n[1]); break;
        case "move":  await page.mouse.move(n[0], n[1]); break;
        case "drag":
            await page.mouse.move(n[0], n[1]);
            await page.mouse.down();
            // In steps, so a control that reads a delta per frame sees the motion
            // rather than one jump it may round away.
            for (let i = 1; i <= 10; i++) {
                await page.mouse.move(n[0] + (n[2] - n[0]) * i / 10, n[1] + (n[3] - n[1]) * i / 10);
                await page.waitForTimeout(16);
            }
            await page.mouse.up();
            break;
        case "key":   await page.keyboard.press(rest); break;
        case "wait":  await page.waitForTimeout(n[0]); break;
        case "wheel":
            // In notches, like a real wheel: a scenario that reads deltaY per
            // event sees several small steps rather than one implausible jump.
            for (let i = 0; i < Math.abs(n[0]); i++) {
                await page.mouse.wheel(0, Math.sign(n[0]) * 100);
                await page.waitForTimeout(80);
            }
            break;
        default: throw new Error(`Unknown step: ${step}`);
    }
    // The UI repaints on demand, and a click's effect lands on the next frame.
    if (verb !== "wait") await page.waitForTimeout(250);
}
if (steps.length) console.log(`did ${steps.length} step(s): ${steps.join(" ")}`);

// Well past Playwright's 30s default: a scene that converts an equirectangular
// sky to a cubemap keeps the software rasteriser busy for far longer than that,
// and the shot has to wait for a frame either way.
await page.screenshot({ path: out, timeout: 180000, ...(clip ? { clip } : {}) });
console.log(`saved ${out}`);

console.log(logs.length ? "console:" : "console: (silent)");
for (const l of logs) console.log(l);

await browser.close();
