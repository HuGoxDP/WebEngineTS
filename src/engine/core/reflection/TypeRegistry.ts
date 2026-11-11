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

    /**
     * Registers a class under `typeName` and attaches its metadata.
     *
     * @remarks
     * Two classes may not share a name. A collision silently makes one of them
     * unloadable — every scene referring to it would rebuild the *other* class
     * — so it is reported rather than accepted. The usual causes are a
     * copy-pasted `typeName` and a minifier rewriting class names, which is why
     * built-in components always pass an explicit one.
     *
     * Re-registering the same constructor is allowed: a module evaluated twice
     * (two bundle copies, or a hot reload) is not an error.
     */
    public static register(typeName: string, ctor: AnyConstructor, meta: ClassMeta): void {
        const existing = TypeRegistry._byName.get(typeName);
        if (existing && existing !== ctor) {
            console.error(
                `[TypeRegistry] Type name "${typeName}" is already registered to a different `
                + `class. Give one of them an explicit @Serializable({ typeName }) — otherwise `
                + `scenes referring to it will load the wrong component. If the swap is ` +
                `intended (a script reload), call TypeRegistry.replace instead.`,
            );
            return;
        }

        TypeRegistry._byName.set(typeName, ctor);
        TypeRegistry._byCtor.set(ctor, meta);
    }

    /**
     * Swaps the class registered under an existing name — the explicit,
     * intended counterpart to the collision {@link register} refuses.
     *
     * A script reload registers a new constructor under the same `typeName`,
     * and `register` refuses that on purpose: a silent collision would load the
     * wrong component. `replace` is how a host says the swap is deliberate.
     * From then on the name resolves to `ctor`, so a scene deserialized after
     * the swap instantiates the new class; the metadata is passed explicitly
     * because the refused `register` never stored it (a host reads it with
     * `getClassMeta` from the class's own `@Serializable`).
     *
     * The previous class's metadata is kept: instances still alive under it
     * keep serializing under the same name, so a file saved from a mixed scene
     * still loads. Re-instantiating those live instances from their serialized
     * fields is the host's step (the editor's script reload does it) — the
     * engine's part is that the name now means the new class.
     *
     * @throws if nothing is registered under `typeName`, or if `meta` names
     *         something else — both are caller errors, not collisions.
     */
    public static replace(typeName: string, ctor: AnyConstructor, meta: ClassMeta): void {
        const existing = TypeRegistry._byName.get(typeName);
        if (!existing) {
            throw new Error(
                `[TypeRegistry] Cannot replace "${typeName}": nothing is registered under that name.`
            );
        }
        if (meta.typeName !== typeName) {
            throw new Error(
                `[TypeRegistry] Cannot replace "${typeName}" with metadata that names ` +
                `"${meta.typeName}".`
            );
        }
        if (existing === ctor) return;

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
        // Both maps, or the registry is only half cleared: `getMeta` and
        // `getTypeName` read the other one, and would go on answering for
        // classes the registry no longer knows. A WeakMap has no `clear`, so
        // the way to empty it is to replace it.
        TypeRegistry._byCtor = new WeakMap();
    }

    private constructor() {}
}
