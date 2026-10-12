import type { SerializedGameObject, SerializedComponent } from "./SceneSerializer";

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
     * Child indices from the instance root down to the owning GameObject, in the
     * prefab's own tree. Empty for the root itself.
     *
     * Informational once {@link node} is present: the node is found by id, so a
     * prefab that gains or loses a sibling does not misdirect the override.
     */
    path: number[];
    /**
     * Id of the owning node within the prefab, when its nodes have ids — which
     * every prefab made by {@link Prefab.fromGameObject} does.
     */
    node?: string;
    /**
     * Registered type name of the component the field belongs to, or `null`
     * for a GameObject-level value ({@link field} is then `name`, `active`, or
     * one of the transform's).
     */
    component: string | null;
    /** Which component of that type on the GameObject. `0` unless duplicated. */
    componentIndex: number;
    /**
     * Field name, a transform path such as `transform.position`, or `prefab` for
     * a nested prefab instance's own link.
     */
    field: string;
    /** The instance's value, in serialized form. */
    value: unknown;
}

/** A child the instance has and the prefab does not. */
export interface PrefabAddedChild {
    /** Id of the prefab node it was added under. */
    parent: string;
    /** Its position among that node's children in the instance. */
    index: number;
    node: SerializedGameObject;
}

/** A component the instance has and the prefab does not. */
export interface PrefabAddedComponent {
    /** Id of the prefab node it was added to. */
    node: string;
    /** Its position among that node's components in the instance. */
    index: number;
    component: SerializedComponent;
}

/** A component the prefab has and the instance has removed. */
export interface PrefabRemovedComponent {
    node: string;
    /** Registered type name. */
    component: string;
    /** Which component of that type, in the prefab. */
    componentIndex: number;
}

/**
 * Everything that differs between an instance and its prefab: the values, and
 * the shape.
 *
 * @remarks
 * Unity lists these as overrides, added objects, added components and removed
 * ones. Shape changes need node ids to be addressed at all — a child cannot be
 * "the second one" once an earlier one is removed — so they exist only for
 * prefabs whose nodes have them.
 */
export interface PrefabChanges {
    overrides: PrefabOverride[];
    addedChildren?: PrefabAddedChild[];
    /** Ids of prefab nodes the instance does not have. */
    removedChildren?: string[];
    addedComponents?: PrefabAddedComponent[];
    removedComponents?: PrefabRemovedComponent[];
}

/** The link an instance keeps to the prefab it came from, as saved. */
export interface SerializedPrefabLink {
    /** Id of the prefab asset. */
    guid: string;
    /**
     * Present when the instance is saved as *prefab plus changes*. Absent when
     * the tree is saved in full and the link only records where it came from.
     */
    changes?: PrefabChanges;
}

/**
 * What the serializer needs of a prefab, and nothing more.
 *
 * @remarks
 * Described rather than imported: `Prefab` uses the serializer, and the
 * serializer importing it back is the loop `GameObject` → `Prefab` →
 * `SceneSerializer` → `GameObject` that was already broken once. `Prefab`
 * satisfies this by shape.
 */
export interface PrefabSource {
    readonly name: string;
    /** The tree this prefab describes, with a variant resolved against its base. */
    _resolvedTree(): SerializedGameObject;
}

/**
 * What a GameObject remembers about being a prefab instance.
 *
 * @remarks
 * Set on the root of an instance and nowhere else. `source` is the prefab
 * itself when this session knows it, and `guid` names it for the file, so an
 * instance read from a scene whose prefab is not loaded yet still keeps the
 * link. `raw` holds the saved link verbatim when the prefab could not be
 * found: such an object is a placeholder, and writing the link back untouched
 * is what keeps opening and saving from deleting what it stood for.
 */
export interface PrefabInstanceInfo {
    source: PrefabSource | null;
    guid: string | null;
    raw: SerializedPrefabLink | null;
}

/** Transform fields compared at the GameObject level. */
const TRANSFORM_FIELDS = ["position", "rotation", "scale"] as const;

