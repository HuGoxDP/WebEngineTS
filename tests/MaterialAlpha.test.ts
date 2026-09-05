import { describe, test, expect } from "vitest";
import { StandardMaterial, MaterialRenderMode } from "../src/engine/core/graphics/StandardMaterial";
import { Color } from "../src/engine/core/math/Color";

/**
 * Three keeps colour and opacity apart: `MeshStandardMaterial.color` is RGB with
 * no alpha channel. An engine `Color` carrying `a < 1` therefore lost it, so a
 * material set translucent rendered fully opaque — the DNA scenario's RNA
 * polymerase, declared at 0.42, drew as a solid blob hiding the helix behind it.
 * `UnlitMaterial` had always copied alpha across; `StandardMaterial` had not.
 */

const three = (m: StandardMaterial): any => (m as any)._threeMatHandle;

describe("StandardMaterial carries albedo alpha into opacity", () => {
    test("Fade uses the albedo alpha", () => {
        const m = new StandardMaterial();
        m.albedoColor = new Color(0.55, 0.85, 0.7, 0.42);
        m.renderMode = MaterialRenderMode.Fade;

        expect(three(m).transparent).toBe(true);
        expect(three(m).opacity).toBeCloseTo(0.42, 4);
    });

    test("the order of the two assignments does not matter", () => {
        const m = new StandardMaterial();
        m.renderMode = MaterialRenderMode.Fade;
        m.albedoColor = new Color(1, 0, 0, 0.25);

        expect(three(m).opacity).toBeCloseTo(0.25, 4);
    });

    test("an opaque material ignores alpha, as Unity does", () => {
        const m = new StandardMaterial();
        m.albedoColor = new Color(1, 1, 1, 0.3);

        expect(three(m).transparent).toBe(false);
        expect(three(m).opacity).toBe(1);
    });

    test("makeTransparent sets both the mode and the opacity", () => {
        const m = new StandardMaterial();
        m.makeTransparent(0.6);

        expect(three(m).transparent).toBe(true);
        expect(three(m).opacity).toBeCloseTo(0.6, 4);
    });

    test("going back to Opaque restores full opacity", () => {
        const m = new StandardMaterial();
        m.makeTransparent(0.2);
        m.renderMode = MaterialRenderMode.Opaque;

        expect(three(m).opacity).toBe(1);
    });
});
