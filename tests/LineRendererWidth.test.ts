import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { LineRenderer } from "../src/engine/core/components/LineRenderer";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * `startWidth`/`endWidth` did nothing: the line was a `THREE.Line` whose material
 * hardcoded `linewidth: 1`, and WebGL ignores `linewidth` on a LineBasicMaterial
 * regardless. Every line in every scenario drew as a 1 px hairline. The geometry
 * is now a ribbon, so width is vertices and the setting has an effect that can be
 * measured rather than taken on trust.
 */

const made: GameObject[] = [];

function line(width: number, endWidth = width): LineRenderer {
    const go = new GameObject("L");
    made.push(go);
    const l = go.addComponent(LineRenderer);
    l.positionCount = 2;
    l.setPosition(0, new Vector3(0, 0, 0));
    l.setPosition(1, new Vector3(4, 0, 0));
    l.startWidth = width;
    l.endWidth = endWidth;
    LineRenderer._updateAll();
    return l;
}

/** Distance between the two vertices generated for point `i`. */
function ribbonWidthAt(l: LineRenderer, i: number): number {
    const pos = (l as any)._threeLine.geometry.getAttribute("position");
    const a = i * 2, b = a + 1;
    return Math.hypot(
        pos.getX(a) - pos.getX(b),
        pos.getY(a) - pos.getY(b),
        pos.getZ(a) - pos.getZ(b),
    );
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("LineRenderer width is real geometry", () => {
    test("the ribbon is as wide as startWidth asks", () => {
        expect(ribbonWidthAt(line(0.5), 0)).toBeCloseTo(0.5, 4);
    });

    test("a wider setting produces a wider ribbon", () => {
        expect(ribbonWidthAt(line(2), 0)).toBeCloseTo(2, 4);
        expect(ribbonWidthAt(line(0.25), 0)).toBeCloseTo(0.25, 4);
    });

    test("width tapers from start to end", () => {
        const l = line(1, 0.2);
        expect(ribbonWidthAt(l, 0)).toBeCloseTo(1, 4);
        expect(ribbonWidthAt(l, 1)).toBeCloseTo(0.2, 4);
    });

    test("it draws triangles, so the width is rasterised at all", () => {
        const l = line(0.5);
        const geo = (l as any)._threeLine.geometry;
        expect(geo.getIndex()).not.toBeNull();
        expect(geo.getIndex().count).toBe(6); // two triangles for one segment
        expect((l as any)._threeLine.isMesh).toBe(true);
    });
});
