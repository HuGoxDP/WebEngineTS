import { describe, test, expect } from "vitest";
import { Mesh } from "../src/engine/core/graphics/Mesh";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";
import { Matrix4x4 } from "../src/engine/core/math/Matrix4x4";

describe("Mesh.combine (static batching)", () => {
    test("combined vertex and triangle counts equal the sum of the sources", () => {
        const cube = Mesh.createCube(1);
        const baseV = cube.vertexCount;
        const baseT = cube.triangles.length;

        const combined = Mesh.combine([
            { mesh: cube },
            {
                mesh: cube,
                matrix: Matrix4x4.TRS(new Vector3(10, 0, 0), Quaternion.identity, Vector3.one),
            },
        ]);

        expect(combined.vertexCount).toBe(baseV * 2);
        expect(combined.triangles.length).toBe(baseT * 2);
    });

    test("instance transforms are baked into the combined geometry", () => {
        const cube = Mesh.createCube(1); // spans [-0.5, 0.5] on each axis
        const combined = Mesh.combine([
            { mesh: cube },
            {
                mesh: cube,
                matrix: Matrix4x4.TRS(new Vector3(10, 0, 0), Quaternion.identity, Vector3.one),
            },
        ]);

        const b = combined.bounds;
        expect(b.min.x).toBeCloseTo(-0.5, 3);
        expect(b.max.x).toBeCloseTo(10.5, 3);
    });

    test("empty input yields an empty mesh; single input round-trips counts", () => {
        expect(Mesh.combine([]).vertexCount).toBe(0);

        const sphere = Mesh.createSphere(0.5, 8);
        const one = Mesh.combine([{ mesh: sphere }]);
        expect(one.vertexCount).toBe(sphere.vertexCount);
        expect(one.triangles.length).toBe(sphere.triangles.length);
    });
});
