import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { MeshFilter } from "../src/engine/core/rendering/MeshFilter";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { Mesh } from "../src/engine/core/graphics/Mesh";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Bounds } from "../src/engine/core/math/Bounds";

/**
 * Unity's MeshFilter/MeshRenderer contract: the renderer draws whatever mesh
 * the filter holds *now* — shared or instanced — no matter which component was
 * added first, whether the mesh arrived after the renderer, or whether the
 * object was inactive when it was assigned. Editing through `filter.mesh`
 * reaches the screen; replacing a mesh destroys the instance the filter owned,
 * and never the shared asset.
 *
 * Before the fix the renderer read `sharedMesh` once at awake: `filter.mesh = m`
 * drew nothing, late assignment drew nothing, getter edits never reached the
 * screen, and replaced instances leaked.
 */

const CUBE_V = 24; // Mesh.createCube: 24 vertices

const made: GameObject[] = [];
const meshes: Mesh[] = [];

function track(go: GameObject): GameObject {
    made.push(go);
    return go;
}

function cube(): Mesh {
    const m = Mesh.createCube(1);
    meshes.push(m);
    return m;
}

/** Filter with a shared mesh, then a renderer with a material — the order that always worked. */
function drawn(m: Mesh): { go: GameObject; filter: MeshFilter; renderer: MeshRenderer } {
    const go = track(new GameObject("Drawn"));
    const filter = go.addComponent(MeshFilter);
    filter.sharedMesh = m;
    const renderer = go.addComponent(MeshRenderer);
    renderer.sharedMaterial = new StandardMaterial();
    return { go, filter, renderer };
}

const geoOf = (r: MeshRenderer): any => (r as any)._threeMesh.geometry;
const posCount = (r: MeshRenderer): number => geoOf(r).getAttribute("position")?.count ?? 0;

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    for (const m of meshes) if (m.exists()) m.destroyImmediate();
    meshes.length = 0;
});

