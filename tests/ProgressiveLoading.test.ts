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

describe("StreamingAssetSource — priority queue", () => {
    /** A fetch whose every response is held open until the test releases it. */
    function gatedFetch() {
        const started: string[] = [];
        const gates = new Map<string, (body: string) => void>();

        const impl: FetchLike = (url: string) => {
            started.push(url);
            return new Promise<Response>(resolve => {
                gates.set(url, (body: string) => {
                    const bytes = new TextEncoder().encode(body);
                    resolve({
                        ok: true,
                        status: 200,
                        arrayBuffer: async () => bytes.buffer.slice(0),
                    } as unknown as Response);
                });
            });
        };

        return {
            impl,
            started,
            /** Lets one in-flight request finish, then drains the microtask queue. */
            async release(url: string) {
                gates.get(url)!("ok");
                gates.delete(url);
                await vi.waitFor(() => expect(gates.size).toBeGreaterThanOrEqual(0));
                for (let i = 0; i < 8; i++) await Promise.resolve();
            },
        };
    }

    const priorities = ["critical", "high", "low", "lazy"] as const;

    function makeSource(maxConcurrentRequests: number) {
        const fetcher = gatedFetch();
        const source = new StreamingAssetSource(
            parseStreamingManifest({
                schema: 1, id: "x",
                assets: [
                    { path: "data/filler.json", priority: "high", lods: [{ url: "filler.json" }] },
                    ...priorities.map(p => ({
                        path: `data/${p}.json`,
                        priority: p,
                        lods: [{ url: `${p}.json` }],
                    })),
                ],
            }),
            {
                baseUrl: "https://cdn.test/a/",
                fetch: fetcher.impl,
                maxConcurrentRequests,
            },
        );
        return { source, fetcher };
    }

    const url = (name: string) => `https://cdn.test/a/${name}.json`;

    test("no more requests are in flight than the cap allows", async () => {
        const { source, fetcher } = makeSource(2);

        void source.readBytes("data/critical.json");
        void source.readBytes("data/high.json");
        void source.readBytes("data/low.json");
        void source.readBytes("data/lazy.json");
        await Promise.resolve();

        expect(fetcher.started).toHaveLength(2);
        expect(source.activeRequestCount).toBe(2);
        expect(source.pendingRequestCount).toBe(2);
    });

    test("queued speculative reads start in priority order, not submission order", async () => {
        const { source, fetcher } = makeSource(1);

        // The first submission takes the only slot; the rest queue.
        void source.readBytes("data/filler.json", { speculative: true });
        await Promise.resolve();
        void source.readBytes("data/lazy.json", { speculative: true });
        void source.readBytes("data/low.json", { speculative: true });
        void source.readBytes("data/critical.json", { speculative: true });
        void source.readBytes("data/high.json", { speculative: true });
        await Promise.resolve();

        expect(fetcher.started).toEqual([url("filler")]);

        await fetcher.release(url("filler"));
        expect(fetcher.started[1]).toBe(url("critical"));

        await fetcher.release(url("critical"));
        expect(fetcher.started[2]).toBe(url("high"));

        await fetcher.release(url("high"));
        expect(fetcher.started[3]).toBe(url("low"));

        await fetcher.release(url("low"));
        expect(fetcher.started[4]).toBe(url("lazy"));
    });

    test("a real read overtakes speculation, whatever the manifest calls it", async () => {
        // The declared priority says how eagerly to preload; an actual read is
        // something waiting. A `lazy` asset the scenario asked for must not
        // queue behind speculative `critical` work.
        const { source, fetcher } = makeSource(1);

        void source.readBytes("data/filler.json", { speculative: true });
        await Promise.resolve();
        void source.readBytes("data/critical.json", { speculative: true });
        void source.readBytes("data/lazy.json");
        await Promise.resolve();

        await fetcher.release(url("filler"));

        expect(fetcher.started[1]).toBe(url("lazy"));
    });

    test("a queued request is promoted when something asks for it for real", async () => {
        const { source, fetcher } = makeSource(1);

        void source.readBytes("data/filler.json", { speculative: true });
        await Promise.resolve();
        void source.readBytes("data/low.json", { speculative: true });
        void source.readBytes("data/critical.json", { speculative: true });
        await Promise.resolve();

        // `critical` would be next — until `low` is genuinely demanded.
        void source.readBytes("data/low.json");
        await Promise.resolve();

        await fetcher.release(url("filler"));

        expect(fetcher.started[1]).toBe(url("low"));
        // Promotion must not turn one asset into two requests.
        expect(fetcher.started.filter(u => u === url("low"))).toHaveLength(1);
    });

    test("waiters on one URL share a single request, queued or in flight", async () => {
        const { source, fetcher } = makeSource(1);

        const a = source.readText("data/critical.json");
        const b = source.readText("data/critical.json", { speculative: true });
        await Promise.resolve();

        await fetcher.release(url("critical"));

        expect(await a).toBe("ok");
        expect(await b).toBe("ok");
        expect(fetcher.started).toHaveLength(1);
        expect(source.requestCount).toBe(1);
    });

    test("a slot is released even when its request fails, and every waiter sees it", async () => {
        const fetcher = fakeFetch({});
        const source = new StreamingAssetSource(
            parseStreamingManifest({
                schema: 1, id: "x",
                assets: [
                    { path: "a.json", lods: [{ url: "a.json" }] },
                    { path: "b.json", lods: [{ url: "b.json" }] },
                ],
            }),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl, maxConcurrentRequests: 1 },
        );

        const first = source.readBytes("a.json");
        const alsoFirst = source.readBytes("a.json");

        await expect(first).rejects.toThrow(/404/);
        await expect(alsoFirst).rejects.toThrow(/404/);

        // The failure must not strand the slot, or the queue deadlocks.
        await expect(source.readBytes("b.json")).rejects.toThrow(/404/);
        expect(source.activeRequestCount).toBe(0);
        expect(source.pendingRequestCount).toBe(0);
    });

    test("raising the cap starts queued work; lowering it cancels nothing", async () => {
        const { source, fetcher } = makeSource(1);

        void source.readBytes("data/critical.json", { speculative: true });
        void source.readBytes("data/high.json", { speculative: true });
        void source.readBytes("data/low.json", { speculative: true });
        await Promise.resolve();
        expect(fetcher.started).toHaveLength(1);

        source.maxConcurrentRequests = 3;
        await Promise.resolve();
        expect(fetcher.started).toHaveLength(3);

        source.maxConcurrentRequests = 1;
        expect(source.activeRequestCount).toBe(3);
    });
});

