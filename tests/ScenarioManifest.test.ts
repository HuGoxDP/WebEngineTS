import { describe, test, expect } from "vitest";
import JSZip from "jszip";
import {
    normalizeScriptPath, parseStreamingManifest, toScenarioManifest,
} from "../src/engine/core/assets/StreamingManifest";
import { StreamingAssetSource } from "../src/engine/core/assets/StreamingAssetSource";
import { ZipAssetSource } from "../src/engine/core/assets/ZipAssetSource";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import { ScenarioLoadState } from "../src/engine/core/scenario/ScenarioTypes";
import type { FetchLike } from "../src/engine/core/assets/StreamingAssetSource";
import type { IScenarioLoadProgress } from "../src/engine/core/scenario/ScenarioTypes";

/**
 * These tests stop at the `Ready` state rather than calling `run()`. Running a
 * scenario needs `import()` of a Blob URL, which Node cannot do — so the parts
 * that are reachable here are the manifest conversion and the script source,
 * which is where the manifest path actually differs from the ZIP one.
 */

function fakeFetch(files: Record<string, string>) {
    const requested: string[] = [];
    const impl: FetchLike = async (url: string) => {
        requested.push(url);
        const body = files[url];
        if (body === undefined) return { ok: false, status: 404 } as unknown as Response;
        const bytes = new TextEncoder().encode(body);
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
            json: async () => JSON.parse(body),
        } as unknown as Response;
    };
    return { impl, requested };
}

function runnableManifest(extra: Record<string, unknown> = {}) {
    return {
        schema: 1,
        id: "solar-system",
        name: "Solar System",
        version: 3,
        entry: "scripts/main.js",
        scripts: [
            { path: "scripts/main.js", url: "main-9f3c.js" },
            { path: "helpers/orbit.js", url: "orbit-2b1a.js" },
        ],
        assets: [
            {
                path: "textures/earth.png",
                guid: "earth-guid",
                priority: "critical",
                lods: [{ level: 0, url: "earth.png" }],
            },
            { path: "data/config.json", lods: [{ level: 0, url: "config.json" }] },
        ],
        ...extra,
    };
}

describe("StreamingManifest — scripts", () => {
    test("script paths are normalized to the prefix imports resolve against", () => {
        const manifest = parseStreamingManifest(runnableManifest());

        expect(manifest.scripts!.map(s => s.path)).toEqual([
            "scripts/main.js",
            "scripts/helpers/orbit.js",
        ]);
        expect(manifest.entry).toBe("scripts/main.js");
    });

    test("normalizeScriptPath folds separators and supplies the extension", () => {
        expect(normalizeScriptPath("helpers\\orbit")).toBe("scripts/helpers/orbit.js");
        expect(normalizeScriptPath("./main.js")).toBe("scripts/main.js");
        expect(normalizeScriptPath("scripts/main.js")).toBe("scripts/main.js");
    });

    test("an entry point that is not in the script list fails at parse time", () => {
        // A manifest is written by a tool and read by a loader with no user in
        // between, so this has to fail where it can still be pointed at.
        expect(() => parseStreamingManifest(runnableManifest({ entry: "scripts/nope.js" })))
            .toThrow(/not in 'scripts'/);
    });

    test("scripts without an entry, and an entry without scripts, both fail", () => {
        expect(() => parseStreamingManifest(runnableManifest({ entry: undefined })))
            .toThrow(/lists scripts but no 'entry'/);
        expect(() => parseStreamingManifest(runnableManifest({ scripts: undefined })))
            .toThrow(/lists no scripts/);
    });

    test("a malformed script entry names itself", () => {
        expect(() => parseStreamingManifest({
            schema: 1, id: "x", entry: "a.js",
            scripts: [{ path: "a.js" }],
            assets: [],
        })).toThrow(/scripts\[0\] is missing 'url'/);

        expect(() => parseStreamingManifest({
            schema: 1, id: "x", entry: "a.js",
            scripts: [{ path: "a.js", url: "1" }, { path: "scripts/a.js", url: "2" }],
            assets: [],
        })).toThrow(/Duplicate script path "scripts\/a.js"/);
    });

    test("an asset-only manifest is still valid — it just cannot be run", () => {
        const manifest = parseStreamingManifest({
            schema: 1, id: "x",
            assets: [{ path: "a.png", lods: [{ url: "a" }] }],
        });

        expect(manifest.scripts).toBeUndefined();
        expect(manifest.entry).toBeUndefined();
    });
});

