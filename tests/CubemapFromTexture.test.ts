import { describe, test, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";

/**
 * Cubemap and Texture2D both allocate a canvas in paths this file touches, and
 * the URL overload decodes through `new Image()`. Both stubs must precede the
 * first import of either class.
 */
let imagesConstructed = 0;

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
    }),
});

/**
 * Stands in for the browser image decoder: it decodes what a browser decodes
 * and fails on what a browser cannot read. KTX2 is the case that matters — it
 * is a GPU container format, not an image format, so no `<img>` will ever
 * decode one however the URL is produced.
 */
class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public crossOrigin: string | null = null;
    public width = 0;
    public height = 0;

    private _src = "";

    constructor() {
        imagesConstructed++;
    }

    public get src(): string {
        return this._src;
    }

    public set src(value: string) {
        this._src = value;
        const decodable = !/\.ktx2(\?|$)/.test(value);
        queueMicrotask(() => {
            if (decodable) {
                this.width = 8192;
                this.height = 4096;
                this.onload?.();
            } else {
                this.onerror?.();
            }
        });
    }
}

vi.stubGlobal("Image", FakeImage);

const { Cubemap } = await import("../src/engine/core/graphics/Cubemap");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { TextureRelease } = await import("../src/engine/core/graphics/TextureRelease");

/**
 * A stand-in for what `Texture2D.fromKTX2ArrayBuffer` produces: a compressed
 * texture the GPU keeps compressed. 8192x4096 BC7 is the real panorama in
 * `Benchscene3.zip`.
 */
function compressedPanorama(width = 8192, height = 4096) {
    const tex = new THREE.CompressedTexture(
        [{ data: new Uint8Array(8), width, height }] as unknown as ImageData[],
        width,
        height,
        THREE.RGBA_BPTC_Format,
        THREE.UnsignedByteType,
    );
    tex.needsUpdate = true;
    return Texture2D._fromThreeTexture(tex);
}

/** The same panorama as an ordinary decoded image, for the A/B comparison. */
function uncompressedPanorama(width = 8192, height = 4096) {
    const tex = new THREE.Texture({ width, height } as unknown as HTMLImageElement);
    tex.needsUpdate = true;
    return Texture2D._fromThreeTexture(tex);
}

beforeEach(() => {
    imagesConstructed = 0;
    Texture2D.maxSize = 0;
    TextureRelease._clear();
});

describe("Cubemap.fromEquirectangular — the URL overload", () => {
    test("a JPEG panorama loads", async () => {
        const cube = await Cubemap.fromEquirectangular("blob:stars_panorama.jpg");

        expect(cube.isEquirectangular).toBe(true);
        expect(imagesConstructed).toBe(1);
    });

    test("a KTX2 panorama cannot be loaded at all", async () => {
        // This is E1's root cause. The overload decodes with `new Image()`, and
        // a browser image decoder cannot read KTX2 — so the largest texture in
        // the scene was excluded from the compressed-texture measurement no
        // matter what the scenario asked for.
        await expect(Cubemap.fromEquirectangular("blob:stars_panorama.ktx2"))
            .rejects.toThrow(/Failed to load image/);
    });
});

describe("Cubemap.fromEquirectangular — the texture overload", () => {
    test("a decoded KTX2 texture is accepted without an image decoder", async () => {
        const panorama = compressedPanorama();

        const cube = await Cubemap.fromEquirectangular(panorama);

        expect(cube.isEquirectangular).toBe(true);
        // Nothing was decoded a second time: the texture arrived decoded.
        expect(imagesConstructed).toBe(0);
    });

    test("the cubemap samples the source's pixels, not a second upload", async () => {
        const panorama = compressedPanorama();

        const cube = await Cubemap.fromEquirectangular(panorama);

        // Sharing the Three.js `source` is what keeps this to one GPU upload;
        // a separate texture object is what keeps the mapping change off the
        // shared asset.
        expect(cube._internalThreeTexture).not.toBe(panorama._internalThreeTexture);
        expect(cube._internalThreeTexture.source).toBe(panorama._internalThreeTexture.source);
        expect(cube._internalThreeTexture.format).toBe(THREE.RGBA_BPTC_Format);
    });

    test("the source asset is left exactly as it was handed over", async () => {
        const panorama = compressedPanorama();

        await Cubemap.fromEquirectangular(panorama);

        // A cached Texture2D may be in use elsewhere; turning it into an
        // environment map behind its owner's back would change how it samples.
        expect(panorama._internalThreeTexture.mapping).toBe(THREE.UVMapping);
    });

    test("a six-face cubemap is still not equirectangular", async () => {
        const panorama = compressedPanorama();

        const cube = await Cubemap.fromEquirectangular(panorama);

        // faceSize stays 0 for a panorama, as it does for the URL overload —
        // the overload changes where the pixels come from, nothing else.
        expect(cube.faceSize).toBe(0);
    });
});

