import { describe, test, expect } from "vitest";
import { Ray } from "../src/engine/core/math/Ray";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * A Ray promises a unit direction and every consumer relies on it. The setter
 * and `set` normalize; the getter hands back the ray's own vector, so writing
 * through it does not. Audit part 8, F51 — documented rather than closed, since
 * the live vector is what makes a per-frame cast allocation-free.
 */

describe("Ray keeps its direction normalized", () => {
    test("when constructed", () => {
        const ray = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, 5));

        expect(ray.direction.magnitude()).toBeCloseTo(1, 6);
        expect(ray.direction.z).toBeCloseTo(1, 6);
    });

    test("when assigned", () => {
        const ray = new Ray();

        ray.direction = new Vector3(3, 0, 4);

        expect(ray.direction.magnitude()).toBeCloseTo(1, 6);
        expect(ray.direction.x).toBeCloseTo(0.6, 6);
    });

    test("when set", () => {
        const ray = new Ray();

        ray.set(new Vector3(0, 0, 0), new Vector3(0, 9, 0));

        expect(ray.direction.magnitude()).toBeCloseTo(1, 6);
    });

    test("but not when written through the getter — which the docs now say", () => {
        // Pinned as the documented behaviour rather than fixed: returning a
        // copy would allocate on every access, and a raycast reads this per
        // frame. The doc names the consequence and the way round it.
        const ray = new Ray();

        ray.direction.set(0, 0, 2);

        expect(ray.direction.magnitude()).toBeCloseTo(2, 6);
    });

    test("origin is the ray's own vector too", () => {
        const ray = new Ray();

        ray.origin.set(1, 2, 3);

        expect(ray.origin.x).toBe(1);
        expect(ray.origin.z).toBe(3);
    });

    test("constructing copies its arguments rather than aliasing them", () => {
        const origin = new Vector3(1, 1, 1);
        const ray = new Ray(origin, new Vector3(0, 0, 1));

        origin.set(9, 9, 9);

        expect(ray.origin.x).toBe(1);
    });

    test("a point along the ray is origin plus a scaled direction", () => {
        const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, 10));

        const at = ray.getPoint(5);

        expect(at.z).toBeCloseTo(5, 6);
    });
});