let _idCounter = 0;

/**
 * A new id for a prefab node.
 *
 * @remarks
 * Random, so two prefabs authored apart never share one by accident, plus a
 * counter, so two minted in the same millisecond never do either.
 */
export function mintNodeId(): string {
    _idCounter = (_idCounter + 1) % 0x100000;
    const random = Math.floor(Math.random() * 0x1000000).toString(36).padStart(5, "0");
    return `${random}${_idCounter.toString(36).padStart(3, "0")}`;
}

/**
 * @internal
 * Compares a serialized instance against the prefab it came from.
 *
 * @remarks
 * Kept apart from {@link Prefab} because it is pure: two snapshots in, a list
 * of differences out. Nothing here touches live objects, which is what makes it
 * testable and reusable for the editor's "modified" markers.
 *
 * Nodes are matched by **id** when the prefab's have them, so an instance that
 * reorders, adds or removes children is still compared node against the node it
 * came from. A prefab without ids (a file from before they existed, loaded
 * through {@link ensureIds}) is the only case that falls back to matching by
 * position — and the only one where shape changes cannot be reported.
 */
export class PrefabDiff {

    private constructor() {}

    /**
     * Every *value* on `instance` that differs from `prefab`.
     *
     * @remarks
     * Shape changes are not here — they are not values. {@link compareChanges}
     * has both.
     *
     * @param prefab - the snapshot the instance was created from.
     * @param instance - the instance's current snapshot.
     * @returns the differences, in tree order.
     */
    public static compare(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
    ): PrefabOverride[] {
        return PrefabDiff.compareChanges(prefab, instance).overrides;
    }

    /**
     * Every difference between `instance` and `prefab`, values and shape.
     *
     * @remarks
     * Nodes the instance added are given ids here if they have none, so that
     * whatever is built from the result — a variant, say — can be compared in
     * its turn. That is done to `instance`, which is expected to be a snapshot
     * taken for this purpose.
     */
    public static compareChanges(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
    ): PrefabChanges {
        const changes: PrefabChanges = { overrides: [] };
        PrefabDiff._compareNode(prefab, instance, [], changes);

        const out: PrefabChanges = { overrides: changes.overrides };
        if (changes.addedChildren?.length) out.addedChildren = changes.addedChildren;
        if (changes.removedChildren?.length) out.removedChildren = changes.removedChildren;
        if (changes.addedComponents?.length) out.addedComponents = changes.addedComponents;
        if (changes.removedComponents?.length) out.removedComponents = changes.removedComponents;
        return out;
    }

    /**
     * Applies value overrides onto a snapshot, producing what the instance should be.
     *
     * @param prefab - the snapshot to start from.
     * @param overrides - differences to apply.
     * @returns a new snapshot with the overrides applied.
     */
    public static apply(
        prefab: SerializedGameObject,
        overrides: readonly PrefabOverride[],
    ): SerializedGameObject {
        return PrefabDiff.applyChanges(prefab, { overrides: [...overrides] });
    }

