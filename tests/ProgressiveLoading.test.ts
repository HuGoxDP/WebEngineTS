import { describe, test, expect, afterEach, vi } from "vitest";
import JSZip from "jszip";
import { parseStreamingManifest } from "../src/engine/core/assets/StreamingManifest";
import { StreamingAssetSource } from "../src/engine/core/assets/StreamingAssetSource";
import { Resources } from "../src/engine/core/assets/Resources";
import { JsonAsset } from "../src/engine/core/assets/AssetTypes";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import type { FetchLike } from "../src/engine/core/assets/StreamingAssetSource";

/**
 * Streaming Stage 1 — progressive first paint.
 *
 * `Scenario.run()` cannot be driven here: it imports Blob URLs, which Node has
 * no loader for. What is reachable is the mechanism (`Resources.prefetch`) and
 * the policy (which priorities the post-first-frame pass fetches), and those
 * are where the behaviour actually lives.
 */

/** A fetch that serves a table, records order, and tracks peak concurrency. */
function fakeFetch(files: Record<string, string>, delayTicks = 0) {
    const requested: string[] = [];
    let inFlight = 0;
    let peakInFlight = 0;

    const impl: FetchLike = async (url: string) => {
        requested.push(url);
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);

        for (let i = 0; i < delayTicks; i++) await Promise.resolve();

        inFlight--;
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

    return { impl, requested, peak: () => peakInFlight };
}

function jsonAssets(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        path: `data/a${i}.json`,
        lods: [{ level: 0, url: `a${i}.json` }],
    }));
}

function jsonFiles(count: number, base = "https://cdn.test/a/") {
    const files: Record<string, string> = {};
    for (let i = 0; i < count; i++) files[`${base}a${i}.json`] = `{"i":${i}}`;
    return files;
}

afterEach(() => {
    Resources.releaseSource();
});

