import { describe, test, expect } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { InstancedMeshRenderer } from "../src/engine/core/rendering/InstancedMeshRenderer";
import { Mesh } from "../src/engine/core/graphics/Mesh";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";
import { Matrix4x4 } from "../src/engine/core/math/Matrix4x4";
import { Color } from "../src/engine/core/math/Color";

function makeRenderer(): InstancedMeshRenderer {
    const go = new GameObject("Instanced");
    const inst = go.addComponent(InstancedMeshRenderer);
    inst.mesh = Mesh.createCube(1);
    inst.sharedMaterial = new StandardMaterial();
    return inst;
}

function expectMatrixClose(a: Matrix4x4, b: Matrix4x4): void {
    for (let i = 0; i < 16; i++) {
        expect(a.elements[i]).toBeCloseTo(b.elements[i], 4);
    }
}

describe("InstancedMeshRenderer", () => {
    test("count grows and capacity always covers it", () => {
        const inst = makeRenderer();
        expect(inst.count).toBe(0);

        inst.count = 3;
        expect(inst.count).toBe(3);
        expect(inst.capacity).toBeGreaterThanOrEqual(3);
    });

    test("setInstanceTransform / getInstanceMatrix round-trips a TRS matrix", () => {
        const inst = makeRenderer();
        inst.count = 2;

        const pos = new Vector3(1, 2, 3);
        const rot = Quaternion.identity;
        const scale = new Vector3(2, 2, 2);
        inst.setInstanceTransform(1, pos, rot, scale);

        const expected = Matrix4x4.TRS(pos, rot, scale);
        expectMatrixClose(inst.getInstanceMatrix(1), expected);
    });

    test("setInstanceTransform auto-grows count to include the index", () => {
        const inst = makeRenderer();
        expect(inst.count).toBe(0);

        inst.setInstanceTransform(4, new Vector3(0, 0, 0), Quaternion.identity, Vector3.one);
        expect(inst.count).toBe(5);
    });

    test("growing beyond capacity preserves earlier instance matrices", () => {
        const inst = makeRenderer();
        inst.count = 2;
        inst.setInstanceTransform(0, new Vector3(5, 0, 0), Quaternion.identity, Vector3.one);
        const before = inst.getInstanceMatrix(0);

        const cap = inst.capacity;
        inst.count = cap + 1; // forces reallocation
        expect(inst.capacity).toBeGreaterThan(cap);

        expectMatrixClose(inst.getInstanceMatrix(0), before);
    });

    test("per-instance color assignment does not throw and is retained across growth", () => {
        const inst = makeRenderer();
        inst.count = 1;
        // setColorAt allocates the instance-color buffer on first use.
        expect(() =>
            inst.setInstanceColor(0, new Color(1, 0, 0, 1)),
        ).not.toThrow();

        const cap = inst.capacity;
        inst.count = cap + 1; // reallocate; color carry-over path must not throw
        expect(inst.capacity).toBeGreaterThan(cap);
    });
});
