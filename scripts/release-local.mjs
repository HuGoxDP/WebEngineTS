// scripts/release-local.mjs
// ============================================================================
// Dev-only: build + pack the engine and push it to the local sibling consumers
// that depend on it as a library. One-directional (engine -> consumers); the
// engine never imports from them. Not shipped (scripts/ is outside package.files).
//
//   npm run release:local              build, pack, copy tgz, reinstall the dep
//   npm run release:local -- --no-install   just build/pack/copy (skip npm install)
//   npm run release:local -- --dry-run      print where it WOULD deliver and stop: no build, no pack, no copy
//
// Consumers:
//   ScenarioCreator            file:WebEngineTS-0.1.0.tgz   (builds scenarios)
//   virtual-lab/frontend       file:WebEngineTS-0.1.0.tgz   (also found at testv/virtual-lab/frontend;
//                                Angular auto-copies
//                                the standalone bundle to /assets via angular.json)
//   WebEngineTSEditor/app      WebEngineTS-0.1.0.tgz        (packed, like the rest)
//   WebEngineTS-Benchmarks     engine/WebEngineTS.standalone.js  (plain bundle copy,
//                              no npm dependency — it loads the bundle through an
//                              import map, exactly as the platform does)
//
// Cache-busting: `package.json`'s version stays fixed (0.1.0) for the repo
// — only bump it deliberately for a real release. To still guarantee every local
// pack is genuinely new content (so a plain `npm install` in a consumer, or even a
// stale lockfile, can never silently reuse an old tarball), this script stamps a
// unique prerelease version (`0.1.0-local.<timestamp>`) into package.json ONLY for
// the `npm pack` step, then immediately restores the original file — the engine's
// working tree and git history are untouched. Every consumer still depends on the
// stable filename `WebEngineTS-0.1.0.tgz` (renamed after packing), so their
// package.json dependency specs never need editing.
//
// The same stamped version is passed to the build as WEBENGINE_BUILD_VERSION, so
// the bundle reports it at run time through `BuildInfo.version` / `Application.version`
// instead of the plain 0.1.0 every local build would otherwise claim. Installed
// version and reported version are then the same string, and a consumer can name
// its engine build without grepping the shipped .d.ts for symbols.
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { copyTarball, findWorkspaceParent, missingFromTarball, planTargets } from "./lib/release-targets.mjs";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARENT = findWorkspaceParent(ENGINE);
const PKG_PATH = join(ENGINE, "package.json");
const TGZ = "WebEngineTS-0.1.0.tgz";
const noInstall = process.argv.includes("--no-install");
const dryRun = process.argv.includes("--dry-run");

// Where each consumer lives (virtual-lab at the workspace root or under testv/) is decided by
// scripts/lib/release-targets.mjs, which is unit-tested over fake trees.
//
// `spec` is installed EXPLICITLY (`npm install <spec>`) as defense in depth
// alongside the unique-version stamp above - a plain `npm install` can still
// skip re-resolving an unchanged dependency line in some npm versions/lockfile
// states, so we always force it explicitly.
//
// The Basis/KTX2 transcoder every host has to serve itself (`transcoderTargets`) is NOT bundled into the engine -
// `KTX2Loader` fetches it at runtime from whatever `Texture2D.ktx2TranscoderPath` points at. It is also versioned
// together with `three`: a transcoder older than the loader fails at runtime in ways that look like a corrupt
// texture. Copying it from the engine's own `node_modules/three` on every release is what keeps the two in
// lockstep. `dest` is the directory the host *serves* it from. Only a directory the host already has is
// refreshed: creating one where the host does not serve static files would be a copy nobody can fetch.
//
// `bundleConsumers` take a plain copy of the standalone bundle instead of a package (the benchmark suite resolves
// "WebEngineTS" through an import map). Left out of the sync it would silently keep benchmarking an old engine.
const { lab, consumers, transcoderTargets, bundleConsumers } = planTargets(PARENT, TGZ);

const run = (cmd, cwd, env) =>
    execSync(cmd, { cwd, stdio: "inherit", env: env ? { ...process.env, ...env } : process.env });
const runJson = (cmd, cwd) => JSON.parse(execSync(cmd, { cwd }).toString());

