import { describe, test, expect } from "vitest";
import { Mathf } from "../src/engine/core/math/Mathf";

/**
 * Unity's Mathf.Round is .NET's Math.Round: halves go to the even neighbour.
 * JavaScript's Math.round sends them toward positive infinity instead, so a
 * scenario ported from Unity got a different answer at exactly .5 — and the
 * method's siblings all promise Unity equivalence. Audit part 8, F48.
 */

describe("Mathf.round", () => {
    test("sends halves to the even neighbour", () => {
        expect(Mathf.round(0.5)).toBe(0);
        expect(Mathf.round(1.5)).toBe(2);
        expect(Mathf.round(2.5)).toBe(2);
        expect(Mathf.round(3.5)).toBe(4);
    });

    test("does the same below zero", () => {
        // Negative zero, as IEEE and therefore .NET give: rounding a negative
        // toward zero keeps the sign. Pinned with `toBe`, which distinguishes
        // the two zeros, because the whole point here is exactness.
        expect(Mathf.round(-0.5)).toBe(-0);
        expect(Mathf.round(-1.5)).toBe(-2);
        expect(Mathf.round(-2.5)).toBe(-2);
        expect(Mathf.round(-3.5)).toBe(-4);
    });

    test("rounds everything else to the nearer integer", () => {
        expect(Mathf.round(0.4)).toBe(0);
        expect(Mathf.round(0.6)).toBe(1);
        expect(Mathf.round(-0.4)).toBe(-0);
        expect(Mathf.round(-0.6)).toBe(-1);
        expect(Mathf.round(2.4999999)).toBe(2);
        expect(Mathf.round(2.5000001)).toBe(3);
    });

    test("leaves integers alone", () => {
        expect(Mathf.round(0)).toBe(0);
        expect(Mathf.round(7)).toBe(7);
        expect(Mathf.round(-7)).toBe(-7);
    });

    test("does not bias a sum of halves, which is the point of it", () => {
        // Rounding halves in one direction adds half a unit per value; to even
        // cancels out. This is why .NET and therefore Unity chose it.
        let sum = 0;
        for (let i = 0; i < 10; i++) sum += Mathf.round(i + 0.5);

        // 0,2,2,4,4,6,6,8,8,10 — the same total as the inputs, 50.
        expect(sum).toBe(50);
    });

    test("roundToInt agrees with round", () => {
        for (const v of [0.5, 1.5, 2.5, -0.5, -1.5, 0.6, -0.6]) {
            expect(Mathf.roundToInt(v)).toBe(Mathf.round(v) | 0);
        }
        expect(Mathf.roundToInt(2.5)).toBe(2);
        expect(Mathf.roundToInt(3.5)).toBe(4);
    });
});
