import type { SerializedGameObject } from "./SceneSerializer";

/**
 * One value on a prefab instance that differs from the prefab it came from.
 *
 * @remarks
 * Unity's model: an instance is not a copy of the prefab, it is the prefab plus
 * a list of differences. That is what lets an edit to the prefab reach every
 * instance while each instance keeps its own position, name or colour.
 *
 * The address is a **property path**: which GameObject in the tree, which
 * component on it, and which field.
 */
export interface PrefabOverride {
    /**
     * Child indices from the instance root down to the owning GameObject.
     * Empty for the root itself.
     */
    path: number[];
    /**
     * Registered type name of the component the field belongs to, or `null`
     * for a GameObject-level value ({@link field} is then `name`, `active`, or
     * one of the transform's).
     */
    component: string | null;
    /** Which component of that type on the GameObject. `0` unless duplicated. */
    componentIndex: number;
    /** Field name, or a transform path such as `transform.position`. */
    field: string;
    /** The instance's value, in serialized form. */
    value: unknown;
}

/** Transform fields compared at the GameObject level. */
const TRANSFORM_FIELDS = ["position", "rotation", "scale"] as const;

/**
 * @internal
 * Compares a serialized instance against the prefab it came from.
 *
 * @remarks
 * Kept apart from {@link Prefab} because it is pure: two snapshots in, a list
 * of differences out. Nothing here touches live objects, which is what makes it
 * testable and reusable for the editor's "modified" markers.
 *
 * **Structural changes are not overrides.** A child added to or removed from an
 * instance is a different shape, not a different value, and Unity treats it as
 * a separate kind of modification. Only the subtree the two snapshots share is
 * compared, so an added child is simply not reported here.
 */
export class PrefabDiff {

    private constructor() {}

    /**
     * Every value on `instance` that differs from `prefab`.
     *
     * @param prefab - the snapshot the instance was created from.
     * @param instance - the instance's current snapshot.
     * @returns the differences, in tree order.
     */
    public static compare(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
    ): PrefabOverride[] {
        const out: PrefabOverride[] = [];
        PrefabDiff._compareNode(prefab, instance, [], out);
        return out;
    }

    /**
     * Applies overrides onto a snapshot, producing what the instance should be.
     *
     * @remarks
     * The inverse of {@link compare}, and how an instance is rebuilt from
     * `prefab + differences` rather than from a full copy. The snapshot is
     * deep-copied first, so the prefab is never modified.
     *
     * @param prefab - the snapshot to start from.
     * @param overrides - differences to apply.
     * @returns a new snapshot with the overrides applied.
     */
    public static apply(
        prefab: SerializedGameObject,
        overrides: readonly PrefabOverride[],
    ): SerializedGameObject {
        const clone = JSON.parse(JSON.stringify(prefab)) as SerializedGameObject;

        for (const override of overrides) {
            const node = PrefabDiff._nodeAt(clone, override.path);
            if (!node) continue;

            if (override.component === null) {
                PrefabDiff._applyNodeField(node, override.field, override.value);
                continue;
            }

            const target = PrefabDiff._componentAt(node, override.component, override.componentIndex);
            if (target) target.fields[override.field] = override.value;
        }

        return clone;
    }

    // ── private ──────────────────────────────────────────────────────

    private static _compareNode(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        out: PrefabOverride[],
    ): void {
        if (prefab.name !== instance.name) {
            out.push({ path, component: null, componentIndex: 0, field: "name", value: instance.name });
        }
        if (prefab.active !== instance.active) {
            out.push({ path, component: null, componentIndex: 0, field: "active", value: instance.active });
        }

        for (const key of TRANSFORM_FIELDS) {
            const before = (prefab.transform as any)[key];
            const after = (instance.transform as any)[key];
            if (!PrefabDiff._equal(before, after)) {
                out.push({
                    path, component: null, componentIndex: 0,
                    field: `transform.${key}`, value: after,
                });
            }
        }

        PrefabDiff._compareComponents(prefab, instance, path, out);

        // Only the shared subtree: a child present on one side alone is a
        // structural change, not a value difference.
        const shared = Math.min(prefab.children.length, instance.children.length);
        for (let i = 0; i < shared; i++) {
            PrefabDiff._compareNode(prefab.children[i], instance.children[i], [...path, i], out);
        }
    }

    private static _compareComponents(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        out: PrefabOverride[],
    ): void {
        const seen = new Map<string, number>();

        for (const comp of instance.components) {
            const index = seen.get(comp.type) ?? 0;
            seen.set(comp.type, index + 1);

            const original = PrefabDiff._componentAt(prefab, comp.type, index);
            // A component the prefab does not have is a structural change.
            if (!original) continue;

            for (const field of Object.keys(comp.fields)) {
                if (PrefabDiff._equal(original.fields[field], comp.fields[field])) continue;
                out.push({
                    path,
                    component: comp.type,
                    componentIndex: index,
                    field,
                    value: comp.fields[field],
                });
            }
        }
    }

    private static _applyNodeField(node: SerializedGameObject, field: string, value: unknown): void {
        if (field === "name") { node.name = value as string; return; }
        if (field === "active") { node.active = value as boolean; return; }

        if (field.startsWith("transform.")) {
            const key = field.substring("transform.".length);
            (node.transform as any)[key] = value;
        }
    }

    private static _nodeAt(root: SerializedGameObject, path: readonly number[]): SerializedGameObject | null {
        let node = root;
        for (const index of path) {
            const next = node.children[index];
            if (!next) return null;
            node = next;
        }
        return node;
    }

    private static _componentAt(
        node: SerializedGameObject,
        type: string,
        index: number,
    ): { type: string; fields: Record<string, unknown> } | null {
        let seen = 0;
        for (const comp of node.components) {
            if (comp.type !== type) continue;
            if (seen === index) return comp;
            seen++;
        }
        return null;
    }

    /**
     * Structural equality over serialized values.
     *
     * @remarks
     * Everything compared here has already been through the serializer, so it
     * is plain JSON — no cycles, no class instances, and key order is the field
     * walk's, which is stable for a given class.
     */
    private static _equal(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a === null || b === null || a === undefined || b === undefined) return false;
        if (typeof a !== "object" || typeof b !== "object") return false;

        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((v, i) => PrefabDiff._equal(v, b[i]));
        }

        const ka = Object.keys(a as object);
        const kb = Object.keys(b as object);
        if (ka.length !== kb.length) return false;
        return ka.every(k => PrefabDiff._equal((a as any)[k], (b as any)[k]));
    }
}
