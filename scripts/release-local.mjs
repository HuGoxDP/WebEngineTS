// scripts/release-local.mjs
// ============================================================================
// Dev-only: build + pack the engine and push it to the local sibling consumers
// that depend on it as a library. One-directional (engine -> consumers); the
// engine never imports from them. Not shipped (scripts/ is outside package.files).
//
//   npm run release:local              build, pack, copy tgz, reinstall the dep
//   npm run release:local -- --no-install   just build/pack/copy (skip npm install)
//
// Consumers:
//   ScenarioCreator            file:WebEngineTS-0.1.0.tgz   (builds scenarios)
//   testv/virtual-lab/frontend file:WebEngineTS-0.1.0.tgz   (Angular auto-copies
//                                the standalone bundle to /assets via angular.json)
//   WebEngineTSEditor/app      file:../../WebEngineTS       (uses dist/ directly)
//
// Cache-busting: `package.json`'s version stays fixed (0.1.0) for the repo/thesis
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
import { existsSync, copyFileSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARENT = resolve(ENGINE, "..");
const PKG_PATH = join(ENGINE, "package.json");
const TGZ = "WebEngineTS-0.1.0.tgz";
const noInstall = process.argv.includes("--no-install");

// `spec` is installed EXPLICITLY (`npm install <spec>`) as defense in depth
// alongside the unique-version stamp above — a plain `npm install` can still
// skip re-resolving an unchanged dependency line in some npm versions/lockfile
// states, so we always force it explicitly.
/** @type {{name:string, dir:string, copyTgz:boolean, spec:string}[]} */
const consumers = [
    { name: "ScenarioCreator", dir: join(PARENT, "ScenarioCreator"), copyTgz: true, spec: `./${TGZ}` },
    { name: "virtual-lab frontend", dir: join(PARENT, "testv", "virtual-lab", "frontend"), copyTgz: true, spec: `./${TGZ}` },
    { name: "WebEngineTSEditor app", dir: join(PARENT, "WebEngineTSEditor", "app"), copyTgz: false, spec: "../../WebEngineTS" },
];

const run = (cmd, cwd, env) =>
    execSync(cmd, { cwd, stdio: "inherit", env: env ? { ...process.env, ...env } : process.env });
const runJson = (cmd, cwd) => JSON.parse(execSync(cmd, { cwd }).toString());

// The unique local version is decided ONCE, up front, and used twice: passed to
// the build so the bundle reports it at run time (`BuildInfo.version`), and
// stamped into package.json for `npm pack` so the consumer installs it. Deriving
// it separately in each place would let a bundle claim a version no tarball ever
// carried — which is exactly the "which build is this?" confusion the stamping
// exists to end.
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

    if (c.copyTgz) {
        copyFileSync(stableTgzPath, join(c.dir, TGZ));
        console.log(`  copied ${TGZ}`);
    }

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

console.log("\n✓ Done. Rebuild/serve each consumer to pick up the new engine.");
