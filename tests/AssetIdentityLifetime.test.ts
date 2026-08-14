import { describe, test, expect, afterEach, vi } from "vitest";

vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Resources } = await import("../src/engine/core/assets/Resources");
const { AssetDatabase } = await import("../src/engine/core/assets/AssetDatabase");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { StreamingAssetSource } = await import("../src/engine/core/assets/StreamingAssetSource");
const { parseStreamingManifest } = await import("../src/engine/core/assets/StreamingManifest");
type FetchLike = (url: string) => Promise<Response>;

/**
 * AssetDatabase binds a guid to a live instance on load, and had no unbind at
 * all. So after unloadUnused() or an eviction, `isLoaded(guid)` still answered
 * true and `get(guid)` handed back a destroyed asset — a disposed texture that
 * a deserialized scene would happily assign to a material. Audit part 4, F15.
 */

const MB = 1024 * 1024;

function install() {
    const impl: FetchLike = async () => {
        const bytes = new TextEncoder().encode("64");
        return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(0) } as unknown as Response;
    };

    const source = new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1, id: "x",
            assets: [
                { path: "textures/a.ktx2", guid: "guid-a", lods: [{ url: "a.ktx2" }] },
                { path: "textures/b.ktx2", guid: "guid-b", lods: [{ url: "b.ktx2" }] },
            ],
        }),
        { baseUrl: "https://cdn.test/a/", fetch: impl },
    );

    Resources.useSource(source);
    AssetDatabase.setManifest(source.assetEntries());
    Resources.registerDecoder(Texture2D, [".ktx2"], async () => new Texture2D(64, 64));
}

afterEach(() => {
    Resources.vramBudgetBytes = Number.POSITIVE_INFINITY;
    Resources.releaseSource();
});

describe("Asset identity does not outlive the instance", () => {
    test("a loaded asset is reachable by its id", async () => {
        install();
        const tex = await Resources.load(Texture2D, "textures/a.ktx2");

        expect(AssetDatabase.isLoaded("guid-a")).toBe(true);
        expect(AssetDatabase.get("guid-a")).toBe(tex);
    });

    test("unloadUnused stops it reporting an instance it destroyed", async () => {
        install();
        const tex = await Resources.load(Texture2D, "textures/a.ktx2");
        Resources.release(tex);

        expect(Resources.unloadUnused()).toBe(1);

        expect(AssetDatabase.isLoaded("guid-a")).toBe(false);
        expect(AssetDatabase.get("guid-a")).toBeNull();
    });

    test("eviction under a budget does the same", async () => {
        install();
        await Resources.load(Texture2D, "textures/a.ktx2");
        Resources.releaseByPath(Texture2D, "textures/a.ktx2");

        Resources.vramBudgetBytes = 1;
        Resources.evictToBudget();

        expect(AssetDatabase.isLoaded("guid-a")).toBe(false);
    });

    test("the path↔guid mapping survives — only the instance is forgotten", async () => {
        // Destruction removes what is in memory, not what the file is called;
        // a scene referring to the asset must resolve again once it reloads.
        install();
        const tex = await Resources.load(Texture2D, "textures/a.ktx2");
        Resources.release(tex);
        Resources.unloadUnused();

        const again = await Resources.load(Texture2D, "textures/a.ktx2");

        expect(again).not.toBe(tex);
        expect(AssetDatabase.get("guid-a")).toBe(again);
    });

    test("destroying one asset leaves the other reachable", async () => {
        install();
        const a = await Resources.load(Texture2D, "textures/a.ktx2");
        await Resources.load(Texture2D, "textures/b.ktx2");
        Resources.release(a);

        Resources.unloadUnused();

        expect(AssetDatabase.isLoaded("guid-a")).toBe(false);
        expect(AssetDatabase.isLoaded("guid-b")).toBe(true);
    });
});
