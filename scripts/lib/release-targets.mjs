// scripts/lib/release-targets.mjs
// ============================================================================
// Where `npm run release:local` delivers, as pure functions over a directory tree,
// so the layout rules can be tested without building anything or writing into a
// sibling repo.
//
// The workspace is cloned two ways (see scripts/player-smoke/locate-playwright.mjs):
//
//   <root>/virtual-lab          workspace root (clone-all.*)
//   <root>/testv/virtual-lab    older layout
//
// The root layout wins when both exist; the other one is reported as ignored, never
// written to silently.
// ============================================================================

import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where virtual-lab lives under the workspace parent, in priority order. */
export const VIRTUAL_LAB_LAYOUTS = ["virtual-lab", join("testv", "virtual-lab")];

/**
 * What an engine tarball must contain for a consumer to host the player and its client.
 * Paths as `npm pack --json` lists them (forward slashes, relative to the package root).
 */
export const REQUIRED_PACKAGE_FILES = [
    "dist/player/player.html",
    "dist/player/player.js",
    "dist/player/player.nginx.conf",
    "dist/player-host.js",
    "dist/player-host.d.ts",
];

/**
 * The virtual-lab checkout under `parent`.
 * @returns {{ dir: string, layout: string, ignored: string[] } | null}
 */
export function resolveVirtualLab(parent, exists = existsSync) {
    const found = VIRTUAL_LAB_LAYOUTS.filter(layout => exists(join(parent, layout)));
    if (found.length === 0) return null;
    return { dir: join(parent, found[0]), layout: found[0], ignored: found.slice(1).map(layout => join(parent, layout)) };
}

/**
 * Every delivery target, with virtual-lab resolved through {@link resolveVirtualLab}.
 * Absent repos still get an entry: the caller skips what does not exist, so a missing sibling is reported, not guessed at.
 * @param {string} parent  the folder that holds the sibling repos
 * @param {string} tgzName the stable tarball file name consumers depend on
 */
export function planTargets(parent, tgzName, exists = existsSync) {
    const lab = resolveVirtualLab(parent, exists);
    const labDir = lab?.dir ?? join(parent, VIRTUAL_LAB_LAYOUTS[0]);

    /** @type {{name:string, dir:string, copyTgz:boolean, spec:string}[]} */
    const consumers = [
        { name: "ScenarioCreator", dir: join(parent, "ScenarioCreator"), copyTgz: true, spec: `./${tgzName}` },
        { name: "virtual-lab frontend", dir: join(labDir, "frontend"), copyTgz: true, spec: `./${tgzName}` },
        { name: "WebEngineTSEditor app", dir: join(parent, "WebEngineTSEditor", "app"), copyTgz: true, spec: `./${tgzName}` },
    ];
    /** @type {{name:string, dest:string}[]} */
    const transcoderTargets = [
        { name: "virtual-lab frontend", dest: join(labDir, "frontend", "src", "assets", "basis") },
        { name: "WebEngineTS-Benchmarks", dest: join(parent, "WebEngineTS-Benchmarks", "public", "basis") },
    ];
    /** @type {{name:string, dir:string, dest:string, files:string[]}[]} */
    const bundleConsumers = [{
        name: "WebEngineTS-Benchmarks",
        dir: join(parent, "WebEngineTS-Benchmarks"),
        dest: join(parent, "WebEngineTS-Benchmarks", "engine"),
        files: ["WebEngineTS.standalone.js", "WebEngineTS.d.ts"],
    }];
    return { lab, consumers, transcoderTargets, bundleConsumers };
}

/** The required package files that `files` (the packed tarball's listing) does not contain. */
export function missingFromTarball(files, required = REQUIRED_PACKAGE_FILES) {
    const have = new Set(files.map(file => String(file).replaceAll("\\", "/").replace(/^package\//, "")));
    return required.filter(file => !have.has(file));
}

/**
 * Copies the tarball into a consumer that has `copyTgz` and exists.
 * @returns {"copied" | "skipped"}
 */
export function copyTarball(consumer, tgzPath, tgzName, { exists = existsSync, copy = copyFileSync } = {}) {
    if (!consumer.copyTgz || !exists(consumer.dir)) return "skipped";
    copy(tgzPath, join(consumer.dir, tgzName));
    return "copied";
}

/** Repos that mark a folder as the workspace parent. */
const SIBLINGS = ["ScenarioCreator", "WebEngineTSEditor", "WebEngineTS-Benchmarks", ...VIRTUAL_LAB_LAYOUTS];

/**
 * The folder that holds the sibling repos: the nearest ancestor of `engineDir` that contains one of them.
 * A checkout's parent is that folder; a worktree (`<workspace>/WebEngineTS/.claude/worktrees/<name>`) sits deeper,
 * where a fixed `..` would look in a folder with no siblings. Falls back to `..` when nothing is found.
 */
export function findWorkspaceParent(engineDir, exists = existsSync) {
    for (let dir = dirname(engineDir), up = ""; dir !== up; up = dir, dir = dirname(dir)) {
        if (SIBLINGS.some(name => exists(join(dir, name)))) return dir;
    }
    return dirname(engineDir);
}
