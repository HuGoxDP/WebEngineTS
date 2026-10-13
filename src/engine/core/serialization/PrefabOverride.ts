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
     *
     * Ids joined by `/` address a node inside a nested prefab instance: the
     * nested instance's id in this prefab, then the node's id in the nested
     * prefab (`"0uak7004/4xe08002"`). Such a change is folded into the nested
     * instance's own link when it is applied, so the nested instance records
     * one field at a time rather than as a whole.
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
    /**
     * Changes addressed to nodes the prefab no longer has, kept rather than
     * dropped. They are tried again on every load, so they apply once more if
     * the prefab gets the node back — Unity's "unused overrides".
     */
    unused?: PrefabChanges;
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
 * is what keeps opening and saving from deleting what it stood for. `unused`
 * holds the changes that no longer apply (see {@link SerializedPrefabLink.unused}).
 */
export interface PrefabInstanceInfo {
    source: PrefabSource | null;
    guid: string | null;
    raw: SerializedPrefabLink | null;
    unused: PrefabChanges | null;
}

/**
 * @internal
 * How {@link encodeNodePath} and {@link findNodeById} see a tree: live
 * GameObjects when a scene is written or read, saved JSON for a prefab file.
 */
export interface NodeAccess<N> {
    /** The node's id, or null if it has none. */
    id(node: N): string | null;
    children(node: N): readonly N[];
    /**
     * Whether the node is the root of a nested prefab instance: its own id
     * belongs to the tree around it, its interior to another prefab.
     */
    isInstance(node: N): boolean;
}

/**
 * @internal
 * The descendant of `from` with this node id, looked for depth first in child
 * order without entering a nested instance (whose own root is checked).
 *
 * @remarks
 * The interior of a nested instance is another prefab's namespace, where the
 * same ids may repeat — two copies of one prefab nested side by side have
 * identical interiors — so it is never searched.
 */
export function findNodeById<N>(from: N, id: string, access: NodeAccess<N>): N | null {
    for (const child of access.children(from)) {
        if (access.id(child) === id) return child;
        if (access.isInstance(child)) continue;
        const found = findNodeById(child, id, access);
        if (found !== null) return found;
    }
    return null;
}

/**
 * @internal
 * A reference path rewritten to address nodes by id where it can.
 *
 * @remarks
 * `chain` is the nodes the positional `path` walks through, its first element
 * the root `path[0]` indexes. From the first node at or past `idsFrom`, each
 * step jumps to the furthest node further down the chain that
 * {@link findNodeById} finds by its id; a node it cannot reach that way is
 * stepped to by child index. So the path is a number for every hop up to and
 * including the first instance root, then one id per prefab namespace it
 * crosses. A reference written this way survives the prefab gaining or losing
 * siblings in front of its target, which a positional one silently does not.
 *
 * @param idsFrom - the index in `chain` of the first node below which ids are
 *   written at all: the first instance root, or the root of a prefab.
 */
export function encodeNodePath<N>(
    chain: readonly N[],
    path: readonly number[],
    idsFrom: number,
    access: NodeAccess<N>,
): Array<number | string> {
    const out: Array<number | string> = [path[0]];
    let at = 0;
    while (at < chain.length - 1) {
        let jump = -1;
        if (at >= idsFrom) {
            for (let j = chain.length - 1; j > at; j--) {
                const id = access.id(chain[j]);
                if (id !== null && findNodeById(chain[at], id, access) === chain[j]) {
                    jump = j;
                    break;
                }
            }
        }
        if (jump < 0) {
            out.push(path[at + 1]);
            at++;
        } else {
            out.push(access.id(chain[jump])!);
            at = jump;
        }
    }
    return out;
}

/**
 * Finds the tree of a prefab by its id, or null when it is not loaded. Given to
 * {@link PrefabDiff.compareChanges} so that two links to the same prefab can be
 * compared one field at a time.
 */
export type PrefabTreeResolver = (guid: string) => SerializedGameObject | null;

/** What a comparison carries down the tree. */
interface CompareContext {
    readonly resolve: PrefabTreeResolver | null;
    /** Guids of the nested prefabs being compared inside each other, outermost first. */
    readonly chain: readonly string[];
}

/** Separates the levels of an id that addresses a node inside a nested instance. */
const NEST = "/";

/**
 * @internal
 * The first level of an id that addresses a node inside a nested instance,
 * and the rest; null for a plain id.
 */
export function splitNested(id: string): { head: string; rest: string } | null {
    const at = id.indexOf(NEST);
    return at < 0 ? null : { head: id.slice(0, at), rest: id.slice(at + 1) };
}

