import { describe, test, expect, vi } from "vitest";

/**
 * Every `Mesh.create*` primitive must wind its triangles to agree with the
 * normals it stores beside them.
 *
 * three.js draws with `side: FrontSide`, so a triangle wound against its own
 * normal is back-face culled: the object is visible only where you are looking
 * at its far inner surface. `createPlane` vanishes entirely, `createTorus`
 * renders as a hollow shell, `createCylinder` as an open tube with its lids
 * intact.
 *
 * Found in ScenarioCreator, present on every engine build ever measured — the
 * builders have always done this and nobody had looked. It is not observable
 * from unit tests that only count vertices, which is why it survived: the data
 * is all there and self-consistent, it is simply inside out.
 *
 * The check needs no renderer. For each triangle it compares the geometric
 * normal `(b−a) × (c−a)` against the mean of the three stored vertex normals;
 * a negative dot means the face is wound inside out.
 */

vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const { Mesh } = await import("../src/engine/core/graphics/Mesh");
const { Vector3 } = await import("../src/engine/core/math/Vector3");

interface WindingReport {
    total: number;
    out: number;
    in: number;
    degenerate: number;
}

/** Classifies every face of a mesh as facing out, in, or degenerate. */
function auditWinding(mesh: InstanceType<typeof Mesh>): WindingReport {
    const v = mesh.vertices;
    const n = mesh.normals;
    const tri = mesh.triangles;
    const report: WindingReport = { total: 0, out: 0, in: 0, degenerate: 0 };

    for (let i = 0; i < tri.length; i += 3) {
        const a = v[tri[i]], b = v[tri[i + 1]], c = v[tri[i + 2]];

        // Geometric normal of the face as wound.
        const e1 = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
        const e2 = new Vector3(c.x - a.x, c.y - a.y, c.z - a.z);
        const gx = e1.y * e2.z - e1.z * e2.y;
        const gy = e1.z * e2.x - e1.x * e2.z;
        const gz = e1.x * e2.y - e1.y * e2.x;

        // Mean of the three stored vertex normals.
        const na = n[tri[i]], nb = n[tri[i + 1]], nc = n[tri[i + 2]];
        const mx = (na.x + nb.x + nc.x) / 3;
        const my = (na.y + nb.y + nc.y) / 3;
        const mz = (na.z + nb.z + nc.z) / 3;

        report.total++;
        const area = Math.hypot(gx, gy, gz);
        // A sliver at a pole or seam has no meaningful facing; sphere and
        // capsule both produce them by construction.
        if (area < 1e-12) { report.degenerate++; continue; }

        const dot = gx * mx + gy * my + gz * mz;
        if (dot > 0) report.out++;
        else if (dot < 0) report.in++;
        else report.degenerate++;
    }

    return report;
}

const builders: Array<[string, () => InstanceType<typeof Mesh>]> = [
    ["createCube", () => Mesh.createCube(1)],
    ["createSphere", () => Mesh.createSphere(0.5, 16)],
    ["createQuad", () => Mesh.createQuad(1, 1)],
    ["createPlane", () => Mesh.createPlane(4, 4)],
    ["createPlane (segmented)", () => Mesh.createPlane(4, 4, 3, 2)],
    ["createCylinder", () => Mesh.createCylinder(0.4, 1, 16)],
    ["createCapsule", () => Mesh.createCapsule(0.3, 1, 12)],
    ["createTorus", () => Mesh.createTorus(0.4, 0.15, 16, 24)],
];

describe("Mesh primitives are wound to face outwards", () => {
    for (const [name, build] of builders) {
        test(`${name} has no inside-out faces`, () => {
            const report = auditWinding(build());

            expect(report.total).toBeGreaterThan(0);
            expect(report.in).toBe(0);
            // Guards against a "fix" that silently drops geometry.
            expect(report.out).toBeGreaterThan(0);
        });
    }

    test("a plane is a floor, not a wall", () => {
        // Unity's `PrimitiveType.Plane` lies in XZ facing +Y. Following
        // three.js's `PlaneGeometry` instead put it in XY facing +Z, which is a
        // wall — and duplicated `createQuad`. Nothing could depend on the old
        // orientation: the winding culled the plane away, so it had never
        // rendered.
        const mesh = Mesh.createPlane(4, 6);

        for (const n of mesh.normals) {
            expect(n.y).toBeCloseTo(1, 6);
            expect(n.x).toBeCloseTo(0, 6);
            expect(n.z).toBeCloseTo(0, 6);
        }

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const v of mesh.vertices) {
            expect(v.y).toBeCloseTo(0, 6);
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }

        expect(maxX - minX).toBeCloseTo(4, 6);
        expect(maxZ - minZ).toBeCloseTo(6, 6);
    });

    test("the capsule still occupies the box it is asked for", () => {
        // The winding fix reordered the capsule's middle rings top-down to
        // match its hemispheres. That moves vertices, which the winding audit
        // alone would not notice — a scrambled capsule can still be wound
        // consistently.
        const r = 0.3, h = 1;
        const mesh = Mesh.createCapsule(r, h, 12);

        let minY = Infinity, maxY = -Infinity, maxR = 0;
        for (const p of mesh.vertices) {
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            maxR = Math.max(maxR, Math.hypot(p.x, p.z));
        }

        expect(maxY - minY).toBeCloseTo(h, 6);
        expect(maxY).toBeCloseTo(h / 2, 6);
        expect(maxR).toBeCloseTo(r, 6);
    });

    test("the capsule's rings descend without doubling back", () => {
        // The defect that made the middle band span the whole capsule: rings
        // ordered bottom-up between hemispheres ordered top-down, stitched by
        // one index grid that assumed they agreed.
        const mesh = Mesh.createCapsule(0.3, 1, 12);
        const perRing = 12 + 1;
        const rings = mesh.vertices.length / perRing;

        expect(Number.isInteger(rings)).toBe(true);

        for (let ring = 1; ring < rings; ring++) {
            const prev = mesh.vertices[(ring - 1) * perRing].y;
            const curr = mesh.vertices[ring * perRing].y;
            expect(curr).toBeLessThanOrEqual(prev + 1e-9);
        }
    });

    test("the audit itself can tell the two directions apart", () => {
        // A check that reports zero inside-out faces because it cannot detect
        // one would pass every test above and mean nothing. Reversing a known
        // good mesh must flip its verdict.
        const mesh = Mesh.createCube(1);
        const good = auditWinding(mesh);

        const tri = mesh.triangles;
        const reversed: number[] = [];
        for (let i = 0; i < tri.length; i += 3) {
            reversed.push(tri[i], tri[i + 2], tri[i + 1]);
        }
        mesh.triangles = reversed;
        const bad = auditWinding(mesh);

        expect(good.in).toBe(0);
        expect(good.out).toBe(12);
        expect(bad.out).toBe(0);
        expect(bad.in).toBe(12);
    });
});
