import { describe, test, expect } from "vitest";
import { Quaternion } from "../src/engine/core/math/Quaternion";
import { Vector3 } from "../src/engine/core/math/Vector3";

function approx(a: number, b: number, epsilon = 1e-5): boolean {
    return Math.abs(a - b) < epsilon;
}

function expectQuatFinite(q: Quaternion) {
    expect(Number.isFinite(q.x)).toBe(true);
    expect(Number.isFinite(q.y)).toBe(true);
    expect(Number.isFinite(q.z)).toBe(true);
    expect(Number.isFinite(q.w)).toBe(true);
}

function expectQuatNormalized(q: Quaternion, epsilon = 1e-4) {
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    expect(approx(len, 1, epsilon)).toBe(true);
}

describe("Quaternion.lookRotation", () => {
    test("forward +Z produces identity rotation", () => {
        const q = Quaternion.lookRotation(new Vector3(0, 0, 1));
        expectQuatFinite(q);
        expectQuatNormalized(q);
        // Identity quaternion = (0, 0, 0, 1)
        expect(approx(q.x, 0)).toBe(true);
        expect(approx(q.y, 0)).toBe(true);
        expect(approx(q.z, 0)).toBe(true);
        expect(approx(q.w, 1)).toBe(true);
    });

    test("forward +X produces 90° Y rotation", () => {
        const q = Quaternion.lookRotation(new Vector3(1, 0, 0));
        expectQuatFinite(q);
        expectQuatNormalized(q);
        // 90° around Y = (0, sin(45°), 0, cos(45°)) = (0, 0.7071, 0, 0.7071)
        expect(approx(q.x, 0)).toBe(true);
        expect(approx(Math.abs(q.y), 0.7071, 1e-3)).toBe(true);
        expect(approx(q.z, 0)).toBe(true);
        expect(approx(Math.abs(q.w), 0.7071, 1e-3)).toBe(true);
    });

    test("forward -Z produces 180° Y rotation", () => {
        const q = Quaternion.lookRotation(new Vector3(0, 0, -1));
        expectQuatFinite(q);
        expectQuatNormalized(q);
        // 180° around Y = (0, 1, 0, 0) or (0, -1, 0, 0)
        expect(approx(q.x, 0)).toBe(true);
        expect(approx(Math.abs(q.y), 1, 1e-3)).toBe(true);
        expect(approx(q.z, 0)).toBe(true);
        expect(approx(q.w, 0, 1e-3)).toBe(true);
    });

    test("arbitrary direction produces finite normalized quaternion", () => {
        const q = Quaternion.lookRotation(new Vector3(1, 2, 3));
        expectQuatFinite(q);
        expectQuatNormalized(q);
    });

    test("non-unit forward vector is handled", () => {
        const q = Quaternion.lookRotation(new Vector3(0, 0, 100));
        expectQuatFinite(q);
        expectQuatNormalized(q);
        expect(approx(q.x, 0)).toBe(true);
        expect(approx(q.y, 0)).toBe(true);
        expect(approx(q.z, 0)).toBe(true);
        expect(approx(q.w, 1)).toBe(true);
    });

    test("forward parallel to up uses fallback", () => {
        const q = Quaternion.lookRotation(new Vector3(0, 1, 0));
        expectQuatFinite(q);
        expectQuatNormalized(q);
    });

    test("zero forward returns identity", () => {
        const q = Quaternion.lookRotation(new Vector3(0, 0, 0));
        expect(q.x).toBe(0);
        expect(q.y).toBe(0);
        expect(q.z).toBe(0);
        expect(q.w).toBe(1);
    });

    test("out parameter is reused", () => {
        const out = new Quaternion();
        const result = Quaternion.lookRotation(new Vector3(0, 0, 1), Vector3.up, out);
        expect(result).toBe(out);
    });
});