describe("Cubemap — VRAM accounting for a borrowed source", () => {
    test("a borrowed panorama is not counted twice", async () => {
        // MemoryProfiler sums every live Texture *and* every live Cubemap. The
        // source Texture2D stays alive and reports the bytes, so a Cubemap that
        // reported them again would inflate estimatedTextureVramBytes by the
        // size of the biggest texture in the scene.
        const panorama = compressedPanorama();

        const cube = await Cubemap.fromEquirectangular(panorama);

        expect(panorama._estimateVramBytes()).toBeGreaterThan(0);
        expect(cube._estimateVramBytes()).toBe(0);
    });

    test("a cubemap that owns its image still reports it", async () => {
        const cube = await Cubemap.fromEquirectangular("blob:stars_panorama.jpg");

        expect(cube._estimateVramBytes()).toBeGreaterThan(0);
    });

    test("the compressed panorama is the cheaper of the two", () => {
        // The saving E1 exists to make measurable: BC7 at 8 bpp against RGBA8
        // at 32 bpp, on the single largest texture in the scene.
        const compressed = compressedPanorama();
        const plain = uncompressedPanorama();

        expect(compressed._estimateVramBytes()).toBeLessThan(plain._estimateVramBytes());
    });
});

describe("Cubemap — lifetime of a borrowed source", () => {
    test("disposing the cubemap leaves the source usable", async () => {
        const panorama = compressedPanorama();
        const cube = await Cubemap.fromEquirectangular(panorama);

        cube.dispose();

        // The pixels belong to the Texture2D; freeing them from under it would
        // blank a texture its owner still holds.
        expect(panorama._internalThreeTexture.image).not.toBeNull();
        expect(panorama._estimateVramBytes()).toBeGreaterThan(0);
    });

    test("releasing a borrowed cubemap's pixels goes through the owner", async () => {
        const panorama = compressedPanorama();
        const cube = await Cubemap.fromEquirectangular(panorama);

        cube.releaseSourceImage();
        // No probe, so the blind countdown applies: two ticks.
        TextureRelease._tick(null);
        TextureRelease._tick(null);

        // Freed once, by the object that owns the pixels, so its own readable
        // state matches what actually happened.
        expect(panorama.isReadable).toBe(false);
        expect(panorama._internalThreeTexture.image).toBeNull();
    });

    test("a swapped source reaches the cubemap", async () => {
        // TextureStreaming re-decodes a Texture2D in place at another detail
        // level. A cubemap holding the handle from before the swap would keep
        // drawing the level that was replaced.
        const panorama = compressedPanorama(8192, 4096);
        const cube = await Cubemap.fromEquirectangular(panorama);

        const smaller = new THREE.CompressedTexture(
            [{ data: new Uint8Array(8), width: 2048, height: 1024 }] as unknown as ImageData[],
            2048,
            1024,
            THREE.RGBA_BPTC_Format,
            THREE.UnsignedByteType,
        );
        panorama._adoptThreeTexture(smaller, 2048, 1024);

        expect(cube._internalThreeTexture.source).toBe(smaller.source);
        expect(cube._internalThreeTexture.mapping).toBe(THREE.EquirectangularReflectionMapping);
    });
});
