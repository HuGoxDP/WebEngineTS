import { describe, test, expect } from "vitest";
import { Matrix4x4 } from "../src/engine/core/math/Matrix4x4";

describe("Matrix4x4 — shared constants", () => {
    test("identity is readable on first access", () => {
        // It used to throw: Object.freeze rejects a Float32Array that has
        // elements, so the very first read of the constant in a process died.
        const identity = Matrix4x4.identity;

        expect(identity.get(0, 0)).toBe(1);
        expect(identity.get(1, 1)).toBe(1);
        expect(identity.get(2, 2)).toBe(1);
        expect(identity.get(3, 3)).toBe(1);
        expect(identity.get(0, 3)).toBe(0);
    });

    test("zero is readable on first access", () => {
        const zero = Matrix4x4.zero;

        for (let i = 0; i < 16; i++) expect(zero.elements[i]).toBe(0);
    });

    test("both are the same shared instance every time", () => {
        expect(Matrix4x4.identity).toBe(Matrix4x4.identity);
        expect(Matrix4x4.zero).toBe(Matrix4x4.zero);
    });

    test("clone gives an independent copy of the constant", () => {
        const copy = Matrix4x4.identity.clone();

        copy.set(0, 3, 7);

        expect(Matrix4x4.identity.get(0, 3)).toBe(0);
    });
});
