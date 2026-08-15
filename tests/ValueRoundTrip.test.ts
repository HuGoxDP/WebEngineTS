import { describe, test, expect } from "vitest";
import { ValueSerializer } from "../src/engine/core/serialization/ValueSerializer";
import { FieldType } from "../src/engine/core/reflection/Types";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Vector4 } from "../src/engine/core/math/Vector4";
import { Quaternion } from "../src/engine/core/math/Quaternion";
import { Color } from "../src/engine/core/math/Color";
import { Rect } from "../src/engine/core/math/Rect";
import { Bounds } from "../src/engine/core/math/Bounds";
import { Mesh } from "../src/engine/core/graphics/Mesh";

/**
 * Part 10's checklist asks for "serializer round-trips for every FieldType".
 * The value types are the half that can be checked without a scene: they must
 * come back as the same class with the same numbers, through JSON, so a saved
 * scene reloads as objects rather than as the shapes they were written as.
 * Audit part 10.
 *
 * The reference types — GameObject, Component, Asset — deliberately do *not*
 * round-trip through this function alone: they resolve in a second pass once
 * every object exists, which `tests/Serialization.test.ts` covers at the scene
 * level. Their absence here is the design, not a gap.
 */

/** Serializes, stringifies, parses and deserializes — a real save and load. */
function roundTrip(value: unknown, type: FieldType): unknown {
    const written = ValueSerializer.serialize(value, type);
    const reloaded = JSON.parse(JSON.stringify(written));
    return ValueSerializer.deserialize(reloaded, type);
}

describe("Value round-trips through JSON", () => {
    test("Vector2", () => {
        const back = roundTrip(new Vector2(1.5, -2.25), FieldType.Vector2) as Vector2;

        expect(back).toBeInstanceOf(Vector2);
        expect(back.x).toBe(1.5);
        expect(back.y).toBe(-2.25);
    });

    test("Vector3", () => {
        const back = roundTrip(new Vector3(1, 2, 3), FieldType.Vector3) as Vector3;

        expect(back).toBeInstanceOf(Vector3);
        expect(back.z).toBe(3);
    });

    test("Vector4", () => {
        const back = roundTrip(new Vector4(1, 2, 3, 4), FieldType.Vector4) as Vector4;

        expect(back).toBeInstanceOf(Vector4);
        expect(back.w).toBe(4);
    });

    test("Quaternion", () => {
        const q = Quaternion.euler(30, 45, 60);

        const back = roundTrip(q, FieldType.Quaternion) as Quaternion;

        expect(back).toBeInstanceOf(Quaternion);
        expect(back.x).toBeCloseTo(q.x, 6);
        expect(back.w).toBeCloseTo(q.w, 6);
    });

    test("Color, alpha included", () => {
        const back = roundTrip(new Color(0.25, 0.5, 0.75, 0.125), FieldType.Color) as Color;

        expect(back).toBeInstanceOf(Color);
        expect(back.r).toBe(0.25);
        expect(back.a).toBe(0.125);
    });

    test("Rect", () => {
        const back = roundTrip(new Rect(1, 2, 30, 40), FieldType.Rect) as Rect;

        expect(back).toBeInstanceOf(Rect);
        expect(back.x).toBe(1);
        expect(back.height).toBe(40);
    });

    test("Bounds keeps its centre and size", () => {
        const bounds = new Bounds(new Vector3(1, 2, 3), new Vector3(4, 5, 6));

        const back = roundTrip(bounds, FieldType.Bounds) as Bounds;

        expect(back).toBeInstanceOf(Bounds);
        expect(back.center.y).toBe(2);
        expect(back.size.z).toBe(6);
    });

    test("a primitive mesh comes back as a mesh, not as its recipe", () => {
        // The one value type stored as a recipe rather than as its data:
        // vertex buffers are never written into a scene.
        const back = roundTrip(Mesh.createCube(2), FieldType.Mesh) as Mesh;

        expect(back).toBeInstanceOf(Mesh);
        expect(back.vertexCount).toBeGreaterThan(0);
    });

    test("numbers, strings and booleans pass through untouched", () => {
        expect(roundTrip(42, FieldType.Number)).toBe(42);
        expect(roundTrip("hello", FieldType.String)).toBe("hello");
        expect(roundTrip(true, FieldType.Boolean)).toBe(true);
        expect(roundTrip(false, FieldType.Boolean)).toBe(false);
    });

    test("an enum is a number on the way out and back", () => {
        expect(roundTrip(3, FieldType.Enum)).toBe(3);
    });

    test("an array of values keeps its element types", () => {
        const written = ValueSerializer.serialize(
            [new Vector2(1, 2), new Vector2(3, 4)], FieldType.Array,
        );
        const reloaded = JSON.parse(JSON.stringify(written));
        const back = ValueSerializer.deserialize(
            reloaded, FieldType.Array, undefined, FieldType.Vector2,
        ) as Vector2[];

        expect(back).toHaveLength(2);
        expect(back[0]).toBeInstanceOf(Vector2);
        expect(back[1].y).toBe(4);
    });

    test("null survives as null rather than becoming an empty object", () => {
        expect(roundTrip(null, FieldType.Vector3)).toBeNull();
    });

    test("a plain object keeps its shape", () => {
        const back = roundTrip({ a: 1, b: "two", c: [3] }, FieldType.Object) as Record<string, unknown>;

        expect(back.a).toBe(1);
        expect(back.b).toBe("two");
        expect(back.c).toEqual([3]);
    });
});