describe("toScenarioManifest", () => {
    test("it produces the manifest shape the ZIP path produces", () => {
        const scenario = toScenarioManifest(parseStreamingManifest(runnableManifest()));

        expect(scenario).toEqual({
            manifestVersion: "1.0",
            id: "solar-system",
            name: "Solar System",
            version: "3",
            // Scenario resolves the entry point against `scripts/`, so the
            // prefix that disambiguates it in the manifest comes back off.
            entryPoint: "main.js",
            assets: [{ guid: "earth-guid", path: "assets/textures/earth.png" }],
        });
    });

    test("the display name falls back to the id", () => {
        const scenario = toScenarioManifest(
            parseStreamingManifest(runnableManifest({ name: undefined })),
        );

        expect(scenario.name).toBe("solar-system");
    });

    test("an asset without a guid contributes no identity", () => {
        // A minted id that does not survive a reload is worse than none,
        // because it looks stable.
        const scenario = toScenarioManifest(parseStreamingManifest(runnableManifest()));

        expect(scenario.assets).toHaveLength(1);
    });

    test("a manifest with nothing to run says so, and says what to do instead", () => {
        const assetsOnly = parseStreamingManifest({
            schema: 1, id: "x", assets: [{ path: "a.png", lods: [{ url: "a" }] }],
        });

        expect(() => toScenarioManifest(assetsOnly))
            .toThrow(/Resources.useSource/);
    });
});

describe("StreamingAssetSource — scripts", () => {
    const files = {
        "https://cdn.test/a/main-9f3c.js": "export default class {}",
        "https://cdn.test/a/orbit-2b1a.js": "export const orbit = 1;",
    };

    function makeSource() {
        const fetcher = fakeFetch(files);
        const source = new StreamingAssetSource(
            parseStreamingManifest(runnableManifest()),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
        );
        return { source, requested: fetcher.requested };
    }

    test("it lists every module the manifest declares", () => {
        const { source } = makeSource();

        expect(source.listScripts()).toEqual([
            "scripts/main.js",
            "scripts/helpers/orbit.js",
        ]);
    });

    test("a script is read from its own URL, prefix optional", async () => {
        const { source, requested } = makeSource();

        expect(await source.readScript("main.js")).toBe("export default class {}");
        expect(await source.readScript("scripts/helpers/orbit.js"))
            .toBe("export const orbit = 1;");
        expect(requested).toEqual([
            "https://cdn.test/a/main-9f3c.js",
            "https://cdn.test/a/orbit-2b1a.js",
        ]);
    });

    test("scripts stay out of the IAssetSource face", async () => {
        // Resources decodes assets into engine objects; a module is neither
        // decodable that way nor something scenario code should reach by path.
        const { source } = makeSource();

        expect(source.has("scripts/main.js")).toBe(false);
        expect(source.list()).toEqual([
            "assets/textures/earth.png",
            "assets/data/config.json",
        ]);
    });

    test("a module the manifest does not list fails by name", async () => {
        const { source } = makeSource();

        await expect(source.readScript("missing.js"))
            .rejects.toThrow(/Script not in the manifest: scripts\/missing.js/);
    });

    test("concurrent reads of one module share a single request", async () => {
        const { source, requested } = makeSource();

        await Promise.all([source.readScript("main.js"), source.readScript("main.js")]);

        expect(requested).toHaveLength(1);
    });
});

