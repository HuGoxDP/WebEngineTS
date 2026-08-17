import { describe, test, expect } from "vitest";
import { ParticleShape } from "../src/engine/core/particles/ParticleShape";
import { ParticleShapeType } from "../src/engine/core/particles/ParticleTypes";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * Two emitter shapes did not sample what they documented. A Cone read `radius`
 * nowhere, so every cone emitted from a point however the field was set — and a
 * dangling comment, "slight offset on the disk at radius=0 for cone base",
 * marked where the code should have been. A Box shell picked one of six faces
 * uniformly, ignoring their areas. Audit part 10, F71 and F72.
 */

const SAMPLES = 4000;

function sampleMany(shape: ParticleShape, n = SAMPLES): { pos: Vector3; dir: Vector3 }[] {
    const out: { pos: Vector3; dir: Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
        const pos = new Vector3();
        const dir = new Vector3();
        shape._sample(pos, dir);
        out.push({ pos, dir });
    }
    return out;
}

function cone(radius: number, angle = 25): ParticleShape {
    const s = new ParticleShape();
    s.type = ParticleShapeType.Cone;
    s.radius = radius;
    s.angle = angle;
    return s;
}

function box(x: number, y: number, z: number): ParticleShape {
    const s = new ParticleShape();
    s.type = ParticleShapeType.Box;
    s.boxExtents = new Vector3(x, y, z);
    s.emitFromShell = true;
    return s;
}

describe("Cone emission", () => {
    test("spawns on a base disk of the documented radius", () => {
        const samples = sampleMany(cone(5));

        const radii = samples.map(s => Math.hypot(s.pos.x, s.pos.z));
        expect(Math.max(...radii)).toBeGreaterThan(4.5);
        expect(Math.max(...radii)).toBeLessThanOrEqual(5);
    });

    test("the disk is flat — a base, not a volume", () => {
        const samples = sampleMany(cone(5), 200);

        for (const s of samples) expect(s.pos.y).toBe(0);
    });

    test("radius 0 still gives the point source it always was", () => {
        const samples = sampleMany(cone(0), 200);

        for (const s of samples) {
            // Math.abs, because a zero radius times a negative cosine is -0.
            expect(Math.abs(s.pos.x)).toBe(0);
            expect(Math.abs(s.pos.z)).toBe(0);
        }
    });

    test("the spawn radius scales with the field", () => {
        const small = sampleMany(cone(1)).map(s => Math.hypot(s.pos.x, s.pos.z));
        const large = sampleMany(cone(10)).map(s => Math.hypot(s.pos.x, s.pos.z));

        expect(Math.max(...small)).toBeLessThan(1.01);
        expect(Math.max(...large)).toBeGreaterThan(9);
    });

    test("the disk is uniform by area, not crowded at the centre", () => {
        // Half the area of a disk lies outside r/sqrt(2), so half the samples
        // should. A bare random would put ~71% of them inside that circle.
        const radii = sampleMany(cone(1)).map(s => Math.hypot(s.pos.x, s.pos.z));
        const outer = radii.filter(r => r > Math.SQRT1_2).length / radii.length;

        expect(outer).toBeGreaterThan(0.45);
        expect(outer).toBeLessThan(0.55);
    });

    test("direction is still within the half-angle of +Y", () => {
        // Unchanged by the position fix, and the reason to keep asserting it.
        const samples = sampleMany(cone(3, 25), 500);
        const limit = Math.cos((25 * Math.PI) / 180) - 1e-9;

        for (const s of samples) expect(s.dir.y).toBeGreaterThanOrEqual(limit);
    });
});

describe("Box shell emission", () => {
    test("weights faces by area rather than counting to six", () => {
        // A 10x1x1 box: the two caps are 4 units of area against 80 for the
        // sides, so ~5% of particles belong on them. One-in-six sends 33%.
        const samples = sampleMany(box(10, 1, 1));
        const onCap = samples.filter(s => Math.abs(Math.abs(s.pos.x) - 10) < 1e-9).length;

        expect(onCap / samples.length).toBeGreaterThan(0.02);
        expect(onCap / samples.length).toBeLessThan(0.09);
    });

    test("a cube is unchanged — every face is a sixth of it", () => {
        const samples = sampleMany(box(1, 1, 1));
        const onX = samples.filter(s => Math.abs(Math.abs(s.pos.x) - 1) < 1e-9).length;

        expect(onX / samples.length).toBeGreaterThan(0.28);
        expect(onX / samples.length).toBeLessThan(0.39);
    });

    test("a flat box emits only from the faces that have area", () => {
        // Extents (1,1,0): the +-Z faces are the whole surface. Uniform picking
        // sent two thirds of the particles to faces of zero area, which is not
        // a face at all — they landed on the rim.
        const samples = sampleMany(box(1, 1, 0), 1000);
        const onRim = samples.filter(
            s => Math.abs(Math.abs(s.pos.x) - 1) < 1e-9 || Math.abs(Math.abs(s.pos.y) - 1) < 1e-9,
        ).length;

        expect(onRim / samples.length).toBeLessThan(0.02);
    });

    test("every sample still lies on the surface", () => {
        const samples = sampleMany(box(2, 3, 4), 1000);

        for (const s of samples) {
            const onFace =
                Math.abs(Math.abs(s.pos.x) - 2) < 1e-9 ||
                Math.abs(Math.abs(s.pos.y) - 3) < 1e-9 ||
                Math.abs(Math.abs(s.pos.z) - 4) < 1e-9;
            expect(onFace).toBe(true);
            expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(2 + 1e-9);
            expect(Math.abs(s.pos.y)).toBeLessThanOrEqual(3 + 1e-9);
            expect(Math.abs(s.pos.z)).toBeLessThanOrEqual(4 + 1e-9);
        }
    });

    test("both signs of a face are used", () => {
        const samples = sampleMany(box(1, 1, 1));
        const plus = samples.filter(s => Math.abs(s.pos.x - 1) < 1e-9).length;
        const minus = samples.filter(s => Math.abs(s.pos.x + 1) < 1e-9).length;

        expect(plus).toBeGreaterThan(0);
        expect(minus).toBeGreaterThan(0);
        expect(Math.abs(plus - minus) / (plus + minus)).toBeLessThan(0.2);
    });

    test("the volume form is untouched", () => {
        const s = box(2, 3, 4);
        s.emitFromShell = false;

        const samples = sampleMany(s, 500);

        for (const p of samples) {
            expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(2);
            expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(3);
            expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(4);
        }
    });
});
