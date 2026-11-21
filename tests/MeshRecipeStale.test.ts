import { describe, test, expect, afterEach, vi } from "vitest";
import { Mesh, IndexFormat, SubMesh } from "../src/engine/core/graphics/Mesh";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Vector4 } from "../src/engine/core/math/Vector4";
import { Color } from "../src/engine/core/math/Color";
import { Bounds } from "../src/engine/core/math/Bounds";

/**
 * M0.2hr4, Phase 1 — a mesh knows when its recipe no longer describes its
 * geometry, and how many MeshFilters use it.
 *
 * Before this, no edit ever cleared the recipe: an edited cube saved as an
 * unedited cube, silently reverting the edit. Now every geometry write through
 * `_markDirty()` stales the recipe, `primitive` reports null, and the codec
 * (Phase 3) saves such a mesh empty with a warning. Bounds-only changes rebuild
 * nothing and must not stale it.
 *
 * The use count (`_filterUses`, `_retainByFilter`, `_releaseByFilter`) is the
 * lifetime basis for D-2: a getter-made instance (`_autoDestroy`) is freed
 * exactly when its last MeshFilter lets go.
 *
 * DW-1.6 is pinned by the untouched `tests/Serialization.test.ts` :1976-2056 —
 * no test there is edited by this task.
 */

const meshes: Mesh[] = [];

function cube(size: number = 1): Mesh {
    const m = Mesh.createCube(size);
    meshes.push(m);
    return m;
}

function track(m: Mesh): Mesh {
    meshes.push(m);
    return m;
}

afterEach(() => {
    for (const m of meshes) if (m.exists()) m.destroyImmediate();
    meshes.length = 0;
    vi.restoreAllMocks();
});

describe("Mesh recipe staleness (M0.2hr4 DW-1.1)", () => {
    // Every writer that goes through _markDirty(). One write on a fresh cube
    // must stale the recipe: the geometry no longer matches the factory call.
    const writers: Array<[string, (m: Mesh) => void]> = [
        ["vertices", m => { m.vertices = [new Vector3(0, 0, 0)]; }],
        ["normals", m => { m.normals = [new Vector3(0, 1, 0)]; }],
        ["tangents", m => { m.tangents = [new Vector4(1, 0, 0, 1)]; }],
        ["uv", m => { m.uv = [new Vector2(0, 0)]; }],
        ["uv2", m => { m.uv2 = [new Vector2(0, 0)]; }],
        ["uv3", m => { m.uv3 = [new Vector2(0, 0)]; }],
        ["uv4", m => { m.uv4 = [new Vector2(0, 0)]; }],
        ["colors", m => { m.colors = [new Color(1, 1, 1, 1)]; }],
        ["triangles", m => { m.triangles = [0, 1, 2]; }],
        ["indexFormat", m => { m.indexFormat = IndexFormat.UInt32; }],
        ["setSubMesh", m => { m.setSubMesh(0, new SubMesh(0, 36)); }],
        ["recalculateNormals", m => { m.recalculateNormals(); }],
        ["recalculateTangents", m => { m.recalculateTangents(); }],
        ["clear", m => { m.clear(); }],
    ];

    test.each(writers)("writing %s once stales the recipe", (_name, write) => {
        const m = cube();
        expect(m.primitive).toEqual({ kind: "Cube", args: [1] });

        write(m);

        expect(m.primitive).toBeNull();
    });
});

describe("Mesh factories are not stale at birth (M0.2hr4 DW-1.2)", () => {
    const factories: Array<[string, () => Mesh, { kind: string; args: number[] }]> = [
        ["Cube", () => Mesh.createCube(2), { kind: "Cube", args: [2] }],
        ["Sphere", () => Mesh.createSphere(0.5, 16), { kind: "Sphere", args: [0.5, 16] }],
        ["Plane", () => Mesh.createPlane(2, 3, 2, 2), { kind: "Plane", args: [2, 3, 2, 2] }],
        ["Cylinder", () => Mesh.createCylinder(0.5, 2, 12), { kind: "Cylinder", args: [0.5, 2, 12] }],
        ["Capsule", () => Mesh.createCapsule(0.5, 2, 12), { kind: "Capsule", args: [0.5, 2, 12] }],
        ["Quad", () => Mesh.createQuad(2, 1), { kind: "Quad", args: [2, 1] }],
    ];

    test.each(factories)("%s reports its recipe", (_name, make, recipe) => {
        const m = track(make());

        expect(m.primitive).toEqual(recipe);
    });
});

describe("Bounds changes do not stale the recipe (M0.2hr4 DW-1.3)", () => {
    test("set bounds leaves primitive non-null", () => {
        const m = cube();

        m.bounds = new Bounds(new Vector3(0, 0, 0), new Vector3(10, 10, 10));

        expect(m.primitive).toEqual({ kind: "Cube", args: [1] });
    });

    test("recalculateBounds leaves primitive non-null", () => {
        const m = cube();

        m.recalculateBounds();

        expect(m.primitive).toEqual({ kind: "Cube", args: [1] });
    });
});

describe("clone carries recipe staleness (M0.2hr4 DW-1.4)", () => {
    test("an unedited cube's clone keeps the recipe", () => {
        const m = cube();

        const c = track(m.clone());

        expect(c.primitive).toEqual(m.primitive);
    });

    test("an edited cube's clone reports no recipe", () => {
        const m = cube();
        m.vertices = m.vertices.map(v => new Vector3(v.x * 2, v.y, v.z));

        const c = track(m.clone());

        expect(c.primitive).toBeNull();
    });

    test("editing a clone does not stale the original", () => {
        const m = cube();
        const c = track(m.clone());

        c.vertices = [new Vector3(9, 9, 9)];

        expect(c.primitive).toBeNull();
        expect(m.primitive).toEqual({ kind: "Cube", args: [1] });
    });

    test("a stale clone's own clone stays stale", () => {
        const m = cube();
        m.clear();
        const c = track(m.clone());

        const cc = track(c.clone());

        expect(cc.primitive).toBeNull();
    });
});

describe("Mesh filter use count (M0.2hr4 DW-1.5)", () => {
    test("retain x2 then release leaves one use and returns false", () => {
        const m = cube();

        m._retainByFilter();
        m._retainByFilter();
        const freed = m._releaseByFilter();

        expect(m._filterUses).toBe(1);
        expect(freed).toBe(false);
    });

    test("the last release of an auto-destroy mesh returns true", () => {
        const m = cube();
        m._autoDestroy = true;
        m._retainByFilter();
        m._retainByFilter();
        m._releaseByFilter();

        const freed = m._releaseByFilter();

        expect(m._filterUses).toBe(0);
        expect(freed).toBe(true);
    });

    test("the last release without auto-destroy returns false", () => {
        const m = cube();
        m._autoDestroy = false;
        m._retainByFilter();

        const freed = m._releaseByFilter();

        expect(m._filterUses).toBe(0);
        expect(freed).toBe(false);
    });

    test("a release at 0 stays 0 and logs one console.error", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const m = cube();

        const freed = m._releaseByFilter();

        expect(m._filterUses).toBe(0);
        expect(freed).toBe(false);
        expect(error).toHaveBeenCalledTimes(1);
    });
});
