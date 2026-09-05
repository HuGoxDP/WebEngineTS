import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { LineRenderer } from "../src/engine/core/components/LineRenderer";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";

/**
 * Every LineRenderer setter marks the line dirty, but nothing consumed the flag:
 * `GameObject._systemLateUpdate` only visits `ScriptableBehaviour`s, and a
 * LineRenderer is a `Renderer`. Geometry appeared to work because `setPosition`
 * rebuilds directly; colour and width were silently dropped, so a line drawn
 * orange came out white. Now driven from `Application._loop` like `LODGroup`.
 */

const made: GameObject[] = [];

function line(): LineRenderer {
    const go = new GameObject("L");
    made.push(go);
    const l = go.addComponent(LineRenderer);
    l.positionCount = 2;
    l.setPosition(0, new Vector3(0, 0, 0));
    l.setPosition(1, new Vector3(1, 0, 0));
    return l;
}

const materialOf = (l: LineRenderer): any => (l as any)._threeLine?.material;

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("LineRenderer flushes its dirty state from the loop", () => {
    test("a colour set after the first build reaches the material", () => {
        const l = line();
        l.startColor = new Color(1, 0.45, 0.1, 1);

        LineRenderer._updateAll();

        const c = materialOf(l).color;
        expect(c.r).toBeCloseTo(1, 3);
        expect(c.g).toBeCloseTo(0.45, 3);
        expect(c.b).toBeCloseTo(0.1, 3);
    });

    test("an enabled line is registered, a disabled one is not", () => {
        const l = line();
        const reg = (LineRenderer as any)._activeInstances as Set<LineRenderer>;
        expect(reg.has(l)).toBe(true);

        l.enabled = false;
        expect(reg.has(l)).toBe(false);
    });

    test("_updateAll is safe with nothing registered", () => {
        expect(() => LineRenderer._updateAll()).not.toThrow();
    });
});
