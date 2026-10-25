// scripts/check-bundle-size.mjs
//
// Fails when a shipped file's gzip size passes its budget, or when a file that must be engine-free
// contains engine code.
//
// dist/WebEngineTS.standalone.js is the file every student downloads: the platform's import map points at it.
// Nothing else watches its size, and a bundle grows by accident (a new import that drags a large dependency in, a
// minifier setting lost in a config edit), so the budget is checked in CI after the build.
//
// The player files are the other two budgets, with a second rule: dist/player-host.js runs on the platform's own
// origin and dist/player/player.js imports the engine at run time, so NEITHER may contain engine code. A host
// client that quietly bundled the engine would be a megabyte on every page that embeds a scenario.
//
// Usage: npm run build && npm run size
//
// The number that matters is the gzip size at level 9, which is a little
// smaller than what a server sends at a default level and a little larger than
// what Brotli sends. It is a stable yardstick, not a prediction of the wire.
//
// Raising a budget is a decision, not a fix: say in the commit why the file needs the bytes, and record the new
// size in CHANGELOG.md under "Changed".

import { readFileSync } from "node:fs";
import { BUDGETS, ENGINE_MARKERS, HOST_ONLY_MARKERS, findMarkers, gzipBytes } from "./lib/bundle-checks.mjs";

/** @type {{ file: string, budgetGzip: number, forbidden: string[] }[]} Budgets and their history: scripts/lib/bundle-checks.mjs. */
const TARGETS = [
  { file: "dist/WebEngineTS.standalone.js", budgetGzip: BUDGETS.standalone, forbidden: [] },
  { file: "dist/player-host.js", budgetGzip: BUDGETS.playerHost, forbidden: [...ENGINE_MARKERS, ...HOST_ONLY_MARKERS] },
  { file: "dist/player/player.js", budgetGzip: BUDGETS.player, forbidden: ENGINE_MARKERS },
];

const fmt = (n) => n.toLocaleString("en-US");
let failed = false;

for (const { file, budgetGzip, forbidden } of TARGETS) {
  let raw;
  try {
    raw = readFileSync(new URL(`../${file}`, import.meta.url));
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error(`[size] ${file} does not exist. Run "npm run build" first.`);
      process.exit(1);
    }
    throw e;
  }

  const gzipped = gzipBytes(raw);
  console.log(`[size] ${file}`);
  console.log(`[size]   raw   ${fmt(raw.length).padStart(10)} bytes`);
  console.log(`[size]   gzip  ${fmt(gzipped).padStart(10)} bytes   (budget ${fmt(budgetGzip)})`);

  if (gzipped > budgetGzip) {
    const over = gzipped - budgetGzip;
    console.error(
      `[size] ${file} is over budget by ${fmt(over)} bytes. If the growth is intended, raise ` +
      `its budget in scripts/check-bundle-size.mjs and say why in the commit; ` +
      `otherwise find what grew.`,
    );
    failed = true;
  }

  const found = findMarkers(raw.toString("utf8"), forbidden);
  if (found.length) {
    console.error(`[size] ${file} contains engine code (${found.join(", ")}). It must stay engine-free.`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