describe("MeshFilter.mesh and late assignment (M0.2h)", () => {
    // === Guards: the paths that already worked must keep working ===

    test("sharedMesh before the renderer draws with sharedMaterial", () => {
        const m = cube();
        const { renderer } = drawn(m);

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    test("sharedMesh before the renderer draws with an instanced material", () => {
        const m = cube();
        const { renderer } = drawn(m);
        renderer.material = new StandardMaterial();

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    test("updateMesh and forceUpdate keep the drawn geometry current", () => {
        const m = cube();
        const { renderer } = drawn(m);

        renderer.updateMesh();
        expect(geoOf(renderer)).toBe(m._internalGeometry);

        renderer.forceUpdate();
        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    test("swapping meshes never destroys the shared asset", () => {
        const a = cube();
        const b = cube();
        const { filter } = drawn(a);

        filter.sharedMesh = b;
        expect(a.exists()).toBe(true);

        filter.mesh = a;
        expect(b.exists()).toBe(true);

        filter.mesh = null;
        expect(a.exists()).toBe(true);
        expect(b.exists()).toBe(true);
    });

    // === Setter semantics: `filter.mesh = m` draws m itself ===

    test("filter.mesh = m stores the reference and the renderer draws it", () => {
        const m = cube();
        const go = track(new GameObject("SetterFirst"));
        const filter = go.addComponent(MeshFilter);
        filter.mesh = m;

        // Unity's setter assigns the reference; it does not copy.
        expect(filter.sharedMesh).toBe(m);

        const renderer = go.addComponent(MeshRenderer);
        renderer.sharedMaterial = new StandardMaterial();

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    // === Order independence and late assignment ===

    test("a renderer added before any filter picks up the mesh assigned later", () => {
        const m = cube();
        const go = track(new GameObject("RendererFirst"));
        const renderer = go.addComponent(MeshRenderer);
        renderer.sharedMaterial = new StandardMaterial();

        const filter = go.addComponent(MeshFilter);
        filter.sharedMesh = m;

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    test("sharedMesh assigned after the renderer draws", () => {
        const m = cube();
        const go = track(new GameObject("LateShared"));
        const filter = go.addComponent(MeshFilter);
        const renderer = go.addComponent(MeshRenderer);
        renderer.sharedMaterial = new StandardMaterial();

        filter.sharedMesh = m;

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    test("a mesh assigned while inactive draws on activation", () => {
        const m = cube();
        const go = track(new GameObject("SweptArea"));
        const filter = go.addComponent(MeshFilter);
        const renderer = go.addComponent(MeshRenderer);
        renderer.sharedMaterial = new StandardMaterial();

        go.setActive(false);
        filter.sharedMesh = m;
        go.setActive(true);

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    test("filter.mesh assigned while inactive draws on activation", () => {
        const m = cube();
        const go = track(new GameObject("SweptAreaSetter"));
        const filter = go.addComponent(MeshFilter);
        const renderer = go.addComponent(MeshRenderer);
        renderer.sharedMaterial = new StandardMaterial();

        go.setActive(false);
        filter.mesh = m;
        go.setActive(true);

        expect(geoOf(renderer)).toBe(m._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    // === Getter edits reach the screen ===

    test("editing through the mesh getter reaches the drawn geometry", () => {
        const m = cube();
        const { filter, renderer } = drawn(m);

        const inst = filter.mesh!;
        expect(inst).not.toBe(m);
        // The renderer must now draw the instance, not the shared mesh.
        expect(geoOf(renderer)).toBe(inst._internalGeometry);

        const verts = inst.vertices;
        verts[0] = new Vector3(5, 0, 0);
        inst.vertices = verts;

        expect(geoOf(renderer)).toBe(inst._internalGeometry);
        expect(geoOf(renderer).getAttribute("position").getX(0)).toBe(5);
    });

    test("editing an instanced mesh leaves other users of the shared mesh alone", () => {
        const m = cube();
        const mine = drawn(m);
        const other = drawn(m);

        const inst = mine.filter.mesh!;
        const verts = inst.vertices;
        verts[0] = new Vector3(5, 0, 0);
        inst.vertices = verts;

        expect(geoOf(mine.renderer).getAttribute("position").getX(0)).toBe(5);
        expect(geoOf(other.renderer)).toBe(m._internalGeometry);
        expect(m._internalGeometry.getAttribute("position").getX(0)).toBe(-0.5);
    });

    test("editing the shared mesh in place reaches every renderer using it", () => {
        const m = cube();
        const first = drawn(m);
        const second = drawn(m);

        m.vertices = m.vertices.map(v => new Vector3(v.x * 2, v.y, v.z));

        expect(geoOf(first.renderer)).toBe(m._internalGeometry);
        expect(geoOf(second.renderer)).toBe(m._internalGeometry);
        expect(geoOf(first.renderer).getAttribute("position").getX(0)).toBe(-1);
    });

    // === Clearing ===

    test("mesh = null undraws", () => {
        const m = cube();
        const { filter, renderer } = drawn(m);
        expect(posCount(renderer)).toBe(CUBE_V);

        filter.mesh = null;

        expect(filter.sharedMesh).toBeNull();
        expect(filter.mesh).toBeNull();
        expect(posCount(renderer)).toBe(0);
    });

    test("sharedMesh = null undraws", () => {
        const m = cube();
        const { filter, renderer } = drawn(m);

        filter.sharedMesh = null;

        expect(posCount(renderer)).toBe(0);
    });

    // === Instance leaks: a replaced instance is destroyed, not dropped ===

    test("replacing the shared mesh destroys the owned instance", async () => {
        const a = cube();
        const b = cube();
        const { filter, renderer } = drawn(a);
        const inst = filter.mesh!;

        filter.sharedMesh = b;
        await Promise.resolve(); // zero-delay destroys drain in a microtask

        expect(inst.exists()).toBe(false);
        expect(geoOf(renderer)).toBe(b._internalGeometry);
    });

    test("assigning through mesh destroys the previous owned instance", async () => {
        const a = cube();
        const b = cube();
        const go = track(new GameObject("Replace"));
        const filter = go.addComponent(MeshFilter);
        filter.mesh = a;
        const inst = filter.mesh!;

        filter.mesh = b;
        await Promise.resolve();

        expect(inst.exists()).toBe(false);

        const renderer = go.addComponent(MeshRenderer);
        renderer.sharedMaterial = new StandardMaterial();
        expect(geoOf(renderer)).toBe(b._internalGeometry);
    });

    test("mesh = null destroys the owned instance", async () => {
        const m = cube();
        const { filter } = drawn(m);
        const inst = filter.mesh!;

        filter.mesh = null;
        await Promise.resolve();

        expect(inst.exists()).toBe(false);
    });

    test("a sharedMesh swap drops the instance and the renderer follows the new mesh", () => {
        const a = cube();
        const b = cube();
        const { filter, renderer } = drawn(a);
        filter.mesh; // instantiate

        filter.sharedMesh = b;

        expect(geoOf(renderer)).toBe(b._internalGeometry);
        expect(posCount(renderer)).toBe(CUBE_V);
    });

    // === Self-assignment: assigning the held instance back must not destroy it (M0.2hr1) ===

    test("mesh = filter.mesh (self-assign) keeps the owned instance alive and drawn", async () => {
        const { filter, renderer } = drawn(cube());
        const inst = filter.mesh!;

        filter.mesh = inst;

        // Destroy clears vertices synchronously; a self-assign must not destroy.
        expect(posCount(renderer)).toBe(CUBE_V);
        await Promise.resolve(); // zero-delay destroys drain in a microtask
        expect(inst.exists()).toBe(true);
        expect(filter.mesh).toBe(inst);
    });

    test("sharedMesh = filter.mesh (self-assign) keeps the mesh alive and drawn", async () => {
        const { filter, renderer } = drawn(cube());
        const inst = filter.mesh!;

        filter.sharedMesh = inst;

        expect(posCount(renderer)).toBe(CUBE_V);
        await Promise.resolve();
        expect(inst.exists()).toBe(true);
        expect(filter.sharedMesh).toBe(inst);
        expect(geoOf(renderer)).toBe(inst._internalGeometry);
    });

    test("the Unity edit idiom survives: read, edit, assign back through mesh", async () => {
        const { filter, renderer } = drawn(cube());
        const inst = filter.mesh!;

        const verts = inst.vertices;
        verts[0] = new Vector3(5, 0, 0);
        inst.vertices = verts;

        filter.mesh = inst;

        expect(posCount(renderer)).toBe(CUBE_V);
        expect(geoOf(renderer).getAttribute("position").getX(0)).toBe(5);
        await Promise.resolve();
        expect(inst.exists()).toBe(true);
    });

    test("a second filter holding the instance as sharedMesh survives the owner's mesh self-assign", async () => {
        const { filter: filterA, renderer: rendererA } = drawn(cube());
        const inst = filterA.mesh!;

        const goB = track(new GameObject("SecondUser"));
        const filterB = goB.addComponent(MeshFilter);
        const rendererB = goB.addComponent(MeshRenderer);
        rendererB.sharedMaterial = new StandardMaterial();
        filterB.sharedMesh = inst;
        expect(posCount(rendererB)).toBe(CUBE_V);

        filterA.mesh = inst;
        await Promise.resolve();

        expect(inst.exists()).toBe(true);
        expect(posCount(rendererB)).toBe(CUBE_V);
        expect(posCount(rendererA)).toBe(CUBE_V);
    });

    test("a second filter holding the instance as sharedMesh survives the owner's sharedMesh self-assign", async () => {
        const { filter: filterA, renderer: rendererA } = drawn(cube());
        const inst = filterA.mesh!;

        const goB = track(new GameObject("SecondUserShared"));
        const filterB = goB.addComponent(MeshFilter);
        const rendererB = goB.addComponent(MeshRenderer);
        rendererB.sharedMaterial = new StandardMaterial();
        filterB.sharedMesh = inst;
        expect(posCount(rendererB)).toBe(CUBE_V);

        // After this form filterA holds inst as its shared mesh, so rendererA draws inst too.
        filterA.sharedMesh = inst;
        await Promise.resolve();

        expect(inst.exists()).toBe(true);
        expect(posCount(rendererB)).toBe(CUBE_V);
        expect(posCount(rendererA)).toBe(CUBE_V);
    });
});

/**
 * M0.2hr2: two stale-renderer holes left by M0.2h.
 *
 * (1) Destroying the MeshFilter must undraw by itself, and a replacement
 *     filter must be found even though the renderer cached the old one
 *     (`updateMesh` re-finds only when the cache is null, not destroyed).
 * (2) `recalculateBounds()` and `mesh.bounds =` change the extents without a
 *     data write, so they must notify the renderer too — otherwise
 *     `renderer.localBounds` keeps the extents of the last data write.
 *
 * The propagation assertions come BEFORE any manual forceUpdate: a manual
 * update re-reads the filter and re-copies bounds, masking the missing
 * notification. The trailing forceUpdate guards keep the manual path pinned.
 */
describe("M0.2hr2: stale renderer holes", () => {
    test("destroyed MeshFilter stops drawing", () => {
        const { filter, renderer } = drawn(cube());
        expect(posCount(renderer)).toBe(CUBE_V);

        filter.destroyImmediate();

        // Removal must undraw on its own — no manual kick.
        expect(posCount(renderer)).toBe(0);

        renderer.forceUpdate();
        expect(posCount(renderer)).toBe(0);
    });

    test("renderer picks up replacement MeshFilter after destroy", () => {
        const { go, filter, renderer } = drawn(cube());
        filter.destroyImmediate();

        const sphere = Mesh.createSphere();
        meshes.push(sphere);
        const replacement = go.addComponent(MeshFilter);
        replacement.sharedMesh = sphere;

        renderer.forceUpdate();

        expect(geoOf(renderer)).toBe(sphere._internalGeometry);
        expect(posCount(renderer)).toBe(sphere.vertexCount);
    });

    test("recalculateBounds propagates to renderer after in-place position edit", () => {
        const m = cube();
        const { renderer } = drawn(m);

        // Live getter, edited in place: no setter, no data-write notification.
        for (const v of m.vertices) v.x *= 10;
        m.recalculateBounds();
        expect(m.bounds.max.x).toBe(5);

        // The recomputed extents must reach the renderer without a manual kick.
        expect(renderer.localBounds.max.x).toBe(5);

        renderer.forceUpdate();
        expect(renderer.localBounds.max.x).toBe(5);
    });

    test("bounds setter notifies renderer", () => {
        const m = cube();
        const { renderer } = drawn(m);

        const assigned = new Bounds(new Vector3(1, 2, 3), new Vector3(4, 6, 8));
        m.bounds = assigned;

        expect(renderer.localBounds.equals(assigned)).toBe(true);

        renderer.forceUpdate();
        expect(renderer.localBounds.equals(assigned)).toBe(true);
    });
});
