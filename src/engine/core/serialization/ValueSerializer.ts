import { Vector2 } from "../math/Vector2";
import { Vector3 } from "../math/Vector3";
import { Vector4 } from "../math/Vector4";
import { Quaternion } from "../math/Quaternion";
import { Color } from "../math/Color";
import { Rect } from "../math/Rect";
import { Bounds } from "../math/Bounds";
import { FieldType } from "../reflection/Types";
import { AssetDatabase } from "../assets/AssetDatabase";
import { Sprite } from "../graphics/Sprite";
import { Mesh } from "../graphics/Mesh";
import type { GameObject } from "../GameObject";

/**
 * Optional context shared across an entire serialize/deserialize pass.
 * Lets compound types (currently just `GameObject` references) round-trip
 * across multiple components in the same scene.
 */
export interface SerializeContext {
    /** Map of every GameObject in the scene to its hierarchical path. */
    goToPath: Map<GameObject, number[]>;
    /**
     * The registered type name of a component, or null if its class carries no
     * `@Serializable`. Supplied by the SceneSerializer, which owns the registry
     * lookup — this module deliberately knows nothing about components.
     */
    componentTypeName(component: object): string | null;
    /**
     * Which of its GameObject's components of that same type this one is.
     * `0` unless the object genuinely carries several.
     */
    componentIndex(owner: GameObject, component: object): number;
    /**
     * Gives an asset that has no file behind it an id, and writes its values
     * into the scene's asset table on first sight.
     *
     * @remarks
     * A material is built in code, never loaded, so it has no identity of its
     * own. Emitting it once and referencing it by id is what keeps two
     * renderers sharing one material still sharing it after a load. Returns
     * null when the class carries no `@Serializable` and so cannot be rebuilt.
     */
    inlineAsset(asset: object): string | null;
    /**
     * Encodes a value whose class is `@Serializable` but which is neither a
     * component nor an asset — a nested struct that lives inside its owner.
     *
     * @remarks
     * Unity's `[System.Serializable]`. It is what lets a field hold a shape the
     * one-level field metadata cannot describe, such as `LODGroup`'s levels:
     * an array of structs each holding an array of references. Returns null
     * when the class is not registered, so the plain-object fallback still
     * applies to ordinary data.
     */
    nestedValue(value: object): { type: string; fields: Record<string, unknown> } | null;
    /**
     * Assets written by {@link inlineAsset}, in the order they were first seen.
     * The entry points attach this to the snapshot they return.
     */
    assetTable: Array<{ guid: string; type: string; fields: Record<string, unknown> }>;
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
    pendingGORefs: Array<{
        component: object;
        field: string;
        path: number[];
        /** Slot to write into when the field is an array; null when it is not. */
        arrayIndex: number | null;
    }>;
    /**
     * Component references collected during deserialize, resolved in the same
     * deferred pass as {@link pendingGORefs} once every GameObject exists.
     */
    pendingComponentRefs: Array<{
        component: object;
        field: string;
        path: number[];
        typeName: string;
        index: number;
        /** Slot to write into when the field is an array; null when it is not. */
        arrayIndex: number | null;
    }>;
    /**
     * Asset references whose asset was not loaded when the scene was rebuilt.
     * Surfaced on the result so a caller can preload them and re-resolve, since
     * loading is asynchronous and deserialization is not.
     */
    pendingAssetRefs: Array<{
        component: object;
        field: string;
        guid: string;
        /** Present when the reference was a Sprite: its framing, to rebuild with. */
        sprite?: Record<string, unknown>;
    }>;
    /** Current component being deserialized — populated by SceneSerializer. */
    currentComponent: object | null;
    /** Current field name being deserialized — populated by SceneSerializer. */
    currentField: string | null;
    /**
     * Rebuilds a nested serializable value. The counterpart of
     * {@link SerializeContext.nestedValue}; null when the class is unknown.
     */
    buildNested(type: string, fields: Record<string, unknown>): object | null;
    /**
     * Index within the array currently being deserialized, or null outside one.
     *
     * @remarks
     * A reference inside an array resolves in the same deferred pass as any
     * other, but has to be written into its slot rather than over the whole
     * field — without this, an array of references collapsed to whichever
     * element resolved last.
     */
    currentArrayIndex: number | null;
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
    public static serialize(
        value: unknown,
        type?: FieldType,
        ctx?: SerializeContext,
        elementType?: FieldType,
    ): unknown {
        if (value === null || value === undefined) return null;

        // Primitives
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
            return value;
        }