    /**
     * Applies values and shape changes onto a snapshot.
     *
     * @remarks
     * The inverse of {@link compareChanges}, and how an instance is rebuilt from
     * `prefab + differences` rather than from a full copy. The snapshot is
     * deep-copied first, so the prefab is never modified. A change addressed to a
     * node the prefab no longer has is skipped rather than failing: the prefab
     * moved on, and what the instance said about that part no longer applies.
     */
    public static applyChanges(
        prefab: SerializedGameObject,
        changes: PrefabChanges,
    ): SerializedGameObject {
        const clone = JSON.parse(JSON.stringify(prefab)) as SerializedGameObject;
        const byId = PrefabDiff._index(clone);

        for (const override of changes.overrides) {
            const node = override.node !== undefined
                ? byId.get(override.node)?.node
                : PrefabDiff._nodeAt(clone, override.path);
            if (!node) continue;

            if (override.component === null) {
                PrefabDiff._applyNodeField(node, override.field, override.value);
                continue;
            }

            const target = PrefabDiff._componentAt(node, override.component, override.componentIndex);
            if (target) target.fields[override.field] = override.value;
        }

        // Highest index first, so removing one does not renumber the next.
        const removed = [...(changes.removedComponents ?? [])]
            .sort((a, b) => b.componentIndex - a.componentIndex);
        for (const r of removed) {
            const node = byId.get(r.node)?.node;
            if (!node) continue;
            const at = PrefabDiff._componentPosition(node, r.component, r.componentIndex);
            if (at >= 0) node.components.splice(at, 1);
        }

        for (const id of changes.removedChildren ?? []) {
            const entry = byId.get(id);
            if (!entry?.parent) continue;
            entry.parent.children.splice(entry.parent.children.indexOf(entry.node), 1);
        }

        // Lowest index first: each insert is at a position that already counts
        // everything inserted before it.
        const addedComponents = [...(changes.addedComponents ?? [])].sort((a, b) => a.index - b.index);
        for (const a of addedComponents) {
            const node = byId.get(a.node)?.node;
            if (!node) continue;
            node.components.splice(Math.min(Math.max(a.index, 0), node.components.length), 0,
                JSON.parse(JSON.stringify(a.component)) as SerializedComponent);
        }

        const addedChildren = [...(changes.addedChildren ?? [])].sort((a, b) => a.index - b.index);
        for (const a of addedChildren) {
            const parent = byId.get(a.parent)?.node;
            if (!parent) continue;
            parent.children.splice(Math.min(Math.max(a.index, 0), parent.children.length), 0,
                JSON.parse(JSON.stringify(a.node)) as SerializedGameObject);
        }

        return clone;
    }

    /**
     * Gives every node in a snapshot an id, keeping the ones it has.
     *
     * @param snapshot - the tree, modified in place.
     * @param legacy - derive ids from the node's position rather than minting
     *   them, so a file that never had ids gets the *same* ones every time it is
     *   loaded. A minted id would differ on every load, and an instance saved
     *   against the first would find nothing on the second.
     */
    public static ensureIds(snapshot: SerializedGameObject, legacy = false): SerializedGameObject {
        const walk = (node: SerializedGameObject, path: number[]): void => {
            if (node.id === undefined) {
                node.id = legacy ? `~${path.join(".")}` : mintNodeId();
            }
            node.children.forEach((child, i) => walk(child, [...path, i]));
        };
        walk(snapshot, []);
        return snapshot;
    }

    // ── private ──────────────────────────────────────────────────────

    private static _compareNode(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        changes: PrefabChanges,
    ): void {
        const node = prefab.id;
        const at = (rest: Omit<PrefabOverride, "path" | "node">): PrefabOverride =>
            node === undefined ? { path, ...rest } : { path, node, ...rest };

        if (prefab.name !== instance.name) {
            changes.overrides.push(at({ component: null, componentIndex: 0, field: "name", value: instance.name }));
        }
        if (prefab.active !== instance.active) {
            changes.overrides.push(at({ component: null, componentIndex: 0, field: "active", value: instance.active }));
        }

        for (const key of TRANSFORM_FIELDS) {
            const before = (prefab.transform as any)[key];
            const after = (instance.transform as any)[key];
            if (!PrefabDiff._equal(before, after)) {
                changes.overrides.push(at({
                    component: null, componentIndex: 0,
                    field: `transform.${key}`, value: after,
                }));
            }
        }

        // A nested prefab instance is compared as one value: its link, with its
        // own changes inside. Reading those apart is the nested prefab's job.
        if (!PrefabDiff._equal(prefab.prefab, instance.prefab)) {
            changes.overrides.push(at({
                component: null, componentIndex: 0,
                field: "prefab", value: instance.prefab ?? null,
            }));
        }

        PrefabDiff._compareComponents(prefab, instance, at, changes);
        PrefabDiff._compareChildren(prefab, instance, path, changes);
    }

