import { describe, test, expect, afterEach, vi } from "vitest";

vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Resources } = await import("../src/engine/core/assets/Resources");
const { AssetDatabase } = await import("../src/engine/core/assets/AssetDatabase");
type IAssetSource = import("../src/engine/core/assets/Resources").IAssetSource;

/**
 * A load is async, and the scenario that asked for it can unload while it is
 * still in the air. The landing had no idea: it cached the asset, bound its
 * guid and handed it out — into whatever source was installed by then. Audit
 * part 4, F16.
 */

/** An asset that reports GPU bytes and remembers being destroyed. */
class GpuAsset {
    public destroyed = false;
    constructor(public readonly tag: string) {}
    public destroy(): void { this.destroyed = true; }
    public _estimateVramBytes(): number { return 4 * 1024 * 1024; }
}

/** A source whose reads finish only when the test says so. */
class ManualSource implements IAssetSource {
    private readonly _pending: Array<() => void> = [];
    public reads = 0;

    constructor(public readonly tag: string) {}

    public has(): boolean { return true; }
    public list(): string[] { return ["assets/x.gpu"]; }
    public async readText(): Promise<string> { return ""; }
    public async getBlobUrl(): Promise<string> { return "blob:none"; }

    public readBytes(): Promise<Uint8Array> {
        this.reads++;
        return new Promise<Uint8Array>(resolve => {
            this._pending.push(() => resolve(new Uint8Array([1, 2, 3, 4])));
        });
    }

    /** Lets every outstanding read finish. */
    public flush(): void {
        const waiting = this._pending.splice(0);
        for (const resolve of waiting) resolve();
    }
}

let decoded: GpuAsset[] = [];
let decodedWith: Array<IAssetSource | null> = [];

function install(tag: string): ManualSource {
    const source = new ManualSource(tag);
    Resources.useSource(source);
    Resources.registerDecoder(GpuAsset, [".gpu"], async (_bytes, _path, from) => {
        const asset = new GpuAsset(tag);
        decoded.push(asset);
        decodedWith.push(from);
        return asset;
    });
    return source;
}

afterEach(() => {
    decoded = [];
    decodedWith = [];
    Resources.vramBudgetBytes = Number.POSITIVE_INFINITY;
    Resources.releaseSource();
});

describe("A load that lands after its source is gone", () => {
    test("does not cache itself into the scenario that replaced it", async () => {
        const first = install("first");
        const pending = Resources.load(GpuAsset, "x.gpu");

        Resources.releaseSource();

        first.flush();
        await expect(pending).rejects.toThrow(/released|unload/i);

        expect(Resources.cacheSize).toBe(0);
        expect(Resources.estimatedVramBytes).toBe(0);
    });

    test("destroys what it decoded instead of leaking it", async () => {
        const first = install("first");
        const pending = Resources.load(GpuAsset, "x.gpu");

        Resources.releaseSource();
        first.flush();
        await pending.catch(() => { /* expected */ });

        expect(decoded).toHaveLength(1);
        expect(decoded[0].destroyed).toBe(true);
    });

    test("does not bind its guid over the new scenario's database", async () => {
        const first = install("first");
        AssetDatabase.setManifest([{ path: "assets/x.gpu", guid: "guid-x" }]);
        const pending = Resources.load(GpuAsset, "x.gpu");

        // The new scenario ships the same path — so the guid is live again, and
        // a stale bind would answer for it.
        Resources.releaseSource();
        install("second");
        AssetDatabase.setManifest([{ path: "assets/x.gpu", guid: "guid-x" }]);

        first.flush();
        await pending.catch(() => { /* expected */ });

        expect(AssetDatabase.isLoaded("guid-x")).toBe(false);
    });

    test("does not disturb a fresh load of the same path", async () => {
        const first = install("first");
        const stale = Resources.load(GpuAsset, "x.gpu");

        Resources.releaseSource();
        const second = install("second");
        const fresh = Resources.load(GpuAsset, "x.gpu");

        // The stale read lands first — its bookkeeping must not touch the load
        // the new source is running for the very same path.
        first.flush();
        await stale.catch(() => { /* expected */ });

        second.flush();
        const asset = await fresh;

        expect(asset.tag).toBe("second");
        expect(Resources.cacheSize).toBe(1);
        expect(second.reads).toBe(1);
    });

    test("reads through the source it started with, not the one installed since", async () => {
        // Decoding against a source that is null (released) or someone else's
        // (replaced) is how a scenario's texture ends up resolved out of the
        // next scenario's archive.
        const first = install("first");
        const pending = Resources.load(GpuAsset, "x.gpu");

        Resources.releaseSource();
        const second = install("second");

        first.flush();
        await pending.catch(() => { /* expected */ });

        expect(second.reads).toBe(0);
        expect(decodedWith).toEqual([first]);
    });
});
