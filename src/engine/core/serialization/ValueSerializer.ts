import { Vector2 } from "../math/Vector2";
import { Vector3 } from "../math/Vector3";
import { Vector4 } from "../math/Vector4";
import { Quaternion } from "../math/Quaternion";
import { Color } from "../math/Color";
import { Rect } from "../math/Rect";
import { Bounds } from "../math/Bounds";
import { FieldType } from "../reflection/Types";
import { AssetDatabase } from "../assets/AssetDatabase";
import type { GameObject } from "../GameObject";

/**
 * Optional context shared across an entire serialize/deserialize pass.
 * Lets compound types (currently just `GameObject` references) round-trip
 * across multiple components in the same scene.
 */
export interface SerializeContext {
    /** Map of every GameObject in the scene to its hierarchical path. */
    goToPath: Map<GameObject, number[]>;
}

/** Marker emitted in deserialize for a `GameObjectRef` field. */
export interface PendingGORef {
    /** The path the JSON pointed at. */
    path: number[];
}

export interface DeserializeContext {
    /**
     * Refs collected during deserialize. After every GameObject has been
     * re-created the SceneSerializer walks this list and assigns the
     * resolved `GameObject | null` to `(component as any)[field]`.
     */
    pendingGORefs: Array<{ component: object; field: string; path: number[] }>;
    /**
     * Asset references whose asset was not loaded when the scene was rebuilt.
     * Surfaced on the result so a caller can preload them and re-resolve, since
     * loading is asynchronous and deserialization is not.
     */
    pendingAssetRefs: Array<{ component: object; field: string; guid: string }>;
    /** Current component being deserialized — populated by SceneSerializer. */
    currentComponent: object | null;
    /** Current field name being deserialized — populated by SceneSerializer. */
    currentField: string | null;
}

/**
 * Converts engine values to and from JSON-compatible form.
 *
 * @remarks
 * Used by the scene serializer for each `@SerializedField`. Primitive
 * values pass through unchanged; compound types (Vector3, Color, etc.)
 * are tagged with `$type` for round-trip reconstruction.
 *
 * `GameObject` references serialize as `{ $type: "GameObjectRef", path: [...] }`
 * and resolve in a deferred pass so references between siblings round-trip.
 */
export class ValueSerializer {

    /**
     * Serializes an engine value to JSON-safe form.
     * @param value The runtime value.
     * @param type Optional explicit type hint for compound types.
     * @param ctx Optional shared context for cross-object references.
     */
    public static serialize(value: unknown, type?: FieldType, ctx?: SerializeContext): unknown {
        if (value === null || value === undefined) return null;

        // Primitives
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
            return value;
        }

        // Arrays
        if (Array.isArray(value)) {
            return value.map(v => ValueSerializer.serialize(v, undefined, ctx));
        }

        // Compound engine types (detected either by hint or instanceof)
        if (value instanceof Vector2) return { $type: "Vector2", x: value.x, y: value.y };
        if (value instanceof Vector3) return { $type: "Vector3", x: value.x, y: value.y, z: value.z };
        if (value instanceof Vector4) return { $type: "Vector4", x: value.x, y: value.y, z: value.z, w: value.w };
        if (value instanceof Quaternion) return { $type: "Quaternion", x: value.x, y: value.y, z: value.z, w: value.w };
        if (value instanceof Color) return { $type: "Color", r: value.r, g: value.g, b: value.b, a: value.a };
        if (value instanceof Rect) {
            return { $type: "Rect", x: value.x, y: value.y, width: value.width, height: value.height };
        }
        if (value instanceof Bounds) {
            const c = value.center;
            const e = value.extents;
            return {
                $type: "Bounds",
                cx: c.x, cy: c.y, cz: c.z,
                ex: e.x, ey: e.y, ez: e.z,
            };
        }

        // Asset reference — stored by stable id, so renaming or moving the file
        // it came from does not break the scene pointing at it. The path rides
        // along for diagnostics only; nothing resolves through it.
        if (type === FieldType.Asset) {
            const guid = AssetDatabase.guidOf(value as object);
            if (guid === null) return null;
            return { $type: "AssetRef", guid, path: AssetDatabase.pathOf(guid) ?? undefined };
        }

        // GameObject reference — needs scene context to compute a path.
        // We can't import GameObject here without creating a circular dep,
        // so we duck-type: anything with a Transform (and a name + getInstanceID)
        // and that the ctx knows about is a GameObject reference.
        if (ctx && type === FieldType.GameObject && typeof value === "object") {
            const path = ctx.goToPath.get(value as GameObject);
            if (path) return { $type: "GameObjectRef", path };
            // Reference points to a GO that isn't part of the saved scene — null it.
            return null;
        }
        if (ctx && typeof value === "object" && (value as any).transform && typeof (value as any).getInstanceID === "function") {
            const path = ctx.goToPath.get(value as GameObject);
            if (path) return { $type: "GameObjectRef", path };
            return null;
        }

        // Fallback: plain object
        if (typeof value === "object") {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(value as object)) {
                out[k] = ValueSerializer.serialize((value as any)[k], undefined, ctx);
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
    public static deserialize(json: unknown, type?: FieldType, ctx?: DeserializeContext): unknown {
        if (json === null || json === undefined) return null;

        // Primitives
        if (typeof json === "number" || typeof json === "string" || typeof json === "boolean") {
            return json;
        }

        // Arrays
        if (Array.isArray(json)) {
            return json.map(v => ValueSerializer.deserialize(v, undefined, ctx));
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
                case "Rect": case FieldType.Rect:
                    return new Rect(+(obj.x ?? 0), +(obj.y ?? 0), +(obj.width ?? 0), +(obj.height ?? 0));
                case "Bounds": case FieldType.Bounds:
                    return new Bounds(
                        new Vector3(+(obj.cx ?? 0), +(obj.cy ?? 0), +(obj.cz ?? 0)),
                        // Bounds takes a full size, not the half-extents it stores.
                        new Vector3(+(obj.ex ?? 0) * 2, +(obj.ey ?? 0) * 2, +(obj.ez ?? 0) * 2),
                    );
                case "AssetRef": case FieldType.Asset: {
                    const guid = typeof obj.guid === "string" ? obj.guid : null;
                    if (guid === null) return null;

                    const asset = AssetDatabase.get(guid);
                    if (asset !== null) return asset;

                    // Not in memory. Recorded rather than dropped, so a caller
                    // can preload the missing ids and re-resolve instead of
                    // discovering a blank material at first render.
                    if (ctx && ctx.currentComponent && ctx.currentField) {
                        ctx.pendingAssetRefs.push({
                            component: ctx.currentComponent,
                            field: ctx.currentField,
                            guid,
                        });
                    }
                    return null;
                }
                case "GameObjectRef":
                    // Defer until the second pass — we only have a path right now.
                    if (ctx && ctx.currentComponent && ctx.currentField && Array.isArray(obj.path)) {
                        ctx.pendingGORefs.push({
                            component: ctx.currentComponent,
                            field: ctx.currentField,
                            path: (obj.path as number[]).slice(),
                        });
                    }
                    return null;
            }

            // Fallback: plain object
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(obj)) {
                if (k === "$type") continue;
                out[k] = ValueSerializer.deserialize(obj[k], undefined, ctx);
            }
            return out;
        }

        return null;
    }

    private constructor() {}
}
