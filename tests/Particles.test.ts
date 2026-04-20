import { describe, test, expect } from "vitest";
import { Color } from "../src/engine/core/math/Color";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Gradient } from "../src/engine/core/particles/Gradient";
import { ParticleShape } from "../src/engine/core/particles/ParticleShape";
import {
    GradientMode,
    ParticleShapeType,
    ParticleSimulationSpace,
    ParticleRenderMode,
} from "../src/engine/core/particles/ParticleTypes";
import { ParticleBurst } from "../src/engine/core/particles/ParticleSystem";

// ──────────────────────────────────────────────────────────────────────────
// Gradient
// ──────────────────────────────────────────────────────────────────────────

describe("Gradient", () => {
    test("default evaluates to opaque white everywhere", () => {
        const g = new Gradient();
        const c = g.evaluate(0.5);
        expect(c.r).toBeCloseTo(1);
        expect(c.g).toBeCloseTo(1);
        expect(c.b).toBeCloseTo(1);
        expect(c.a).toBeCloseTo(1);
    });

    test("blends linearly between two color keys", () => {
        const g = Gradient.fromKeys(
            [[new Color(1, 0, 0, 1), 0], [new Color(0, 0, 1, 1), 1]],
            [[1, 0], [1, 1]],
        );
        const mid = g.evaluate(0.5);
        expect(mid.r).toBeCloseTo(0.5);
        expect(mid.g).toBeCloseTo(0);
        expect(mid.b).toBeCloseTo(0.5);
    });

    test("alpha track is independent of color", () => {
        const g = Gradient.fromKeys(
            [[new Color(1, 0, 0, 1), 0], [new Color(1, 0, 0, 1), 1]],
            [[0, 0], [1, 1]],
        );
        expect(g.evaluate(0).a).toBeCloseTo(0);
        expect(g.evaluate(1).a).toBeCloseTo(1);
        expect(g.evaluate(0.5).a).toBeCloseTo(0.5);
    });

    test("clamps t outside [0, 1]", () => {
        const g = Gradient.fromKeys(
            [[new Color(0, 0, 0, 1), 0], [new Color(1, 1, 1, 1), 1]],
            [[1, 0], [1, 1]],
        );
        expect(g.evaluate(-1).r).toBeCloseTo(0);
        expect(g.evaluate(2).r).toBeCloseTo(1);
    });

    test("Fixed mode does NOT interpolate", () => {
        const g = Gradient.fromKeys(
            [[new Color(1, 0, 0, 1), 0], [new Color(0, 1, 0, 1), 0.5], [new Color(0, 0, 1, 1), 1]],
            [[1, 0], [1, 1]],
        );
        g.mode = GradientMode.Fixed;
        // In Fixed mode, value at 0.25 equals the earlier key (red).
        const c = g.evaluate(0.25);
        expect(c.r).toBeCloseTo(1);
        expect(c.g).toBeCloseTo(0);
        expect(c.b).toBeCloseTo(0);
    });

    test("writes into provided out color (no allocation)", () => {
        const out = new Color();
        const g = Gradient.fromKeys(
            [[new Color(0.2, 0.4, 0.6, 1), 0], [new Color(0.2, 0.4, 0.6, 1), 1]],
            [[1, 0], [1, 1]],
        );
        const result = g.evaluate(0.5, out);
        expect(result).toBe(out);
        expect(out.r).toBeCloseTo(0.2);
        expect(out.g).toBeCloseTo(0.4);
        expect(out.b).toBeCloseTo(0.6);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// ParticleShape
// ──────────────────────────────────────────────────────────────────────────

describe("ParticleShape", () => {
    const pos = new Vector3();
    const dir = new Vector3();

    test("Point shape places particle at origin", () => {
        const s = new ParticleShape();
        s.type = ParticleShapeType.Point;
        s._sample(pos, dir);
        expect(pos.x).toBe(0);
        expect(pos.y).toBe(0);
        expect(pos.z).toBe(0);
        // Direction is a unit vector
        const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        expect(mag).toBeCloseTo(1, 2);
    });

    test("Sphere shape respects radius", () => {
        const s = new ParticleShape();
        s.type = ParticleShapeType.Sphere;
        s.radius = 5;
        for (let i = 0; i < 50; i++) {
            s._sample(pos, dir);
            const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
            expect(r).toBeLessThanOrEqual(5 + 1e-6);
        }
    });

    test("Sphere shell emits exactly on surface", () => {
        const s = new ParticleShape();
        s.type = ParticleShapeType.Sphere;
        s.radius = 3;
        s.emitFromShell = true;
        for (let i = 0; i < 30; i++) {
            s._sample(pos, dir);
            const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
            expect(r).toBeCloseTo(3, 4);
        }
    });

    test("Cone direction is within half-angle of +Y", () => {
        const s = new ParticleShape();
        s.type = ParticleShapeType.Cone;
        s.angle = 30;
        const cosMin = Math.cos((30 * Math.PI) / 180);
        for (let i = 0; i < 50; i++) {
            s._sample(pos, dir);
            expect(dir.y).toBeGreaterThanOrEqual(cosMin - 1e-5);
        }
    });

    test("Box shape stays within extents", () => {
        const s = new ParticleShape();
        s.type = ParticleShapeType.Box;
        s.boxExtents = new Vector3(2, 3, 4);
        for (let i = 0; i < 50; i++) {
            s._sample(pos, dir);
            expect(Math.abs(pos.x)).toBeLessThanOrEqual(2 + 1e-6);
            expect(Math.abs(pos.y)).toBeLessThanOrEqual(3 + 1e-6);
            expect(Math.abs(pos.z)).toBeLessThanOrEqual(4 + 1e-6);
        }
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Enums & simple types
// ──────────────────────────────────────────────────────────────────────────

describe("Particle enums", () => {
    test("ParticleShapeType values are distinct", () => {
        const set = new Set([
            ParticleShapeType.Point,
            ParticleShapeType.Sphere,
            ParticleShapeType.Cone,
            ParticleShapeType.Box,
        ]);
        expect(set.size).toBe(4);
    });

    test("ParticleSimulationSpace values", () => {
        expect(ParticleSimulationSpace.Local).toBe("Local");
        expect(ParticleSimulationSpace.World).toBe("World");
    });

    test("ParticleRenderMode values", () => {
        expect(ParticleRenderMode.Billboard).toBe("Billboard");
        expect(ParticleRenderMode.StretchedBillboard).toBe("StretchedBillboard");
    });

    test("GradientMode values", () => {
        expect(GradientMode.Blend).toBe("Blend");
        expect(GradientMode.Fixed).toBe("Fixed");
    });
});

describe("ParticleBurst", () => {
    test("stores time and count", () => {
        const burst = new ParticleBurst(1.5, 20);
        expect(burst.time).toBe(1.5);
        expect(burst.count).toBe(20);
    });
});
