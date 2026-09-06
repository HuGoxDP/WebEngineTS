import { describe, test, expect } from "vitest";
import { Mesh } from "../src/engine/core/graphics/Mesh";

/**
 * Which way a textured sphere wraps.
 *
 * `Mesh.createSphere` carried `THREE.SphereGeometry`'s parameterisation, written
 * for a right-handed frame, into this engine's left-handed one. A sphere is the
 * same sphere either way, so nothing showed until something was mapped onto it:
 * the solar system's Earth rendered with India west of Africa and Madagascar off
 * the wrong coast — a factual error in a scenario about the real world.
 *
 * An equirectangular map runs west to east with `u`: `u = 0` at 180°W, `0.5` at
 * the prime meridian, `1` at 180°E. Pinned here against the axes, because the
 * viewer-facing statement — east is to the right of screen — follows from these
 * plus the handedness contract in CoordinateSpaces.test.ts.
 */

/** `u` of the equatorial vertex closest to a direction, by dot product. */
function uToward(mesh: Mesh, x: number, y: number, z: number): number {
    const vertices = mesh.vertices;
    const uvs = mesh.uv;

    let best = -Infinity;
    let bestU = NaN;
    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        if (Math.abs(v.y) > 1e-3) continue;            // equator only
        const dot = v.x * x + v.y * y + v.z * z;
        if (dot > best) { best = dot; bestU = uvs[i].x; }
    }
    return bestU;
}

describe("Mesh.createSphere UV orientation", () => {
    // 4 segments would put a vertex exactly on each axis; 32 is what content uses.
    const sphere = Mesh.createSphere(1, 32);

    test("the prime meridian faces +X", () => {
        expect(uToward(sphere, 1, 0, 0)).toBeCloseTo(0.5, 5);
    });

    test("90°E faces +Z, and 90°W faces −Z", () => {
        // The pair that the right-handed parameterisation had the other way round.
        expect(uToward(sphere, 0, 0, 1)).toBeCloseTo(0.75, 5);
        expect(uToward(sphere, 0, 0, -1)).toBeCloseTo(0.25, 5);
    });

    test("east runs toward +X across the hemisphere a camera on −Z sees", () => {
        // That hemisphere is centred on −Z; +X is screen right, which the
        // handedness tests pin. So `u` must increase from −Z toward +X for east to
        // read to the right, as it does on a globe.
        expect(uToward(sphere, 1, 0, 0)).toBeGreaterThan(uToward(sphere, 0, 0, -1));
    });

    test("v runs from the south pole to the north", () => {
        const vertices = sphere.vertices;
        const uvs = sphere.uv;

        let north = -Infinity;
        let south = Infinity;
        let northV = NaN;
        let southV = NaN;
        for (let i = 0; i < vertices.length; i++) {
            if (vertices[i].y > north) { north = vertices[i].y; northV = uvs[i].y; }
            if (vertices[i].y < south) { south = vertices[i].y; southV = uvs[i].y; }
        }

        expect(northV).toBeCloseTo(1, 5);
        expect(southV).toBeCloseTo(0, 5);
    });
});
