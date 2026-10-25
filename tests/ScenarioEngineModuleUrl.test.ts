import { describe, test, expect, afterEach, vi } from "vitest";
import { Scenario } from "../src/engine/core/scenario/Scenario";

const URL_ = "https://example.com/engine/WebEngineTS.js";
const L = JSON.stringify(URL_);
const rw = (code: string) => Scenario._rewriteEngineImports(code, URL_);

afterEach(() => {
    Scenario.engineModuleUrl = null;
});

describe("DW-2.1 bare WebEngineTS rewrite", () => {
    const forms: Array<[string, (q: string) => string, string]> = [
        ["import x from", q => `import x from ${q}WebEngineTS${q};`, `import x from ${L};`],
        ["import x, { y } from", q => `import x, { y } from ${q}WebEngineTS${q};`, `import x, { y } from ${L};`],
        ["multi-line import { a, b } from", q => `import {\n a,\n b\n} from ${q}WebEngineTS${q};`, `import {\n a,\n b\n} from ${L};`],
        ["import * as", q => `import * as E from ${q}WebEngineTS${q};`, `import * as E from ${L};`],
        ["export { y } from", q => `export { y } from ${q}WebEngineTS${q};`, `export { y } from ${L};`],
        ["export * from", q => `export * from ${q}WebEngineTS${q};`, `export * from ${L};`],
        ["side-effect import", q => `import ${q}WebEngineTS${q};`, `import ${L};`],
        ["dynamic import()", q => `const m = await import(${q}WebEngineTS${q});`, `const m = await import(${L});`],
        ["dynamic import( spaced )", q => `import( ${q}WebEngineTS${q} )`, `import( ${L} )`],
    ];

    for (const [name, input, expected] of forms) {
        for (const q of ['"', "'"]) {
            test(`${name} with ${q}`, () => {
                expect(rw(input(q))).toBe(expected);
            });
        }
    }

    test("every occurrence in one file is rewritten", () => {
        const out = rw(`import a from "WebEngineTS";\nimport b from 'WebEngineTS';`);
        expect(out).toBe(`import a from ${L};\nimport b from ${L};`);
    });

    test("untouched when the URL is unset (byte-identical)", () => {
        const code = `import a from "WebEngineTS";\nimport "./x.js";\nawait import('WebEngineTS');`;
        expect(Scenario.engineModuleUrl).toBeNull();
        expect(Scenario._rewriteEngineImports(code, Scenario.engineModuleUrl)).toBe(code);
    });

    test("a '$&' in the URL is not treated as a replacement pattern", () => {
        const out = Scenario._rewriteEngineImports(`import a from "WebEngineTS";`, "https://e.com/a$&b.js");
        expect(out).toBe(`import a from "https://e.com/a$&b.js";`);
    });
});

describe("DW-2.1 things that must not be rewritten", () => {
    test.each([
        `import a from "WebEngineTS/sub";`,
        `import a from "WebEngineTSx";`,
        `import a from "xWebEngineTS";`,
        `import a from "webenginets";`,
        `import a from "./WebEngineTS";`,
        `import a from "https://cdn/WebEngineTS";`,
        `import a from "WebEngineTS';`,
        `const s = Array.from("WebEngineTS");`,
        `foo.import("WebEngineTS");`,
    ])("leaves %s alone", code => {
        expect(rw(code)).toBe(code);
    });

    test("documented limit: a from-string inside a string literal is rewritten", () => {
        expect(rw(`const s = 'import a from "WebEngineTS"';`)).toBe(`const s = 'import a from ${L}';`);
    });
});

describe("DW-2.1 engineModuleUrl setter", () => {
    test("defaults to null and round-trips a valid URL", () => {
        expect(Scenario.engineModuleUrl).toBeNull();
        Scenario.engineModuleUrl = URL_;
        expect(Scenario.engineModuleUrl).toBe(URL_);
        Scenario.engineModuleUrl = null;
        expect(Scenario.engineModuleUrl).toBeNull();
    });

    test.each([
        "https://example.com/e.js",
        "http://localhost:4200/WebEngineTS.js",
        "blob:https://example.com/3f1c2a",
    ])("accepts %s", v => {
        expect(() => { Scenario.engineModuleUrl = v; }).not.toThrow();
        expect(Scenario.engineModuleUrl).toBe(v);
    });

    test.each([
        ["relative", "/engine/WebEngineTS.js"],
        ["relative dot", "./WebEngineTS.js"],
        ["empty", ""],
        ["bare name", "WebEngineTS"],
        ["javascript scheme", "javascript:alert(1)"],
        ["data scheme", "data:text/javascript,1"],
        ["file scheme", "file:///a.js"],
        ["double quote", 'https://e.com/a".js'],
        ["single quote", "https://e.com/a'.js"],
        ["backtick", "https://e.com/a`.js"],
        ["backslash", "https://e.com/a\\b.js"],
        ["newline", "https://e.com/a\n.js"],
        ["carriage return", "https://e.com/a\r.js"],
        ["tab", "https://e.com/a\t.js"],
        ["space", "https://e.com/a b.js"],
        ["less-than", "https://e.com/a<b.js"],
        ["script close", "https://e.com/</script>.js"],
        ["line separator", "https://e.com/a .js"],
    ])("rejects %s", (_n, v) => {
        Scenario.engineModuleUrl = URL_;
        expect(() => { Scenario.engineModuleUrl = v; }).toThrow(/engineModuleUrl/);
        expect(Scenario.engineModuleUrl).toBe(URL_);
    });
});

describe("DW-2.1 through the pre-linker blob path", () => {
    async function prelinked(files: Record<string, string>): Promise<string[]> {
        const blobs: string[] = [];
        vi.stubGlobal("Blob", class { constructor(parts: string[]) { blobs.push(parts[0]); } });
        const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${blobs.length}`);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            const s = Object.create(Scenario.prototype) as Record<string, unknown>;
            s._scripts = {
                listScripts: () => Object.keys(files),
                readScript: async (p: string) => files[p],
            };
            s._scriptBlobUrlMap = new Map();
            s._scriptBlobUrls = [];
            await (s as unknown as { _prelinkAllScripts(): Promise<void> })._prelinkAllScripts();
        } finally {
            log.mockRestore();
            create.mockRestore();
            vi.unstubAllGlobals();
        }
        return blobs;
    }

    const files = {
        "scripts/a.js": `import { x } from "./b.js";\nimport E from "WebEngineTS";`,
        "scripts/b.js": `export * from "WebEngineTS"; export const x = 1;`,
    };

    test("rewrites the engine import in every module and still links relative ones", async () => {
        Scenario.engineModuleUrl = URL_;
        const [b, a] = await prelinked(files);
        expect(b).toBe(`export * from ${L}; export const x = 1;`);
        expect(a).toBe(`import { x } from "blob:test/1";\nimport E from ${L};`);
    });

    test("with the URL unset the bare import is left for the import map", async () => {
        const [b, a] = await prelinked(files);
        expect(b).toBe(files["scripts/b.js"]);
        expect(a).toBe(`import { x } from "blob:test/1";\nimport E from "WebEngineTS";`);
    });
});
