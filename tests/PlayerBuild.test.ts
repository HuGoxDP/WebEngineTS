// tests/PlayerBuild.test.ts
// ============================================================
// DW-3.1: the player artifacts and what they must not contain. The three player builds are generated IN MEMORY
// from the real rollup config (no dist/ needed, nothing written), then checked:
//   - the host client has no engine code and stays under its gzip budget;
//   - the player script has no engine code either (it imports the engine by URL at run time);
//   - the host's .d.ts exports the plan's contract and does not mention three.js or the engine;
//   - package.json exports `WebEngineTS/player-host` at the files the config writes, and ships dist.
// `npm run size` repeats the size and symbol checks on the files `npm run build` actually wrote.
// ============================================================

import { readFileSync, readdirSync } from "node:fs";
import { rollup, type OutputOptions, type Plugin, type RollupOptions } from "rollup";
import ts from "typescript";
import { beforeAll, describe, expect, test } from "vitest";
import { playerBuild, playerHostBuild, playerHostDtsBuild } from "../rollup.config.mjs";
import { BUDGETS, ENGINE_MARKERS, HOST_ONLY_MARKERS, findMarkers, gzipBytes } from "../scripts/lib/bundle-checks.mjs";

const BUILD_TIMEOUT_MS = 180_000;

/** Strips types without checking them, the way esbuild does for the other tests. */
const transpileOnly: Plugin = {
    name: "transpile-only",
    transform: (code, id) => id.endsWith(".ts") ? { code: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText, map: null } : null,
};

/**
 * Generates one config's output in memory. The type-checking TypeScript plugin is swapped for a transpile-only one:
 * checking pulls the whole engine's types into every build (seconds of CPU each, enough to starve neighbouring test
 * files), and `npm run build` and `npm run typecheck` already check them. Input, output and every other plugin are the
 * config's own.
 */
async function generate(config: RollupOptions): Promise<string> {
    const plugins = ((config.plugins ?? []) as Plugin[]).map(plugin =>
        plugin?.name === "typescript" ? transpileOnly : plugin);
    const bundle = await rollup({ ...config, plugins, output: undefined } as RollupOptions);
    try {
        const { output } = await bundle.generate(config.output as OutputOptions);
        const chunks = output.filter(item => item.type === "chunk");
        expect(chunks).toHaveLength(1); // one file, no code-split chunks (a .map asset may ride along)
        return chunks[0].type === "chunk" ? chunks[0].code : "";
    } finally {
        await bundle.close();
    }
}

let hostCode = "";
let playerCode = "";
let hostDts = "";
beforeAll(async () => {
    [hostCode, playerCode, hostDts] = await Promise.all([generate(playerHostBuild), generate(playerBuild), generate(playerHostDtsBuild)]);
}, BUILD_TIMEOUT_MS);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("DW-3.1: the host client bundle", () => {
    test("DW_3_1 contains no engine or three.js code, and is under its gzip budget", async () => {
        const code = hostCode;

        expect(code).toContain("class PlayerHost");
        expect(findMarkers(code, [...ENGINE_MARKERS, ...HOST_ONLY_MARKERS])).toEqual([]);
        expect(code).not.toMatch(/from\s+["']three/);
        expect(code).not.toMatch(/\bimport\s*\(/);
        expect(gzipBytes(code)).toBeLessThan(BUDGETS.playerHost);
    });

    test("DW_3_1 is a self-contained ES module with no imports at all", async () => {
        const code = hostCode;

        expect(code).not.toMatch(/^\s*import\s/m);
        expect(code).toMatch(/^export\s*\{[^}]*PlayerHost[^}]*\}/m);
        expect(code).toMatch(/PLAYER_PROTOCOL_VERSION/);
    });
});

describe("DW-3.1: the player script", () => {
    test("DW_3_1 does not bundle the engine: it imports it by URL at run time", async () => {
        const code = playerCode;

        expect(findMarkers(code, ENGINE_MARKERS)).toEqual([]);
        expect(code).toMatch(/import\(/);
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(gzipBytes(code)).toBeLessThan(BUDGETS.player);
    });

    test("the build copies player.html and player.nginx.conf beside player.js", () => {
        const copier = (playerBuild.plugins as { name?: string }[]).find(p => p?.name === "copy-player-statics");

        expect(copier).toBeDefined();
        expect(playerBuild.output).toMatchObject({ file: "dist/player/player.js", format: "es" });
        for (const file of ["player.html", "player.nginx.conf"]) {
            expect(readFileSync(new URL(`../src/player/static/${file}`, import.meta.url), "utf8").length).toBeGreaterThan(0);
        }
    });
});

describe("DW-3.1: the host client's declarations", () => {
    test("DW_3_1 export the plan's contract and mention neither three.js nor the engine", async () => {
        const dts = hostDts;

        expect(dts).toMatch(/declare class PlayerHost/);
        expect(dts).toMatch(/export\s*\{[^}]*\bPlayerHost\b[^}]*\}/);
        for (const name of ["PLAYER_PROTOCOL_VERSION", "PlayerMessage", "PlayerMetrics"]) expect(dts).toMatch(new RegExp(String.raw`export\s*(type\s*)?\{[^}]*\b${name}\b`));
        expect(dts).not.toMatch(/from\s+["']three/);
        expect(dts).not.toMatch(/from\s+["'][^"']*engine/);
        expect(dts).toMatch(/restart\(\): Promise<void>/);
        expect(dts).toMatch(/measure\(seconds: number\): Promise<PlayerMetrics>/);
        expect(dts).toMatch(/load\(source: PlayerLoadSource, opts: \{\s*diag: boolean;\s*\}\): Promise<void>/);
    });
});

describe("DW-3.1: package.json", () => {
    test("DW_3_1 exports ./player-host at the files the build writes, with types", () => {
        const entry = pkg.exports["./player-host"];

        expect(entry.types).toBe("./" + (playerHostDtsBuild.output as OutputOptions).file);
        expect(entry.import).toBe("./" + (playerHostBuild.output as OutputOptions).file);
        expect(pkg.exports["."].import).toBe("./dist/WebEngineTS.esm.js");
    });

    test("DW_3_1 ships dist (which holds dist/player) and the size script covers the player files", () => {
        expect(pkg.files).toContain("dist");
        const sizeScript = readFileSync(new URL("../scripts/check-bundle-size.mjs", import.meta.url), "utf8");
        expect(sizeScript).toContain("dist/player-host.js");
        expect(sizeScript).toContain("dist/player/player.js");
    });

    test("the build is part of the default build and typecheck covers the player", () => {
        expect(pkg.scripts.typecheck).toContain("tsconfig.player.json");
        expect(pkg.scripts["player-smoke"]).toContain("scripts/player-smoke/run.mjs");
    });
});

describe("the engine does not depend on the player", () => {
    test("no file under src/engine imports from src/player", () => {
        const root = new URL("../src/engine/", import.meta.url);
        const offenders = (readdirSync(root, { recursive: true }) as string[])
            .filter(file => file.endsWith(".ts"))
            .filter(file => /from\s+["'][^"']*\/player\//.test(readFileSync(new URL(file, root), "utf8")));

        expect(offenders).toEqual([]);
    });
});
