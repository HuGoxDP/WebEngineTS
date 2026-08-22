import { describe, test, expect, vi } from "vitest";
import * as THREE from "three";

/**
 * A material slot decides whether its texture is colour or data.
 *
 * `Texture2D.fromArrayBuffer` tags everything sRGB — it decodes an image and
 * cannot know what the image means. `fromKTX2ArrayBuffer` tags nothing, so the
 * container's own transfer function survives. Neither is wrong alone, but they
 * disagree: the same normal map shaded one way as a JPEG and another as KTX2,
 * which made the two arms of a KTX2 A/B differ in a shading input as well as a
 * texture format.
 *
 * The slot is where the information actually lives — a normal map is data
 * because it is plugged into the normal slot — so that is where the colour
 * space is now assigned. Found in ScenarioCreator against
 * `0.1.0-local.1787254037912`; this reproduces the table it measured.
 */

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
    }),
});

const { StandardMaterial } = await import("../src/engine/core/graphics/StandardMaterial");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");

/** A texture as `fromArrayBuffer` leaves it: decoded, and tagged sRGB. */
function decodedAsSrgb(): InstanceType<typeof Texture2D> {
    const three = new THREE.Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    three.colorSpace = THREE.SRGBColorSpace;
    return Texture2D._fromThreeTexture(three);
}

/** A texture as the KTX2 path leaves it: untouched. */
function transcodedUntagged(): InstanceType<typeof Texture2D> {
    const three = new THREE.CompressedTexture(
        [] as unknown as ImageData[], 4, 4, THREE.RGBA_BPTC_Format, THREE.UnsignedByteType,
    );
    return Texture2D._fromThreeTexture(three);
}

const space = (t: InstanceType<typeof Texture2D>) => t._internalThreeTexture.colorSpace;

describe("colour slots keep sRGB", () => {
    test("albedo is colour", () => {
        const m = new StandardMaterial();
        const t = decodedAsSrgb();

        m.albedoTexture = t;

        expect(space(t)).toBe(THREE.SRGBColorSpace);
    });

    test("emission is colour", () => {
        const m = new StandardMaterial();
        const t = decodedAsSrgb();

        m.emissionTexture = t;

        expect(space(t)).toBe(THREE.SRGBColorSpace);
    });

    test("a colour slot corrects a texture that arrived untagged", () => {
        // The KTX2 path leaves colorSpace alone, so an albedo map shipped as
        // KTX2 would otherwise skip the sRGB decode its JPEG twin gets.
        const m = new StandardMaterial();
        const t = transcodedUntagged();

        m.albedoTexture = t;

        expect(space(t)).toBe(THREE.SRGBColorSpace);
    });
});

describe("data slots are linear", () => {
    const dataSlots = ["normalTexture", "metallicTexture", "occlusionTexture", "heightTexture"] as const;

    for (const slot of dataSlots) {
        test(`${slot} is data, not colour`, () => {
            const m = new StandardMaterial();
            const t = decodedAsSrgb();

            (m as unknown as Record<string, unknown>)[slot] = t;

            // Matching what GLTFLoader assigns to the same slot, so a texture
            // behaves the same inside a GLB as standalone.
            expect(space(t)).toBe(THREE.NoColorSpace);
        });
    }

    test("the fix is what changed it — the input really was sRGB", () => {
        // Without this the suite would pass just as well if the textures had
        // arrived linear by accident.
        expect(space(decodedAsSrgb())).toBe(THREE.SRGBColorSpace);
    });
});

describe("both delivery formats shade identically", () => {
    test("a normal map is linear whether it came as an image or as KTX2", () => {
        // The reported defect: `srgb` at ktx2=0 and `srgb-linear` at ktx2=1, so
        // the flag moved a shading input and "the same scene with compressed
        // textures" was not strictly true.
        const asImage = decodedAsSrgb();
        const asKtx2 = transcodedUntagged();

        new StandardMaterial().normalTexture = asImage;
        new StandardMaterial().normalTexture = asKtx2;

        expect(space(asImage)).toBe(space(asKtx2));
        expect(space(asImage)).toBe(THREE.NoColorSpace);
    });

    test("and so is a metallic-roughness map", () => {
        const asImage = decodedAsSrgb();
        const asKtx2 = transcodedUntagged();

        new StandardMaterial().metallicTexture = asImage;
        new StandardMaterial().metallicTexture = asKtx2;

        expect(space(asImage)).toBe(space(asKtx2));
        expect(space(asImage)).toBe(THREE.NoColorSpace);
    });
});

describe("clearing a slot", () => {
    test("assigning null is not an error", () => {
        const m = new StandardMaterial();
        m.normalTexture = decodedAsSrgb();

        expect(() => { m.normalTexture = null; }).not.toThrow();
        expect(m.normalTexture).toBeNull();
    });
});
