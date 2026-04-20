import { Vector2 } from "../math/Vector2";
import { Vector3 } from "../math/Vector3";
import { Vector4 } from "../math/Vector4";
import { Quaternion } from "../math/Quaternion";
import { Color } from "../math/Color";
import { FieldType } from "../reflection/Types";

/**
 * Converts engine values to and from JSON-compatible form.
 *
 * @remarks
 * Used by the scene serializer for each `@SerializedField`. Primitive
 * values pass through unchanged; compound types (Vector3, Color, etc.)
 * are tagged with `$type` for round-trip reconstruction.
 *
 * ```
 * 5         → 5
 * "foo"     → "foo"
 * true      → true
 * Vector3   → { "$type": "Vector3", "x": 1, "y": 2, "z": 3 }
 * Color     → { "$type": "Color", "r": 1, "g": 0, "b": 0, "a": 1 }
 * ```
 */
export class ValueSerializer {

    /**
     * Serializes an engine value to JSON-safe form.
     * @param value The runtime value.
     * @param type Optional explicit type hint for compound types.
     */
    public static serialize(value: unknown, type?: FieldType): unknown {
        if (value === null || value === undefined) return null;

        // Primitives
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
            return value;
        }

        // Arrays
        if (Array.isArray(value)) {
            return value.map(v => ValueSerializer.serialize(v));
        }

        // Compound engine types (detected either by hint or instanceof)
        if (value instanceof Vector2) return { $type: "Vector2", x: value.x, y: value.y };
        if (value instanceof Vector3) return { $type: "Vector3", x: value.x, y: value.y, z: value.z };
        if (value instanceof Vector4) return { $type: "Vector4", x: value.x, y: value.y, z: value.z, w: value.w };
        if (value instanceof Quaternion) return { $type: "Quaternion", x: value.x, y: value.y, z: value.z, w: value.w };
        if (value instanceof Color) return { $type: "Color", r: value.r, g: value.g, b: value.b, a: value.a };

        // Fallback: plain object
        if (typeof value === "object") {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(value as object)) {
                out[k] = ValueSerializer.serialize((value as any)[k]);
            }
            return out;
        }

        return null;
    }

    /**
     * Reconstructs a runtime value from its JSON form.
     * Type information comes either from an explicit `type` hint or
     * from the `$type` marker embedded in the JSON itself.
     */
    public static deserialize(json: unknown, type?: FieldType): unknown {
        if (json === null || json === undefined) return null;

        // Primitives
        if (typeof json === "number" || typeof json === "string" || typeof json === "boolean") {
            return json;
        }

        // Arrays
        if (Array.isArray(json)) {
            return json.map(v => ValueSerializer.deserialize(v));
        }

        // Tagged compound objects
        if (typeof json === "object") {
            const obj = json as Record<string, unknown>;
            const tag = obj.$type as string | undefined;

            switch (tag ?? type) {
                case "Vector2": case FieldType.Vector2:
                    return new Vector2(+(obj.x ?? 0), +(obj.y ?? 0));
                case "Vector3": case FieldType.Vector3:
                    return new Vector3(+(obj.x ?? 0), +(obj.y ?? 0), +(obj.z ?? 0));
                case "Vector4": case FieldType.Vector4:
                    return new Vector4(+(obj.x ?? 0), +(obj.y ?? 0), +(obj.z ?? 0), +(obj.w ?? 0));
                case "Quaternion": case FieldType.Quaternion:
                    return new Quaternion(+(obj.x ?? 0), +(obj.y ?? 0), +(obj.z ?? 0), +(obj.w ?? 1));
                case "Color": case FieldType.Color:
                    return new Color(+(obj.r ?? 1), +(obj.g ?? 1), +(obj.b ?? 1), +(obj.a ?? 1));
            }

            // Fallback: plain object
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(obj)) {
                if (k === "$type") continue;
                out[k] = ValueSerializer.deserialize(obj[k]);
            }
            return out;
        }

        return null;
    }

    private constructor() {}
}
