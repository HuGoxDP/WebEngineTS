import { describe, test, expect, afterEach, vi } from "vitest";

// Texture2D's constructor is the only DOM user on this path: it makes a canvas
// and asks for a 2D context, tolerating null. A stub that returns null is
// therefore enough, and far lighter than pulling jsdom in for one call.
// It has to be in place before Texture2D is imported for the first time.
vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Resources } = await import("../src/engine/core/assets/Resources");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { JsonAsset } = await import("../src/engine/core/assets/AssetTypes");
const { Material } = await import("../src/engine/core/graphics/Material");
const { StandardMaterial } = await import("../src/engine/core/graphics/StandardMaterial");
const { StreamingAssetSource } = await import("../src/engine/core/assets/StreamingAssetSource");
const { parseStreamingManifest } = await import("../src/engine/core/assets/StreamingManifest");
type FetchLike = (url: string) => Promise<Response>;

/** Serves a body per URL; each body is just the pixel size to decode to. */
function serve(files: Record<string, string>) {
    const requested: string[] = [];
    const impl: FetchLike = async (url: string) => {
        requested.push(url);
        const body = files[url];
        if (body === undefined) return { ok: false, status: 404 } as unknown as Response;
        const bytes = new TextEncoder().encode(body);
        return {
            ok: true, status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
        } as unknown as Response;
    };
    return { impl, requested };
}

/** A manifest with one two-level texture and one plain JSON asset. */
function install() {
    const fetcher = serve({
        "https://cdn.test/a/terrain-low.ktx2": "64",
        "https://cdn.test/a/terrain-high.ktx2": "512",
        "https://cdn.test/a/config.json": '{"speed":2}',
    });

    const source = new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1, id: "x",
            assets: [
                {
                    path: "textures/terrain.ktx2",
                    lods: [
                        { level: 0, url: "terrain-low.ktx2" },
                        { level: 1, url: "terrain-high.ktx2" },
                    ],
                },
                { path: "data/config.json", lods: [{ level: 0, url: "config.json" }] },
            ],
        }),
        { baseUrl: "https://cdn.test/a/", fetch: fetcher.impl },
    );

    Resources.useSource(source);

    // Overriding the built-in Texture2D decoder, which would need real image
    // decoding. The size in the payload stands in for the decoded dimensions,
    // so a level change is observable as a size change.
    Resources.registerDecoder(
        Texture2D,
        [".ktx2", ".png"],
        async (bytes: Uint8Array) => {
            const size = Number(new TextDecoder().decode(bytes));
            return new Texture2D(size, size);
        },
    );

    return { source, fetcher };
}

// Each test installs its own source and decoder; only the teardown is shared.
afterEach(() => { Resources.releaseSource(); });

describe("Resources.reload", () => {
    test("the instance is the same object, carrying new content", async () => {
        const { source } = install();
        const texture = await Resources.load(Texture2D, "textures/terrain.ktx2");
        expect(texture.width).toBe(512);

        source.setLodLevel("textures/terrain.ktx2", 0);
        const reloaded = await Resources.reload(Texture2D, "textures/terrain.ktx2");

        // Identity is the whole point: everything already holding it follows.
        expect(reloaded).toBe(texture);
        expect(texture.width).toBe(64);
        expect(texture.height).toBe(64);
    });

    test("materials holding the texture draw the reloaded content", async () => {
        const { source } = install();
        const texture = await Resources.load(Texture2D, "textures/terrain.ktx2");

        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);
        const before = (material._internalThreeMaterial as unknown as Record<string, unknown>)["map"];

        source.setLodLevel("textures/terrain.ktx2", 0);
        await Resources.reload(Texture2D, "textures/terrain.ktx2");

        const after = (material._internalThreeMaterial as unknown as Record<string, unknown>)["map"];
        expect(after).not.toBe(before);
        expect(after).toBe(texture._internalThreeTexture);
    });

    test("it re-reads at the level the source now serves", async () => {
        const { source, fetcher } = install();
        await Resources.load(Texture2D, "textures/terrain.ktx2");
        expect(fetcher.requested).toEqual(["https://cdn.test/a/terrain-high.ktx2"]);

        source.setLodLevel("textures/terrain.ktx2", 0);
        await Resources.reload(Texture2D, "textures/terrain.ktx2");

        expect(fetcher.requested).toEqual([
            "https://cdn.test/a/terrain-high.ktx2",
            "https://cdn.test/a/terrain-low.ktx2",
        ]);
    });

    test("the cached VRAM estimate follows the new size", async () => {
        const { source } = install();
        await Resources.load(Texture2D, "textures/terrain.ktx2");
        const big = Resources.estimatedVramBytes;

        source.setLodLevel("textures/terrain.ktx2", 0);
        await Resources.reload(Texture2D, "textures/terrain.ktx2");

        expect(Resources.estimatedVramBytes).toBeLessThan(big);
    });

    test("reloading does not hand out another claim on the asset", async () => {
        // It reloads an asset; it does not take a reference to it.
        install();
        const texture = await Resources.load(Texture2D, "textures/terrain.ktx2");
        await Resources.reload(Texture2D, "textures/terrain.ktx2");

        Resources.release(texture);
        expect(Resources.unloadUnused()).toBe(1);
    });

    test("an asset that was never loaded cannot be reloaded", async () => {
        install();

        await expect(Resources.reload(Texture2D, "textures/terrain.ktx2"))
            .rejects.toThrow(/not loaded/);
    });

    test("a type that cannot adopt is refused rather than silently replaced", async () => {
        // Replacing the cache entry would leave every existing reference on the
        // old content, which looks like it worked and is worse than an error.
        install();
        await Resources.load(JsonAsset, "data/config.json");

        await expect(Resources.reload(JsonAsset, "data/config.json"))
            .rejects.toThrow(/cannot be reloaded in place/);
    });

    test("reloading without a source fails loudly", async () => {
        install();
        await Resources.load(Texture2D, "textures/terrain.ktx2");
        Resources.releaseSource();

        await expect(Resources.reload(Texture2D, "textures/terrain.ktx2"))
            .rejects.toThrow(/No asset source is active/);
    });
});