describe("ZipAssetSource", () => {
    function makeZip(): JSZip {
        const zip = new JSZip();
        zip.file("manifest.json", '{"id":"x"}');
        zip.file("scripts/main.js", "export default class {}");
        zip.file("scripts/helpers/orbit.js", "export const orbit = 1;");
        zip.file("scripts/notes.txt", "not a module");
        zip.file("assets/textures/earth.png", "PNGDATA");
        return zip;
    }

    test("it lists only the .js modules under scripts/", () => {
        const source = new ZipAssetSource(makeZip());

        expect([...source.listScripts()].sort()).toEqual([
            "scripts/helpers/orbit.js",
            "scripts/main.js",
        ]);
    });

    test("a script is read with or without the prefix", async () => {
        const source = new ZipAssetSource(makeZip());

        expect(await source.readScript("main.js")).toBe("export default class {}");
        expect(await source.readScript("scripts/main.js")).toBe("export default class {}");
    });

    test("reads after release throw rather than returning nothing", async () => {
        // A scenario that released too early has a bug, and a silent empty read
        // would hide it until a texture failed to appear.
        const source = new ZipAssetSource(makeZip());
        source.release();

        expect(source.isReleased).toBe(true);
        expect(source.has("manifest.json")).toBe(false);
        await expect(source.readText("manifest.json")).rejects.toThrow(/has been released/);
    });

    test("a missing file fails by name", async () => {
        const source = new ZipAssetSource(makeZip());

        await expect(source.readBytes("assets/nope.png"))
            .rejects.toThrow(/File not found: assets\/nope.png/);
    });
});

describe("Scenario — loading from a manifest", () => {
    const manifestUrl = "https://cdn.test/s/scenario.json";

    function serve(manifest: Record<string, unknown>) {
        return fakeFetch({ [manifestUrl]: JSON.stringify(manifest) });
    }

    test("it reaches Ready with the same manifest shape a ZIP would give", async () => {
        const fetcher = serve(runnableManifest());
        const scenario = new Scenario();

        await scenario.loadFromManifestUrl(manifestUrl, { fetch: fetcher.impl });

        expect(scenario.loadState).toBe(ScenarioLoadState.Ready);
        expect(scenario.isLoaded).toBe(true);
        expect(scenario.manifest!.id).toBe("solar-system");
        expect(scenario.manifest!.entryPoint).toBe("main.js");
        expect(scenario.name).toBe("Solar System");
        expect(scenario.assets).not.toBeNull();
    });

    test("only the manifest is fetched — scripts and assets wait for the run", async () => {
        // Pre-linking happens in run(); loading is a single round trip, which is
        // what makes a manifest cheaper to open than an archive.
        const fetcher = serve(runnableManifest());

        await new Scenario().loadFromManifestUrl(manifestUrl, { fetch: fetcher.impl });

        expect(fetcher.requested).toEqual([manifestUrl]);
    });

    test("progress is reported through the same callback the ZIP path uses", async () => {
        const fetcher = serve(runnableManifest());
        const seen: IScenarioLoadProgress[] = [];
        const scenario = new Scenario();

        scenario.onProgress(p => seen.push({ ...p }));
        await scenario.loadFromManifestUrl(manifestUrl, { fetch: fetcher.impl });

        expect(seen.map(p => p.state)).toEqual([
            ScenarioLoadState.Loading,
            ScenarioLoadState.Loading,
            ScenarioLoadState.Loading,
            ScenarioLoadState.Ready,
        ]);
        expect(seen[seen.length - 1].progress).toBe(1);
    });

    test("a manifest that cannot be fetched leaves the scenario in Error", async () => {
        const fetcher = fakeFetch({});
        const scenario = new Scenario();

        await expect(scenario.loadFromManifestUrl(manifestUrl, { fetch: fetcher.impl }))
            .rejects.toThrow(/Manifest fetch failed: 404/);
        expect(scenario.loadState).toBe(ScenarioLoadState.Error);
        expect(scenario.isLoaded).toBe(false);
    });

    test("an asset-only manifest is refused as a scenario", async () => {
        const fetcher = serve({
            schema: 1, id: "x", assets: [{ path: "a.png", lods: [{ url: "a" }] }],
        });
        const scenario = new Scenario();

        await expect(scenario.loadFromManifestUrl(manifestUrl, { fetch: fetcher.impl }))
            .rejects.toThrow(/describes assets but no scenario to run/);
        expect(scenario.loadState).toBe(ScenarioLoadState.Error);
    });

    test("run() before loading names all three ways to load", async () => {
        await expect(new Scenario().run()).rejects.toThrow(/loadFromManifestUrl/);
    });
});
