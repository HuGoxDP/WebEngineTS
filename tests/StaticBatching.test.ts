import { describe, test, expect } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { StaticBatchingUtility } from "../src/engine/core/rendering/StaticBatchingUtility";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { MeshFilter } from "../src/engine/core/rendering/MeshFilter";
import { Mesh } from "../src/engine/core/graphics/Mesh";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { Vector3 } from "../src/engine/core/math/Vector3";

const CUBE_V = 24; // BoxGeometry: 24 vertices

function makeCube(material: StandardMaterial, x: number): { go: GameObject; renderer: MeshRenderer } {
    const go = new GameObject("Cube");
    go.transform.position = new Vector3(x, 0, 0);
    go.addComponent(MeshFilter).sharedMesh = Mesh.createCube(1);
    const renderer = go.addComponent(MeshRenderer);
    renderer.sharedMaterial = material;
    return { go, renderer };
}

describe("StaticBatchingUtility", () => {
    test("groups renderers by material into one batch each, disabling originals", () => {
        const matA = new StandardMaterial();
        const matB = new StandardMaterial();
        const matC = new StandardMaterial();

        const a = [makeCube(matA, 0), makeCube(matA, 2), makeCube(matA, 4)];
        const b = [makeCube(matB, 0), makeCube(matB, 2)];
        const c = makeCube(matC, 0); // singleton — should not be batched

        const batches = StaticBatchingUtility.combine([
            ...a.map(e => e.go), ...b.map(e => e.go), c.go,
        ]);

        expect(batches.length).toBe(2);

        const batchA = batches.find(g => g.getComponent(MeshRenderer)!.sharedMaterial === matA)!;
        const batchB = batches.find(g => g.getComponent(MeshRenderer)!.sharedMaterial === matB)!;
        expect(batchA).toBeDefined();
        expect(batchB).toBeDefined();

        expect(batchA.getComponent(MeshFilter)!.sharedMesh!.vertexCount).toBe(CUBE_V * 3);
        expect(batchB.getComponent(MeshFilter)!.sharedMesh!.vertexCount).toBe(CUBE_V * 2);

        // Originals of batched groups are disabled; the singleton is untouched.
        for (const e of [...a, ...b]) expect(e.renderer.enabled).toBe(false);
        expect(c.renderer.enabled).toBe(true);
    });

    test("bakes world transforms into the combined geometry", () => {
        const mat = new StandardMaterial();
        const cubes = [makeCube(mat, 0), makeCube(mat, 4)]; // spans world x in [-0.5, 4.5]

        const [batch] = StaticBatchingUtility.combine(cubes.map(e => e.go));
        const bounds = batch.getComponent(MeshFilter)!.sharedMesh!.bounds;

        expect(bounds.min.x).toBeCloseTo(-0.5, 3);
        expect(bounds.max.x).toBeCloseTo(4.5, 3);
    });

    test("combineRoot batches descendants and parents the batch under the root", () => {
        const mat = new StandardMaterial();
        const root = new GameObject("Environment");

        const c1 = makeCube(mat, 0);
        const c2 = makeCube(mat, 2);
        c1.go.transform.setParent(root.transform, true);
        c2.go.transform.setParent(root.transform, true);

        const batches = StaticBatchingUtility.combineRoot(root);

        expect(batches.length).toBe(1);
        expect(batches[0].transform.parent).toBe(root.transform);
        expect(c1.renderer.enabled).toBe(false);
        expect(c2.renderer.enabled).toBe(false);
    });
});
