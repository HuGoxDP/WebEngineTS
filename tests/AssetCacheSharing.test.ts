import { describe, test, expect, afterEach, vi } from "vitest";

// Texture2D's constructor is the only DOM user here and tolerates a null 2D
// context. Must precede the first Texture2D import.
vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Resources } = await import("../src/engine/core/assets/Resources");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { Texture } = await import("../src/engine/core/graphics/Texture");
const { EngineObject } = await import("../src/engine/core/EngineObject");
const { ScenarioAssets } = await import("../src/engine/core/scenario/ScenarioAssets");
const { StreamingAssetSource } = await import("../src/engine/core/assets/StreamingAssetSource");
const { parseStreamingManifest } = await import("../src/engine/core/assets/StreamingManifest");
type FetchLike = (url: string) => Promise<Response>;

/**
 * The platform measured the streamed path holding ~2.9× the texture VRAM of the
 * ZIP path for the same 19 GPU textures (virtual-lab docs/upstream/webenginets.md
 * §1). Cause: ScenarioAssets kept its own texture cache, independent of the one
 * in Resources. On the streaming path every manifest asset is prefetched into
 * Resources, and the scenario's own `assets.loadTexture` then decoded the same
 * bytes again — two engine textures alive per GPU texture. The ZIP path does no
 * prefetching, so it never doubled.
 *
 * MemoryProfiler sums every live engine Texture, which is why the duplicate was
 * visible as VRAM rather than as a leak nobody noticed.
 */

/** How many live engine textures exist — what the profiler counts. */
function liveTextureCount(): number {
    return EngineObject.FindObjectsOfType(Texture).length;
}

function install() {
    const requested: string[] = [];
    const impl: FetchLike = async (url: string) => {
        requested.push(url);
        const bytes = new TextEncoder().encode("64");
        return {
            ok: true, status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
        } as unknown as Response;
    };

    const source = new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1, id: "x",
            assets: [
                { path: "textures/earth.ktx2", priority: "critical", lods: [{ url: "earth.ktx2" }] },
                { path: "textures/moon.ktx2", priority: "low", lods: [{ url: "moon.ktx2" }] },
            ],
        }),
        { baseUrl: "https://cdn.test/a/", fetch: impl },
    );

    const assets = new ScenarioAssets(source);
    assets._activateAsResourceSource([]);

    // Override the built-in Texture2D decoder, which would need real image
    // decoding; the payload stands in for the decoded size.
    Resources.registerDecoder(
        Texture2D,
        [".ktx2", ".png", ".jpg"],
        async (bytes: Uint8Array) => {
            const size = Number(new TextDecoder().decode(bytes));
            return new Texture2D(size, size);
        },
    );

    return { assets, requested };
}

afterEach(() => {
    Resources.releaseSource();
});

describe("ScenarioAssets and Resources share one cache", () => {
    test("a prefetched texture is not decoded again by loadTexture", async () => {
        const { assets, requested } = install();

        await Resources.prefetch(["assets/textures/earth.ktx2"]);
        const beforeCount = liveTextureCount();
        const beforeRequests = requested.length;

        await assets.loadTexture("earth.ktx2");

        // The decisive assertion: no second engine texture for the same bytes.
        expect(liveTextureCount()).toBe(beforeCount);
        expect(requested.length).toBe(beforeRequests);
    });

    test("loadTexture returns the very instance Resources holds", async () => {
        const { assets } = install();

        const viaProvider = await assets.loadTexture("earth.ktx2");
        const viaResources = await Resources.load(Texture2D, "textures/earth.ktx2");

        expect(viaProvider).toBe(viaResources);
    });

    test("two loadTexture calls share one instance, whatever the spelling", async () => {
        const { assets } = install();

        const a = await assets.loadTexture("earth.ktx2");
        const b = await assets.loadTexture("textures/earth.ktx2");

        expect(a).toBe(b);
        expect(liveTextureCount()).toBe(1);
    });

    test("prefetching everything then loading one leaves one texture per asset", async () => {
        // The streaming shape: the whole manifest is warmed, the scenario asks
        // for what it needs. Two assets must mean two textures, not four.
        const { assets } = install();

        await Resources.prefetch([
            "assets/textures/earth.ktx2",
            "assets/textures/moon.ktx2",
        ]);
        await assets.loadTexture("earth.ktx2");
        await assets.loadTexture("moon.ktx2");

        expect(liveTextureCount()).toBe(2);
    });

    test("disposing the provider destroys what it handed out", async () => {
        const { assets } = install();
        await assets.loadTexture("earth.ktx2");
        expect(liveTextureCount()).toBe(1);

        assets.dispose();
        // EngineObject.destroy queues a microtask rather than destroying on the
        // spot, so the count settles a tick later — right for gameplay, and a
        // trap when asserting in the same one.
        await Promise.resolve();

        expect(liveTextureCount()).toBe(0);
    });
});
