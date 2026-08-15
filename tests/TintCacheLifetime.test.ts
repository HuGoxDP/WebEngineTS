import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { TintCache } = await import("../src/engine/core/ui/TintCache");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
// Importing UIImage is what installs the hook, exactly as a real build does.
await import("../src/engine/core/ui/UIImage");

/**
 * Tinted copies are keyed by a texture's instance id, which is never reused. A
 * destroyed texture therefore left full-resolution buffers in the cache that
 * nothing could ever ask for again — counted against the budget, and reported
 * by the memory profiler, until the 32 MB limit happened to push them out.
 * Audit part 6, F34.
 */

/** A stand-in for a tinted buffer of a given size. */
function buffer(width: number, height: number): HTMLCanvasElement {
    return { width, height } as unknown as HTMLCanvasElement;
}

beforeEach(() => TintCache._reset());
afterEach(() => TintCache._reset());

describe("A tinted copy dies with its source texture", () => {
    test("destroying the texture drops its buffers", () => {
        const texture = new Texture2D(4, 4);
        TintCache.put(texture.getInstanceID(), 0, 0xff0000, buffer(64, 64));

        expect(TintCache.count).toBe(1);

        texture.destroyImmediate();

        expect(TintCache.count).toBe(0);
        expect(TintCache.bytes).toBe(0);
    });

    test("every tint of that texture goes, not just one", () => {
        const texture = new Texture2D(4, 4);
        const id = texture.getInstanceID();
        TintCache.put(id, 0, 0xff0000, buffer(32, 32));
        TintCache.put(id, 0, 0x00ff00, buffer(32, 32));
        TintCache.put(id, 1, 0x0000ff, buffer(32, 32));

        expect(TintCache.count).toBe(3);

        texture.destroyImmediate();

        expect(TintCache.count).toBe(0);
    });

    test("another texture's buffers are left alone", () => {
        const doomed = new Texture2D(4, 4);
        const kept = new Texture2D(4, 4);
        TintCache.put(doomed.getInstanceID(), 0, 0xff0000, buffer(16, 16));
        TintCache.put(kept.getInstanceID(), 0, 0xff0000, buffer(16, 16));

        doomed.destroyImmediate();

        expect(TintCache.count).toBe(1);
        expect(TintCache.get(kept.getInstanceID(), 0, 0xff0000)).not.toBeNull();
        kept.destroyImmediate();
    });

    test("the byte count is right afterwards", () => {
        const texture = new Texture2D(4, 4);
        const other = new Texture2D(4, 4);
        TintCache.put(texture.getInstanceID(), 0, 0xff0000, buffer(10, 10));
        TintCache.put(other.getInstanceID(), 0, 0xff0000, buffer(20, 20));
        const otherBytes = 20 * 20 * 4;

        texture.destroyImmediate();

        expect(TintCache.bytes).toBe(otherBytes);
        other.destroyImmediate();
        expect(TintCache.bytes).toBe(0);
    });

    test("destroying a texture with nothing cached is harmless", () => {
        const texture = new Texture2D(4, 4);
        const other = new Texture2D(4, 4);
        TintCache.put(other.getInstanceID(), 0, 0xff0000, buffer(8, 8));

        texture.destroyImmediate();

        expect(TintCache.count).toBe(1);
        other.destroyImmediate();
    });
});
