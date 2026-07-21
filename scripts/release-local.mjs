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
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARENT = resolve(ENGINE, "..");
const TGZ = "WebEngineTS-0.1.0.tgz";
const noInstall = process.argv.includes("--no-install");

// `spec` is installed EXPLICITLY (`npm install <spec>`) — plain `npm install`
// reuses the cached tarball because the version is unchanged, so the explicit
// path/tarball is required to force npm to re-hash and pick up new content.
/** @type {{name:string, dir:string, copyTgz:boolean, spec:string}[]} */
const consumers = [
    { name: "ScenarioCreator", dir: join(PARENT, "ScenarioCreator"), copyTgz: true, spec: `./${TGZ}` },
    { name: "virtual-lab frontend", dir: join(PARENT, "testv", "virtual-lab", "frontend"), copyTgz: true, spec: `./${TGZ}` },
    { name: "WebEngineTSEditor app", dir: join(PARENT, "WebEngineTSEditor", "app"), copyTgz: false, spec: "../../WebEngineTS" },
];

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

console.log("▶ Building engine…");
run("npm run build", ENGINE);

console.log("▶ Packing tarball…");
run("npm pack", ENGINE);

for (const c of consumers) {
    console.log(`\n▶ ${c.name}`);
    if (!existsSync(c.dir)) {
        console.warn(`  ⚠ skipped — not found at ${c.dir}`);
        continue;
    }

    if (c.copyTgz) {
        copyFileSync(join(ENGINE, TGZ), join(c.dir, TGZ));
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