describe("StreamingAssetSource — disposal stops the queue", () => {
    /** A fetch whose responses are held open until released. */
    function gatedFetch() {
        const started: string[] = [];
        const gates = new Map<string, () => void>();

        const impl: FetchLike = (url: string) => {
            started.push(url);
            return new Promise<Response>(resolve => {
                gates.set(url, () => {
                    const bytes = new TextEncoder().encode("ok");
                    resolve({
                        ok: true, status: 200,
                        arrayBuffer: async () => bytes.buffer.slice(0),
                    } as unknown as Response);
                });
            });
        };

        return {
            impl,
            started,
            async release(url: string) {
                gates.get(url)!();
                gates.delete(url);
                for (let i = 0; i < 8; i++) await Promise.resolve();
            },
        };
    }

    function makeSource() {
        const fetcher = gatedFetch();
        const source = new StreamingAssetSource(
            parseStreamingManifest({
                schema: 1, id: "x",
                assets: [
                    { path: "a.json", lods: [{ url: "a.json" }] },
                    { path: "b.json", lods: [{ url: "b.json" }] },
                ],
            }),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl, maxConcurrentRequests: 1 },
        );
        return { source, fetcher };
    }

    const url = (name: string) => `https://cdn.test/a/${name}`;

    test("a queued request is not sent once the scenario is gone", async () => {
        // dispose() documents that in-flight reads are left to settle. A queued
        // one was never sent — and used to be sent afterwards, fetching for a
        // scenario that had ended. Audit part 4, F20.
        const { source, fetcher } = makeSource();

        const first = source.readBytes("a.json");
        const queued = source.readBytes("b.json");
        await Promise.resolve();
        expect(fetcher.started).toEqual([url("a.json")]);

        source.dispose();
        await expect(queued).rejects.toThrow(/dispos/i);

        await fetcher.release(url("a.json"));
        await first;

        expect(fetcher.started).toEqual([url("a.json")]);
        expect(source.pendingRequestCount).toBe(0);
    });

    test("a read after disposal fails instead of resolving to nothing", async () => {
        // The queue kept its entry while `dispose` emptied the in-flight map,
        // so the shared-request path handed back `undefined` — which decodes as
        // an empty asset, the one outcome worse than an error.
        const { source } = makeSource();

        // Caught, not `void`ed: dispose rejects the queued one, and a rejection
        // nobody handles is reported as an unhandled error for the whole run.
        const inFlight = source.readBytes("a.json").catch(() => { /* never settles */ });
        const queued = source.readBytes("b.json").catch(() => { /* expected */ });
        await Promise.resolve();

        source.dispose();
        await queued;
        void inFlight;

        await expect(source.readBytes("b.json")).rejects.toThrow(/dispos/i);
        await expect(source.readText("a.json")).rejects.toThrow(/dispos/i);
        await expect(source.readScript("scripts/main.js")).rejects.toThrow();
    });

    test("it says so", async () => {
        const { source } = makeSource();

        expect(source.isDisposed).toBe(false);
        source.dispose();
        expect(source.isDisposed).toBe(true);
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
