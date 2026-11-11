import { describe, test, expect, afterEach, vi } from "vitest";

// The second half of G2 (ROADMAP E-G2a). The streamed path prefetches every
// non-`Lazy` manifest asset, and the prefetch decodes it through its decoder —
// for an image that is a `Texture2D` — and leaves it cached at reference count
// zero (a speculative load is released the moment it lands). A host that then
// asks for the same file as bytes (`Resources.getUrl`, as
// `Cubemap.fromEquirectangular` does) never wanted that object: solar-system's
// 8192×4096 skybox stayed alive at 128 MB beside the cubemap built from its own
// bytes, on the manifest path only — the ZIP path prefetches nothing. G2's
// measurement (virtual-lab streaming e2e): 96.8 MB against 224.8 MB.
//
// `getUrl` now releases the zero-reference decoded object for the path it is
// asked about before handing out the URL.

// Texture2D's constructor is the only DOM user here and tolerates a null 2D
// context. Must precede the first Texture2D import.
vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

// Node has URL.createObjectURL/revokeObjectURL (buffer-backed), so the source's
// blob bookkeeping runs as is; the URL value itself is not under test.

const { Resources } = await import("../src/engine/core/assets/Resources");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { Texture } = await import("../src/engine/core/graphics/Texture");
const { EngineObject } = await import("../src/engine/core/EngineObject");
const { ScenarioAssets } = await import("../src/engine/core/scenario/ScenarioAssets");
const { StreamingAssetSource } = await import("../src/engine/core/assets/StreamingAssetSource");
const { parseStreamingManifest } = await import("../src/engine/core/assets/StreamingManifest");

/** How many live engine textures exist — what the profiler counts. */
function liveTextureCount(): number {
    return EngineObject.FindObjectsOfType(Texture).length;
}

/** A 64×64 texture per decoded image, standing in for the decoded size. */
const SIZE = 64;

const made: InstanceType<typeof Texture2D>[] = [];

function install() {
    const impl = async () => ({
        ok: true, status: 200,
        arrayBuffer: async () => new TextEncoder().encode("64").buffer.slice(0),
    } as unknown as Response);

    const source = new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1, id: "x",
            assets: [
                { path: "skybox/stars.jpg", priority: "critical", lods: [{ url: "stars.jpg" }] },
                { path: "textures/earth.jpg", priority: "critical", lods: [{ url: "earth.jpg" }] },
            ],
        }),
        { baseUrl: "https://cdn.test/a/", fetch: impl },
    );

    const assets = new ScenarioAssets(source);
    assets._activateAsResourceSource([]);

    // Override the built-in decoder, which would need real image decoding.
    Resources.registerDecoder(
        Texture2D,
        [".jpg", ".png", ".ktx2"],
        async () => {
            const t = new Texture2D(SIZE, SIZE);
            made.push(t);
            return t;
        },
    );

    return { assets };
}

afterEach(() => {
    for (const t of made) if (t.exists()) t.destroyImmediate();
    made.length = 0;
    Resources.releaseSource();
});

describe("getUrl releases the decoded object nobody asked for", () => {
    test("a prefetched, unreferenced texture for the path is gone", async () => {
        install();

        await Resources.prefetch(["assets/skybox/stars.jpg"]);
        expect(Resources.cacheSize).toBe(1);
        const prefetched = made[0];
        expect(liveTextureCount()).toBe(1);

        const url = await Resources.getUrl("skybox/stars.jpg");

        expect(url).toMatch(/^blob:/);
        // The whole point: the 8192×4096 skybox did not survive its own URL.
        expect(Resources.cacheSize).toBe(0);
        expect(prefetched.exists()).toBe(false);
        expect(liveTextureCount()).toBe(0);
    });

    test("a texture the scenario actually loaded survives its URL", async () => {
        install();

        const held = await Resources.load(Texture2D, "textures/earth.jpg");
        expect(liveTextureCount()).toBe(1);

        await Resources.getUrl("textures/earth.jpg");

        // Held at reference count above zero — the scenario's own object.
        expect(held.exists()).toBe(true);
        expect(Resources.cacheSize).toBe(1);
        expect(liveTextureCount()).toBe(1);
    });

    test("another path's unreferenced entry is left alone", async () => {
        install();

        await Resources.prefetch([
            "assets/skybox/stars.jpg",
            "assets/textures/earth.jpg",
        ]);
        expect(Resources.cacheSize).toBe(2);

        await Resources.getUrl("skybox/stars.jpg");

        expect(Resources.cacheSize).toBe(1);
        expect(made[1].exists()).toBe(true);
        expect(made[0].exists()).toBe(false);
    });

    test("with nothing cached the URL is served all the same", async () => {
        install();

        const url = await Resources.getUrl("skybox/stars.jpg");

        expect(url).toMatch(/^blob:/);
        expect(Resources.cacheSize).toBe(0);
    });
});
