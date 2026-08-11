import { describe, test, expect, beforeEach } from "vitest";
import {
    AssetPriority, normalizeAssetPath, parseStreamingManifest,
} from "../src/engine/core/assets/StreamingManifest";
import { StreamingAssetSource } from "../src/engine/core/assets/StreamingAssetSource";
import { Resources } from "../src/engine/core/assets/Resources";
import { JsonAsset } from "../src/engine/core/assets/AssetTypes";
import type { FetchLike } from "../src/engine/core/assets/StreamingAssetSource";

/** A fetch that serves a fixed table and records what was asked for. */
function fakeFetch(files: Record<string, string>) {
    const requested: string[] = [];
    const impl: FetchLike = async (url: string) => {
        requested.push(url);
        const body = files[url];
        if (body === undefined) {
            return { ok: false, status: 404 } as unknown as Response;
        }
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

function manifestJson(extra: Record<string, unknown> = {}) {
    return {
        schema: 1,
        id: "solar-system",
        assets: [
            {
                path: "textures/earth.ktx2",
                guid: "earth-guid",
                priority: "critical",
                lods: [
                    { level: 0, url: "earth-512.ktx2", bytes: 4 },
                    { level: 1, url: "earth-2048.ktx2", bytes: 9 },
                ],
            },
            {
                path: "assets/data/config.json",
                priority: "lazy",
                lods: [{ level: 0, url: "config.json" }],
            },
        ],
        ...extra,
    };
}

describe("StreamingManifest — parsing", () => {
    test("normalizes paths to the prefix the resolver uses", () => {
        const manifest = parseStreamingManifest(manifestJson());

        expect(manifest.assets.map(a => a.path)).toEqual([
            "assets/textures/earth.ktx2",
            "assets/data/config.json",
        ]);
    });

    test("normalizeAssetPath folds separators and leading dots", () => {
        expect(normalizeAssetPath("textures\\earth.png")).toBe("assets/textures/earth.png");
        expect(normalizeAssetPath("./textures/earth.png")).toBe("assets/textures/earth.png");
        expect(normalizeAssetPath("assets/textures/earth.png")).toBe("assets/textures/earth.png");
    });

    test("a missing priority defaults to High", () => {
        const manifest = parseStreamingManifest({
            schema: 1, id: "x",
            assets: [{ path: "a.png", lods: [{ level: 0, url: "a" }] }],
        });

        expect(manifest.assets[0].priority).toBe(AssetPriority.High);
    });

    test("LODs are sorted ascending however they were written", () => {
        const manifest = parseStreamingManifest({
            schema: 1, id: "x",
            assets: [{
                path: "a.png",
                lods: [{ level: 2, url: "hi" }, { level: 0, url: "lo" }, { level: 1, url: "mid" }],
            }],
        });

        expect(manifest.assets[0].lods.map(l => l.url)).toEqual(["lo", "mid", "hi"]);
    });

    test("a missing level falls back to the array index", () => {
        const manifest = parseStreamingManifest({
            schema: 1, id: "x",
            assets: [{ path: "a.png", lods: [{ url: "lo" }, { url: "hi" }] }],
        });

        expect(manifest.assets[0].lods.map(l => l.level)).toEqual([0, 1]);
    });

    test("a manifest the engine cannot read fails where it can be pointed at", () => {
        // A malformed manifest has no user between the tool that wrote it and
        // the loader; failing late would surface as a texture that never appears.
        expect(() => parseStreamingManifest({ id: "x", assets: [] }))
            .toThrow(/Missing 'schema'/);
        expect(() => parseStreamingManifest({ schema: 2, id: "x", assets: [] }))
            .toThrow(/Unsupported schema 2/);
        expect(() => parseStreamingManifest({ schema: 1, assets: [] }))
            .toThrow(/Missing 'id'/);
        expect(() => parseStreamingManifest({ schema: 1, id: "x" }))
            .toThrow(/Missing 'assets'/);
        expect(() => parseStreamingManifest({
            schema: 1, id: "x", assets: [{ path: "a.png", lods: [] }],
        })).toThrow(/at least one entry in 'lods'/);
        expect(() => parseStreamingManifest({
            schema: 1, id: "x", assets: [{ path: "a.png", lods: [{ level: 0 }] }],
        })).toThrow(/missing 'url'/);
        expect(() => parseStreamingManifest({
            schema: 1, id: "x",
            assets: [{ path: "a.png", priority: "urgent", lods: [{ url: "a" }] }],
        })).toThrow(/unknown priority "urgent"/);
    });

    test("two assets cannot claim one path", () => {
        expect(() => parseStreamingManifest({
            schema: 1, id: "x",
            assets: [
                { path: "a.png", lods: [{ url: "1" }] },
                { path: "assets/a.png", lods: [{ url: "2" }] },
            ],
        })).toThrow(/Duplicate asset path/);
    });
});

describe("StreamingAssetSource", () => {
    let source: StreamingAssetSource;
    let requested: string[];

    const files = {
        "https://cdn.test/a/earth-512.ktx2": "LOW.",
        "https://cdn.test/a/earth-2048.ktx2": "HIGH-DATA",
        "https://cdn.test/a/config.json": '{"speed":2}',
    };

    beforeEach(() => {
        const fetcher = fakeFetch(files);
        requested = fetcher.requested;
        source = new StreamingAssetSource(
            parseStreamingManifest(manifestJson()),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
        );
    });

    test("it answers has/list synchronously from the manifest", () => {
        expect(source.has("textures/earth.ktx2")).toBe(true);
        expect(source.has("assets/textures/earth.ktx2")).toBe(true);
        expect(source.has("textures/mars.ktx2")).toBe(false);

        expect(source.list()).toHaveLength(2);
        expect(source.list("textures/")).toEqual(["assets/textures/earth.ktx2"]);
    });

    test("a read fetches the most detailed level", async () => {
        const bytes = await source.readBytes("textures/earth.ktx2");

        expect(new TextDecoder().decode(bytes)).toBe("HIGH-DATA");
        expect(requested).toEqual(["https://cdn.test/a/earth-2048.ktx2"]);
    });

    test("maxLodLevel caps quality without touching the manifest", async () => {
        source.maxLodLevel = 0;

        expect(await source.readText("textures/earth.ktx2")).toBe("LOW.");
        expect(source.urlFor("textures/earth.ktx2")).toBe("https://cdn.test/a/earth-512.ktx2");
    });

    test("a cap below every level still returns the coarsest one", async () => {
        source.maxLodLevel = -5;

        expect(await source.readText("textures/earth.ktx2")).toBe("LOW.");
    });

    test("concurrent reads of one path share a single request", async () => {
        const [a, b] = await Promise.all([
            source.readText("textures/earth.ktx2"),
            source.readText("assets/textures/earth.ktx2"),
        ]);

        expect(a).toBe(b);
        expect(requested).toHaveLength(1);
    });

    test("bytes and requests are counted", async () => {
        await source.readText("textures/earth.ktx2");
        await source.readText("data/config.json");

        expect(source.requestCount).toBe(2);
        expect(source.bytesFetched).toBe("HIGH-DATA".length + '{"speed":2}'.length);
    });

    test("a path the manifest does not list fails by name", async () => {
        await expect(source.readBytes("textures/mars.png"))
            .rejects.toThrow(/Not in the manifest: assets\/textures\/mars.png/);
    });

    test("a failed fetch names the path and the status", async () => {
        const fetcher = fakeFetch({});
        const missing = new StreamingAssetSource(
            parseStreamingManifest(manifestJson()),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
        );

        await expect(missing.readBytes("textures/earth.ktx2"))
            .rejects.toThrow(/Fetch failed for "assets\/textures\/earth.ktx2": 404/);
    });

    test("identities are handed over in the shape AssetDatabase takes", () => {
        // Assets without a guid are omitted: a minted id that does not survive
        // a reload is worse than none, because it looks stable.
        expect(source.assetEntries()).toEqual([
            { guid: "earth-guid", path: "assets/textures/earth.ktx2" },
        ]);
    });

    test("priorities are queryable even though nothing orders by them yet", () => {
        expect(source.pathsByPriority(AssetPriority.Critical))
            .toEqual(["assets/textures/earth.ktx2"]);
        expect(source.pathsByPriority(AssetPriority.Lazy))
            .toEqual(["assets/data/config.json"]);
        expect(source.pathsByPriority(AssetPriority.Low)).toEqual([]);
    });
});

describe("StreamingAssetSource — through Resources", () => {
    test("scenario code loads from a manifest exactly as it would from a ZIP", async () => {
        const fetcher = fakeFetch({ "https://cdn.test/a/config.json": '{"speed":2}' });
        const source = new StreamingAssetSource(
            parseStreamingManifest(manifestJson()),
            { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
        );

        Resources.useSource(source);
        try {
            // No extension and no "assets/" prefix — the same call a scenario
            // makes today against the ZIP source. That this works unchanged is
            // the point of implementing IAssetSource rather than a new API.
            const config = await Resources.load(JsonAsset, "data/config");

            expect(config.data).toEqual({ speed: 2 });
            expect(fetcher.requested).toEqual(["https://cdn.test/a/config.json"]);
        } finally {
            Resources.releaseSource();
        }
    });

    test("installing a second source releases the first", async () => {
        const first = new StreamingAssetSource(
            parseStreamingManifest(manifestJson()),
            { baseUrl: "https://cdn.test/a/", fetch: fakeFetch({}).impl },
        );
        const second = new StreamingAssetSource(
            parseStreamingManifest({
                schema: 1, id: "other",
                assets: [{ path: "b.json", lods: [{ url: "b.json" }] }],
            }),
            { baseUrl: "https://cdn.test/a/", fetch: fakeFetch({}).impl },
        );

        Resources.useSource(first);
        Resources.useSource(second);
        try {
            expect(Resources.hasSource).toBe(true);
        } finally {
            Resources.releaseSource();
        }
        expect(Resources.hasSource).toBe(false);
    });
});

describe("StreamingAssetSource — per-asset detail levels", () => {
    const files = {
        "https://cdn.test/a/earth-512.ktx2": "LOW.",
        "https://cdn.test/a/earth-2048.ktx2": "HIGH-DATA",
        "https://cdn.test/a/config.json": '{"speed":2}',
    };

    function makeSource() {
        return new StreamingAssetSource(
            parseStreamingManifest(manifestJson()),
            { baseUrl: "https://cdn.test/a/", fetch: fakeFetch(files).impl },
        );
    }

    test("a per-asset level picks that level for that asset alone", async () => {
        const source = makeSource();

        source.setLodLevel("textures/earth.ktx2", 0);

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(0);
        expect(await source.readText("textures/earth.ktx2")).toBe("LOW.");
        // The other asset is untouched by a request aimed at this one.
        expect(source.getLodLevel("data/config.json")).toBe(0);
    });

    test("the prefix is optional, as everywhere else", () => {
        const source = makeSource();

        source.setLodLevel("assets/textures/earth.ktx2", 0);

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(0);
    });

    test("the global ceiling wins over a more ambitious per-asset request", () => {
        // maxLodLevel is a ceiling, not a default — lowering it must not be
        // undoable asset by asset.
        const source = makeSource();
        source.maxLodLevel = 0;

        source.setLodLevel("textures/earth.ktx2", 1);

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(0);
    });

    test("a per-asset request below the ceiling still applies", () => {
        const source = makeSource();
        source.maxLodLevel = 1;

        source.setLodLevel("textures/earth.ktx2", 0);

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(0);
    });

    test("asking for more than the asset offers gives its best", () => {
        const source = makeSource();

        source.setLodLevel("textures/earth.ktx2", 99);

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(1);
    });

    test("asking below the coarsest still returns the coarsest", () => {
        const source = makeSource();

        source.setLodLevel("textures/earth.ktx2", -5);

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(0);
    });

    test("clearing returns the asset to the global ceiling", () => {
        const source = makeSource();
        source.setLodLevel("textures/earth.ktx2", 0);

        source.clearLodLevel("textures/earth.ktx2");

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(1);
    });

    test("raising the ceiling lets an earlier request through again", () => {
        const source = makeSource();
        source.setLodLevel("textures/earth.ktx2", 1);
        source.maxLodLevel = 0;
        expect(source.getLodLevel("textures/earth.ktx2")).toBe(0);

        source.maxLodLevel = Number.POSITIVE_INFINITY;

        expect(source.getLodLevel("textures/earth.ktx2")).toBe(1);
    });

    test("a level set for a path the manifest does not list fails by name", () => {
        const source = makeSource();

        expect(() => source.setLodLevel("textures/mars.png", 0))
            .toThrow(/Not in the manifest: assets\/textures\/mars.png/);
        expect(source.getLodLevel("textures/mars.png")).toBeNull();
    });

    test("the level chosen is the one the URL points at", () => {
        const source = makeSource();

        source.setLodLevel("textures/earth.ktx2", 0);

        expect(source.urlFor("textures/earth.ktx2"))
            .toBe("https://cdn.test/a/earth-512.ktx2");
    });
});

describe("StreamingAssetSource — URL resolution", () => {
    test("a relative base is joined textually", async () => {
        const fetcher = fakeFetch({ "/scenarios/solar/earth-2048.ktx2": "OK" });
        const source = new StreamingAssetSource(
            parseStreamingManifest(manifestJson()),
            { baseUrl: "/scenarios/solar/scenario.json", fetch: fetcher.impl },
        );

        // new URL() cannot resolve against a path, so the source falls back to
        // replacing the last segment — the behaviour a browser would give.
        expect(await source.readText("textures/earth.ktx2")).toBe("OK");
    });

    test("an absolute asset URL ignores the base", () => {
        const source = new StreamingAssetSource(parseStreamingManifest({
            schema: 1, id: "x",
            assets: [{ path: "a.png", lods: [{ url: "https://other.test/a.png" }] }],
        }), { baseUrl: "https://cdn.test/a/" });

        expect(source.urlFor("a.png")).toBe("https://other.test/a.png");
    });

    test("fromUrl reads the manifest and makes its own location the base", async () => {
        const fetcher = fakeFetch({
            "https://cdn.test/s/scenario.json": JSON.stringify(manifestJson()),
            "https://cdn.test/s/earth-2048.ktx2": "FROM-URL",
        });

        const source = await StreamingAssetSource.fromUrl(
            "https://cdn.test/s/scenario.json", { fetch: fetcher.impl },
        );

        expect(source.manifest.id).toBe("solar-system");
        expect(await source.readText("textures/earth.ktx2")).toBe("FROM-URL");
    });

    test("the manifest's own baseUrl wins over its location", async () => {
        const fetcher = fakeFetch({
            "https://cdn.test/s/scenario.json": JSON.stringify(
                manifestJson({ baseUrl: "https://assets.test/a/" }),
            ),
        });

        const source = await StreamingAssetSource.fromUrl(
            "https://cdn.test/s/scenario.json", { fetch: fetcher.impl },
        );

        expect(source.urlFor("textures/earth.ktx2"))
            .toBe("https://assets.test/a/earth-2048.ktx2");
    });

    test("a manifest that will not load says so", async () => {
        const fetcher = fakeFetch({});

        await expect(StreamingAssetSource.fromUrl("https://cdn.test/nope.json", {
            fetch: fetcher.impl,
        })).rejects.toThrow(/Manifest fetch failed: 404/);
    });
});
