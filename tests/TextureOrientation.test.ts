import { describe, test, expect, vi } from "vitest";
import * as THREE from "three";

/**
 * Orientation has to be sayable.
 *
 * An image decoded by the browser has its first row at the top, and three.js
 * flips it on upload by default so V=0 is the bottom — the engine's own
 * primitives and Unity both expect that. glTF puts the UV origin at the
 * top-left, so `GLTFLoader` uploads with `flipY = false`, and a KTX2 texture is
 * always `false` because block-compressed data cannot be flipped at all.
 *
 * So a separately-loaded map on a glTF-imported mesh samples upside down, while
 * the same asset shipped as `.ktx2` does not: the *file format* changes the
 * picture. On Benchscene2 that measured as a max channel Δ of 173 between the
 * two arms of a KTX2 A/B — a different scene, not a different texture format.
 *
 * The convention itself is not settled here (see
 * `design/unity-coordinates-plan.md`); what is settled is that content can now
 * state the orientation through the public API instead of reaching past it into
 * the Three.js texture, which the engine's own rules forbid.
 */

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {} }),
    }),
});

const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");

/** A texture as the image path leaves it. */
function decodedImage(): InstanceType<typeof Texture2D> {
    const three = new THREE.Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    return Texture2D._fromThreeTexture(three);
}

/** A texture as the KTX2 path leaves it — `flipY` forced false by three.js. */
function transcoded(): InstanceType<typeof Texture2D> {
    return Texture2D._fromThreeTexture(new THREE.CompressedTexture(
        [] as unknown as ImageData[], 4, 4, THREE.RGBA_BPTC_Format, THREE.UnsignedByteType,
    ));
}

describe("Texture.flipVertically", () => {
    test("it reports what the image path actually does", () => {
        expect(decodedImage().flipVertically).toBe(true);
    });

    test("and what the KTX2 path cannot help doing", () => {
        // Not a choice three.js makes — `CompressedTexture` forces it, because
        // block-compressed data cannot be flipped on upload.
        expect(transcoded().flipVertically).toBe(false);
    });

    test("the two disagree, which is the defect it exists to let content fix", () => {
        expect(decodedImage().flipVertically).not.toBe(transcoded().flipVertically);
    });

    test("setting it reaches the upload", () => {
        const t = decodedImage();

        t.flipVertically = false;

        expect(t.flipVertically).toBe(false);
        expect(t._internalThreeTexture.flipY).toBe(false);
    });

    test("changing it marks the texture for re-upload", () => {
        // `needsUpdate` is write-only in Three.js — setting it bumps `version`,
        // which is what the renderer actually reads.
        const t = decodedImage();
        const before = t._internalThreeTexture.version;

        t.flipVertically = false;

        // Without this the GPU keeps the copy it already has, and the property
        // reads as changed while the picture does not change.
        expect(t._internalThreeTexture.version).toBeGreaterThan(before);
    });

    test("setting it to what it already is does not force an upload", () => {
        const t = decodedImage();
        const before = t._internalThreeTexture.version;

        t.flipVertically = true;

        expect(t._internalThreeTexture.version).toBe(before);
    });

    test("applied unconditionally, both formats end up in one orientation", () => {
        // The shape content must use: setting it only on the arm that needs it
        // puts the arm-dependent difference straight back.
        const image = decodedImage();
        const ktx2 = transcoded();

        image.flipVertically = false;
        ktx2.flipVertically = false;

        expect(image.flipVertically).toBe(ktx2.flipVertically);
    });
});
