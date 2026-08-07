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
            // @ExecutionOrder may have run first (decorators apply bottom-up),
            // so an order already declared is carried into the metadata.
            executionOrder: _executionOrder.get(target),
        };
        _classMeta.set(target, meta);
        TypeRegistry.register(typeName, target, meta);
        return target;
    };
}

// ==================== EXECUTION ORDER ====================

/** @internal Per-constructor update order. Absent means the default, `0`. */
const _executionOrder: WeakMap<AnyConstructor, number> = new WeakMap();

/**
 * Distinct orders any class has declared, ascending, always including `0`.
 *
 * @remarks
 * The update loop walks the hierarchy once per entry. It stays a single-element
 * array until a scenario actually declares an order, which is what keeps the
 * default path free of any per-component ordering work.
 */
let _passes: number[] = [0];

/**
 * Sets when this component's `update` / `fixedUpdate` / `lateUpdate` run
 * relative to other components.
 *
 * @remarks
 * Equivalent to Unity's `[DefaultExecutionOrder]`. Lower values run earlier;
 * everything undecorated sits at `0`, and negative values run before it. The
 * order is **global**, not per-GameObject: every script at `-100` in the scene
 * updates before every script at `0`, wherever they sit in the hierarchy.
 *
 * Within one order, components keep hierarchy order — parents before children,
 * siblings in child-index order — which is what the engine did before any
 * ordering existed, so adding this decorator to one class cannot reshuffle the
 * rest.
 *
 * ```ts
 * @ExecutionOrder(-100)          // sample input before anything reads it
 * class InputAggregator extends ScriptableBehaviour { ... }
 * ```
 *
 * @param order - relative order; lower runs first.
 */
export function ExecutionOrder(order: number) {
    return function <T extends AnyConstructor>(target: T): T {
        const value = Number.isFinite(order) ? Math.trunc(order) : 0;
        _executionOrder.set(target, value);

        if (!_passes.includes(value)) {
            _passes.push(value);
            _passes.sort((a, b) => a - b);
        }

        const meta = _classMeta.get(target);
        if (meta) meta.executionOrder = value;
        return target;
    };
}

/**
 * The update order of an instance's class. `0` unless {@link ExecutionOrder}
 * was applied to it or to a base class.
 *
 * @param instance - the component to ask about.
 */
export function getExecutionOrder(instance: object): number {
    let ctor = instance?.constructor as AnyConstructor | undefined;
    while (ctor && ctor !== Object) {
        const order = _executionOrder.get(ctor);
        if (order !== undefined) return order;
        ctor = Object.getPrototypeOf(ctor) as AnyConstructor | undefined;
    }
    return 0;
}

/**
 * @internal
 * The orders the update loop has to walk, ascending. One entry — the common
 * case — means no ordering work is needed at all.
 */
export function _executionOrderPasses(): readonly number[] {
    return _passes;
}

/** @internal Drops every declared order. For tests. */
export function _resetExecutionOrders(): void {
    _passes = [0];
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
