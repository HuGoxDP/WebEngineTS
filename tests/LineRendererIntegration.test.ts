import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { LineRenderer } from "../src/engine/core/components/LineRenderer";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";
import { UnlitMaterial } from "../src/engine/core/graphics/UnlitMaterial";
import { ShadowCastingMode } from "../src/engine/core/rendering/Renderer";

/**
 * LineRenderer added its Three object to the Transform itself and left its
 * material hooks commented out. Two consequences: `_internalRenderObject` stayed
 * null, so the base Renderer's shadow, visibility and bounds never applied to a
 * line; and `sharedMaterial` never reached one, so colour could only come from
 * `startColor`. Both now go through the base class.
 */

const made: GameObject[] = [];

function line(): LineRenderer {
    const go = new GameObject("L");
    made.push(go);
    const l = go.addComponent(LineRenderer);
    l.positionCount = 2;
    l.setPosition(0, new Vector3(0, 0, 0));
    l.setPosition(1, new Vector3(1, 0, 0));
    l.startWidth = 0.2;
    l.endWidth = 0.2;
    return l;
}

const threeOf = (l: LineRenderer): any => (l as any)._threeLine;
const renderObjectOf = (l: LineRenderer): any => (l as any)._internalRenderObject;

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("LineRenderer is a full Renderer", () => {
    test("it registers its render object with the base class", () => {
        const l = line();
        expect(renderObjectOf(l)).not.toBeNull();
        expect(renderObjectOf(l)).toBe(threeOf(l));
    });

    test("disabling hides the line through the base visibility sync", () => {
        const l = line();
        expect(threeOf(l).visible).toBe(true);

        l.enabled = false;
        expect(threeOf(l).visible).toBe(false);

        l.enabled = true;
        expect(threeOf(l).visible).toBe(true);
    });

    test("shadow settings reach the line", () => {
        const l = line();
        l.shadowCastingMode = ShadowCastingMode.Off;
        expect(threeOf(l).castShadow).toBe(false);

        l.shadowCastingMode = ShadowCastingMode.On;
        expect(threeOf(l).castShadow).toBe(true);
    });

    test("an assigned Material is used, and removing it restores the built-in one", () => {
        const l = line();
        const own = threeOf(l).material;

        const mat = new UnlitMaterial();
        mat.color = new Color(0.1, 0.9, 0.3, 1);
        l.sharedMaterial = mat;

        expect(threeOf(l).material).toBe(mat._internalThreeMaterial);
        expect(threeOf(l).material).not.toBe(own);

        l.sharedMaterial = null;
        expect(threeOf(l).material).toBe(own);
    });

    test("with no Material assigned the line keeps its vertex-coloured one", () => {
        const l = line();
        LineRenderer._updateAll();
        expect(threeOf(l).material.vertexColors).toBe(true);
    });
});
