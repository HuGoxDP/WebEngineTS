import { describe, test, expect } from "vitest";
import * as THREE from "three";
import { Material } from "../src/engine/core/graphics/Material";
import { StandardMaterial, MaterialRenderMode } from "../src/engine/core/graphics/StandardMaterial";
import { Shader } from "../src/engine/core/graphics/Shader";
import { Texture } from "../src/engine/core/graphics/Texture";
import { Color } from "../src/engine/core/math/Color";

/**
 * Assigning a shader builds a fresh Three.js material, which starts at its own
 * defaults. Everything the engine-side material was carrying has to be put back
 * — otherwise a shader change silently drops the colours, textures and cutout
 * settings that were already assigned.
 */

function three(material: Material): Record<string, unknown> {
    return material._internalThreeMaterial as unknown as Record<string, unknown>;
}

describe("Material.shader — state survives the swap", () => {
    test("colour properties are re-applied to the new material", () => {
        const material = new StandardMaterial();
        material.color = new Color(0.25, 0.5, 0.75, 1);

        // Compared against the value before the swap rather than against the
        // literal: Three.js stores colour in its linear working space, so
        // asserting 0.25 here would be asserting the sRGB conversion, not the
        // thing under test.
        const before = (three(material)["color"] as THREE.Color).clone();

        material.shader = Shader.Unlit;

        const after = three(material)["color"] as THREE.Color;
        expect(after).not.toBe(before);
        expect(after.r).toBeCloseTo(before.r, 5);
        expect(after.g).toBeCloseTo(before.g, 5);
        expect(after.b).toBeCloseTo(before.b, 5);
    });

    test("textures are re-applied, not dropped", () => {
        const material = new StandardMaterial();
        const texture = new Texture();
        material.setTexture("_MainTex", texture);

        material.shader = Shader.Unlit;

        expect(three(material)["map"]).toBe(texture._internalThreeTexture);
    });

    test("a re-applied texture still follows a later handle swap", () => {
        // The referent registration belongs to setTexture, so re-syncing must
        // not be mistaken for a re-assignment that would need re-registering.
        const material = new StandardMaterial();
        const texture = new Texture();
        material.setTexture("_MainTex", texture);

        material.shader = Shader.Unlit;

        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);
        expect(three(material)["map"]).toBe(replacement);
    });

    test("transparent mode survives in full, not just its `transparent` flag", () => {
        // `transparent` was the one field the old setter carried across;
        // depthWrite, which Transparent mode also turns off, was not.
        const material = new StandardMaterial();
        material.renderMode = MaterialRenderMode.Transparent;

        material.shader = Shader.Unlit;

        expect(three(material)["transparent"]).toBe(true);
        expect(three(material)["depthWrite"]).toBe(false);
    });

    test("cutout state survives — the part no property sync could restore", () => {
        // renderMode and alphaCutoff live engine-side as _Mode / _Cutoff but
        // take effect purely as transparent / alphaTest / depthWrite, so they
        // ride across on the render-state copy rather than the property sync.
        const material = new StandardMaterial();
        material.renderMode = MaterialRenderMode.Cutout;
        material.alphaCutoff = 0.75;

        material.shader = Shader.Unlit;

        expect(three(material)["alphaTest"]).toBeCloseTo(0.75, 5);
        expect(three(material)["depthWrite"]).toBe(true);
    });

    test("assigning the same shader changes nothing", () => {
        const material = new StandardMaterial();
        const before = material._internalThreeMaterial;

        material.shader = material.shader;

        expect(material._internalThreeMaterial).toBe(before);
    });

    test("the engine-side properties themselves are untouched by the swap", () => {
        const material = new StandardMaterial();
        material.color = new Color(1, 0, 0, 1);
        material.setFloat("_Metallic", 0.4);

        material.shader = Shader.Unlit;

        expect(material.color.r).toBe(1);
        expect(material.getFloat("_Metallic")).toBeCloseTo(0.4, 5);
    });
});
