import { describe, test, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

/**
 * B6 of the engine, phase 1 (C6 DW-1.1..DW-1.5): a render target as a resource.
 *
 * A `RenderTexture` is the one texture a script cannot ship: it is allocated for
 * a format rather than decoded into one, its GPU image is wanted rather than
 * always there, and its descriptor freezes the moment the renderer creates the
 * buffers. These tests pin that contract without a GPU — the whole type is
 * engine arithmetic plus a descriptor, and three.js allocates lazily, so a
 * constructed target never touches GL.
 *
 * What is deliberately *not* here: rendering, readback, the camera, the memory
 * profiler — those are later phases, each with its own file.
 */

const { RenderTexture, RenderTextureFormat } = await import("../src/engine/core/graphics/RenderTexture");

/** Silences the "not supported" warnings the snapping paths emit, and counts them. */
function countWarnings(): { spy: ReturnType<typeof vi.spyOn>; lines: () => string[] } {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
    });
    return { spy, lines: () => lines };
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe("descriptor: what the constructor accepts", () => {
    test("defaults are a 24-bit ARGB32 target, not yet created", () => {
        const rt = new RenderTexture(64, 32);
        expect(rt.width).toBe(64);
        expect(rt.height).toBe(32);
        expect(rt.depth).toBe(24);
        expect(rt.format).toBe(RenderTextureFormat.ARGB32);
        expect(rt.antiAliasing).toBe(1);
        expect(rt.isCreated()).toBe(false);
    });

    test("DefaultHDR resolves to the format that will be allocated", () => {
        const rt = new RenderTexture(8, 8, 16, RenderTextureFormat.DefaultHDR);
        expect(rt.format).toBe(RenderTextureFormat.ARGBHalf);
        // And Default never survives as itself.
        expect(new RenderTexture(8, 8, 16, RenderTextureFormat.Default).format)
            .toBe(RenderTextureFormat.ARGB32);
    });

    test("a depth outside the set snaps to the nearest and warns once", () => {
        const { spy, lines } = countWarnings();
        expect(new RenderTexture(8, 8, 20).depth).toBe(16);
        expect(new RenderTexture(8, 8, 100).depth).toBe(32);
        expect(new RenderTexture(8, 8, 0).depth).toBe(0);
        expect(new RenderTexture(8, 8, -5).depth).toBe(0);
        expect(spy).toHaveBeenCalled();
        expect(lines().every(l => l.includes("[RenderTexture] depth"))).toBe(true);
    });

    test("an antiAliasing outside the set snaps to the nearest, ties going down", () => {

        const rt = new RenderTexture(8, 8);
        rt.antiAliasing = 3;
        expect(rt.antiAliasing).toBe(2);
        rt.antiAliasing = 6;      // exactly between 4 and 8: the smaller wins
        expect(rt.antiAliasing).toBe(4);
        rt.antiAliasing = 12;
        expect(rt.antiAliasing).toBe(8);
        rt.antiAliasing = 0;
        expect(rt.antiAliasing).toBe(1);
    });

    test("a size that is not usable is a RangeError; a fraction is floored", () => {
        expect(() => new RenderTexture(0, 4)).toThrow(RangeError);
        expect(() => new RenderTexture(NaN, 4)).toThrow(RangeError);
        expect(() => new RenderTexture(4, Infinity)).toThrow(RangeError);
        expect(() => new RenderTexture(4, -1)).toThrow(RangeError);
        expect(new RenderTexture(10.7, 4.2).width).toBe(10);
        expect(new RenderTexture(10.7, 4.2).height).toBe(4);
    });
});

