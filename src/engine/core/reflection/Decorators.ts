import type {
    FieldMeta,
    ClassMeta,
    SerializableOptions,
    SerializedFieldOptions,
} from "./Types";
import { TypeRegistry, type AnyConstructor } from "./TypeRegistry";

// ==================== INTERNAL METADATA STORE ====================

/** @internal Per-prototype field metadata. */
const _protoFields: WeakMap<object, FieldMeta[]> = new WeakMap();

/** @internal Per-constructor class metadata. */
const _classMeta: WeakMap<AnyConstructor, ClassMeta> = new WeakMap();

function _ensureField(proto: object, name: string | symbol): FieldMeta {
    let list = _protoFields.get(proto);
    if (!list) {
        list = [];
        _protoFields.set(proto, list);
    }
    const key = String(name);
    let existing = list.find(f => f.name === key);
    if (!existing) {
        existing = { name: key, serialize: false };
        list.push(existing);
    }
    return existing;
}

// ==================== CLASS DECORATOR ====================

/**
 * Marks a class as serializable by the engine.
 *
 * @remarks
 * Registers the class in the {@link TypeRegistry} and records its field
 * metadata. Use together with {@link SerializedField} on properties that
 * should persist / be editable in the inspector.
 *
 * ```ts
 * @Serializable({ category: "Gameplay" })
 * class PlayerController extends ScriptableBehaviour {
 *     @SerializedField() speed = 5;
 *     @Range(0, 10) @SerializedField() jumpHeight = 2;
 * }
 * ```
 */
export function Serializable(opts: SerializableOptions = {}) {
    return function <T extends AnyConstructor>(target: T): T {
        const typeName = opts.typeName ?? target.name ?? "Anonymous";
        const fields = _protoFields.get(target.prototype) ?? [];
        const meta: ClassMeta = {
            typeName,
            fields: [...fields],
            category: opts.category,
        };
        _classMeta.set(target, meta);
        TypeRegistry.register(typeName, target, meta);
        return target;
    };
}

// ==================== FIELD DECORATORS ====================

/**
 * Marks a class field for serialization and inspector display.
 *
 * @remarks
 * Must be combined with {@link Serializable} on the owning class.
 * For compound types (Vector3, Color, GameObject refs) pass the type
 * explicitly via `options.type`.
 */
export function SerializedField(options: SerializedFieldOptions = {}) {
    return function (target: object, propertyKey: string | symbol): void {
        const f = _ensureField(target, propertyKey);
        f.serialize = true;
        if (options.type         !== undefined) f.type         = options.type;
        if (options.elementType  !== undefined) f.elementType  = options.elementType;
        if (options.displayName  !== undefined) f.displayName  = options.displayName;
        if (options.enumValues   !== undefined) f.enumValues   = options.enumValues;
        if (options.assetType    !== undefined) f.assetType    = options.assetType;
    };
}

/** Adds a `[min, max]` slider constraint for the inspector. */
export function Range(min: number, max: number) {
    return function (target: object, propertyKey: string | symbol): void {
        _ensureField(target, propertyKey).range = [min, max];
    };
}

/** Adds a section header above this field in the inspector. */
export function Header(text: string) {
    return function (target: object, propertyKey: string | symbol): void {
        _ensureField(target, propertyKey).header = text;
    };
}

/** Adds a hover tooltip in the inspector. */
export function Tooltip(text: string) {
    return function (target: object, propertyKey: string | symbol): void {
        _ensureField(target, propertyKey).tooltip = text;
    };
}

/**
 * Hides the field from the inspector.
 * Still persisted if `@SerializedField` was applied.
 */
export function HideInInspector() {
    return function (target: object, propertyKey: string | symbol): void {
        _ensureField(target, propertyKey).hideInInspector = true;
    };
}

// ==================== QUERIES ====================

/** Returns metadata attached to a class by `@Serializable`. */
export function getClassMeta(ctor: AnyConstructor): ClassMeta | null {
    return _classMeta.get(ctor) ?? null;
}

/**
 * Returns all serialized fields on a class including fields inherited
 * from base classes. Child-class declarations override parent ones.
 */
export function getAllFields(ctor: AnyConstructor): FieldMeta[] {
    const chain: AnyConstructor[] = [];
    let cur: AnyConstructor | null = ctor;
    while (cur && cur !== Object) {
        chain.unshift(cur);
        cur = Object.getPrototypeOf(cur) as AnyConstructor | null;
    }
    const merged = new Map<string, FieldMeta>();
    for (const c of chain) {
        const list = _protoFields.get(c.prototype);
        if (!list) continue;
        for (const f of list) merged.set(f.name, f);
    }
    return [...merged.values()];
}
