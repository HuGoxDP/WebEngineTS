import { describe, test, expect, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Mesh } from "../src/engine/core/graphics/Mesh";
import { MeshFilter } from "../src/engine/core/rendering/MeshFilter";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { Bounds } from "../src/engine/core/math/Bounds";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * M0.2hr3 / AC-5: five mesh data writes used to rebuild the GPU geometry once
 * per write (five `_syncToThree` calls per renderer). They now queue the
 * renderer, and one static flush rebuilds it exactly once. Existing readers
 * (geometry, `localBounds`, `bounds`) pull the flush forward so U-4 stays green.
 */

const made: GameObject[] = [];
const meshes: Mesh[] = [];

const geoOf = (r: MeshRenderer): any => (r as any)._threeMesh.geometry;
const posCount = (r: MeshRenderer): number =>
    geoOf(r).getAttribute("position")?.count ?? 0;
/** Optional call so the same file also runs (and fails on counts) against base. */
const flush = (): void => (MeshRenderer as any)._flushDirty?.();

function track(go: GameObject): GameObject {
    made.push(go);
    return go;
}

function mesh(name: string): Mesh {
    const m = new Mesh(name);
    meshes.push(m);
    return m;
}

/** A triangle drawn by one renderer, ready before any sync spy is installed. */
function seed(): { go: GameObject; filter: MeshFilter; renderer: MeshRenderer; mesh: Mesh } {
    const m = mesh(nameOf());
    m.vertices = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
    m.normals = [v(0, 0, 1), v(0, 0, 1), v(0, 0, 1)];
    m.uv = [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)];
    m.triangles = [0, 1, 2];
    m.recalculateBounds();

    const go = track(new GameObject("Deferred"));
    const filter = go.addComponent(MeshFilter);
    filter.sharedMesh = m;
    const renderer = go.addComponent(MeshRenderer);
    renderer.sharedMaterial = new StandardMaterial();
    return { go, filter, renderer, mesh: m };
}

let seedIndex = 0;
function nameOf(): string {
    return `Deferred-${seedIndex++}`;
}
function v(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
}

/** A quad's data, replacing the seeded triangle through five separate writes. */
function fiveWrites(m: Mesh): void {
    m.vertices = [v(0, 0, 0), v(3, 0, 0), v(3, 2, 0), v(0, 2, 0)];
    m.normals = [v(0, 0, 1), v(0, 0, 1), v(0, 0, 1), v(0, 0, 1)];
    m.uv = [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1)];
    m.triangles = [0, 1, 2, 0, 2, 3];
    m.recalculateNormals();
}

afterEach(() => {
    flush();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    for (const m of meshes) if (m.exists()) m.destroyImmediate();
    meshes.length = 0;
    vi.restoreAllMocks();
});

describe("M0.2hr3: deferred mesh rebuild (AC-5)", () => {
    test("five data writes plus one flush rebuild exactly once, with final data", () => {
        const { renderer, mesh: m } = seed();
        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");

        fiveWrites(m);
        flush();

        expect(sync).toHaveBeenCalledTimes(1);
        expect(posCount(renderer)).toBe(4);
        expect(geoOf(renderer).boundingBox.max.x).toBe(3);

        // Bounds-only changes stay immediate and do not rebuild geometry.
        m.recalculateBounds();
        expect(renderer.localBounds.equals(m.bounds)).toBe(true);
        expect(renderer.localBounds.max.x).toBe(3);
        expect(renderer.bounds.max.x).toBe(3);
        expect(sync).toHaveBeenCalledTimes(1);
    });

    test("destroy while dirty then flush is a no-op; an undrawn mesh is never rebuilt", () => {
        const { go, mesh: m } = seed();
        const orphan = mesh("Orphan");
        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");

        m.vertices = [v(9, 9, 9)];
        orphan.vertices = [v(8, 8, 8)];
        go.destroyImmediate();

        expect(() => flush()).not.toThrow();
        expect(sync).not.toHaveBeenCalled();
    });

    test("flushing an empty dirty set is a no-op", () => {
        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");
        expect(() => flush()).not.toThrow();
        expect(sync).not.toHaveBeenCalled();
    });

    test("a mesh swapped before the flush rebuilds the renderer's current mesh", () => {
        const { filter, renderer, mesh: old } = seed();
        const next = mesh("Next");
        next.vertices = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
        next.triangles = [0, 1, 2];
        next.recalculateBounds();

        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");
        old.vertices = [v(5, 5, 5)];
        filter.sharedMesh = next;
        flush();

        expect(sync).toHaveBeenCalledTimes(1);
        expect(geoOf(renderer)).toBe(next._internalGeometry);
        expect(posCount(renderer)).toBe(3);
    });

    test("a write after the flush re-dirties the renderer", () => {
        const { renderer, mesh: m } = seed();
        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");

        m.vertices = [v(0, 0, 0), v(4, 0, 0), v(0, 4, 0)];
        flush();
        expect(sync).toHaveBeenCalledTimes(1);

        m.normals = [v(0, 0, -1), v(0, 0, -1), v(0, 0, -1)];
        flush();
        expect(sync).toHaveBeenCalledTimes(2);
        expect(posCount(renderer)).toBe(3);
    });

    test("bounds-only changes stay immediate and never rebuild geometry", () => {
        const { renderer, mesh: m } = seed();
        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");

        const assigned = new Bounds(v(1, 2, 3), v(4, 6, 8));
        m.bounds = assigned;

        expect(renderer.localBounds.equals(assigned)).toBe(true);
        expect(sync).not.toHaveBeenCalled();
    });

    test("U-4: a geometry or bounds read right after a write sees the final data", () => {
        const { renderer, mesh: m } = seed();
        const sync = vi.spyOn(Mesh.prototype, "_syncToThree");

        m.vertices = [v(0, 0, 0), v(7, 0, 0), v(0, 7, 0)];
        expect(posCount(renderer)).toBe(3);
        expect(geoOf(renderer).getAttribute("position").getX(1)).toBe(7);
        expect(sync).toHaveBeenCalledTimes(1);

        const updated = new Bounds();
        updated.setMinMax(v(0, 0, 0), v(7, 7, 0));
        m.bounds = updated;
        expect(renderer.localBounds.max.x).toBe(7);
        expect(renderer.bounds.max.x).toBe(7);
        expect(sync).toHaveBeenCalledTimes(1);
    });
});