describe("the GPU image: create, release, destroy", () => {
    test("create is idempotent and release is idempotent", () => {
        const rt = new RenderTexture(16, 16);
        expect(rt.create()).toBe(true);
        expect(rt.isCreated()).toBe(true);
        rt.create();
        expect(rt.isCreated()).toBe(true);

        rt.release();
        expect(rt.isCreated()).toBe(false);
        rt.release();
        expect(rt.isCreated()).toBe(false);

        rt.create();
        expect(rt.isCreated()).toBe(true);
    });

    test("a descriptor setter on a created target is refused once, and ignored", () => {
        const { spy } = countWarnings();
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const rt = new RenderTexture(16, 16);
        rt.create();

        rt.width = 99;
        rt.width = 199;      // refused, and not repeated
        expect(rt.width).toBe(16);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain("width");

        rt.height = 99;
        expect(rt.height).toBe(16);
        expect(errorSpy).toHaveBeenCalledTimes(2);

        // Each property gets its own one refusal.
        rt.depth = 32;
        rt.format = RenderTextureFormat.ARGBHalf;
        rt.antiAliasing = 4;
        expect(rt.depth).toBe(24);
        expect(rt.format).toBe(RenderTextureFormat.ARGB32);
        expect(rt.antiAliasing).toBe(1);
        expect(errorSpy).toHaveBeenCalledTimes(5);

        // Released: the same setter works.
        rt.release();
        rt.width = 32;
        rt.depth = 16;
        expect(rt.width).toBe(32);
        expect(rt.depth).toBe(16);
        expect(errorSpy).toHaveBeenCalledTimes(5);
        spy.mockRestore();
    });

    test("release gives the GPU image back without killing the object", () => {
        const rt = new RenderTexture(16, 16);
        rt.create();
        const before = rt._internalThreeRenderTarget;
        rt.release();
        expect(rt._internalThreeRenderTarget).not.toBe(before);
        expect(before.texture.dispose).toBeDefined();
        // Still usable: a render into a released target creates it again (D3).
        rt._markCreatedByBackend();
        expect(rt.isCreated()).toBe(true);
    });

    test("destroying while active clears the active slot and the state", () => {
        const rt = new RenderTexture(8, 8);
        rt.create();
        expect(RenderTexture.active).toBe(null);
        RenderTexture.active = rt;

        // `destroy()` queues the end-of-frame callback; `destroyImmediate()`
        // runs it now. Both reach the same `onDestroy`.
        rt.destroyImmediate();

        expect(RenderTexture.active).toBe(null);
        expect(rt.isCreated()).toBe(false);
        expect(rt.exists()).toBe(false);
    });

    test("create after destroy answers false and warns", () => {
        const { spy, lines } = countWarnings();
        const rt = new RenderTexture(8, 8);
        rt.destroyImmediate();
        expect(rt.create()).toBe(false);
        expect(lines().some(l => l.includes("destroyed"))).toBe(true);
        spy.mockRestore();
    });
});

