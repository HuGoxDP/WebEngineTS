import { describe, test, expect } from "vitest";
import * as THREE from "three";
import { Texture } from "../src/engine/core/graphics/Texture";
import { Material } from "../src/engine/core/graphics/Material";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";

/**
 * A texture's Three.js handle can be replaced after materials already hold it —
 * an async load finishing, or a streamed asset arriving at a higher detail
 * level. Materials copy that handle when the texture is assigned, so without a
 * reverse index the swap reaches nothing already drawing with it.
 *
 * The base `Texture` is used throughout: its constructor needs no DOM, unlike
 * `Texture2D`'s.
 */

/** Reads the Three.js texture a material currently has in a slot. */
function threeSlot(material: Material, slot: string): unknown {
    return (material._internalThreeMaterial as unknown as Record<string, unknown>)[slot];
}

describe("Texture handle swap — propagation to materials", () => {
    test("a material follows the swap instead of keeping the old handle", () => {
        const texture = new Texture();
        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);

        const before = threeSlot(material, "map");
        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(before).not.toBe(replacement);
        expect(threeSlot(material, "map")).toBe(replacement);
    });

    test("every slot holding the texture is re-pointed, not just the first", () => {
        // One texture can fill several slots; re-syncing only the first would
        // leave the scene half-updated in a way that looks like a shader bug.
        const texture = new Texture();
        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);
        material.setTexture("_EmissionMap", texture);

        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(threeSlot(material, "map")).toBe(replacement);
        expect(threeSlot(material, "emissiveMap")).toBe(replacement);
    });

    test("every material holding the texture follows it", () => {
        const texture = new Texture();
        const first = new Material(new StandardMaterial().shader);
        const second = new Material(new StandardMaterial().shader);
        first.setTexture("_MainTex", texture);
        second.setTexture("_MainTex", texture);

        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(threeSlot(first, "map")).toBe(replacement);
        expect(threeSlot(second, "map")).toBe(replacement);
    });

    test("a cloned material is a second holder and follows too", () => {
        // Cloning shares textures by reference (Unity's semantics), so the
        // instance is every bit as much a holder as its source.
        const texture = new Texture();
        const source = new Material(new StandardMaterial().shader);
        source.setTexture("_MainTex", texture);

        const instance = source.clone();
        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(threeSlot(instance, "map")).toBe(replacement);
    });

    test("a material that dropped the texture stops following it", () => {
        const texture = new Texture();
        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);
        material.setTexture("_MainTex", null);

        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(threeSlot(material, "map")).toBeNull();
    });

    test("dropping one of two slots keeps the other following", () => {
        // The registration is per material, not per slot, so releasing it on
        // the first slot cleared would silently stop updating the second.
        const texture = new Texture();
        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);
        material.setTexture("_EmissionMap", texture);

        material.setTexture("_MainTex", null);

        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(threeSlot(material, "map")).toBeNull();
        expect(threeSlot(material, "emissiveMap")).toBe(replacement);
    });

    test("replacing a texture releases the old one", () => {
        const first = new Texture();
        const second = new Texture();
        const material = new Material(new StandardMaterial().shader);

        material.setTexture("_MainTex", first);
        material.setTexture("_MainTex", second);

        // The old texture must no longer drive this material's slot.
        first._setInternalThreeTexture(new THREE.Texture());
        expect(threeSlot(material, "map")).toBe(second._internalThreeTexture);

        const replacement = new THREE.Texture();
        second._setInternalThreeTexture(replacement);
        expect(threeSlot(material, "map")).toBe(replacement);
    });

    test("a destroyed material is not kept alive by its textures", () => {
        // Registrations are strong, so a material that failed to unregister
        // would leak for as long as the texture lives.
        // destroyImmediate, not destroy: the latter queues a microtask, which
        // is right for gameplay and useless for asserting in the same tick.
        const texture = new Texture();
        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);

        material.destroyImmediate();

        const referents = (texture as unknown as { _referents: Set<unknown> })._referents;
        expect(referents.size).toBe(0);
    });

    test("swapping after every holder is gone does not throw", () => {
        const texture = new Texture();
        const material = new Material(new StandardMaterial().shader);
        material.setTexture("_MainTex", texture);
        material.destroyImmediate();

        expect(() => texture._setInternalThreeTexture(new THREE.Texture())).not.toThrow();
    });
});

describe("Texture handle swap — through the typed material API", () => {
    test("StandardMaterial.albedoTexture follows a swap", () => {
        const texture = new Texture();
        const material = new StandardMaterial();
        material.setTexture("_MainTex", texture);

        const replacement = new THREE.Texture();
        texture._setInternalThreeTexture(replacement);

        expect(threeSlot(material, "map")).toBe(replacement);
    });

    test("copyPropertiesFromMaterial makes the target follow, and the old set stop", () => {
        const carried = new Texture();
        const dropped = new Texture();

        const source = new Material(new StandardMaterial().shader);
        source.setTexture("_MainTex", carried);

        const target = new Material(new StandardMaterial().shader);
        target.setTexture("_MainTex", dropped);
        target.copyPropertiesFromMaterial(source);

        const replacement = new THREE.Texture();
        carried._setInternalThreeTexture(replacement);
        expect(threeSlot(target, "map")).toBe(replacement);

        const droppedReferents =
            (dropped as unknown as { _referents: Set<unknown> })._referents;
        expect(droppedReferents.size).toBe(0);
    });
});
