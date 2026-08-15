import { describe, test, expect } from "vitest";
import {
    Gradient, GradientColorKey, GradientAlphaKey,
} from "../src/engine/core/particles/Gradient";
import { GradientMode } from "../src/engine/core/particles/ParticleTypes";
import { Color } from "../src/engine/core/math/Color";

/**
 * `setKeys` takes whatever arrays it is given, and every branch of `evaluate`
 * indexes key 0. An empty gradient — which a scenario building keys from data
 * can produce — threw a TypeError from inside a particle update. Audit part 10,
 * F59.
 */

const red = () => new Color(1, 0, 0, 1);
const blue = () => new Color(0, 0, 1, 1);

describe("Gradient at its edges", () => {
    test("an empty gradient evaluates instead of throwing", () => {
        const g = new Gradient();
        g.setKeys([], []);

        const c = g.evaluate(0.5);

        expect(c.r).toBe(1);
        expect(c.g).toBe(1);
        expect(c.b).toBe(1);
        expect(c.a).toBe(1);
    });

    test("empty colour keys with real alpha keys still works", () => {
        const g = new Gradient();
        g.setKeys([], [new GradientAlphaKey(0, 0), new GradientAlphaKey(1, 1)]);

        const c = g.evaluate(0.5);

        expect(c.r).toBe(1);
        expect(c.a).toBeCloseTo(0.5, 5);
    });

    test("a single key answers everywhere", () => {
        const g = new Gradient();
        g.setKeys([new GradientColorKey(red(), 0.5)], [new GradientAlphaKey(0.25, 0.5)]);

        for (const t of [0, 0.5, 1]) {
            const c = g.evaluate(t);
            expect(c.r).toBe(1);
            expect(c.b).toBe(0);
            expect(c.a).toBeCloseTo(0.25, 5);
        }
    });

    test("blends between two keys", () => {
        const g = new Gradient();
        g.setKeys(
            [new GradientColorKey(red(), 0), new GradientColorKey(blue(), 1)],
            [new GradientAlphaKey(1, 0), new GradientAlphaKey(1, 1)],
        );

        const c = g.evaluate(0.5);

        expect(c.r).toBeCloseTo(0.5, 5);
        expect(c.b).toBeCloseTo(0.5, 5);
    });

    test("clamps outside 0–1 rather than extrapolating", () => {
        const g = new Gradient();
        g.setKeys(
            [new GradientColorKey(red(), 0), new GradientColorKey(blue(), 1)],
            [new GradientAlphaKey(1, 0), new GradientAlphaKey(1, 1)],
        );

        expect(g.evaluate(-5).r).toBe(1);
        expect(g.evaluate(5).b).toBe(1);
    });

    test("two keys at the same time do not divide by zero", () => {
        const g = new Gradient();
        g.setKeys(
            [
                new GradientColorKey(red(), 0),
                new GradientColorKey(blue(), 0.5),
                new GradientColorKey(new Color(0, 1, 0, 1), 0.5),
            ],
            [new GradientAlphaKey(1, 0), new GradientAlphaKey(1, 1)],
        );

        const c = g.evaluate(0.5);

        expect(Number.isFinite(c.r)).toBe(true);
        expect(Number.isFinite(c.g)).toBe(true);
        expect(Number.isFinite(c.b)).toBe(true);
    });

    test("Fixed mode steps rather than blending", () => {
        const g = new Gradient();
        g.mode = GradientMode.Fixed;
        g.setKeys(
            [new GradientColorKey(red(), 0), new GradientColorKey(blue(), 1)],
            [new GradientAlphaKey(1, 0), new GradientAlphaKey(1, 1)],
        );

        const c = g.evaluate(0.5);

        expect(c.r).toBe(1);
        expect(c.b).toBe(0);
    });
});