describe("the descriptor reaches the Three.js target", () => {
    test("the base texture IS the target's texture, and it was not left dangling", () => {
        const rt = new RenderTexture(8, 8);
        expect(rt._internalThreeTexture).toBe(rt._internalThreeRenderTarget.texture);
    });

    test("ARGB32 is an 8-bit sRGB target; ARGBHalf is a half-float linear one", () => {
        const srgb = new RenderTexture(8, 8, 24, RenderTextureFormat.ARGB32);
        expect(srgb._internalThreeRenderTarget.texture.type).toBe(THREE.UnsignedByteType);
        expect(srgb._internalThreeRenderTarget.texture.colorSpace).toBe(THREE.SRGBColorSpace);

        const hdr = new RenderTexture(8, 8, 24, RenderTextureFormat.DefaultHDR);
        expect(hdr.format).toBe(RenderTextureFormat.ARGBHalf);
        expect(hdr._internalThreeRenderTarget.texture.type).toBe(THREE.HalfFloatType);
        expect(hdr._internalThreeRenderTarget.texture.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    });

    test("antiAliasing becomes samples; depth 0 leaves the depth buffer off; 24+ adds a stencil", () => {
        expect(new RenderTexture(8, 8, 24, RenderTextureFormat.ARGB32)._internalThreeRenderTarget.samples).toBe(0);
        const msaa = new RenderTexture(8, 8, 24, RenderTextureFormat.ARGB32);
        msaa.antiAliasing = 4;
        expect(msaa._internalThreeRenderTarget.samples).toBe(4);
        expect(msaa._internalThreeRenderTarget.depthBuffer).toBe(true);
        expect(msaa._internalThreeRenderTarget.stencilBuffer).toBe(true);

        const flat = new RenderTexture(8, 8, 0);
        expect(flat._internalThreeRenderTarget.depthBuffer).toBe(false);
        expect(flat._internalThreeRenderTarget.stencilBuffer).toBe(false);

        const deep16 = new RenderTexture(8, 8, 16);
        expect(deep16._internalThreeRenderTarget.depthBuffer).toBe(true);
        expect(deep16._internalThreeRenderTarget.stencilBuffer).toBe(false);
    });

    test("a material's data-slot request does not re-tag a target's colour", () => {
        const rt = new RenderTexture(8, 8, 24, RenderTextureFormat.ARGB32);
        rt._setLinearData(true);   // what a normal-map slot would do to a Texture
        expect(rt._internalThreeTexture.colorSpace).toBe(THREE.SRGBColorSpace);

        rt.format = RenderTextureFormat.DefaultHDR;
        rt._setLinearData(false);
        expect(rt._internalThreeTexture.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    });

    test("a filter or wrap change on a created target releases it (three never re-uploads RT parameters)", () => {
        const rt = new RenderTexture(16, 16);
        rt.create();
        const before = rt._internalThreeRenderTarget;
        rt.filterMode = 0;          // Point
        expect(rt._internalThreeTexture.minFilter).toBe(THREE.NearestFilter);
        expect(rt._internalThreeRenderTarget).not.toBe(before);
    });
});

describe("the VRAM estimate is pure arithmetic", () => {
    const ARGB32 = RenderTextureFormat.ARGB32;
    const ARGBHalf = RenderTextureFormat.ARGBHalf;

    test("256x128 ARGB32 depth 24 is colour + depth", () => {
        const rt = new RenderTexture(256, 128, 24, ARGB32);
        rt.create();
        expect(rt._estimateVramBytes()).toBe(256 * 128 * 4 + 256 * 128 * 4);
    });

    test("multi-sampling adds the multisampled colour buffer and multiplies the depth term", () => {
        const rt = new RenderTexture(256, 128, 24, ARGB32);
        rt.antiAliasing = 4;
        rt.create();
        // colour (256·128·4) + multisampled colour (·4) + depth (256·128·4·4)
        expect(rt._estimateVramBytes()).toBe(256 * 128 * 4 + 256 * 128 * 4 * 4 + 256 * 128 * 4 * 4);
    });

    test("Trilinear multiplies the colour term by 4/3; ARGBHalf doubles the colour bytes", () => {
        // The filter is set before create(): changing it on a created target
        // releases the target (D4), and a released target costs nothing.
        const rt = new RenderTexture(64, 64, 24, ARGB32);
        rt.filterMode = 2;          // Trilinear, before the target exists
        rt.create();
        expect(rt._estimateVramBytes()).toBe(Math.round(64 * 64 * 4 * 4 / 3) + 64 * 64 * 4);

        const hdr = new RenderTexture(64, 64, 24, ARGBHalf);
        hdr.create();
        expect(hdr._estimateVramBytes()).toBe(64 * 64 * 8 + 64 * 64 * 4);
    });

    test("a filter change on a created target costs nothing until it is re-created", () => {
        const rt = new RenderTexture(64, 64, 24, ARGB32);
        rt.create();
        rt.filterMode = 2;
        expect(rt.isCreated()).toBe(false);
        expect(rt._estimateVramBytes()).toBe(0);
        expect(rt.create()).toBe(true);
        expect(rt._estimateVramBytes()).toBe(Math.round(64 * 64 * 4 * 4 / 3) + 64 * 64 * 4);
    });

    test("a target that is not created costs nothing, and depth 0 removes the depth term", () => {
        const rt = new RenderTexture(512, 512, 24, ARGB32);
        expect(rt._estimateVramBytes()).toBe(0);

        const flat = new RenderTexture(64, 64, 0, ARGB32);
        flat.create();
        expect(flat._estimateVramBytes()).toBe(64 * 64 * 4);
    });
});

describe("the public surface names no THREE type", () => {
    test("the members an author touches are engine-typed", () => {
        const rt = new RenderTexture(8, 8);
        const api = Object.getOwnPropertyNames(Object.getPrototypeOf(rt))
            .filter(name => !name.startsWith("_") && name !== "constructor");
        // Texture's inherited surface plus this type's own; every one of them
        // takes or returns an engine type — the THREE handle is `_internal*`.
        expect(api).toContain("create");
        expect(api).toContain("release");
        expect(api).toContain("isCreated");
        expect(api).toEqual(expect.arrayContaining(["width", "height", "depth", "format", "antiAliasing"]));
        expect(api.some(name => /three/i.test(name))).toBe(false);
    });
});
