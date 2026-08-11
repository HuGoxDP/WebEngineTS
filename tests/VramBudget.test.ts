import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { parseStreamingManifest } from "../src/engine/core/assets/StreamingManifest";
import { StreamingAssetSource } from "../src/engine/core/assets/StreamingAssetSource";
import { Resources } from "../src/engine/core/assets/Resources";
import type { FetchLike } from "../src/engine/core/assets/StreamingAssetSource";

/**
 * A stand-in for a texture: it reports a GPU cost and records its own
 * destruction, which is all the budget cares about. Using a real Texture2D
 * would drag WebGL in without testing anything more.
 */
class FakeGpuAsset {
    public static destroyed: string[] = [];

    constructor(public readonly name: string, private readonly _bytes: number) {}

    public _estimateVramBytes(): number { return this._bytes; }

    public destroy(): void { FakeGpuAsset.destroyed.push(this.name); }
}

/** An asset with no GPU footprint at all — a JSON blob costs heap, not VRAM. */
class FakeCpuAsset {
    constructor(public readonly name: string) {}
    public destroy(): void { /* nothing to release */ }
}

const MB = 1024 * 1024;

/** Serves `<name>.gpu` files whose declared size is encoded in the manifest. */
function install(sizes: Record<string, number>) {
    const files: Record<string, string> = {};
    for (const name of Object.keys(sizes)) files[`https://cdn.test/a/${name}`] = name;

    const impl: FetchLike = async (url: string) => {
        const body = files[url];
        if (body === undefined) return { ok: false, status: 404 } as unknown as Response;
        const bytes = new TextEncoder().encode(body);
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
        } as unknown as Response;
    };

    const source = new StreamingAssetSource(
        parseStreamingManifest({
            schema: 1, id: "x",
            assets: Object.keys(sizes).map(name => ({
                path: `t/${name}`,
                lods: [{ level: 0, url: name }],
            })),
        }),
        { baseUrl: "https://cdn.test/a/", fetch: impl },
    );

    Resources.useSource(source);
    Resources.registerDecoder(
        FakeGpuAsset,
        [".gpu"],
        async (bytes: Uint8Array) => {
            const name = new TextDecoder().decode(bytes);
            return new FakeGpuAsset(name, sizes[name]);
        },
    );
    Resources.registerDecoder(
        FakeCpuAsset,
        [".cpu"],
        async (bytes: Uint8Array) => new FakeCpuAsset(new TextDecoder().decode(bytes)),
    );
}

/** Loads and immediately releases, so the asset is cached but unreferenced. */
async function warm(name: string): Promise<void> {
    await Resources.load(FakeGpuAsset, `t/${name}`);
    Resources.releaseByPath(FakeGpuAsset, `t/${name}`);
}

beforeEach(() => {
    FakeGpuAsset.destroyed = [];
    Resources.vramBudgetBytes = Number.POSITIVE_INFINITY;
});

afterEach(() => {
    Resources.vramBudgetBytes = Number.POSITIVE_INFINITY;
    Resources.releaseSource();
});

describe("Resources — VRAM accounting", () => {
    test("cached assets report what they cost on the GPU", async () => {
        install({ "a.gpu": 4 * MB, "b.gpu": 6 * MB });

        await Resources.load(FakeGpuAsset, "t/a.gpu");
        await Resources.load(FakeGpuAsset, "t/b.gpu");

        expect(Resources.estimatedVramBytes).toBe(10 * MB);
    });

    test("an asset with no GPU footprint contributes nothing", async () => {
        install({ "a.gpu": 4 * MB, "note.cpu": 0 });

        await Resources.load(FakeGpuAsset, "t/a.gpu");
        await Resources.load(FakeCpuAsset, "t/note.cpu");

        expect(Resources.cacheSize).toBe(2);
        expect(Resources.estimatedVramBytes).toBe(4 * MB);
    });

    test("what is referenced is separated from what could be reclaimed", async () => {
        install({ "held.gpu": 4 * MB, "spare.gpu": 6 * MB });

        await Resources.load(FakeGpuAsset, "t/held.gpu");
        await warm("spare.gpu");

        expect(Resources.estimatedVramBytes).toBe(10 * MB);
        expect(Resources.evictableVramBytes).toBe(6 * MB);
    });
});