        // Arrays. The declared element type is passed down, which is what makes
        // `elementType` mean anything for a compound element — without it an
        // array of component references serialized as a list of nulls.
        if (Array.isArray(value)) {
            return value.map(v => ValueSerializer.serialize(v, elementType, ctx));
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

        // A Sprite is not itself a loadable asset — it is a *framing* of one, so
        // it serializes as its own value with the texture inside it referenced
        // by id. Two sprites cut from one atlas therefore share the texture and
        // differ only in their rect, which is what an atlas is for.
        if (type === FieldType.Sprite || value instanceof Sprite) {
            const sprite = value as Sprite;
            const guid = AssetDatabase.guidOf(sprite.texture);
            if (guid === null) return null;

            return {
                $type: "Sprite",
                texture: guid,
                rect: {
                    x: sprite.rect.x, y: sprite.rect.y,
                    width: sprite.rect.width, height: sprite.rect.height,
                },
                border: {
                    left: sprite.border.left, right: sprite.border.right,
                    top: sprite.border.top, bottom: sprite.border.bottom,
                },
                pivot: { x: sprite.pivot.x, y: sprite.pivot.y },
            };
        }

        // A mesh is stored as an id when it was loaded from a file, and as the
        // recipe that built it when it came from a factory. Vertex buffers are
        // never written into a scene: a procedural mesh with neither is dropped,
        // which is visible immediately rather than bloating every save.
        if (type === FieldType.Mesh) {
            const guid = AssetDatabase.guidOf(value as object);
            if (guid !== null) return { $type: "AssetRef", guid };

            const primitive = (value as Mesh).primitive;
            if (primitive) {
                return { $type: "PrimitiveMesh", kind: primitive.kind, args: [...primitive.args] };
            }
            return null;
        }

        // Asset reference — stored by stable id, so renaming or moving the file
        // it came from does not break the scene pointing at it. The path rides
        // along for diagnostics only; nothing resolves through it.
        if (type === FieldType.Asset) {
            const guid = AssetDatabase.guidOf(value as object);
            if (guid !== null) {
                return { $type: "AssetRef", guid, path: AssetDatabase.pathOf(guid) ?? undefined };
            }

            // No file behind it — carried inside the scene instead.
            const inlined = ctx ? ctx.inlineAsset(value as object) : null;
            return inlined === null ? null : { $type: "AssetRef", guid: inlined };
        }

        // Component reference — the owning GameObject's path plus which
        // component on it. The index disambiguates a GameObject carrying two of
        // the same type, which is legal and would otherwise resolve to the
        // first one silently.
        if (ctx && type === FieldType.Component && typeof value === "object") {
            const owner = (value as { gameObject?: GameObject }).gameObject;
            return owner ? ValueSerializer._componentRef(value as object, owner, ctx) : null;
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
        // An untyped object that is plainly a scene reference. Checked against
        // the context rather than duck-typed on `.transform`: a Component has
        // one too, and used to be written out as a null GameObject reference.
        if (ctx && typeof value === "object") {
            const asGameObject = ctx.goToPath.get(value as GameObject);
            if (asGameObject) return { $type: "GameObjectRef", path: asGameObject };

            const owner = (value as { gameObject?: GameObject }).gameObject;
            if (owner && ctx.goToPath.has(owner)) {
                return ValueSerializer._componentRef(value as object, owner, ctx);
            }
        }

        // A registered class that is neither component nor asset: a nested
        // struct, stored with its type so it comes back as itself rather than
        // as a bag of keys.
        if (ctx) {
            const nested = ctx.nestedValue(value as object);
            if (nested) return { $type: "Nested", type: nested.type, fields: nested.fields };
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
    public static deserialize(
        json: unknown,
        type?: FieldType,
        ctx?: DeserializeContext,
        elementType?: FieldType,
    ): unknown {
        if (json === null || json === undefined) return null;

        // Primitives
        if (typeof json === "number" || typeof json === "string" || typeof json === "boolean") {
            return json;
        }

        // Arrays
        if (Array.isArray(json)) {
            const out = json.map((v, i) => {
                if (ctx) ctx.currentArrayIndex = i;
                return ValueSerializer.deserialize(v, elementType, ctx);
            });
            if (ctx) ctx.currentArrayIndex = null;
            return out;
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
                case "Sprite": case FieldType.Sprite: {
                    const guid = typeof obj.texture === "string" ? obj.texture : null;
                    const texture = guid !== null ? AssetDatabase.get(guid) : null;
                    // Without its texture there is no sprite to build. Recorded
                    // like any other unresolved reference so the caller can
                    // preload and re-resolve.
                    if (texture === null) {
                        if (guid !== null && ctx && ctx.currentComponent && ctx.currentField) {
                            ctx.pendingAssetRefs.push({
                                component: ctx.currentComponent,
                                field: ctx.currentField,
                                guid,
                                sprite: obj,
                            });
                        }
                        return null;
                    }
                    return ValueSerializer._buildSprite(texture, obj);
                }
                case "PrimitiveMesh": {
                    return Mesh.fromPrimitive({
                        kind: obj.kind as never,
                        args: Array.isArray(obj.args) ? (obj.args as number[]) : [],
                    });
                }
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
                case "ComponentRef": {
                    // Deferred for the same reason a GameObject reference is:
                    // the object it points at may not exist yet.
                    if (ctx && ctx.currentComponent && ctx.currentField && Array.isArray(obj.path)) {
                        ctx.pendingComponentRefs.push({
                            component: ctx.currentComponent,
                            field: ctx.currentField,
                            path: (obj.path as number[]).slice(),
                            typeName: String(obj.component ?? ""),
                            index: Number(obj.index ?? 0),
                            arrayIndex: ctx.currentArrayIndex,
                        });
                    }
                    return null;
                }
                case "Nested": {
                    if (!ctx) return null;
                    return ctx.buildNested(
                        String(obj.type ?? ""),
                        (obj.fields ?? {}) as Record<string, unknown>,
                    );
                }
                case "GameObjectRef":
                    // Defer until the second pass — we only have a path right now.
                    if (ctx && ctx.currentComponent && ctx.currentField && Array.isArray(obj.path)) {
                        ctx.pendingGORefs.push({
                            component: ctx.currentComponent,
                            field: ctx.currentField,
                            path: (obj.path as number[]).slice(),
                            arrayIndex: ctx.currentArrayIndex,
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

    /**
     * @internal
     * Rebuilds a Sprite around an already-loaded texture.
     *
     * @param texture - the resolved texture asset.
     * @param json - the serialized sprite payload.
     */
    public static _buildSprite(texture: object, json: Record<string, unknown>): Sprite {
        const r = (json.rect ?? {}) as Record<string, number>;
        const b = (json.border ?? {}) as Record<string, number>;
        const p = (json.pivot ?? {}) as Record<string, number>;

        const sprite = new Sprite(
            texture as ConstructorParameters<typeof Sprite>[0],
            new Rect(+(r.x ?? 0), +(r.y ?? 0), +(r.width ?? 0), +(r.height ?? 0)),
        );
        sprite.border.set(+(b.left ?? 0), +(b.right ?? 0), +(b.top ?? 0), +(b.bottom ?? 0));
        sprite.pivot.set(+(p.x ?? 0.5), +(p.y ?? 0.5));
        return sprite;
    }

    /**
     * Encodes one component reference, or null when it cannot be rebuilt.
     *
     * @remarks
     * A reference out of the saved subtree, or to a class no registry knows, is
     * nulled rather than written as a half-reference that fails on load.
     */
    private static _componentRef(
        component: object,
        owner: GameObject,
        ctx: SerializeContext,
    ): unknown {
        const path = ctx.goToPath.get(owner);
        const typeName = ctx.componentTypeName(component);
        if (!path || typeName === null) return null;

        return {
            $type: "ComponentRef",
            path,
            component: typeName,
            index: ctx.componentIndex(owner, component),
        };
    }

    private constructor() {}
}
