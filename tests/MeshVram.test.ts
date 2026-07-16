import { describe, test, expect } from "vitest";
import { Mesh } from "../src/engine/core/graphics/Mesh";

describe("Mesh._estimateVramBytes", () => {
    test("is positive for a real mesh and scales linearly with counts", () => {
        const cube = Mesh.createCube(1);
        const single = cube._estimateVramBytes();
        expect(single).toBeGreaterThan(0);

        // Combining two identical cubes doubles vertex + index counts, and the
        // index type is unchanged (< 65536 verts), so VRAM should exactly double.
        const combined = Mesh.combine([{ mesh: cube }, { mesh: cube }]);
        expect(combined._estimateVramBytes()).toBe(single * 2);
    });

    test("an empty mesh estimates zero", () => {
        expect(new Mesh("empty")._estimateVramBytes()).toBe(0);
    });
});
