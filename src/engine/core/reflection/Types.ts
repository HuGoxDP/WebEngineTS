/**
 * Canonical types recognized by the serializer and the editor inspector.
 *
 * @remarks
 * For primitive types (`Number`, `String`, `Boolean`) the serializer can
 * infer the type at runtime via `typeof`. For compound types (Vector3,
 * Color, etc.) or references, supply the type explicitly via
 * `@SerializedField({ type: FieldType.Vector3 })`.
 */
export enum FieldType {
    Number      = "Number",
    String      = "String",
    Boolean     = "Boolean",
    Vector2     = "Vector2",
    Vector3     = "Vector3",
    Vector4     = "Vector4",
    Quaternion  = "Quaternion",
    Color       = "Color",
    Enum        = "Enum",
    /** Reference to another GameObject (serialized by id). */
    GameObject  = "GameObject",
    /** Reference to a loadable asset (serialized by path). */
    Asset       = "Asset",
    /** Array of a single element type. `elementType` must be set. */
    Array       = "Array",
    /** Arbitrary JSON-compatible object. */
    Object      = "Object",
}

/**
 * Inspector / serializer metadata for a single class field.
 */
export interface FieldMeta {
    /** The runtime property name. */
    name: string;
    /** Whether the field is serialized to JSON. True if `@SerializedField` was applied. */
    serialize: boolean;
    /** Canonical type hint. May be undefined — serializer falls back to `typeof`. */
    type?: FieldType;
    /** Element type when `type === FieldType.Array`. */
    elementType?: FieldType;
    /** Friendly name shown in the inspector. Defaults to `name`. */
    displayName?: string;
    /** Long-form hover text for the inspector. */
    tooltip?: string;
    /** Section header displayed above this field. */
    header?: string;
    /** `[min, max]` slider range. */
    range?: readonly [number, number];
    /** If true, the editor does not render this field. Still serialized. */
    hideInInspector?: boolean;
    /** Allowed enum values when `type === FieldType.Enum`. */
    enumValues?: Record<string, number | string>;
    /** Restrict the asset picker when `type === FieldType.Asset`. */
    assetType?: string;
}

/**
 * Inspector / serializer metadata for a whole class.
 */
export interface ClassMeta {
    /** Stable name used in serialized JSON. Defaults to the constructor name. */
    typeName: string;
    /** All fields declared with `@SerializedField` (or any decorator metadata). */
    fields: FieldMeta[];
    /** Inspector category label (e.g., "Physics", "Gameplay"). */
    category?: string;
}

/** Options accepted by `@Serializable`. */
export interface SerializableOptions {
    typeName?: string;
    category?: string;
}

/** Options accepted by `@SerializedField`. */
export interface SerializedFieldOptions {
    type?: FieldType;
    elementType?: FieldType;
    displayName?: string;
    enumValues?: Record<string, number | string>;
    assetType?: string;
}
