import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";

/**
 * Which loaders `Texture2D.maxSize` actually caps.
 *
 * It is documented as capping "every loaded texture's largest dimension", and
 * it does not: the downscale lives in `fromArrayBuffer`, the loader for
 * standalone image files. A texture that arrives already decoded — inside a
 * GLB, or transcoded from KTX2 — is wrapped, not resized, and nothing says so.
 *
 * These tests pin the real boundary so the documentation can describe it and
 * so a change to it is a deliberate one. They are characterization tests: they
 * assert what the engine does today, including the two cases where it does
 * nothing.
 */

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
    }),
});

/** Decodes anything, at a fixed oversized resolution. */
class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public crossOrigin: string | null = null;
    public width = 0;
    public height = 0;

    private _src = "";

    public get src(): string {
        return this._src;
    }

    public set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
            this.width = 8192;
            this.height = 4096;
            this.onload?.();
        });
    }
}

vi.stubGlobal("Image", FakeImage);

// Only the two blob helpers — `URL` itself is still constructed by module code
// that runs during import, so it cannot be replaced wholesale.
URL.createObjectURL = () => "blob:panorama";
URL.revokeObjectURL = () => {};

const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { Cubemap } = await import("../src/engine/core/graphics/Cubemap");

const CAP = 2048;

/** What a KTX2 transcode produces: block-compressed, at the file's size. */
function compressed(width: number, height: number) {
    return new THREE.CompressedTexture(
        [{ data: new Uint8Array(8), width, height }] as unknown as ImageData[],
        width,
        height,
        THREE.RGBA_BPTC_Format,
        THREE.UnsignedByteType,
    );
}

/** What a GLTF load produces: an ordinary decoded image, already on the GPU path. */
function decoded(width: number, height: number) {
    const tex = new THREE.Texture({ width, height } as unknown as HTMLImageElement);
    tex.needsUpdate = true;
    return tex;
}

beforeEach(() => {
    Texture2D.maxSize = CAP;
});

afterEach(() => {
    Texture2D.maxSize = 0;
    // The lazily-built loader is a private static; a stub left behind would
    // leak into any later test that loads a KTX2 texture.
    (Texture2D as unknown as { _ktx2Loader: unknown })._ktx2Loader = null;
});

describe("Texture2D.maxSize — the loaders that honour it", () => {
    test("fromArrayBuffer downscales a standalone image", async () => {
        const texture = await Texture2D.fromArrayBuffer(new ArrayBuffer(8));

        expect(texture.width).toBe(CAP);
        expect(texture.height).toBe(CAP / 2);
    });

    test("a cubemap loaded from a URL downscales too", async () => {
        const cube = await Cubemap.fromEquirectangular("blob:panorama.jpg");

        // The cap applies to the larger dimension, so 8192x4096 arrives as
        // 2048x1024 — drawn into a canvas at the smaller size before upload.
        const image = cube._internalThreeTexture.image as { width: number; height: number };
        expect(image.width).toBe(CAP);
        expect(image.height).toBe(CAP / 2);
    });

    test("no cap means no downscale", async () => {
        Texture2D.maxSize = 0;

        const texture = await Texture2D.fromArrayBuffer(new ArrayBuffer(8));

        expect(texture.width).toBe(8192);
    });
});

describe("Texture2D.maxSize — the loaders that do not", () => {
    test("a texture decoded inside a GLB keeps its full size", () => {
        // ScenarioAssets wraps every GLTF material map with _fromThreeTexture.
        // three.js has already decoded and is about to upload it; the wrap only
        // records the dimensions. A 4K texture in a model ignores the cap, and
        // nothing warns.
        const texture = Texture2D._fromThreeTexture(decoded(4096, 4096));

        expect(texture.width).toBe(4096);
        expect(texture.height).toBe(4096);
    });

    test("a KTX2 texture keeps its full size", async () => {
        // Correct, not a defect: a block-compressed texture cannot be resized
        // by drawing it into a canvas. The consequence is that `maxSize` and
        // KTX2 do not compound — worth stating, because a run with both set
        // gets the compression saving and not the resolution one.
        const loader = { parse: (_data: ArrayBuffer, onLoad: (t: THREE.Texture) => void) => onLoad(compressed(8192, 4096)) };
        (Texture2D as unknown as { _ktx2Loader: unknown })._ktx2Loader = loader;

        const texture = await Texture2D.fromKTX2ArrayBuffer(new ArrayBuffer(8));

        expect(texture.width).toBe(8192);
        expect(texture.height).toBe(4096);
    });

    test("the KTX2 texture is still the cheaper one", async () => {
        // The saving is in the format, not the resolution: BC7 at 8 bpp against
        // RGBA8 at 32 bpp, at four times the dimensions the cap would allow.
        const loader = { parse: (_data: ArrayBuffer, onLoad: (t: THREE.Texture) => void) => onLoad(compressed(8192, 4096)) };
        (Texture2D as unknown as { _ktx2Loader: unknown })._ktx2Loader = loader;

        const ktx2 = await Texture2D.fromKTX2ArrayBuffer(new ArrayBuffer(8));
        const capped = await Texture2D.fromArrayBuffer(new ArrayBuffer(8));

        expect(ktx2._estimateVramBytes()).toBe(8192 * 4096);
        expect(capped._estimateVramBytes()).toBe(CAP * (CAP / 2) * 4);
    });
});
