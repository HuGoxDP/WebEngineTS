// tests/PlaywrightLocator.test.ts
// ============================================================
// scripts/player-smoke borrows Playwright from virtual-lab's e2e/. The one place
// that did this before (scripts/shoot.mjs) hard-coded `testv/virtual-lab/e2e`, a
// directory that does not exist in the root workspace layout, so the script
// failed on the first machine that cloned the repos the other way. The locator
// is what the player-smoke spike (Phase 1 of the player-isolation plan) uses
// instead; these tests pin both layouts, the nested engine worktree, and the
// message a developer gets when neither exists.
//
// Real temp directories rather than a stubbed fs: the locator's whole job is
// answering "is there a Playwright install at this path".
// ============================================================

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    E2E_LAYOUTS, candidateE2eDirs, locatePlaywrightE2e,
} from "../scripts/player-smoke/locate-playwright.mjs";

let workspace: string;

beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "player-smoke-locator-")));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

/** Makes `<workspace>/<layout>` with or without a Playwright install inside. */
function e2e(layout: string, installed = true): string {
    const dir = join(workspace, layout);
    mkdirSync(join(dir, "node_modules", "playwright"), { recursive: true });
    if (installed) writeFileSync(join(dir, "node_modules", "playwright", "package.json"), "{}");
    else rmSync(join(dir, "node_modules"), { recursive: true });
    return dir;
}

/** A directory the script could live in: `<workspace>/<path>`. */
function scriptDir(path: string): string {
    const dir = join(workspace, path);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe("locatePlaywrightE2e", () => {
    test("finds the root layout, virtual-lab/e2e beside the engine", () => {
        const found = e2e("virtual-lab/e2e");

        expect(locatePlaywrightE2e(scriptDir("WebEngineTS/scripts/player-smoke"), {})).toBe(found);
    });

    test("finds the testv layout, testv/virtual-lab/e2e", () => {
        const found = e2e("testv/virtual-lab/e2e");

        expect(locatePlaywrightE2e(scriptDir("WebEngineTS/scripts/player-smoke"), {})).toBe(found);
    });

    test("finds it from inside an engine worktree, which sits four levels deeper", () => {
        const found = e2e("virtual-lab/e2e");
        const start = scriptDir("WebEngineTS/.claude/worktrees/player-isolation/scripts/player-smoke");

        expect(locatePlaywrightE2e(start, {})).toBe(found);
    });

    test("prefers the root layout when both exist", () => {
        const root = e2e("virtual-lab/e2e");
        e2e("testv/virtual-lab/e2e");

        expect(locatePlaywrightE2e(scriptDir("WebEngineTS/scripts/player-smoke"), {})).toBe(root);
    });

    test("prefers the nearer ancestor over a farther one", () => {
        e2e("virtual-lab/e2e");
        const near = join(workspace, "WebEngineTS", "virtual-lab", "e2e");
        mkdirSync(join(near, "node_modules", "playwright"), { recursive: true });
        writeFileSync(join(near, "node_modules", "playwright", "package.json"), "{}");

        expect(locatePlaywrightE2e(scriptDir("WebEngineTS/scripts/player-smoke"), {})).toBe(near);
    });

    test("skips an e2e/ where Playwright was never installed and uses the next layout", () => {
        e2e("virtual-lab/e2e", false);
        const installed = e2e("testv/virtual-lab/e2e");

        expect(locatePlaywrightE2e(scriptDir("WebEngineTS/scripts/player-smoke"), {})).toBe(installed);
    });

    test("PLAYWRIGHT_E2E_DIR beats both layouts", () => {
        e2e("virtual-lab/e2e");
        const elsewhere = join(workspace, "elsewhere");
        mkdirSync(join(elsewhere, "node_modules", "playwright"), { recursive: true });
        writeFileSync(join(elsewhere, "node_modules", "playwright", "package.json"), "{}");

        const found = locatePlaywrightE2e(
            scriptDir("WebEngineTS/scripts/player-smoke"), { PLAYWRIGHT_E2E_DIR: elsewhere },
        );

        expect(found).toBe(elsewhere);
    });

    test("with neither layout, throws a message naming every path tried and the remedy", () => {
        const start = scriptDir("WebEngineTS/scripts/player-smoke");

        expect(() => locatePlaywrightE2e(start, {})).toThrow(/Playwright not found/);
        expect(() => locatePlaywrightE2e(start, {})).toThrow(join(workspace, "virtual-lab", "e2e"));
        expect(() => locatePlaywrightE2e(start, {})).toThrow(join(workspace, "testv", "virtual-lab", "e2e"));
        expect(() => locatePlaywrightE2e(start, {})).toThrow(/PLAYWRIGHT_E2E_DIR/);
    });

    test("an e2e/ without Playwright installed says to run npm ci, not to clone virtual-lab", () => {
        e2e("virtual-lab/e2e", false);

        expect(() => locatePlaywrightE2e(scriptDir("WebEngineTS/scripts/player-smoke"), {}))
            .toThrow(/npm ci/);
    });
});

describe("candidateE2eDirs", () => {
    test("lists both layouts at every ancestor, nearest first, up to the filesystem root", () => {
        const start = scriptDir("a/b");
        const dirs = candidateE2eDirs(start, {});

        expect(dirs.slice(0, E2E_LAYOUTS.length)).toEqual(E2E_LAYOUTS.map(l => join(start, l)));
        expect(dirs.indexOf(join(workspace, "a", "virtual-lab", "e2e")))
            .toBeLessThan(dirs.indexOf(join(workspace, "virtual-lab", "e2e")));
        expect(dirs.length).toBeGreaterThan(E2E_LAYOUTS.length * 3);
        expect(new Set(dirs).size).toBe(dirs.length);
    });

    test("puts PLAYWRIGHT_E2E_DIR first", () => {
        const override = join(workspace, "somewhere");

        expect(candidateE2eDirs(workspace, { PLAYWRIGHT_E2E_DIR: override })[0]).toBe(override);
    });
});