describe("Resources.prefetch", () => {
    function install(count: number, extra: Record<string, string> = {}) {
        const fetcher = fakeFetch({ ...jsonFiles(count), ...extra });
        const source = new StreamingAssetSource(
            parseStreamingManifest({ schema: 1, id: "x", assets: jsonAssets(count) }),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
        );
        Resources.useSource(source);
        return fetcher;
    }

    test("a warmed asset is not fetched again when it is loaded", async () => {
        const fetcher = install(2);

        expect(await Resources.prefetch(["assets/data/a0.json", "data/a1.json"])).toBe(2);
        const asset = await Resources.load(JsonAsset, "data/a0");

        expect(asset.data).toEqual({ i: 0 });
        expect(fetcher.requested).toHaveLength(2);
    });

    test("a prefetch is not a use — nothing pins what was never asked for", async () => {
        install(2);

        await Resources.prefetch(["data/a0.json", "data/a1.json"]);
        expect(Resources.cacheSize).toBe(2);

        // Both sit at zero references, so an unused prefetch is reclaimable.
        expect(Resources.unloadUnused()).toBe(2);
        expect(Resources.cacheSize).toBe(0);
    });

    test("an asset that was prefetched and then loaded survives unloadUnused", async () => {
        install(1);

        await Resources.prefetch(["data/a0.json"]);
        await Resources.load(JsonAsset, "data/a0");

        expect(Resources.unloadUnused()).toBe(0);
        expect(Resources.cacheSize).toBe(1);
    });

    test("one missing asset does not cancel the other forty", async () => {
        // The same reason tryLoad exists rather than Promise.all.
        install(3);

        const warmed = await Resources.prefetch([
            "data/a0.json", "data/missing.json", "data/a2.json",
        ]);

        expect(warmed).toBe(2);
        expect(Resources.cacheSize).toBe(2);
    });

    test("a path no decoder claims is skipped, not thrown", async () => {
        install(1, { "https://cdn.test/a/weird.xyz": "?" });

        await expect(Resources.prefetch(["data/a0.json", "data/thing.xyz"]))
            .resolves.toBe(1);
    });

    test("progress is reported once per path, settled or not", async () => {
        install(2);
        const seen: Array<[number, number]> = [];

        await Resources.prefetch(["data/a0.json", "data/nope.json", "data/a1.json"], {
            concurrency: 1,
            onProgress: (completed, total) => seen.push([completed, total]),
        });

        expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    test("concurrency is bounded", async () => {
        const fetcher = fakeFetch(jsonFiles(10), 3);
        Resources.useSource(new StreamingAssetSource(
            parseStreamingManifest({ schema: 1, id: "x", assets: jsonAssets(10) }),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
        ));

        await Resources.prefetch(
            Array.from({ length: 10 }, (_, i) => `data/a${i}.json`),
            { concurrency: 3 },
        );

        // Both halves matter: unbounded would exceed the cap, and serialized
        // would never reach it.
        expect(fetcher.peak()).toBeLessThanOrEqual(3);
        expect(fetcher.peak()).toBeGreaterThan(1);
        expect(fetcher.requested).toHaveLength(10);
    });

    test("an empty list is not an error", async () => {
        install(1);
        expect(await Resources.prefetch([])).toBe(0);
    });

    test("prefetching without a source fails loudly", async () => {
        await expect(Resources.prefetch(["data/a0.json"]))
            .rejects.toThrow(/No asset source is active/);
    });
});

describe("Scenario — deferred loading after the first frame", () => {
    const manifestUrl = "https://cdn.test/s/scenario.json";

    const manifest = {
        schema: 1,
        id: "solar",
        entry: "scripts/main.js",
        scripts: [{ path: "scripts/main.js", url: "main.js" }],
        assets: [
            {
                path: "data/hud.json", priority: "critical",
                lods: [{ level: 0, url: "hud.json" }],
            },
            {
                path: "data/planet.json", priority: "high",
                lods: [{ level: 0, url: "planet.json" }],
            },
            {
                path: "data/moon.json", priority: "low",
                lods: [{ level: 0, url: "moon.json" }],
            },
            {
                path: "data/credits.json", priority: "lazy",
                lods: [{ level: 0, url: "credits.json" }],
            },
        ],
    };

    function serve() {
        return fakeFetch({
            [manifestUrl]: JSON.stringify(manifest),
            "https://cdn.test/s/hud.json": "{}",
            "https://cdn.test/s/planet.json": "{}",
            "https://cdn.test/s/moon.json": "{}",
            "https://cdn.test/s/credits.json": "{}",
        });
    }

    async function loadedScenario() {
        const fetcher = serve();
        const scenario = new Scenario();
        await scenario.loadFromManifestUrl(manifestUrl, { fetch: fetcher.impl });

        // run() installs the source normally, but it also imports Blob URLs,
        // which Node cannot do. The provider delegates to the same streaming
        // source, so installing it here exercises the real fetch path.
        Resources.useSource(scenario.assets!);
        return { scenario, fetcher };
    }

    test("time to first frame is unset until a frame is drawn", async () => {
        const { scenario } = await loadedScenario();

        expect(scenario.timeToFirstFrame).toBe(-1);

        scenario._onFrameRendered();

        expect(scenario.timeToFirstFrame).toBeGreaterThanOrEqual(0);
    });

    test("only the first frame counts, however many are reported", async () => {
        const { scenario } = await loadedScenario();

        scenario._onFrameRendered();
        const first = scenario.timeToFirstFrame;

        for (let i = 0; i < 5; i++) scenario._onFrameRendered();

        expect(scenario.timeToFirstFrame).toBe(first);
    });

    test("the deferred pass fetches high and low, and leaves lazy alone", async () => {
        const { scenario, fetcher } = await loadedScenario();

        scenario._onFrameRendered();

        await vi.waitFor(() => {
            expect(fetcher.requested).toContain("https://cdn.test/s/moon.json");
        });

        expect(fetcher.requested).toContain("https://cdn.test/s/planet.json");
        // `lazy` means "fetch only if something actually asks"; preloading it
        // here would make the declaration meaningless.
        expect(fetcher.requested).not.toContain("https://cdn.test/s/credits.json");
        // `critical` is the entry point's business, warmed before it runs.
        expect(fetcher.requested).not.toContain("https://cdn.test/s/hud.json");
    });

    test("the deferred pass runs once, not once per frame", async () => {
        const { scenario, fetcher } = await loadedScenario();

        scenario._onFrameRendered();
        await vi.waitFor(() => {
            expect(fetcher.requested).toContain("https://cdn.test/s/moon.json");
        });
        const afterFirst = fetcher.requested.length;

        for (let i = 0; i < 3; i++) scenario._onFrameRendered();
        await Promise.resolve();

        expect(fetcher.requested).toHaveLength(afterFirst);
    });

    test("a ZIP scenario still times its first frame, but defers nothing", async () => {
        // Progressive loading is a manifest-only affair: an archive is already
        // in memory, so there is nothing to fetch later. The timing is reported
        // either way, which is what makes a ZIP run and a streamed run of the
        // same content comparable.
        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify({
            manifestVersion: "1.0", id: "zipped", name: "Zipped",
            version: "1.0.0", entryPoint: "main.js",
        }));
        zip.file("scripts/main.js", "export default class {}");
        const buffer = await zip.generateAsync({ type: "arraybuffer" });

        const scenario = new Scenario();
        await scenario.loadFromData(buffer);

        expect(scenario.timeToFirstFrame).toBe(-1);
        scenario._onFrameRendered();

        expect(scenario.timeToFirstFrame).toBeGreaterThanOrEqual(0);
    });
});
