import type { ClassMeta } from "./Types";

/** Constructor signature all registered types share. */
export type AnyConstructor = new (...args: any[]) => any;

/**
 * Maps stable type names to class constructors.
 *
 * @remarks
 * Populated automatically by `@Serializable()`. The serializer uses
 * this registry to map JSON `{ "$type": "..." }` markers back to
 * runtime classes during `Scene.fromJSON`.
 *
 * ```ts
 * const ctor = TypeRegistry.get("PlayerController");
 * const instance = new ctor(gameObject);
 * ```
 */
export class TypeRegistry {

    private static _byName: Map<string, AnyConstructor> = new Map();
    private static _byCtor: WeakMap<AnyConstructor, ClassMeta> = new WeakMap();

    /** Registers a class under `typeName` and attaches its metadata. */
    public static register(typeName: string, ctor: AnyConstructor, meta: ClassMeta): void {
        TypeRegistry._byName.set(typeName, ctor);
        TypeRegistry._byCtor.set(ctor, meta);
    }

    /** Looks up a registered class by name. Returns null if unknown. */
    public static get(typeName: string): AnyConstructor | null {
        return TypeRegistry._byName.get(typeName) ?? null;
    }

    /** Whether a type with this name is registered. */
    public static has(typeName: string): boolean {
        return TypeRegistry._byName.has(typeName);
    }

    /** Returns the metadata attached to a constructor by `@Serializable`. */
    public static getMeta(ctor: AnyConstructor): ClassMeta | null {
        return TypeRegistry._byCtor.get(ctor) ?? null;
    }

    /** Returns the stable name for an instance's class, or null. */
    public static getTypeName(instance: object): string | null {
        const ctor = instance?.constructor as AnyConstructor | undefined;
        if (!ctor) return null;
        return TypeRegistry._byCtor.get(ctor)?.typeName ?? null;
    }

    /** All registered type names. */
    public static get all(): readonly string[] {
        return [...TypeRegistry._byName.keys()];
    }

    /** @internal Clears the registry (used by tests). */
    public static _clear(): void {
        TypeRegistry._byName.clear();
    }

    private constructor() {}
}
