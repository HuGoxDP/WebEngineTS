import { describe, test, expect } from "vitest";
import { VignetteEffect } from "../src/engine/core/postprocessing/VignetteEffect";
import { Color } from "../src/engine/core/math/Color";

/**
 * `VignetteEffect.color` was declared `THREE.Color` — a Three.js type on a
 * documented, user-facing property of an exported class, which is the one rule
 * the engine calls most important. A scenario author can import only from
 * `"WebEngineTS"`, so the only colour they can construct is the engine's, and
 * assigning it was a type error. Audit part 10, F68.
 */

/** The shape `ShaderPass` gives `_updatePass`, with only what is read. */
function fakePass() {
    return {
        uniforms: {
            tDiffuse: { value: null },
            uIntensity: { value: 0 },
            uSmoothness: { value: 0 },
            uColor: { value: { r: -1, g: -1, b: -1 } },
        },
    };
}

describe("VignetteEffect.color", () => {
    test("is an engine Color, the only kind a scenario can construct", () => {
        const vignette = new VignetteEffect();

        expect(vignette.color).toBeInstanceOf(Color);
    });

    test("accepts an engine Color assigned to it", () => {
        const vignette = new VignetteEffect();

        // The assignment is the test. Note that nothing type-checks this file
        // — tsconfig excludes `**/*.test.ts` — so the negative control here is
        // the runtime one below: the old field held a THREE.Color, which has no
        // `_copyToThree`, and `_updatePass` threw. See F69.
        vignette.color = new Color(0.25, 0.5, 0.75, 1);

        expect(vignette.color.r).toBe(0.25);
    });

    test("the constructor takes one too, so the knob is reachable", () => {
        // It previously took intensity and smoothness only, leaving the field
        // as the sole route to a colour — and the field was the mistyped one.
        const vignette = new VignetteEffect({ intensity: 0.6, color: new Color(1, 0, 0, 1) });

        expect(vignette.color.r).toBe(1);
        expect(vignette.color.g).toBe(0);
        expect(vignette.intensity).toBe(0.6);
    });

    test("the constructor copies it, so two effects do not share one Color", () => {
        const shared = new Color(0, 0, 1, 1);
        const a = new VignetteEffect({ color: shared });
        const b = new VignetteEffect({ color: shared });

        a.color.set(1, 0, 0, 1);

        expect(b.color.b).toBe(1);
        expect(shared.r).toBe(0);
    });

    test("reaches the shader uniform", () => {
        const vignette = new VignetteEffect({ intensity: 0.8, smoothness: 0.3 });
        vignette.color = new Color(0.1, 0.2, 0.3, 1);
        const pass = fakePass();

        vignette._updatePass(pass as never);

        expect(pass.uniforms.uColor.value.r).toBeCloseTo(0.1);
        expect(pass.uniforms.uColor.value.g).toBeCloseTo(0.2);
        expect(pass.uniforms.uColor.value.b).toBeCloseTo(0.3);
        expect(pass.uniforms.uIntensity.value).toBe(0.8);
        expect(pass.uniforms.uSmoothness.value).toBe(0.3);
    });

    test("a mutation in place reaches it as well", () => {
        const vignette = new VignetteEffect();
        const pass = fakePass();

        vignette.color.set(0.5, 0.5, 0.5, 1);
        vignette._updatePass(pass as never);

        expect(pass.uniforms.uColor.value.r).toBeCloseTo(0.5);
    });

    test("alpha is ignored rather than multiplied in", () => {
        // Documented behaviour: the shader blends, it does not composite, so a
        // translucent Color must not silently darken the corners less.
        const vignette = new VignetteEffect({ color: new Color(1, 1, 1, 0) });
        const pass = fakePass();

        vignette._updatePass(pass as never);

        expect(pass.uniforms.uColor.value.r).toBe(1);
    });

    test("defaults to opaque black, as a vignette is", () => {
        const vignette = new VignetteEffect();

        expect(vignette.color.r).toBe(0);
        expect(vignette.color.g).toBe(0);
        expect(vignette.color.b).toBe(0);
        expect(vignette.color.a).toBe(1);
    });
});