/** How a saved tree is walked: a node carrying `prefab` is a nested instance. */
const JSON_ACCESS: NodeAccess<SerializedGameObject> = {
    id: node => node.id ?? null,
    children: node => node.children,
    isInstance: node => node.prefab !== undefined,
};

/** No changes at all. */
const EMPTY: PrefabChanges = Object.freeze({ overrides: [] }) as PrefabChanges;

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
        resolve?: PrefabTreeResolver,
    ): PrefabOverride[] {
        return PrefabDiff.compareChanges(prefab, instance, resolve).overrides;
    }

    /**
     * Every difference between `instance` and `prefab`, values and shape.
     *
     * @remarks
     * Nodes the instance added are given ids here if they have none, so that
     * whatever is built from the result — a variant, say — can be compared in
     * its turn. That is done to `instance`, which is expected to be a snapshot
     * taken for this purpose.
     *
     * A prefab nested inside is compared one field at a time when both sides
     * link the same prefab: a change inside it is then addressed through the
     * nesting (`"outer/inner"`), so an edit the outer prefab makes to a
     * *different* field of the same nested instance still reaches this one.
     * With `resolve` finding its tree the two are expanded and compared as
     * trees; without — no resolver, or the prefab not loaded — the two links'
     * changes are compared instead, and what the instance's adds is the
     * change. The nested instance's whole link is one value only for a
     * different prefab, or for a link that lacks something the outer prefab's
     * holds.
     *
     * An instance whose nodes have no ids at all while the prefab's do — a
     * snapshot of an object saved or copied before ids existed — is compared
     * node for node by position, as before ids: a copy of it takes the
     * prefab's ids at the same places, and its references, written as
     * positions, are rewritten to them. `instance` itself is not modified in
     * that case.
     */
    public static compareChanges(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        resolve?: PrefabTreeResolver,
    ): PrefabChanges {
        const matched = PrefabDiff._hasOwnIds(prefab) && !PrefabDiff._hasOwnIds(instance)
            ? PrefabDiff._matchByPosition(prefab, instance)
            : instance;
        return PrefabDiff._compareTrees(prefab, matched, { resolve: resolve ?? null, chain: [] });
    }

    private static _compareTrees(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        cmp: CompareContext,
    ): PrefabChanges {
        const changes: PrefabChanges = { overrides: [] };
        PrefabDiff._compareNode(prefab, instance, [], changes, false, cmp);

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
     * @param resolve - finds the trees of nested prefabs; see {@link applyChanges}.
     * @returns a new snapshot with the overrides applied.
     */
    public static apply(
        prefab: SerializedGameObject,
        overrides: readonly PrefabOverride[],
        resolve?: PrefabTreeResolver,
    ): SerializedGameObject {
        return PrefabDiff.applyChanges(prefab, { overrides: [...overrides] }, resolve);
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
     *
     * Applying changes the prefab already holds does nothing: an added child
     * whose id the prefab has, or an added component identical to the one
     * already at its place, is skipped. That is what an instance's older saved
     * changes look like once the instance has been applied to its prefab.
     *
     * A change addressed through a nested instance (`"outer/inner"`) is
     * folded into that instance's link. It was recorded against the nested
     * prefab *as this one changes it*, so with `resolve` the link becomes the
     * changes from the nested prefab to that tree with these applied on top:
     * an edit to a child or component this prefab added to the nested
     * instance lands on it, and removing one removes it. Without `resolve`, or
     * with the nested prefab not loaded, the change is added to the link's
     * own changes, which is exact only for nodes and components the nested
     * prefab itself has.
     *
     * @param resolve - finds the trees of nested prefabs by id.
     */
    public static applyChanges(
        prefab: SerializedGameObject,
        changes: PrefabChanges,
        resolve?: PrefabTreeResolver,
    ): SerializedGameObject {
        return PrefabDiff._applyChanges(prefab, changes, resolve ?? null, []);
    }

    /**
     * {@link applyChanges}, carrying the guids of the nested prefabs being
     * expanded around this call, so that a prefab nested inside itself — two
     * files that contain each other — is not composed into without end.
     */
    private static _applyChanges(
        prefab: SerializedGameObject,
        changes: PrefabChanges,
        resolve: PrefabTreeResolver | null,
        chain: readonly string[],
    ): SerializedGameObject {
        const clone = JSON.parse(JSON.stringify(prefab)) as SerializedGameObject;
        const byId = PrefabDiff._index(clone);
        PrefabDiff._composeNested(byId, changes, resolve, chain);

        for (const override of changes.overrides) {
            if (override.node !== undefined && splitNested(override.node) !== null) continue;

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

        // What is still there once the removals are done, for the added children.
        const present = PrefabDiff._index(clone);

        // Lowest index first: each insert is at a position that already counts
        // everything inserted before it.
        const addedComponents = [...(changes.addedComponents ?? [])].sort((a, b) => a.index - b.index);
        for (const a of addedComponents) {
            const node = byId.get(a.node)?.node;
            if (!node) continue;
            const at = Math.min(Math.max(a.index, 0), node.components.length);
            const there = node.components[at];
            if (there !== undefined && there.type === a.component.type
                && PrefabDiff._equal(there.fields, a.component.fields)) continue;
            node.components.splice(at, 0, JSON.parse(JSON.stringify(a.component)) as SerializedComponent);
        }

        const addedChildren = [...(changes.addedChildren ?? [])].sort((a, b) => a.index - b.index);
        for (const a of addedChildren) {
            const parent = byId.get(a.parent)?.node;
            if (!parent) continue;
            if (a.node.id !== undefined && present.has(a.node.id)) continue;
            parent.children.splice(Math.min(Math.max(a.index, 0), parent.children.length), 0,
                JSON.parse(JSON.stringify(a.node)) as SerializedGameObject);
        }

        return clone;
    }

    /**
     * The node of `tree` a change addresses — by id when it has one, by path
     * otherwise — with its parent, or null when the tree has no such node.
     */
    public static nodeOf(
        tree: SerializedGameObject,
        address: { node?: string; path?: readonly number[] },
    ): { node: SerializedGameObject; parent: SerializedGameObject | null } | null {
        if (address.node !== undefined) return PrefabDiff._index(tree).get(address.node) ?? null;

        let node = tree;
        let parent: SerializedGameObject | null = null;
        for (const index of address.path ?? []) {
            const next = node.children[index];
            if (!next) return null;
            parent = node;
            node = next;
        }
        return { node, parent };
    }

    /** Whether `tree`'s own prefab has a node with this id (a nested prefab's interior does not count). */
    public static hasNode(tree: SerializedGameObject, id: string): boolean {
        return PrefabDiff._index(tree).has(id);
    }

    /**
     * The changes that address a node `tree` does not have.
     *
     * @remarks
     * What {@link applyChanges} skips, kept so that it can be written back and
     * tried again — Unity's "unused overrides". Overrides, added children and
     * added components are kept; a removal of a node or component that no
     * longer exists is moot and is dropped.
     *
     * @returns the unused changes, or null when everything applies.
     */
    public static unused(tree: SerializedGameObject, changes: PrefabChanges): PrefabChanges | null {
        const byId = PrefabDiff._index(tree);
        // A change through a nested instance applies when that instance is
        // there; whether the nested prefab has its node is the nested
        // instance's own question.
        const has = (id: string): boolean => byId.has(splitNested(id)?.head ?? id);
        const out: PrefabChanges = {
            overrides: changes.overrides.filter(o => o.node !== undefined && !has(o.node)),
        };
        const addedChildren = (changes.addedChildren ?? []).filter(a => !has(a.parent));
        const addedComponents = (changes.addedComponents ?? []).filter(a => !has(a.node));
        if (addedChildren.length > 0) out.addedChildren = addedChildren;
        if (addedComponents.length > 0) out.addedComponents = addedComponents;

        const empty = out.overrides.length === 0 && addedChildren.length === 0 && addedComponents.length === 0;
        return empty ? null : out;
    }

    /**
     * Why `instance` cannot be written as `tree` plus changes, or null if it can.
     *
     * @remarks
     * {@link PrefabChanges} addresses nodes by id and inserts what was added at
     * its index, so it has no way to say that one of the prefab's own nodes
     * moved: to a different parent, or to a different place among its
     * siblings. Components are the same. An instance that did one of those is
     * not representable, and is saved in full instead of being silently put
     * back in the prefab's order. A node id seen twice is refused too, since
     * neither occurrence could be told from the other.
     *
     * A prefab whose nodes have no ids reports nothing: it is compared by
     * position, where a move is indistinguishable from an edit.
     */
    public static inexpressible(tree: SerializedGameObject, instance: SerializedGameObject): string | null {
        const byId = PrefabDiff._index(tree);
        const seen = new Set<string>();
        const sameParent = (inPrefab: SerializedGameObject | null, inInstance: SerializedGameObject): boolean => {
            if (inPrefab === null) return false;
            if (inPrefab === tree || inInstance === instance) return inPrefab === tree && inInstance === instance;
            return inPrefab.id !== undefined && inPrefab.id === inInstance.id;
        };

        const walk = (
            node: SerializedGameObject,
            parent: SerializedGameObject | null,
            match: SerializedGameObject | null,
        ): string | null => {
            if (parent !== null && node.id !== undefined) {
                if (seen.has(node.id)) return `the node id "${node.id}" appears twice`;
                seen.add(node.id);

                const there = byId.get(node.id);
                if (there !== undefined && !sameParent(there.parent, parent)) {
                    return `"${node.name}" was moved to another parent`;
                }
            }

            if (match !== null) {
                const childOrder = node.children
                    .map(c => c.id === undefined ? -1 : match.children.findIndex(p => p.id === c.id))
                    .filter(at => at >= 0);
                if (!PrefabDiff._ascending(childOrder)) return `the children of "${node.name}" were reordered`;

                const counts = new Map<string, number>();
                const componentOrder = node.components
                    .map(c => {
                        const index = counts.get(c.type) ?? 0;
                        counts.set(c.type, index + 1);
                        return PrefabDiff._componentPosition(match, c.type, index);
                    })
                    .filter(at => at >= 0);
                if (!PrefabDiff._ascending(componentOrder)) return `the components of "${node.name}" were reordered`;
            }

            // A nested instance's interior is another prefab's namespace.
            if (parent !== null && node.prefab !== undefined) return null;
            for (const child of node.children) {
                const childMatch = match === null || child.id === undefined
                    ? null
                    : match.children.find(p => p.id === child.id) ?? null;
                const reason = walk(child, node, childMatch);
                if (reason !== null) return reason;
            }
            return null;
        };

        if (tree.id === undefined) return null;
        return walk(instance, null, tree);
    }

    /**
     * Gives every node in a snapshot an id, keeping the ones it has.
     *
     * @remarks
     * A node that is a nested prefab instance gets an id — it is a node of
     * this prefab — but nothing below it does: its interior belongs to its own
     * prefab, whose ids may repeat (two copies of one prefab nested side by
     * side have the same ones).
     *
     * A file from before ids is given them by position, and its references —
     * written as positions, since nothing else existed — are rewritten to
     * address the same nodes by those ids, as a prefab written now would.
     * Otherwise an untouched reference would differ from the same reference in
     * an instance, and read as an override.
     *
     * @param snapshot - the tree, modified in place.
     * @param legacy - derive ids from the node's position rather than minting
     *   them, so a file that never had ids gets the *same* ones every time it is
     *   loaded. A minted id would differ on every load, and an instance saved
     *   against the first would find nothing on the second.
     */
    public static ensureIds(snapshot: SerializedGameObject, legacy = false): SerializedGameObject {
        const upgrade = legacy && snapshot.id === undefined;
        const walk = (node: SerializedGameObject, path: number[]): void => {
            if (node.id === undefined) {
                node.id = legacy ? `~${path.join(".")}` : mintNodeId();
            }
            if (path.length > 0 && node.prefab !== undefined) return;
            node.children.forEach((child, i) => walk(child, [...path, i]));
        };
        walk(snapshot, []);
        if (upgrade) PrefabDiff._rewritePositionalRefs(snapshot);
        return snapshot;
    }

    // ── private ──────────────────────────────────────────────────────

    /** Whether any node of `root`'s own prefab below it has an id. */
    private static _hasOwnIds(root: SerializedGameObject): boolean {
        for (const entry of PrefabDiff._index(root).values()) {
            if (entry.parent !== null) return true;
        }
        return false;
    }

    /**
     * A copy of `instance` whose nodes carry the ids of the prefab nodes at
     * the same places, with its positional references rewritten to them.
     */
    private static _matchByPosition(prefab: SerializedGameObject, instance: SerializedGameObject): SerializedGameObject {
        const copy = JSON.parse(JSON.stringify(instance)) as SerializedGameObject;
        const walk = (node: SerializedGameObject, twin: SerializedGameObject): void => {
            node.children.forEach((child, i) => {
                const match = twin.children[i];
                if (match === undefined) return;
                if (match.id !== undefined) child.id = match.id;
                if (child.prefab === undefined && match.prefab === undefined) walk(child, match);
            });
        };
        walk(copy, prefab);
        PrefabDiff._rewritePositionalRefs(copy);
        return copy;
    }

    /**
     * Rewrites every unscoped reference in a prefab tree whose path is all
     * positions — in component fields, nested values and the data a
     * `MissingComponent` keeps — to address its target by node id.
     */
    private static _rewritePositionalRefs(root: SerializedGameObject): void {
        const visit = (value: unknown): void => {
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (value === null || typeof value !== "object") return;

            const obj = value as Record<string, unknown>;
            const isRef = obj["$type"] === "GameObjectRef" || obj["$type"] === "ComponentRef";
            const scoped = typeof obj["scope"] === "number" && obj["scope"] > 0;
            if (isRef && !scoped && Array.isArray(obj["path"])
                && (obj["path"] as unknown[]).every(s => typeof s === "number")) {
                const encoded = PrefabDiff._encodeJsonPath(root, obj["path"] as number[]);
                if (encoded !== null) obj["path"] = encoded;
                return;
            }
            for (const key of Object.keys(obj)) visit(obj[key]);
        };

        const walk = (node: SerializedGameObject): void => {
            for (const comp of node.components) visit(comp.fields);
            if (node !== root && node.prefab !== undefined) return;
            node.children.forEach(walk);
        };
        walk(root);
    }

    /** A positional path within one prefab tree, by node id; null if it leads nowhere. */
    private static _encodeJsonPath(root: SerializedGameObject, path: readonly number[]): Array<number | string> | null {
        if (path.length === 0 || path[0] !== 0) return null;
        const chain: SerializedGameObject[] = [root];
        for (let i = 1; i < path.length; i++) {
            const next = chain[chain.length - 1].children[path[i]];
            if (!next) return null;
            chain.push(next);
        }
        return encodeNodePath(chain, path, 0, JSON_ACCESS);
    }

    /**
     * @param foreign - whether the node lies inside a nested instance written in
     *   full, whose ids belong to another prefab. Such a node is addressed by
     *   path alone, and its shape changes cannot be recorded.
     */
    private static _compareNode(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        changes: PrefabChanges,
        foreign: boolean,
        cmp: CompareContext,
    ): void {
        const node = foreign ? undefined : prefab.id;
        const at = (rest: Omit<PrefabOverride, "path" | "node">): PrefabOverride =>
            node === undefined ? { path, ...rest } : { path, node, ...rest };

        // A nested instance whose link differs: field by field when its prefab
        // can be read.
        const linkDiffers = !PrefabDiff._equal(prefab.prefab, instance.prefab);
        const inner = linkDiffers && path.length > 0 && node !== undefined
            ? PrefabDiff._compareNested(prefab, instance, path, node, cmp)
                ?? PrefabDiff._diffLinks(prefab, instance, path, node)
            : null;
        // A nested instance kept as a link takes its active state and scale
        // from its prefab and its link, never from its shell, which only
        // caches them: an outer prefab's shell holds what the nested prefab
        // had when the outer one was saved. Its link says everything about
        // them, so the shells' are not compared.
        const fromLink = path.length > 0 && instance.prefab?.changes !== undefined;

        if (prefab.name !== instance.name) {
            changes.overrides.push(at({ component: null, componentIndex: 0, field: "name", value: instance.name }));
        }
        if (!fromLink && prefab.active !== instance.active) {
            changes.overrides.push(at({ component: null, componentIndex: 0, field: "active", value: instance.active }));
        }

        for (const key of TRANSFORM_FIELDS) {
            if (fromLink && key === "scale") continue;
            const before = (prefab.transform as any)[key];
            const after = (instance.transform as any)[key];
            if (!PrefabDiff._equal(before, after)) {
                changes.overrides.push(at({
                    component: null, componentIndex: 0,
                    field: `transform.${key}`, value: after,
                }));
            }
        }

        if (inner !== null) {
            PrefabDiff._mergeChanges(changes, inner);
        } else if (linkDiffers) {
            // Its whole link, as one value: a different prefab, or a link that
            // drops something the outer prefab's holds.
            changes.overrides.push(at({
                component: null, componentIndex: 0,
                field: "prefab", value: instance.prefab ?? null,
            }));
        }

        PrefabDiff._compareComponents(prefab, instance, at, changes, node);

        const nested = path.length > 0 && (prefab.prefab !== undefined || instance.prefab !== undefined);
        PrefabDiff._compareChildren(prefab, instance, path, changes, foreign || nested, node, cmp);
    }

    /**
     * The differences inside a nested instance, addressed through it, or null
     * when they cannot be compared tree against tree.
     *
     * @remarks
     * Both sides are expanded from the nested prefab with their own changes
     * and compared as trees; every id in the result is then prefixed with the
     * nested instance's id in the outer prefab. A prefab already being
     * compared further out is not entered again, so one that contains itself
     * cannot recurse.
     *
     * Changes the instance keeps as unused — addressed to what the nested
     * prefab no longer has — are passed on through the nesting as well, so
     * that they stay changes of one field each and apply again if the nested
     * prefab gets their objects back.
     */
    private static _compareNested(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        node: string,
        cmp: CompareContext,
    ): PrefabChanges | null {
        const a = prefab.prefab;
        const b = instance.prefab;
        if (cmp.resolve === null || !a || !b || a.guid !== b.guid || !a.changes || !b.changes) return null;
        if (cmp.chain.includes(a.guid)) return null;
        const unused = PrefabDiff._linkDelta(a.unused ?? EMPTY, b.unused ?? EMPTY);
        if (unused === null) return null;

        const base = cmp.resolve(a.guid);
        if (base === null) return null;

        const chain = [...cmp.chain, a.guid];
        const inner = PrefabDiff._compareTrees(
            PrefabDiff._applyChanges(base, a.changes, cmp.resolve, chain),
            PrefabDiff._applyChanges(base, b.changes, cmp.resolve, chain),
            { resolve: cmp.resolve, chain },
        );

        // Name, position and rotation of the nested root are its shell's, and
        // were compared there.
        const rootId = base.id;
        inner.overrides = inner.overrides.filter(o =>
            !(o.node === rootId && o.component === null
                && (o.field === "name" || o.field === "transform.position" || o.field === "transform.rotation")));
        PrefabDiff._mergeChanges(inner, unused);
        return PrefabDiff._nest(inner, path, node);
    }

    /**
     * The differences inside a nested instance read off the two links alone,
     * addressed through it — for when its prefab cannot be read to expand
     * them, such as a placeholder's link while the nested prefab is not
     * loaded.
     *
     * @remarks
     * What the instance's link holds and the outer prefab's does not. That is
     * the instance's own part only when its link holds everything the outer
     * prefab's does, an override replaced by one of the same field included,
     * which is the shape {@link applyChanges} gives a link it folds changes
     * into. Otherwise null: something the outer prefab's link does and the
     * instance's does not cannot be said as a change through the nesting.
     */
    private static _diffLinks(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        node: string,
    ): PrefabChanges | null {
        const a = prefab.prefab;
        const b = instance.prefab;
        if (!a?.changes || !b?.changes || a.guid !== b.guid) return null;
        const changes = PrefabDiff._linkDelta(a.changes, b.changes);
        const unused = PrefabDiff._linkDelta(a.unused ?? EMPTY, b.unused ?? EMPTY);
        if (changes === null || unused === null) return null;
        PrefabDiff._mergeChanges(changes, unused);
        return PrefabDiff._nest(changes, path, node);
    }

    /**
     * What `to` holds that `from` does not, or null when `from` holds
     * something `to` lacks. An override of `from` counts as held when `to`
     * has one for the same field, whatever its value.
     */
    private static _linkDelta(from: PrefabChanges, to: PrefabChanges): PrefabChanges | null {
        if (!from.overrides.every(o => to.overrides.some(e => PrefabDiff._sameField(e, o)))) return null;

        const extra = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] | null => {
            const has = (list: readonly T[] | undefined, item: T): boolean =>
                (list ?? []).some(e => PrefabDiff._equal(e, item));
            if (!(a ?? []).every(e => has(b, e))) return null;
            return (b ?? []).filter(e => !has(a, e));
        };
        const overrides = to.overrides.filter(o => !from.overrides.some(e => PrefabDiff._equal(e, o)));
        const addedChildren = extra(from.addedChildren, to.addedChildren);
        const removedChildren = extra(from.removedChildren, to.removedChildren);
        const addedComponents = extra(from.addedComponents, to.addedComponents);
        const removedComponents = extra(from.removedComponents, to.removedComponents);
        if (addedChildren === null || removedChildren === null
            || addedComponents === null || removedComponents === null) return null;

        const out: PrefabChanges = { overrides };
        if (addedChildren.length > 0) out.addedChildren = addedChildren;
        if (removedChildren.length > 0) out.removedChildren = removedChildren;
        if (addedComponents.length > 0) out.addedComponents = addedComponents;
        if (removedComponents.length > 0) out.removedComponents = removedComponents;
        return out;
    }

    /**
     * Changes made inside the nested instance `node`, at `path` in the outer
     * prefab, addressed through it; null when an override inside has no node
     * id to carry through the nesting.
     */
    private static _nest(inner: PrefabChanges, path: readonly number[], node: string): PrefabChanges | null {
        if (inner.overrides.some(o => o.node === undefined)) return null;
        const nest = (id: string): string => `${node}${NEST}${id}`;
        return {
            overrides: inner.overrides.map(o => ({ ...o, path: [...path, ...o.path], node: nest(o.node!) })),
            addedChildren: inner.addedChildren?.map(e => ({ ...e, parent: nest(e.parent) })),
            removedChildren: inner.removedChildren?.map(nest),
            addedComponents: inner.addedComponents?.map(e => ({ ...e, node: nest(e.node) })),
            removedComponents: inner.removedComponents?.map(e => ({ ...e, node: nest(e.node) })),
        };
    }

    /**
     * Folds the changes addressed through nested instances into those
     * instances' links, in the tree `byId` indexes. See {@link applyChanges}.
     *
     * @remarks
     * With the nested prefab's tree at hand, its link becomes the difference
     * between that tree and the tree the link describes with the new changes
     * applied on top: what the outer prefab added to the nested instance is
     * part of that tree, so an edit to it, or its removal, lands. Without the
     * tree, or for a prefab already being expanded further out, the changes
     * are added to the link's own.
     */
    private static _composeNested(
        byId: Map<string, { node: SerializedGameObject; parent: SerializedGameObject | null }>,
        changes: PrefabChanges,
        resolve: PrefabTreeResolver | null,
        chain: readonly string[],
    ): void {
        const layers = new Map<string, PrefabChanges>();
        const layer = (head: string): PrefabChanges => {
            let found = layers.get(head);
            if (found === undefined) layers.set(head, found = { overrides: [] });
            return found;
        };
        // An override's path runs from the outer root; inside the nested
        // instance it runs from the nested root.
        const depth = (head: string): number => {
            const at = byId.get(head);
            let levels = 0;
            for (let n = at; n?.parent; n = byId.get(n.parent.id ?? "")) levels++;
            return levels;
        };
        for (const o of changes.overrides) {
            const nested = o.node !== undefined ? splitNested(o.node) : null;
            if (nested !== null) {
                layer(nested.head).overrides.push({ ...o, path: o.path.slice(depth(nested.head)), node: nested.rest });
            }
        }
        for (const r of changes.removedComponents ?? []) {
            const nested = splitNested(r.node);
            if (nested !== null) (layer(nested.head).removedComponents ??= []).push({ ...r, node: nested.rest });
        }
        for (const id of changes.removedChildren ?? []) {
            const nested = splitNested(id);
            if (nested !== null) (layer(nested.head).removedChildren ??= []).push(nested.rest);
        }
        for (const a of changes.addedComponents ?? []) {
            const nested = splitNested(a.node);
            if (nested !== null) (layer(nested.head).addedComponents ??= []).push({ ...a, node: nested.rest });
        }
        for (const a of changes.addedChildren ?? []) {
            const nested = splitNested(a.parent);
            if (nested !== null) (layer(nested.head).addedChildren ??= []).push({ ...a, parent: nested.rest });
        }

        for (const [head, inner] of layers) {
            const link = byId.get(head)?.node.prefab;
            if (!link?.changes) continue;
            const base = resolve === null || chain.includes(link.guid) ? null : resolve(link.guid);
            if (base === null) {
                PrefabDiff._mergeInto(link.changes, inner);
                continue;
            }

            const next = [...chain, link.guid];
            const own = link.unused ? PrefabDiff._concat(link.changes, link.unused) : link.changes;
            const before = PrefabDiff._applyChanges(base, own, resolve, next);
            const after = PrefabDiff._applyChanges(before, inner, resolve, next);
            link.changes = PrefabDiff._compareTrees(base, after, { resolve, chain: next });
            const unused = PrefabDiff.unused(before, inner);
            if (unused !== null) link.unused = link.unused ? PrefabDiff._concat(link.unused, unused) : unused;
        }
    }

    /**
     * Adds changes to a nested instance's own, replacing an override the
     * changes already hold for the same field and skipping what is there.
     */
    private static _mergeInto(into: PrefabChanges, from: PrefabChanges): void {
        for (const o of from.overrides) PrefabDiff._mergeOverride(into, o);
        for (const r of from.removedComponents ?? []) {
            if (!(into.removedComponents ?? []).some(e => PrefabDiff._equal(e, r))) {
                (into.removedComponents ??= []).push(r);
            }
        }
        for (const id of from.removedChildren ?? []) {
            if (!(into.removedChildren ?? []).includes(id)) (into.removedChildren ??= []).push(id);
        }
        for (const a of from.addedComponents ?? []) {
            if (!(into.addedComponents ?? []).some(e => PrefabDiff._equal(e, a))) {
                (into.addedComponents ??= []).push(a);
            }
        }
        for (const a of from.addedChildren ?? []) {
            const already = (into.addedChildren ?? []).some(e => e.node.id !== undefined && e.node.id === a.node.id);
            if (!already) (into.addedChildren ??= []).push(a);
        }
    }

    /** Two sets of changes as one, the first's entries before the second's. */
    private static _concat(a: PrefabChanges, b: PrefabChanges): PrefabChanges {
        const out: PrefabChanges = { overrides: [...a.overrides, ...b.overrides] };
        PrefabDiff._mergeChanges(out, {
            overrides: [],
            addedChildren: [...(a.addedChildren ?? []), ...(b.addedChildren ?? [])],
            removedChildren: [...(a.removedChildren ?? []), ...(b.removedChildren ?? [])],
            addedComponents: [...(a.addedComponents ?? []), ...(b.addedComponents ?? [])],
            removedComponents: [...(a.removedComponents ?? []), ...(b.removedComponents ?? [])],
        });
        return out;
    }

    /** Appends one set of changes to another. */
    private static _mergeChanges(into: PrefabChanges, from: PrefabChanges): void {
        into.overrides.push(...from.overrides);
        if (from.addedChildren?.length) (into.addedChildren ??= []).push(...from.addedChildren);
        if (from.removedChildren?.length) (into.removedChildren ??= []).push(...from.removedChildren);
        if (from.addedComponents?.length) (into.addedComponents ??= []).push(...from.addedComponents);
        if (from.removedComponents?.length) (into.removedComponents ??= []).push(...from.removedComponents);
    }

    /**
     * Adds an override to a nested instance's changes, replacing one the
     * changes already hold for the same field.
     */
    private static _mergeOverride(into: PrefabChanges, override: PrefabOverride): void {
        const at = into.overrides.findIndex(o => PrefabDiff._sameField(o, override));
        if (at >= 0) into.overrides[at] = override;
        else into.overrides.push(override);
    }

    /** Whether two overrides address the same field of the same object. */
    private static _sameField(a: PrefabOverride, b: PrefabOverride): boolean {
        return a.node === b.node && a.component === b.component
            && a.componentIndex === b.componentIndex && a.field === b.field
            && (a.node !== undefined || PrefabDiff._equal(a.path, b.path));
    }

    private static _compareChildren(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        path: number[],
        changes: PrefabChanges,
        foreign: boolean,
        node: string | undefined,
        cmp: CompareContext,
    ): void {
        const byId = prefab.children.every(c => c.id !== undefined);

        // No ids to go by: only the subtree both sides share, by position. A
        // child present on one side alone cannot be told from a moved one.
        if (foreign || !byId || node === undefined) {
            const shared = Math.min(prefab.children.length, instance.children.length);
            for (let i = 0; i < shared; i++) {
                PrefabDiff._compareNode(prefab.children[i], instance.children[i], [...path, i], changes, foreign, cmp);
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
                if (PrefabDiff._replaces(prefab.children[at], child)) {
                    (changes.removedChildren ??= []).push(child.id!);
                    (changes.addedChildren ??= []).push({ parent: node, index, node: child });
                    return;
                }
                PrefabDiff._compareNode(prefab.children[at], child, [...path, at], changes, false, cmp);
                return;
            }

            PrefabDiff.ensureIds(child);
            (changes.addedChildren ??= []).push({ parent: node, index, node: child });
        });

        for (const child of prefab.children) {
            if (!matched.has(child.id!)) (changes.removedChildren ??= []).push(child.id!);
        }
    }

    /**
     * Whether an instance's node has to replace the prefab's outright: the
     * prefab keeps a nested instance there as a link, which holds nothing but
     * the link, and the instance has it in full — one that could not be
     * written as a link, such as a nested instance whose children were
     * reordered. No override can carry a subtree, so the prefab's node is
     * recorded as removed and the instance's, under the same id, as added.
     */
    private static _replaces(prefab: SerializedGameObject, instance: SerializedGameObject): boolean {
        return prefab.prefab?.changes !== undefined && instance.prefab?.changes === undefined;
    }

    private static _compareComponents(
        prefab: SerializedGameObject,
        instance: SerializedGameObject,
        at: (rest: Omit<PrefabOverride, "path" | "node">) => PrefabOverride,
        changes: PrefabChanges,
        node: string | undefined,
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
                if (node !== undefined) {
                    (changes.addedComponents ??= []).push({
                        node, index: position, component: comp,
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

        if (node === undefined) return;
        const had = new Map<string, number>();
        for (const comp of prefab.components) {
            const index = had.get(comp.type) ?? 0;
            had.set(comp.type, index + 1);
            if (index >= (kept.get(comp.type) ?? 0)) {
                (changes.removedComponents ??= []).push({
                    node, component: comp.type, componentIndex: index,
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

    /**
     * Every node of `root`'s own prefab by id, with its parent. A nested
     * instance's root is included — it is this prefab's node — but not its
     * interior, whose ids belong to another prefab and may repeat.
     */
    private static _index(
        root: SerializedGameObject,
    ): Map<string, { node: SerializedGameObject; parent: SerializedGameObject | null }> {
        const out = new Map<string, { node: SerializedGameObject; parent: SerializedGameObject | null }>();
        const walk = (node: SerializedGameObject, parent: SerializedGameObject | null): void => {
            if (node.id !== undefined) out.set(node.id, { node, parent });
            if (parent !== null && node.prefab !== undefined) return;
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

    /** Whether every number is larger than the one before it. */
    private static _ascending(values: readonly number[]): boolean {
        for (let i = 1; i < values.length; i++) {
            if (values[i] <= values[i - 1]) return false;
        }
        return true;
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
