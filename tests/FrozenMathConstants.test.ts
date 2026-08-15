import { describe, test, expect } from "vitest";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Vector4 } from "../src/engine/core/math/Vector4";
import { Color } from "../src/engine/core/math/Color";
import { Rect } from "../src/engine/core/math/Rect";

/**
 * Every shared math constant is documented "do not mutate", and only Vector3's
 * were frozen. On the others the contract was advice: `Color.white.a = 0.5`
 * repainted every future use of white, engine-wide and for good. Audit part 8,
 * F49.
 */

describe("Shared math constants refuse to be written", () => {
    test("Vector3's, which already were", () => {
        expect(() => { Vector3.zero.x = 1; }).toThrow(TypeError);
        expect(Vector3.zero.x).toBe(0);
    });

    test("Vector2's", () => {
        expect(() => { Vector2.one.x = 5; }).toThrow(TypeError);
        expect(Vector2.one.x).toBe(1);
    });

    test("Vector4's", () => {
        expect(() => { Vector4.zero.w = 9; }).toThrow(TypeError);
        expect(Vector4.zero.w).toBe(0);
    });

    test("Color's — the one a scenario reaches for most", () => {
        expect(() => { Color.white.a = 0.5; }).toThrow(TypeError);
        expect(Color.white.a).toBe(1);
        expect(() => { Color.red.g = 1; }).toThrow(TypeError);
        expect(Color.red.g).toBe(0);
    });

    test("Rect's", () => {
        expect(() => { Rect.zero.width = 10; }).toThrow(TypeError);
        expect(Rect.zero.width).toBe(0);
    });

    test("mutating methods are refused too, not just assignment", () => {
        // `set` and `copy` write the same fields; freezing catches both.
        expect(() => Color.white.set(0, 0, 0, 0)).toThrow(TypeError);
        expect(() => Vector2.zero.set(3, 4)).toThrow(TypeError);
        expect(Color.white.r).toBe(1);
    });

    test("a clone is still perfectly writable", () => {
        // The escape hatch, and the thing scenario code should be doing.
        const c = Color.white.clone();
        c.a = 0.25;
        expect(c.a).toBe(0.25);
        expect(Color.white.a).toBe(1);

        const v = Vector2.one.clone();
        v.x = 7;
        expect(v.x).toBe(7);
        expect(Vector2.one.x).toBe(1);
    });
});
