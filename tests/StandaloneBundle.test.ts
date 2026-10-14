import { describe, test, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * Smoke test for the minified standalone bundle, the file the platform's import
 * map serves to every student.
 *
 * Every other test imports the sources, so none of them would notice a
 * minifier setting that renames a class or drops a licence notice. This one
 * loads the built files themselves, which means it only means something after
 * `npm run build`. CI runs it as its own step after the build; in the main
 * `npm test` step, before anything is built, the suite is skipped and its name
 * says why.
 *
 * It compares against dist/WebEngineTS.esm.js rather than the sources: both
 * come from the same build, so a difference can only have been introduced by
 * minification, and a stale dist left over from an older checkout cannot make
 * the comparison disagree for an unrelated reason.
 */

const STANDALONE = new URL("../dist/WebEngineTS.standalone.js", import.meta.url);
const ESM = new URL("../dist/WebEngineTS.esm.js", import.meta.url);

const built = existsSync(STANDALONE) && existsSync(ESM);

type EngineModule = {
    BuildInfo: { version: string; builtAt: string | null; isBuild: boolean };
    TypeRegistry: {
        all: readonly string[];
        get(typeName: string): { name: string } | null;
    };
    GameObject: new (name?: string) => object;
    [exportName: string]: unknown;
};

const suite = built
    ? describe
    : describe.skip;

suite(`the standalone bundle${built ? "" : " (skipped: dist/ is not built, run npm run build first)"}`, () => {
    let standalone: EngineModule;
    let esm: EngineModule;
    let standaloneText: string;

    beforeAll(async () => {
        standalone = (await import(/* @vite-ignore */ STANDALONE.href)) as EngineModule;
        esm = (await import(/* @vite-ignore */ ESM.href)) as EngineModule;
        standaloneText = readFileSync(STANDALONE, "utf8");
    }, 60_000);

    test("it is a stamped build", () => {
        expect(standalone.BuildInfo.isBuild).toBe(true);
        expect(standalone.BuildInfo.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(standalone.BuildInfo.version).not.toContain("__WEBENGINE");
        expect(Number.isNaN(Date.parse(standalone.BuildInfo.builtAt ?? ""))).toBe(false);
    });

    test("it exports exactly what the ESM build exports", () => {
        const names = Object.keys(standalone).sort();
        expect(names.length).toBeGreaterThan(100);
        expect(names).toEqual(Object.keys(esm).sort());
    });

    test("TypeRegistry holds the same type names as the ESM build", () => {
        const names = [...standalone.TypeRegistry.all].sort();
        expect(names.length).toBeGreaterThan(30);
        expect(names).toEqual([...esm.TypeRegistry.all].sort());
    });

    test("a class keeps its name", () => {
        expect(new standalone.GameObject("x").constructor.name).toBe("GameObject");
    });

    test("every exported function and class keeps the name it has in the ESM build", () => {
        const renamed: string[] = [];
        for (const key of Object.keys(esm)) {
            const expected = esm[key];
            const actual = standalone[key];
            if (typeof expected !== "function") continue;
            if (typeof actual !== "function" || actual.name !== expected.name) {
                renamed.push(`${key}: ${expected.name} -> ${typeof actual === "function" ? actual.name : typeof actual}`);
            }
        }
        expect(renamed).toEqual([]);
    });

    test("every registered type is a class that keeps its name", () => {
        const renamed: string[] = [];
        for (const typeName of esm.TypeRegistry.all) {
            const expected = esm.TypeRegistry.get(typeName);
            const actual = standalone.TypeRegistry.get(typeName);
            if (!expected || !actual || actual.name !== expected.name) {
                renamed.push(`${typeName}: ${expected?.name} -> ${actual?.name}`);
            }
        }
        expect(renamed).toEqual([]);
    });

    test("the licence notices of three.js and jszip survive minification", () => {
        expect(standaloneText).toMatch(/@license[\s\S]{0,40}Copyright[^\n]*Three\.js Authors/);
        expect(standaloneText).toMatch(/JSZip v\d+\.\d+\.\d+/);
    });

    test("it is minified and carries no source map reference", () => {
        // The map is written as a "hidden" one: hosts copy only the .js, so a
        // sourceMappingURL comment would point at a file that is not there.
        expect(standaloneText).not.toContain("sourceMappingURL");
        expect(standaloneText.split("\n").length).toBeLessThan(500);
    });
});