// The unique local version is decided ONCE, up front, and used twice: passed to
// the build so the bundle reports it at run time (`BuildInfo.version`), and
// stamped into package.json for `npm pack` so the consumer installs it. Deriving
// it separately in each place would let a bundle claim a version no tarball ever
// carried — which is exactly the "which build is this?" confusion the stamping
// exists to end.
if (dryRun) {
    const state = p => (existsSync(p) ? "found" : "absent");
    console.log(`virtual-lab: ${lab ? `${lab.dir} (layout "${lab.layout}")` : "not found"}`);
    for (const ignored of lab?.ignored ?? []) console.log(`  also present, NOT used: ${ignored}`);
    for (const c of consumers) console.log(`tarball -> ${c.name}: ${c.dir} (${state(c.dir)})`);
    for (const c of bundleConsumers) console.log(`bundle  -> ${c.name}: ${c.dest} (${state(c.dir)})`);
    for (const t of transcoderTargets) console.log(`basis   -> ${t.name}: ${t.dest} (${state(t.dest)})`);
    process.exit(0);
}

const originalPkgText = readFileSync(PKG_PATH, "utf8");
const basePkgVersion = JSON.parse(originalPkgText).version;
const stampedVersion = `${basePkgVersion}-local.${Date.now()}`;

console.log(`▶ Building engine… (${stampedVersion})`);
run("npm run build", ENGINE, { WEBENGINE_BUILD_VERSION: stampedVersion });

console.log("▶ Packing tarball (unique local version, then restoring package.json)…");
let packedFilename;
try {
    writeFileSync(PKG_PATH, originalPkgText.replace(
        `"version": "${basePkgVersion}"`,
        `"version": "${stampedVersion}"`,
    ));

    const [result] = runJson("npm pack --json", ENGINE);
    packedFilename = result.filename;

    // A tarball without the player would reach every consumer and fail only when someone tries to host it.
    const missing = missingFromTarball(result.files.map(f => f.path));
    if (missing.length) throw new Error(`[release-local] the packed tarball lacks ${missing.join(", ")}. Did the build run, and does package.json "files" still include dist?`);
} finally {
    // Always restore, even if packing failed — the committed version must never
    // be left mutated on disk.
    writeFileSync(PKG_PATH, originalPkgText);
}

// Rename the uniquely-versioned tarball to the stable name every consumer's
// package.json expects (e.g. WebEngineTS-0.1.0-local.1731000000000.tgz -> WebEngineTS-0.1.0.tgz).
const stableTgzPath = join(ENGINE, TGZ);
if (existsSync(stableTgzPath)) unlinkSync(stableTgzPath);
renameSync(join(ENGINE, packedFilename), stableTgzPath);
console.log(`  packed ${packedFilename} -> ${TGZ} (content is unique; filename is stable)`);

for (const c of consumers) {
    console.log(`\n▶ ${c.name}`);
    if (!existsSync(c.dir)) {
        console.warn(`  ⚠ skipped — not found at ${c.dir}`);
        continue;
    }

    if (copyTarball(c, stableTgzPath, TGZ) === "copied") console.log(`  copied ${TGZ}`);

    const installed = existsSync(join(c.dir, "node_modules"));
    if (noInstall) {
        console.log("  skipped install (--no-install)");
    } else if (!installed) {
        console.log("  node_modules absent — run `npm install` here when you set the project up");
    } else {
        run(`npm install ${c.spec} --prefer-offline --no-audit --no-fund`, c.dir);
        console.log("  reinstalled WebEngineTS ✓");
    }
}

for (const c of bundleConsumers) {
    console.log(`\n▶ ${c.name}`);
    if (!existsSync(c.dir)) {
        console.warn(`  ⚠ skipped — not found at ${c.dir}`);
        continue;
    }

    if (!existsSync(c.dest)) mkdirSync(c.dest, { recursive: true });

    for (const file of c.files) {
        copyFileSync(join(ENGINE, "dist", file), join(c.dest, file));
        console.log(`  copied ${file} ✓`);
    }
}

const transcoderSrc = join(ENGINE, "node_modules", "three", "examples", "jsm", "libs", "basis");
if (existsSync(transcoderSrc)) {
    for (const t of transcoderTargets) {
        // Only refresh a directory the host already has: creating one where the
        // host does not serve static files would be a copy nobody can fetch.
        if (!existsSync(t.dest)) {
            console.log(`\n▶ ${t.name} transcoder — skipped (no ${t.dest})`);
            continue;
        }

        console.log(`\n▶ ${t.name} transcoder`);
        for (const file of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
            copyFileSync(join(transcoderSrc, file), join(t.dest, file));
            console.log(`  copied ${file} ✓`);
        }
    }
} else {
    console.warn(`\n⚠ Basis transcoder not found at ${transcoderSrc} — KTX2 hosts not refreshed.`);
}

console.log("\n✓ Done. Rebuild/serve each consumer to pick up the new engine.");
