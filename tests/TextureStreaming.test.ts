import { describe, test, expect, afterEach, vi } from "vitest";

// Texture2D's constructor is the only DOM user here and tolerates a null 2D
// context, so a stub is enough. It must precede the first Texture2D import.
vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Resources } = await import("../src/engine/core/assets/Resources");
const { TextureStreaming } = await import("../src/engine/core/assets/TextureStreaming");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { StreamingAssetSource } = await import("../src/engine/core/assets/StreamingAssetSource");
const { parseStreamingManifest } = await import("../src/engine/core/assets/StreamingManifest");
type FetchLike = (url: string) => Promise<Response>;

const KB = 1024;

/**
 * Two textures with three levels each. The served body is the pixel size, so a
 * level change shows up as a VRAM change through the real estimator.
 */
function install() {
    const sizes: Record<string, number> = {
        "big-0": 64, "big-1": 256, "big-2": 512,
        "small-0": 16, "small-1": 32, "small-2": 64,
    };

    const impl: FetchLike = async (url: string) => {
        const key = url.split("/").pop()!.replace(".ktx2", "");
        const size = sizes[key];
        if (size === undefined) return { ok: false, status: 404 } as unknown as Response;
        const bytes = new TextEncoder().encode(String(size));
        return {
            ok: true, status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
        } as unknown as Response;
    };

    const lods = (stem: string) =>
        [0, 1, 2].map(level => ({ level, url: `${stem}-${level}.ktx2` }));

    const source = new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1, id: "x",
            assets: [
                { path: "textures/big.ktx2", lods: lods("big") },
                { path: "textures/small.ktx2", lods: lods("small") },
            ],
        }),
        { baseUrl: "https://cdn.test/a/", fetch: impl },
    );

    Resources.useSource(source);
    Resources.registerDecoder(
        Texture2D,
        [".ktx2"],
        async (bytes: Uint8Array) => {
            const size = Number(new TextDecoder().decode(bytes));
            return new Texture2D(size, size);
        },
    );

    TextureStreaming.reset();
    return source;
}

/** Loads both textures at their best level. */
async function loadBoth() {
    await Resources.load(Texture2D, "textures/big.ktx2");
    await Resources.load(Texture2D, "textures/small.ktx2");
}

afterEach(() => {
    TextureStreaming.enabled = false;
    TextureStreaming.reset();
    Resources.vramBudgetBytes = Number.POSITIVE_INFINITY;
    Resources.releaseSource();
});

describe("TextureStreaming — when it does nothing", () => {
    test("no budget means no pass", async () => {
        install();
        await loadBoth();

        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("none");
        expect(pass.path).toBeNull();
    });

    test("a ZIP source has no levels to move between", async () => {
        install();
        await loadBoth();
        Resources.vramBudgetBytes = 1 * KB;
        // Swap in a source that is not a streaming one.
        Resources.releaseSource();

        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("none");
    });

    test("comfortably inside the budget, nothing moves", async () => {
        const source = install();
        await loadBoth();
        source.setLodLevel("textures/big.ktx2", 0);
        await Resources.reload(Texture2D, "textures/big.ktx2");

        // Budget set so usage sits between restoreHeadroom and the limit.
        Resources.vramBudgetBytes = Resources.estimatedVramBytes / 0.9;

        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("none");
    });
});

describe("TextureStreaming — lowering under pressure", () => {
    test("the costliest texture drops a level", async () => {
        const source = install();
        await loadBoth();
        const before = Resources.estimatedVramBytes;
        Resources.vramBudgetBytes = before / 2;

        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("lower");
        expect(pass.path).toBe("assets/textures/big.ktx2");
        expect(source.getLodLevel("textures/big.ktx2")).toBe(1);
        expect(Resources.estimatedVramBytes).toBeLessThan(before);
    });

    test("one texture per pass, so each move can be observed", async () => {
        install();
        await loadBoth();
        Resources.vramBudgetBytes = 1 * KB;

        const first = await TextureStreaming.evaluate();
        const second = await TextureStreaming.evaluate();

        expect(first.path).toBe("assets/textures/big.ktx2");
        // `big` is still the costlier of the two after one step down.
        expect(second.path).toBe("assets/textures/big.ktx2");
        expect(first.level).toBe(1);
        expect(second.level).toBe(0);
    });

    test("a budget nothing can satisfy stops instead of looping", async () => {
        const source = install();
        await loadBoth();
        Resources.vramBudgetBytes = 1;

        // Drive it well past the number of available steps.
        for (let i = 0; i < 8; i++) await TextureStreaming.evaluate();

        expect(source.getLodLevel("textures/big.ktx2")).toBe(0);
        expect(source.getLodLevel("textures/small.ktx2")).toBe(0);
        expect((await TextureStreaming.evaluate()).direction).toBe("none");
    });
});

describe("TextureStreaming — restoring with headroom", () => {
    test("quality comes back when there is real headroom", async () => {
        const source = install();
        await loadBoth();
        source.setLodLevel("textures/big.ktx2", 0);
        source.setLodLevel("textures/small.ktx2", 0);
        await Resources.reload(Texture2D, "textures/big.ktx2");
        await Resources.reload(Texture2D, "textures/small.ktx2");

        Resources.vramBudgetBytes = Resources.estimatedVramBytes * 100;

        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("raise");
        // The cheapest one is raised first — it costs the least to improve.
        expect(pass.path).toBe("assets/textures/small.ktx2");
        expect(source.getLodLevel("textures/small.ktx2")).toBe(1);
    });

    test("nothing is raised past the level the manifest offers", async () => {
        install();
        await loadBoth();
        Resources.vramBudgetBytes = Number.MAX_SAFE_INTEGER;

        // Both already sit at their best level, so there is nothing to gain.
        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("none");
    });

    test("the global ceiling is respected while restoring", async () => {
        // maxLodLevel is a ceiling; restoring must not climb over it.
        const source = install();
        await loadBoth();
        source.maxLodLevel = 0;
        await Resources.reload(Texture2D, "textures/big.ktx2");
        await Resources.reload(Texture2D, "textures/small.ktx2");
        Resources.vramBudgetBytes = Number.MAX_SAFE_INTEGER;

        const pass = await TextureStreaming.evaluate();

        expect(pass.direction).toBe("none");
        expect(source.getLodLevel("textures/big.ktx2")).toBe(0);
    });
});

describe("TextureStreaming — the loop driver", () => {
    test("it stays silent while disabled", async () => {
        const source = install();
        await loadBoth();
        Resources.vramBudgetBytes = 1 * KB;

        TextureStreaming.enabled = false;
        TextureStreaming._update();
        await Promise.resolve();

        expect(source.getLodLevel("textures/big.ktx2")).toBe(2);
    });

    test("a pass is rate-limited, not run every frame", async () => {
        const source = install();
        await loadBoth();
        Resources.vramBudgetBytes = 1 * KB;
        TextureStreaming.enabled = true;

        TextureStreaming._update();
        await vi.waitFor(() => {
            expect(source.getLodLevel("textures/big.ktx2")).toBe(1);
        });

        // Immediately after, the interval has not elapsed.
        for (let i = 0; i < 5; i++) TextureStreaming._update();
        await Promise.resolve();

        expect(source.getLodLevel("textures/big.ktx2")).toBe(1);
    });
});
