// scripts/player-smoke/locate-playwright.mjs
// ============================================================
// Finds the Playwright install the player smoke borrows from virtual-lab's e2e/,
// the one place in the ecosystem that depends on it (the engine does not).
//
// scripts/shoot.mjs hard-codes `../../testv/virtual-lab/e2e`, which is the layout
// of one machine. The workspace is cloned two ways, and an engine worktree sits
// deeper still (`WebEngineTS/.claude/worktrees/<name>`), so a fixed relative path
// breaks on whichever layout it was not written for:
//
//   <root>/virtual-lab/e2e            workspace root (clone-all.*)
//   <root>/testv/virtual-lab/e2e      older layout
//
// The search walks up from the script and tries both layouts at every ancestor,
// nearest first, so it works from the main checkout and from a worktree alike.
// `PLAYWRIGHT_E2E_DIR` overrides it for any other arrangement.
// ============================================================

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/** Where e2e/ lives under an ancestor; the root layout wins when both exist. */
export const E2E_LAYOUTS = ["virtual-lab/e2e", "testv/virtual-lab/e2e"];

const PLAYWRIGHT_MANIFEST = join("node_modules", "playwright", "package.json");

/** Every e2e/ directory worth looking at, in priority order. */
export function candidateE2eDirs(startDir, env = process.env) {
    const dirs = env.PLAYWRIGHT_E2E_DIR ? [resolve(env.PLAYWRIGHT_E2E_DIR)] : [];

    for (let dir = resolve(startDir), up = ""; dir !== up; up = dir, dir = dirname(dir)) {
        for (const layout of E2E_LAYOUTS) dirs.push(join(dir, layout));
    }
    return dirs;
}

/**
 * The first e2e/ directory with Playwright installed.
 * @throws if there is none, naming every path tried and what to do about it.
 */
export function locatePlaywrightE2e(startDir, env = process.env) {
    const candidates = candidateE2eDirs(startDir, env);
    const found = candidates.find(dir => existsSync(join(dir, PLAYWRIGHT_MANIFEST)));
    if (found) return found;

    const withoutInstall = candidates.filter(dir => existsSync(dir));
    throw new Error(
        "[player-smoke] Playwright not found. It is borrowed from virtual-lab's e2e/ and looked for in:\n" +
        candidates.map(dir => `  ${dir}`).join("\n") + "\n" +
        (withoutInstall.length
            ? `Found e2e/ without Playwright installed: ${withoutInstall.join(", ")} - run \`npm ci\` there.\n`
            : "Clone virtual-lab next to this repo (workspace root or testv/), or set PLAYWRIGHT_E2E_DIR.\n"),
    );
}

/** The `playwright` module, resolved from the e2e/ directory found by {@link locatePlaywrightE2e}. */
export function loadPlaywright(startDir, env = process.env) {
    const e2e = locatePlaywrightE2e(startDir, env);
    return createRequire(join(e2e, "package.json"))("playwright");
}