describe("Resources — eviction to a budget", () => {
    test("no budget means nothing is ever evicted", async () => {
        install({ "a.gpu": 100 * MB, "b.gpu": 100 * MB });

        await warm("a.gpu");
        await warm("b.gpu");

        expect(FakeGpuAsset.destroyed).toEqual([]);
        expect(Resources.cacheSize).toBe(2);
    });

    test("a load that breaks the budget evicts least-recently-used first", async () => {
        install({ "a.gpu": 4 * MB, "b.gpu": 4 * MB, "c.gpu": 4 * MB });
        Resources.vramBudgetBytes = 10 * MB;

        await warm("a.gpu");
        await warm("b.gpu");
        // Third load takes the total to 12 MB; `a` is the oldest use.
        await warm("c.gpu");

        expect(FakeGpuAsset.destroyed).toEqual(["a.gpu"]);
        expect(Resources.estimatedVramBytes).toBe(8 * MB);
    });

    test("a cache hit counts as a use, so re-requesting keeps an asset alive", async () => {
        install({ "a.gpu": 4 * MB, "b.gpu": 4 * MB, "c.gpu": 4 * MB });
        Resources.vramBudgetBytes = 10 * MB;

        await warm("a.gpu");
        await warm("b.gpu");
        // Touch `a` again — now `b` is the least recently used, not `a`.
        await warm("a.gpu");
        await warm("c.gpu");

        expect(FakeGpuAsset.destroyed).toEqual(["b.gpu"]);
    });

    test("a referenced asset is never evicted, even over budget", async () => {
        // Destroying a texture a material is holding would break rendering
        // rather than save memory.
        install({ "held.gpu": 8 * MB, "spare.gpu": 4 * MB });
        Resources.vramBudgetBytes = 6 * MB;

        await Resources.load(FakeGpuAsset, "t/held.gpu");
        await warm("spare.gpu");

        expect(FakeGpuAsset.destroyed).toEqual(["spare.gpu"]);
        // The live set alone is over budget and stays there — honestly reported.
        expect(Resources.estimatedVramBytes).toBe(8 * MB);
        expect(Resources.estimatedVramBytes).toBeGreaterThan(Resources.vramBudgetBytes);
    });

    test("evicting stops as soon as the cache fits, not once it is empty", async () => {
        install({ "a.gpu": 4 * MB, "b.gpu": 4 * MB, "c.gpu": 4 * MB, "d.gpu": 4 * MB });
        Resources.vramBudgetBytes = 12 * MB;

        await warm("a.gpu");
        await warm("b.gpu");
        await warm("c.gpu");
        await warm("d.gpu");

        expect(FakeGpuAsset.destroyed).toEqual(["a.gpu"]);
        expect(Resources.cacheSize).toBe(3);
    });

    test("it can be driven by hand after a budget is lowered", async () => {
        install({ "a.gpu": 4 * MB, "b.gpu": 4 * MB });

        await warm("a.gpu");
        await warm("b.gpu");
        expect(FakeGpuAsset.destroyed).toEqual([]);

        Resources.vramBudgetBytes = 5 * MB;
        const freed = Resources.evictToBudget();

        expect(freed).toBe(4 * MB);
        expect(FakeGpuAsset.destroyed).toEqual(["a.gpu"]);
    });

    test("evicting under budget is a no-op that reclaims nothing", async () => {
        install({ "a.gpu": 4 * MB });
        Resources.vramBudgetBytes = 100 * MB;

        await warm("a.gpu");

        expect(Resources.evictToBudget()).toBe(0);
        expect(Resources.cacheSize).toBe(1);
    });

    test("an asset with no GPU cost is never chosen for eviction", async () => {
        // Evicting it would reclaim nothing while still costing a reload.
        install({ "big.gpu": 20 * MB, "note.cpu": 0 });
        Resources.vramBudgetBytes = 4 * MB;

        await Resources.load(FakeCpuAsset, "t/note.cpu");
        Resources.releaseByPath(FakeCpuAsset, "t/note.cpu");
        await warm("big.gpu");

        expect(FakeGpuAsset.destroyed).toEqual(["big.gpu"]);
        expect(Resources.cacheSize).toBe(1);
    });
});
