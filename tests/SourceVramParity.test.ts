import { describe, test, expect, afterEach, vi } from "vitest";

/**
 * The two delivery paths must account for textures identically.
 *
 * The Virtual Lab platform measured the same scenario twice — once from a ZIP,
 * once from a manifest — and read 92.8 MB of estimated texture VRAM against
 * 269.8 MB, with the same 19 live GPU textures either way. That is the opposite
 * of what a VRAM budget assumes, and it is why that platform does not default to
 * the streaming path.
 *
 * This pins the part of it that lives in the engine: `Resources` plus a source.
 * Given the same files under the same paths, the source type must not change how
 * many texture objects survive a load, nor what they are estimated to cost. It
 * does not reproduce the 2.9x, which means the difference is somewhere the
 * engine's own machinery is not — see `design/upstream-answers.md`.
 */

vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Resources } = await import("../src/engine/core/assets/Resources");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { Texture } = await import("../src/engine/core/graphics/Texture");
const { EngineObject } = await import("../src/engine/core/EngineObject");
const { StreamingAssetSource } = await import("../src/engine/core/assets/StreamingAssetSource");
const { parseStreamingManifest } = await import("../src/engine/core/assets/StreamingManifest");

const PATHS = ["textures/a.jpg", "textures/b.jpg", "textures/c.jpg"];
/** The decoded size is carried in the body, so the estimator sees a real one. */
const BODY = "256";

/** A plain in-memory source, standing in for the ZIP path. */
function zipLike() {
    const files = new Map<string, Uint8Array>();
    for (const p of PATHS) files.set(`assets/${p}`, new TextEncoder().encode(BODY));
    return {
        has: (p: string) => files.has(p),
        list: () => [...files.keys()],
        readBytes: async (p: string) => files.get(p)!,
        readText: async (p: string) => new TextDecoder().decode(files.get(p)!),
        getBlobUrl: async () => "blob:x",
    };
}

/** The same files, delivered one fetch at a time through a manifest. */
function streamingLike() {
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode(BODY).buffer.slice(0),
    } as unknown as Response);

    return new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1,
            id: "x",
            assets: PATHS.map(p => ({ path: p, lods: [{ level: 0, url: p }] })),
        }),
        { baseUrl: "https://cdn.test/a/", fetch: fetchImpl },
    );
}

function registerDecoder(): void {
    Resources.registerDecoder(Texture2D, [".jpg"], async (bytes: Uint8Array) => {
        const size = Number(new TextDecoder().decode(bytes));
        return new Texture2D(size, size);
    });
}

function liveTextureCount(): number {
    return EngineObject.FindObjectsOfType(Texture).length;
}

/**
 * Loads every path through `source` and reports what the cache holds.
 *
 * Measured through `Resources` rather than the global object registry: a
 * released asset is destroyed but lingers in the registry until the deferred
 * destruction runs, so a before/after count across two loads mixes the two
 * runs together. The cache is also the thing the delivery path actually
 * governs.
 */
async function loadAllThrough(source: Parameters<typeof Resources.useSource>[0]) {
    Resources.useSource(source);
    registerDecoder();
    for (const p of PATHS) await Resources.load(Texture2D, p);

    return {
        entries: Resources.cacheSize,
        vram: Resources.estimatedVramBytes,
    };
}

afterEach(() => {
    Resources.releaseSource();
});

describe("texture accounting does not depend on the delivery path", () => {
    test("a ZIP-like source holds one entry per file", async () => {
        const result = await loadAllThrough(zipLike());

        expect(result.entries).toBe(PATHS.length);
        expect(result.vram).toBeGreaterThan(0);
    });

    test("a manifest source holds exactly the same", async () => {
        const zip = await loadAllThrough(zipLike());
        Resources.releaseSource();
        const streamed = await loadAllThrough(streamingLike());

        // Same files, same paths, same decoder — so a difference here would be
        // the delivery mechanism inventing or retaining texture objects, which
        // is the shape of the platform's report.
        expect(streamed.entries).toBe(zip.entries);
        expect(streamed.vram).toBe(zip.vram);
    });

    test("loading the same path twice does not retain it twice", async () => {
        // The cache is keyed by resolved path; a source whose paths resolved
        // differently on each call would double every texture in the scene,
        // which is one way the reported 2.9x could have arisen.
        Resources.useSource(streamingLike());
        registerDecoder();

        const before = liveTextureCount();
        await Resources.load(Texture2D, PATHS[0]);
        await Resources.load(Texture2D, PATHS[0]);

        expect(Resources.cacheSize).toBe(1);
        expect(liveTextureCount() - before).toBe(1);
    });
});
