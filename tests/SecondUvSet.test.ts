import { describe, test, expect, vi } from "vitest";
import * as THREE from "three";

/**
 * The second UV set has to survive an import, and land on the channel that
 * samples it.
 *
 * glTF addresses a texture's UV set with `texCoord`, and three.js turns that
 * into `texture.channel`: channel 0 samples the `uv` attribute, channel 1
 * samples `uv1`. Putting a normal or lightmap map on `texCoord: 1` is ordinary
 * — Benchscene2's model does exactly that.
 *
 * Two defects met in the middle. Import read only `uv`, so the second set was
 * dropped; and the writer emitted the engine's `uv2` as three's `uv2`, which is
 * channel *two*. Either way a material pointed at the second set sampled an
 * attribute that was not there, and the failure does not look like a missing
 * texture — it looks like broken shading, which is what sent this to the
 * colour-space investigation first.
 *
 * Engine naming follows Unity, where `uv2` is the second set; three.js counts
 * from `uv`, so the engine's `uv2` is three's `uv1`.
 */

vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Mesh } = await import("../src/engine/core/graphics/Mesh");
const { Vector2 } = await import("../src/engine/core/math/Vector2");

/** A quad carrying two distinct UV sets, as a glTF import would. */
function geometryWithTwoUvSets(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    ]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
        0, 0, 1, 0, 1, 1, 0, 1,
    ]), 2));
    // Deliberately different values, so a test cannot pass by reading the first
    // set twice.
    g.setAttribute("uv1", new THREE.BufferAttribute(new Float32Array([
        0.25, 0.5, 0.75, 0.5, 0.75, 0.9, 0.25, 0.9,
    ]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
}

describe("importing a mesh keeps its second UV set", () => {
    test("uv1 arrives as the engine's uv2", () => {
        const mesh = Mesh.fromThreeGeometry(geometryWithTwoUvSets());

        expect(mesh.uv2.length).toBe(4);
        expect(mesh.uv2[0].x).toBeCloseTo(0.25, 6);
        expect(mesh.uv2[0].y).toBeCloseTo(0.5, 6);
        expect(mesh.uv2[2].x).toBeCloseTo(0.75, 6);
        expect(mesh.uv2[2].y).toBeCloseTo(0.9, 6);
    });

    test("the first set is untouched by it", () => {
        const mesh = Mesh.fromThreeGeometry(geometryWithTwoUvSets());

        expect(mesh.uv.length).toBe(4);
        expect(mesh.uv[2].x).toBeCloseTo(1, 6);
        expect(mesh.uv[2].y).toBeCloseTo(1, 6);
    });

    test("a mesh with only one set gets an empty second one", () => {
        const g = geometryWithTwoUvSets();
        g.deleteAttribute("uv1");

        const mesh = Mesh.fromThreeGeometry(g);

        expect(mesh.uv.length).toBe(4);
        expect(mesh.uv2.length).toBe(0);
    });
});

describe("the second UV set reaches the channel that samples it", () => {
    test("the engine's uv2 is written as three's uv1", () => {
        const mesh = Mesh.fromThreeGeometry(geometryWithTwoUvSets());

        const geometry = mesh._internalGeometry;
        const written = geometry.getAttribute("uv1");

        // channel 0 is `uv`, channel 1 is `uv1` — a texture on texCoord 1 reads
        // this attribute and nothing else.
        expect(written).toBeDefined();
        expect(written.count).toBe(4);
        expect(written.getX(0)).toBeCloseTo(0.25, 6);
        expect(written.getY(2)).toBeCloseTo(0.9, 6);
    });

    test("nothing is left on channel two", () => {
        // Where it used to go: an attribute three declares but this material
        // never samples, so the map silently read nothing.
        const mesh = Mesh.fromThreeGeometry(geometryWithTwoUvSets());

        expect(mesh._internalGeometry.getAttribute("uv2")).toBeUndefined();
    });

    test("a set assigned through the public API is written the same way", () => {
        const mesh = Mesh.createQuad(1, 1);
        mesh.uv2 = [
            new Vector2(0.1, 0.2), new Vector2(0.3, 0.4),
            new Vector2(0.5, 0.6), new Vector2(0.7, 0.8),
        ];

        const written = mesh._internalGeometry.getAttribute("uv1");

        expect(written).toBeDefined();
        expect(written.getX(3)).toBeCloseTo(0.7, 6);
    });
});