    private static _compareChildren(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        changes: PrefabChanges,
    ): void {
        const byId = prefab.children.every(c => c.id !== undefined);

        // No ids to go by: only the subtree both sides share, by position. A
        // child present on one side alone cannot be told from a moved one.
        if (!byId || prefab.id === undefined) {
            const shared = Math.min(prefab.children.length, instance.children.length);
            for (let i = 0; i < shared; i++) {
                PrefabDiff._compareNode(prefab.children[i], instance.children[i], [...path, i], changes);
            }
            return;
        }

        const matched = new Set<string>();
        instance.children.forEach((child, index) => {
            const at = child.id === undefined
                ? -1
                : prefab.children.findIndex(p => p.id === child.id);

            if (at >= 0 && !matched.has(child.id!)) {
                matched.add(child.id!);
                PrefabDiff._compareNode(prefab.children[at], child, [...path, at], changes);
                return;
            }

            PrefabDiff.ensureIds(child);
            (changes.addedChildren ??= []).push({ parent: prefab.id!, index, node: child });
        });

        for (const child of prefab.children) {
            if (!matched.has(child.id!)) (changes.removedChildren ??= []).push(child.id!);
        }
    }

    private static _compareComponents(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        at: (rest: Omit<PrefabOverride, "path" | "node">) => PrefabOverride,
        changes: PrefabChanges,
    ): void {
        const seen = new Map<string, number>();
        const kept = new Map<string, number>();

        instance.components.forEach((comp, position) => {
            const index = seen.get(comp.type) ?? 0;
            seen.set(comp.type, index + 1);

            const original = PrefabDiff._componentAt(prefab, comp.type, index);
            if (!original) {
                // A component the prefab does not have is a shape change — which
                // can only be recorded against a node that has an id.
                if (prefab.id !== undefined) {
                    (changes.addedComponents ??= []).push({
                        node: prefab.id, index: position, component: comp,
                    });
                }
                return;
            }
            kept.set(comp.type, index + 1);

            for (const field of Object.keys(comp.fields)) {
                if (PrefabDiff._equal(original.fields[field], comp.fields[field])) continue;
                changes.overrides.push(at({
                    component: comp.type,
                    componentIndex: index,
                    field,
                    value: comp.fields[field],
                }));
            }
        });

        if (prefab.id === undefined) return;
        const had = new Map<string, number>();
        for (const comp of prefab.components) {
            const index = had.get(comp.type) ?? 0;
            had.set(comp.type, index + 1);
            if (index >= (kept.get(comp.type) ?? 0)) {
                (changes.removedComponents ??= []).push({
                    node: prefab.id, component: comp.type, componentIndex: index,
                });
            }
        }
    }

    private static _applyNodeField(node: SerializedGameObject, field: string, value: unknown): void {
        if (field === "name") { node.name = value as string; return; }
        if (field === "active") { node.active = value as boolean; return; }
        if (field === "prefab") {
            if (value === null || value === undefined) delete node.prefab;
            else node.prefab = value as SerializedGameObject["prefab"];
            return;
        }

        if (field.startsWith("transform.")) {
            const key = field.substring("transform.".length);
            (node.transform as any)[key] = value;
        }
    }

    private static _index(
        root: SerializedGameObject,
    ): Map<string, { node: SerializedGameObject; parent: SerializedGameObject | null }> {
        const out = new Map<string, { node: SerializedGameObject; parent: SerializedGameObject | null }>();
        const walk = (node: SerializedGameObject, parent: SerializedGameObject | null): void => {
            if (node.id !== undefined) out.set(node.id, { node, parent });
            for (const child of node.children) walk(child, node);
        };
        walk(root, null);
        return out;
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

    /** Position in `node.components` of the `index`-th component of `type`, or -1. */
    private static _componentPosition(node: SerializedGameObject, type: string, index: number): number {
        let seen = 0;
        for (let i = 0; i < node.components.length; i++) {
            if (node.components[i].type !== type) continue;
            if (seen === index) return i;
            seen++;
        }
        return -1;
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
