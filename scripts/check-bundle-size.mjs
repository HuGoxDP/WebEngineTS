// scripts/check-bundle-size.mjs
//
// Fails when the standalone bundle's gzip size passes its budget.
//
// dist/WebEngineTS.standalone.js is the file every student downloads: the
// platform's import map points at it. Nothing else watches its size, and a
// bundle grows by accident (a new import that drags a large dependency in, a
// minifier setting lost in a config edit), so the budget is checked in CI after
// the build.
//
// Usage: npm run build && npm run size
//
// The number that matters is the gzip size at level 9, which is a little
// smaller than what a server sends at a default level and a little larger than
// what Brotli sends. It is a stable yardstick, not a prediction of the wire.
//
// Raising the budget is a decision, not a fix: say in the commit why the engine
// needs the bytes, and record the new size in CHANGELOG.md under "Changed".

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

/** Gzip budget in bytes. Measured 391,742 on 2026-10-14 (by this script); the unminified build was 917,253. */
const BUDGET_GZIP_BYTES = 450_000;

const FILE = new URL("../dist/WebEngineTS.standalone.js", import.meta.url);

let raw;
try {
  raw = readFileSync(FILE);
} catch (e) {
  if (e.code === "ENOENT") {
    console.error(`[size] ${FILE.pathname} does not exist. Run "npm run build" first.`);
    process.exit(1);
  }
  throw e;
}

const gzipped = gzipSync(raw, { level: 9 });

const fmt = (n) => n.toLocaleString("en-US");
console.log(`[size] dist/WebEngineTS.standalone.js`);
console.log(`[size]   raw   ${fmt(raw.length).padStart(10)} bytes`);
console.log(`[size]   gzip  ${fmt(gzipped.length).padStart(10)} bytes   (budget ${fmt(BUDGET_GZIP_BYTES)})`);

if (gzipped.length > BUDGET_GZIP_BYTES) {
  const over = gzipped.length - BUDGET_GZIP_BYTES;
  console.error(
    `[size] over budget by ${fmt(over)} bytes. If the growth is intended, raise ` +
    `BUDGET_GZIP_BYTES in scripts/check-bundle-size.mjs and say why in the commit; ` +
    `otherwise find what grew.`,
  );
  process.exit(1);
}
