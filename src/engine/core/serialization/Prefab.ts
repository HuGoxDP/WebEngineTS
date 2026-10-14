import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import type { Component } from "../Component";
import { SceneManager } from "../SceneManager";
import { AssetDatabase } from "../assets/AssetDatabase";
import {
    SceneSerializer,
    type HeldReference,
    type SerializedAsset,
    type SerializedGameObject,
} from "./SceneSerializer";
import {
    PrefabDiff,
    joinNested,
    splitNested,
    type PrefabAddedChild,
    type PrefabAddedComponent,
    type PrefabChanges,
    type PrefabOverride,
    type PrefabRemovedComponent,
    type SerializedPrefabLink,
} from "./PrefabOverride";

/**
 * A prefab as saved in a `.prefab.json` file.
 *
 * @remarks
 * A prefab with a tree of its own carries it as `snapshot`. A variant whose
 * base has an id carries the base's id and its differences from it instead,
 * so that it goes on following its base after a save. `version` is `2` when
 * the file holds something only a reader that knows prefab links can read,
 * and absent otherwise.
 */
export interface SerializedPrefab {
    name: string;
    version?: 2;
    /** The prefab's own tree. Absent for a variant saved with its base. */
    snapshot?: SerializedGameObject;
    /** The id of the prefab this one is a variant of. */
    base?: string;
    /** A variant's differences from its base. */
    changes?: PrefabChanges;
}

/** Variants being resolved right now, so a chain that loops is refused instead of recursing. */
const resolving = new Set<Prefab>();

/**
 * Where an object a reference holds sits in a subtree that a revert is about
 * to build again, so that the reference can be pointed at its replacement.
 */
interface HeldTarget {
    /**
     * From the subtree's root down to the object, by node ids. Empty for the
     * root itself; null when an object on the way has no id — one the
     * instance added and nothing named — which nothing built again can be.
     */
    readonly path: ReadonlyArray<string> | null;
    /**
     * The component held, by registered type and which of that type on its
     * object — `-1` when that can no longer be told — with how many of that
     * type the object had; or null for the object itself. By type and
     * occurrence until components have ids of their own: an object that had
     * fewer of the type than the one built again lost some, and which ones
     * cannot be told.
     */
    readonly component: { readonly type: string; readonly index: number; readonly count: number } | null;
}

/** Why a recorded reference found nothing in the subtree built again. */
type HeldLoss = "gone" | "ambiguous";

/**
 * A reusable GameObject template — save once, instantiate many times.
 *
 * @remarks
 * Equivalent to Unity's Prefab asset. A Prefab stores the serialized
 * form of a GameObject (plus all its children and component values).
 * Each call to {@link instantiate} produces an independent copy that
 * remembers the prefab it came from ({@link GameObject.isPrefabInstance}).
 *
 * Every node of a prefab has an id ({@link GameObject.prefabNodeId}), so an
 * instance is compared with its prefab node by node, and a scene can save an
 * instance as the prefab plus its changes. A prefab inside a prefab is kept
 * as a link to its own prefab, so it follows that prefab's edits.
 *
 * Typical workflow:
 * ```ts
 * // 1. Author-time: create a GameObject in the scene, then snapshot it.
 * const player = scene.createGameObject("Player");
 * player.addComponent(PlayerController);
 * const prefab = Prefab.fromGameObject(player);
 *
 * // 2. Runtime: instantiate many copies.
 * for (let i = 0; i < 10; i++) {
 *     const enemy = prefab.instantiate();
 *     enemy.transform.position = new Vector3(i * 2, 0, 0);
 * }
 *
 * // 3. Persist: save as JSON, load in another session.
 * const json = prefab.toJSON();
 * const restored = Prefab.fromJSON(json);
 * ```
 */
export class Prefab {

    /** Display name for the prefab asset. */
    public name: string;

    /**
     * @internal
     * This prefab's own serialized tree, or null when it is a variant — a
     * variant has no tree of its own, only differences from its base.
     */
    private _snapshot: SerializedGameObject | null;

    /** @internal The prefab this one varies from, when it was given as an object. */
    private readonly _base: Prefab | null;

    /**
     * @internal The id of the prefab this one varies from, when it was read
     * from a file: the base is found through `AssetDatabase` when needed.
     */
    private readonly _baseGuid: string | null;

    /** @internal Differences from the base. Empty unless this is a variant. */
    private _changes: PrefabChanges;

    /**
     * @internal
     * @param base - the base, as a prefab or as its id.
     * @param changes - the differences from it: values alone, or values and shape.
     */
    constructor(
        snapshot: SerializedGameObject | null,
        name?: string,
        base: Prefab | string | null = null,
        changes: readonly PrefabOverride[] | PrefabChanges = [],
    ) {
        this._snapshot = snapshot;
        SceneSerializer._claimPrefabAssets(snapshot, this);
        this._base = base instanceof Prefab ? base : null;
        this._baseGuid = typeof base === "string" ? base : null;
        this._changes = Prefab._toChanges(changes);
        this.name = name ?? snapshot?.name ?? this._base?.name ?? "Prefab";
    }

    /** Values alone become changes with no shape; changes are copied. */
    private static _toChanges(changes: readonly PrefabOverride[] | PrefabChanges): PrefabChanges {
        if (Array.isArray(changes)) return { overrides: [...changes] };
        return JSON.parse(JSON.stringify(changes)) as PrefabChanges;
    }

    /**
     * A prefab defined as differences from another.
     *
     * @remarks
     * Equivalent to Unity's Prefab Variant. The variant holds no tree of its
     * own: it resolves its base every time it is asked, so an edit to the base
     * reaches the variant and everything instantiated from it. That is the
     * whole reason to prefer a variant over a copy.
     *
     * Variants of variants work — the resolution is recursive.
     *
     * A variant can change the shape too — add and remove children and
     * components — when given `PrefabChanges` rather than values alone.
     *
     * ```ts
     * const eliteOverrides = base.getOverrides(tweakedInstance);
     * const elite = Prefab.createVariant(base, eliteOverrides, "Elite Enemy");
     * ```
     *
     * @param base - the prefab to vary from.
     * @param changes - differences, usually from {@link getOverrides}, or
     *   values and shape from {@link getChanges}. {@link applyInstance} on a
     *   variant records an instance's changes the same way.
     * @param name - display name. Defaults to the base's.
     */
    public static createVariant(
        base: Prefab,
        changes: readonly PrefabOverride[] | PrefabChanges,
        name?: string,
    ): Prefab {
        return new Prefab(null, name ?? base.name, base, changes);
    }

    /** Whether this prefab is defined as differences from another. */
    public get isVariant(): boolean { return this._base !== null || this._baseGuid !== null; }

    /**
     * The prefab this one varies from, or null.
     *
     * @remarks
     * For a variant read from a file, the base loaded under its id — null
     * until it is loaded. Loading the variant through `Resources` loads it.
     */
    public get base(): Prefab | null {
        const guid = this._baseGuid ?? AssetDatabase.guidOf(this._base);
        const current = guid !== null ? AssetDatabase.get(guid) : null;
        return current instanceof Prefab ? current : this._base;
    }

    /** This variant's value differences from its {@link base}. Empty otherwise. */
    public get variantOverrides(): readonly PrefabOverride[] {
        return this._changes.overrides;
    }

    /**
     * This variant's differences from its {@link base}, values and shape.
     * Empty otherwise.
     */
    public get variantChanges(): Readonly<PrefabChanges> {
        return this._changes;
    }

    /**
     * @internal
     * The tree this prefab describes, resolving a variant against its base.
     *
     * @remarks
     * Recomputed on each call rather than cached, which is what makes an edit
     * to a base show up in its variants. A prefab tree is small next to the
     * scene it populates, and this runs when instantiating, not per frame.
     *
     * Public only so that the serializer can rebuild an instance from it
     * without importing this class (`PrefabSource`).
     *
     * **NEVER use in user-facing code.**
     *
     * @throws for a variant whose base is not loaded, naming the base, and for
     *   a variant that is, through its bases, a variant of itself.
     */
    public _resolvedTree(): SerializedGameObject {
        if (this._snapshot !== null) return this._snapshot;

        const base = this.base;
        if (base === null) {
            const guid = this._baseGuid;
            if (guid === null) throw new Error("[Prefab] A prefab must have either a snapshot or a base");
            const where = AssetDatabase.pathOf(guid);
            throw new Error(
                `[Prefab] "${this.name}" is a variant of prefab ${guid}` +
                `${where !== null ? ` ("${where}")` : ""}, which is not loaded. Load it first — ` +
                `loading the variant through Resources does.`,
            );
        }
        if (resolving.has(this)) {
            throw new Error(`[Prefab] "${this.name}" is, through its bases, a variant of itself.`);
        }
        resolving.add(this);
        try {
            return PrefabDiff.applyChanges(base._resolvedTree(), this._changes, SceneSerializer._prefabTree);
        } finally {
            resolving.delete(this);
        }
    }

    /**
     * Captures a live GameObject (and its children) as a Prefab.
     *
     * @remarks
     * Every node gets an id. A prefab instance inside `go` is kept as a link
     * to its own prefab rather than copied, so it goes on following that
     * prefab. `go` itself is a new thing — not an instance of whatever it was —
     * and is written in full.
     *
     * `go` is not modified, unless `options.connect`: then it becomes an
     * instance of the new prefab, its objects the prefab's nodes — Unity's
     * "Save As Prefab Asset And Connect", which is what dragging an object
     * into the Project window does.
     */
    public static fromGameObject(go: GameObject, name?: string, options: { connect?: boolean } = {}): Prefab {
        const connect = options.connect === true;
        const snapshot = PrefabDiff.ensureIds(SceneSerializer._serializeForPrefab(go, { mintLive: connect }));
        const prefab = new Prefab(snapshot, name ?? go.name);
        if (connect) {
            go._prefabInfo = { source: prefab, guid: AssetDatabase.guidOf(prefab), raw: null, unused: null };
        }
        return prefab;
    }

    /**
     * Reconstructs a Prefab from its JSON form.
     *
     * @remarks
     * A file written before prefab nodes had ids gets ids derived from each
     * node's position (`~`, `~0`, `~1.0`, ...), so the same file gets the same
     * ids every time it is loaded and an instance saved against one load still
     * matches the next.
     *
     * A variant saved with its base is read as a variant of that base, found
     * through `AssetDatabase` when it is first needed.
     *
     * @throws `UnsupportedFormatError` if the file is of a format version
     *   this build cannot read.
     * @throws if the file has neither a tree nor a base.
     */
    public static fromJSON(json: {
        name?: string;
        version?: number;
        snapshot?: SerializedGameObject;
        base?: string;
        changes?: PrefabChanges;
    }): Prefab {
        SceneSerializer._refuseUnknownVersion(json, "prefab");
        if (typeof json.base === "string") {
            return new Prefab(null, json.name, json.base, json.changes ?? { overrides: [] });
        }
        if (json.snapshot === undefined) {
            throw new Error(`[Prefab] "${json.name ?? "?"}" has neither a tree nor a base.`);
        }
        const snapshot = JSON.parse(JSON.stringify(json.snapshot)) as SerializedGameObject;
        return new Prefab(PrefabDiff.ensureIds(snapshot, true), json.name);
    }

    /**
     * Creates a fresh instance of this prefab in the given scene (defaults to
     * the active scene). The returned GameObject is a root object of the
     * scene, and an instance of this prefab.
     */
    public instantiate(scene?: Scene): GameObject {
        const target = scene ?? SceneManager.activeScene;
        return this._stamp(SceneSerializer._instantiatePrefab(this._resolvedTree(), target, AssetDatabase.guidOf(this)));
    }

    /**
     * What `instance` has that this prefab does not.
     *
     * @remarks
     * Equivalent to Unity's per-instance overrides. An instance is not a copy
     * of the prefab, it is the prefab plus a list of differences — which is
     * what lets an edit to the prefab reach every instance while each keeps its
     * own position, name or colour.
     *
     * Only values are reported here: a child or component added to or removed
     * from an instance is a different *shape*, not a different value, and
     * Unity lists it separately. {@link getChanges} has both.
     *
     * The instance is read in the shape a prefab is stored in — its root in
     * full, a prefab nested inside it as a link — so an untouched instance has
     * no overrides, nested instances included.
     *
     * An object whose nodes have no ids — a copy made before they existed, or
     * the object this prefab was made from without `connect` — is compared
     * node for node by position, as every object was before ids.
     *
     * An instance of this prefab nested inside another instance is compared
     * with this prefab as the prefabs around it change it, so what the outer
     * prefab sets on it is not listed — only what differs from that.
     *
     * @param instance - a live GameObject, usually one {@link instantiate} made.
     * @returns the differences, in tree order. Empty when it matches.
     */
    public getOverrides(instance: GameObject): PrefabOverride[] {
        const tree = this._start(instance).tree;
        return PrefabDiff.compare(
            tree, SceneSerializer._serializeForPrefab(instance, { match: tree, outward: true }),
            SceneSerializer._prefabTree,
        );
    }

    /**
     * Creates an instance and applies `overrides` to it.
     *
     * @remarks
     * The counterpart of {@link getOverrides}: an instance is rebuilt from
     * `prefab + differences` rather than from a stored copy, so a change to the
     * prefab shows up in everything rebuilt from it.
     *
     * @param overrides - differences to apply, from {@link getOverrides}.
     * @param scene - scene to create it in. Defaults to the active one.
     */
    public instantiateWithOverrides(
        overrides: readonly PrefabOverride[],
        scene?: Scene,
    ): GameObject {
        const target = scene ?? SceneManager.activeScene;
        return this._stamp(SceneSerializer._instantiatePrefab(
            PrefabDiff.apply(this._resolvedTree(), overrides, SceneSerializer._prefabTree),
            target,
            AssetDatabase.guidOf(this),
        ));
    }

    /**
     * Resets an instance to this prefab, discarding its own values.
     *
     * @remarks
     * Equivalent to Unity's "Revert All". Implemented as destroy-and-recreate
     * rather than field-by-field assignment: a partial revert would leave any
     * component the prefab does not have still attached, which is not what
     * reverting means. The old instance is destroyed at once, so a save made
     * straight after writes the fresh one alone.
     *
     * The fresh instance takes the old one's place: the same scene, parent and
     * sibling index, and — when it is nested inside another instance — the
     * same node id there, so the instance around it does not read the revert
     * as one object removed and another added. It also keeps the old one's
     * name, position and rotation, which an instance never takes from its
     * prefab (Unity's default overrides, which Revert All leaves alone too).
     *
     * An instance of this prefab nested inside another instance is reverted
     * to what the prefabs around it make of it: what the outer prefab sets on
     * it stays, name, position and rotation included, and only what the scene
     * changed goes. References between it and the instance around it are
     * rebuilt as the outer prefab has them.
     *
     * A reference from elsewhere in the scene to the instance or to anything
     * in it — from another instance, the instance around it, or a plain scene
     * object — goes on pointing at the object that takes its place, as in
     * Unity, whose revert keeps identity: each is recorded before the
     * instance is destroyed, by its node ids from the instance root (a
     * component by type and which of that type), and found again in the
     * fresh instance. One whose object the revert takes away — something the
     * instance added — is left empty, with a warning naming every holder and
     * field. So is one that held a component on an object that had fewer of
     * its type than the prefab gives it: which of them it held cannot be told
     * until components have ids of their own.
     *
     * @param instance - the instance to replace.
     * @returns the fresh instance, in the same scene, parent and position.
     */
    public revert(instance: GameObject): GameObject {
        const around = this._start(instance).around;
        const holder = instance.transform.parent?.gameObject ?? null;
        // Before anything is destroyed: what points into the instance.
        const held = Prefab._heldInto(instance);
        if (around !== null && holder !== null) {
            const index = instance.transform.getSiblingIndex();
            instance.destroyImmediate();
            const rebuilt = SceneSerializer._restoreChild(
                around.scopes, around.node, holder, index, around.tree.assets, around.chain,
            );
            Prefab._pointBack(held, rebuilt);
            Prefab._reconnect(rebuilt);
            return rebuilt;
        }

        const scene = instance.scene;
        const parent = instance.transform.parent;
        const index = instance.transform.getSiblingIndex();
        const nodeId = instance._prefabNodeId;
        const name = instance.name;
        const position = instance.transform.localPosition.clone();
        const rotation = instance.transform.localRotation.clone();
        instance.destroyImmediate();

        const fresh = this.instantiate(scene);
        fresh.transform.setParent(parent, false);
        fresh.transform.setSiblingIndex(index);
        fresh._prefabNodeId = nodeId;
        fresh.name = name;
        fresh.transform.localPosition = position;
        fresh.transform.localRotation = rotation;
        Prefab._pointBack(held, fresh);
        return fresh;
    }

    // ==================== EDITING INSTANCES ====================

    /**
     * Everything `instance` has that this prefab does not: values and shape,
     * as a scene saving it as a link records them.
     *
     * @remarks
     * Equivalent to what Unity's Overrides dropdown lists. Changes are
     * addressed by node id, and {@link GameObject.prefabNodeId} maps an id to
     * the live object — what an editor needs for bold fields and for marking
     * added objects. An object added to the instance is given its id here if
     * it has none, so that it maps too.
     *
     * The root's name, position and rotation are not listed: they are the
     * instance's own and never follow the prefab (Unity's default overrides).
     * {@link getOverrides} lists every value, those included.
     *
     * An object whose nodes have no ids is compared by position, as
     * {@link getOverrides} says, and its objects are given the ids of the
     * prefab nodes they were matched with.
     *
     * An instance of this prefab nested inside another instance is compared
     * with this prefab as the prefabs around it change it: what the outer
     * prefab sets on it is not a change, and the root's name, position and
     * rotation are listed like any other value, since a nested root takes
     * them from the prefab around it.
     */
    public getChanges(instance: GameObject): PrefabChanges {
        const start = this._start(instance);
        const tree = start.tree;
        const changes = PrefabDiff.compareChanges(
            tree, SceneSerializer._serializeForPrefab(instance, { mintLive: true, match: tree, outward: true }),
            SceneSerializer._prefabTree,
        );
        if (start.around === null) {
            changes.overrides = changes.overrides.filter(o => !Prefab._isDefaultOverride(o, tree));
        }
        return changes;
    }

    /**
     * Writes `instance` into this prefab: its tree, or — for a variant — its
     * differences from its base.
     *
     * @remarks
     * Equivalent to Unity's Overrides → Apply All. The instance's root keeps
     * its own name, position and rotation, which are not applied. Objects
     * added to the instance become the prefab's own, under the ids they have.
     *
     * Other instances are live objects built from the prefab as it was, and
     * are not changed here. They follow once rebuilt from a link: reload a
     * scene that was saved with `{ prefabs: "link" }` before the apply. Saving
     * them as links *after* the apply without reloading would record their old
     * state as their own changes.
     *
     * An instance of this prefab nested inside another instance applies only
     * what the scene changed on it ({@link getChanges}) — Unity's "Apply to
     * Prefab" on a nested instance. What the prefabs around it set on it stays
     * theirs, and so does a change to an object only they add.
     *
     * A reference to an object outside the instance has nothing to point at
     * in a prefab, and is never applied — the same rule whether the instance
     * is nested or not, and whether the prefab is a variant: a changed value
     * that points out leaves the prefab's own value (inside a nested
     * instance, the prefab's own override there, or else the nested prefab's
     * value), and one held by a child or component the instance added is
     * applied as null.
     *
     * @throws if `instance` is not an instance of this prefab, or if it holds
     *   an instance of this prefab, directly or through the prefabs inside it:
     *   applying it would make a prefab that contains itself.
     */
    public applyInstance(instance: GameObject): void {
        this._requireInstance(instance);
        const start = this._start(instance);
        const tree = start.tree;
        // References out of the instance are written as such, so that the
        // rule below can tell a changed value from an added one.
        const snapshot = SceneSerializer._serializeForPrefab(instance, { mintLive: true, match: tree, outward: true });

        const guid = AssetDatabase.guidOf(this);
        if (guid !== null && Prefab._holdsPrefab(snapshot, guid, new Set())) {
            throw new Error(
                `[Prefab] "${instance.name}" holds an instance of "${this.name}" itself, directly or ` +
                `through the prefabs inside it. Applying it would make a prefab that contains itself.`,
            );
        }

        const next = start.around === null
            ? Prefab._keepOwnValues(Prefab._asRoot(snapshot, tree), tree)
            : this._withChanges(PrefabDiff.compareChanges(tree, snapshot, SceneSerializer._prefabTree), snapshot);
        // Whatever the path, nothing in a prefab may count out of it.
        Prefab._keepInside(next, 0, "node");

        if (this._snapshot === null) {
            this._changes = PrefabDiff.compareChanges(this.base!._resolvedTree(), next, SceneSerializer._prefabTree);
        } else {
            this._snapshot = next;
            SceneSerializer._claimPrefabAssets(next, this);
        }
    }

    /**
     * An instance's snapshot made into this prefab's tree: the prefab root
     * keeps its own id, name, position and rotation.
     */
    private static _asRoot(snapshot: SerializedGameObject, tree: SerializedGameObject): SerializedGameObject {
        if (tree.id !== undefined) snapshot.id = tree.id;
        snapshot.name = tree.name;
        snapshot.transform.position = { ...tree.transform.position };
        snapshot.transform.rotation = { ...tree.transform.rotation };
        return PrefabDiff.ensureIds(snapshot);
    }

    /**
     * This prefab's own tree with a nested instance's changes applied: all but
     * the root's name, position and rotation and any reference that leaves the
     * instance, carrying the inline assets they use from the instance's table.
     */
    private _withChanges(changes: PrefabChanges, snapshot: SerializedGameObject): SerializedGameObject {
        const own = this._resolvedTree();
        changes.overrides = changes.overrides.filter(o => !Prefab._isDefaultOverride(o, own));
        Prefab._keepInside(changes, 0, "changes");
        const next = PrefabDiff.applyChanges(own, changes, SceneSerializer._prefabTree);

        const known = new Set((next.assets ?? []).map(entry => entry.guid));
        const used = Prefab._assetGuids(changes, snapshot.assets ?? []);
        const carried = (snapshot.assets ?? []).filter(entry => used.has(entry.guid) && !known.has(entry.guid));
        if (carried.length > 0) next.assets = [...(next.assets ?? []), ...carried];
        return PrefabDiff.ensureIds(next);
    }

    /**
     * Puts back into `node` — an instance's snapshot about to become this
     * prefab's tree, `own` being the tree it replaces — the prefab's own value
     * of every field the instance changed to point out of itself, which is
     * what dropping the change does for a nested instance in
     * {@link _withChanges}: a prefab has nothing out there to point at. Inside
     * a nested link the change is an override, which goes back to the
     * prefab's own override there, or is dropped when the prefab has none.
     * What the instance added has no value of the prefab's, and is left for
     * {@link _keepInside} to make null. Objects and components are matched as
     * a comparison matches them: by node id, then by type and occurrence.
     */
    private static _keepOwnValues(node: SerializedGameObject, own: SerializedGameObject): SerializedGameObject {
        const seen = new Map<string, number>();
        for (const component of node.components) {
            const index = seen.get(component.type) ?? 0;
            seen.set(component.type, index + 1);
            const mine = own.components.filter(c => c.type === component.type)[index];
            if (mine === undefined) continue;
            for (const field of Object.keys(component.fields)) {
                if (field in mine.fields && Prefab._pointsOut(component.fields[field], 0)) {
                    component.fields[field] = JSON.parse(JSON.stringify(mine.fields[field])) as unknown;
                }
            }
        }
        for (const child of node.children) {
            const mine = child.id === undefined ? undefined : own.children.find(c => c.id === child.id);
            if (mine !== undefined) Prefab._keepOwnValues(child, mine);
        }

        const link = node.prefab?.changes;
        if (link !== undefined && own.prefab?.guid === node.prefab!.guid) {
            const theirs = own.prefab.changes?.overrides ?? [];
            link.overrides = link.overrides.filter(o => {
                if (o.field === "prefab" || !Prefab._pointsOut(o.value, 1 + Prefab._addressDepth(o.node))) return true;
                const kept = theirs.find(t => t.node === o.node && t.component === o.component
                    && t.componentIndex === o.componentIndex && t.field === o.field
                    && (o.node !== undefined || JSON.stringify(t.path) === JSON.stringify(o.path)));
                if (kept === undefined) return false;
                o.value = JSON.parse(JSON.stringify(kept.value)) as unknown;
                return true;
            });
        }
        return node;
    }

    /** Whether a saved value is, or holds, a reference that counts out further than `depth` links. */
    private static _pointsOut(value: unknown, depth: number): boolean {
        if (value === null || typeof value !== "object") return false;
        if (Prefab._isOutward(value, depth)) return true;
        return Object.values(value as Record<string, unknown>).some(v => Prefab._pointsOut(v, depth));
    }

    /** How many nested instances an address passes through (`"outer/inner"` is one). */
    private static _addressDepth(address: string | undefined): number {
        let depth = 0;
        for (let rest = address ?? ""; ; depth++) {
            const nested = splitNested(rest);
            if (nested === null) return depth;
            rest = nested.rest;
        }
    }

    /**
     * Takes out of saved data, in place, every reference that leaves the
     * instance it is being applied from — a prefab has nothing for it to
     * point at — and says whether there was one.
     *
     * @remarks
     * A changed value that points out is dropped, so the prefab keeps its own
     * value; that holds for a change inside a nested link as well. A
     * reference on something the instance added — a child, a component, or
     * anything inside them — has no value of the prefab's to fall back on,
     * and is made null.
     *
     * A reference's `scope` counts link contexts out from where it is
     * written, so one sitting `depth` links below the instance leaves it when
     * its scope is above `depth`. A node's components and children are at its
     * own depth; the changes of a link it carries are one deeper, and inside
     * those changes an address through nested instances (`"outer/inner"`)
     * deepens what it addresses by one per level.
     *
     * @param kind - what `data` is: a field value, a node, a link, or changes.
     */
    private static _keepInside(
        data: unknown,
        depth: number,
        kind: "value" | "node" | "link" | "changes",
    ): boolean {
        if (data === null || typeof data !== "object") return false;
        let left = false;

        if (kind === "node") {
            const node = data as SerializedGameObject;
            for (const component of node.components ?? []) {
                if (Prefab._keepInside(component.fields, depth, "value")) left = true;
            }
            for (const child of node.children ?? []) {
                if (Prefab._keepInside(child, depth, "node")) left = true;
            }
            if (node.prefab !== undefined && Prefab._keepInside(node.prefab, depth, "link")) left = true;
            return left;
        }

        if (kind === "link") {
            const link = data as SerializedPrefabLink;
            if (Prefab._keepInside(link.changes, depth + 1, "changes")) left = true;
            if (Prefab._keepInside(link.unused, depth + 1, "changes")) left = true;
            return left;
        }

        if (kind === "changes") {
            const changes = data as PrefabChanges;
            changes.overrides = (changes.overrides ?? []).filter(o => {
                const at = depth + Prefab._addressDepth(o.node);
                if (o.component === null && o.field === "prefab") {
                    if (Prefab._keepInside(o.value, at, "link")) left = true;
                    return true;
                }
                if (!Prefab._keepInside(o.value, at, "value")) return true;
                left = true;
                return false;
            });
            for (const a of changes.addedChildren ?? []) {
                if (Prefab._keepInside(a.node, depth + Prefab._addressDepth(a.parent), "node")) left = true;
            }
            for (const a of changes.addedComponents ?? []) {
                const at = depth + Prefab._addressDepth(a.node);
                if (Prefab._keepInside(a.component.fields, at, "value")) left = true;
            }
            return left;
        }

        if (Prefab._isOutward(data, depth)) return true;
        const holder = data as Record<string, unknown>;
        for (const key of Object.keys(holder)) {
            const value = holder[key];
            if (Prefab._isOutward(value, depth)) {
                holder[key] = null;
                left = true;
            } else if (Prefab._keepInside(value, depth, "value")) {
                left = true;
            }
        }
        return left;
    }

    /** Whether a saved value is a reference that counts out further than `depth` links. */
    private static _isOutward(value: unknown, depth: number): boolean {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
        const obj = value as Record<string, unknown>;
        if (obj["$type"] !== "GameObjectRef" && obj["$type"] !== "ComponentRef") return false;
        const scope = obj["scope"];
        return typeof scope === "number" && scope > depth;
    }

    /**
     * The ids of the entries of `table` that `changes` refer to, directly or
     * through another entry.
     */
    private static _assetGuids(changes: PrefabChanges, table: readonly SerializedAsset[]): Set<string> {
        const byGuid = new Map(table.map(entry => [entry.guid, entry]));
        const used = new Set<string>();
        const visit = (value: unknown): void => {
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (value === null || typeof value !== "object") return;
            const obj = value as Record<string, unknown>;
            const entry = obj["$type"] === "AssetRef" && typeof obj["guid"] === "string"
                ? byGuid.get(obj["guid"])
                : undefined;
            if (entry !== undefined && !used.has(entry.guid)) {
                used.add(entry.guid);
                visit(entry.fields);
            }
            for (const key of Object.keys(obj)) visit(obj[key]);
        };
        visit(changes);
        return used;
    }

    /**
     * Undoes one of `instance`'s changes, from {@link getChanges} or
     * {@link getOverrides}.
     *
     * @remarks
     * Equivalent to reverting a single entry in Unity's Overrides dropdown.
     * Done in place: a value is written back onto the object that holds it, an
     * added child or component is removed, a removed one is built again from
     * the prefab where it was. The objects not concerned keep their identity,
     * and references to them from elsewhere stay valid. A reference anywhere
     * in the scene that still holds a removed object, or something below it,
     * points at what is built in its place — found by node ids from the
     * removed child. A component of a removed child is found again when it is
     * the only one of its type on its object, and a removed component when it
     * is the only one of its type removed there and the only one the
     * references hold; otherwise the reference is left empty, with a warning.
     * Until components have ids of their own, a component the scene added and
     * removed again cannot be told from the prefab's: a reference that held
     * only it is pointed at the one built again. A reference inside the
     * instance that the prefabs aim at what is built again, and that still
     * holds a destroyed object, points at it too. A field set to `null` is
     * left alone — it may be the scene's own change — so a reference to a
     * removed object that was saved and loaded again in between, which the
     * save wrote as `null`, stays null.
     *
     * A nested instance held in full where the prefab keeps a link — one
     * whose children were reordered — is reported as that child removed and
     * added again under the same id. The two are one change: reverting either
     * takes the full copy away and builds the nested instance once, from its
     * prefab, at the prefab's place, and references into the copy follow it.
     *
     * On an instance of this prefab nested inside another instance, a change
     * goes back to what the prefabs around it set, as {@link getChanges}
     * compares it.
     *
     * @param change - an override, an added child or component, a removed
     *   component, or the id of a removed child.
     * @throws if `instance` is not an instance of this prefab.
     */
    public revertOverride(
        instance: GameObject,
        change: PrefabOverride | PrefabAddedChild | PrefabAddedComponent | PrefabRemovedComponent | string,
    ): void {
        this._requireInstance(instance);

        // A change addressed through nested instances is reverted inside the
        // innermost one, against that instance's tree as this prefab has it.
        const address = typeof change === "string" ? change
            : "field" in change ? change.node
            : "parent" in change ? change.parent
            : change.node;
        const at = this._descend(instance, address);
        if (at === null) return;
        const { live: root, tree, scopes, chain } = at;
        const assets = tree.assets;

        if (typeof change === "string") {
            const found = PrefabDiff.nodeOf(tree, { node: at.id! });
            if (found === null || found.parent === null) return;
            const parent = this._liveNode(root, tree, { node: found.parent.id, path: [] });
            if (parent === null) return;
            Prefab._restoreRemoved(parent, { node: found.node, parent: found.parent }, scopes, assets, chain);
            return;
        }

        if ("field" in change) {
            this._revertValue(root, tree, { ...change, node: at.id ?? undefined }, scopes, chain);
            return;
        }

        if ("parent" in change) {
            const parent = this._liveNode(root, tree, { node: at.id!, path: [] });
            const id = change.node.id;
            const added = parent === null || id === undefined ? null : Prefab._childWithId(parent, id);
            if (added === null) return;
            // The added half of a nested instance saved in full in place of the
            // prefab's own: the pair is one change, undone by building the
            // nested instance again.
            const replaced = PrefabDiff.nodeOf(tree, { node: id! });
            if (replaced !== null && replaced.parent !== null && replaced.parent.id === at.id) {
                Prefab._restoreRemoved(parent!, { node: replaced.node, parent: replaced.parent }, scopes, assets, chain);
                return;
            }
            added.destroyImmediate();
            return;
        }

        const live = this._liveNode(root, tree, { node: at.id!, path: [] });
        if (live === null) return;

        if ("index" in change) {
            // The one at the position it was added at; failing that, the last
            // of its type, since an added one comes after the prefab's own.
            const type = change.component.type;
            const components = Prefab._componentsOf(live);
            const atIndex = components[change.index];
            const target = atIndex !== undefined && SceneSerializer._componentTypeName(atIndex) === type
                ? atIndex
                : components.filter(c => SceneSerializer._componentTypeName(c) === type).pop();
            if (target !== undefined) live.removeComponent(target as never);
            return;
        }

        const node = PrefabDiff.nodeOf(tree, { node: at.id! });
        if (node === null) return;
        let seen = 0;
        const position = node.node.components.findIndex(c => c.type === change.component && seen++ === change.componentIndex);
        if (position < 0) return;
        // What still holds a removed component of this type on this object: it
        // is the one built again only when it is the only one removed, and the
        // only one of its type held — two cannot both be the prefab's.
        const removed = node.node.components.filter(c => c.type === change.component).length
            - Prefab._componentsOf(live).filter(c => SceneSerializer._componentTypeName(c) === change.component).length;
        const held = SceneSerializer._heldReferences<Component>(live.scene.getRootGameObjects(), (go, component) =>
            component !== null && go === live && !component.exists()
                && SceneSerializer._componentTypeName(component) === change.component ? component : null,
        () => false);
        const restored = SceneSerializer._restoreComponent(scopes, node.node.components[position], live, position, assets);
        if (restored === null) return;
        const distinct = new Set(held.map(h => h.target)).size;
        if (removed === 1 && distinct === 1) {
            for (const h of held) h.assign(restored);
        } else if (held.length > 0) {
            for (const h of held) h.assign(null);
            Prefab._warnLost(`Bringing back a ${change.component} on "${live.name}"`, held.map(h => h.where),
                removed === 1
                    ? `they held ${distinct} different ones of that type, and which was the prefab's cannot be told`
                    : `${removed} of that type were removed, and which one each held cannot be told`);
        }
        Prefab._reconnect(restored);
    }

    /**
     * Builds again, under `parent`, a child of the prefab's that the instance
     * does not have as the prefab has it, at the prefab's place among the
     * children, and points the references that held what it replaces at it.
     *
     * @remarks
     * Either the child was removed, or it is a nested instance the scene
     * holds in full — one whose children were reordered, which a link cannot
     * say — and `getChanges` reports that as the child removed and added again
     * under the same id. The two halves are one change: reverting either
     * takes the copy away and builds the nested instance once, from its
     * prefab, so no two live objects carry one id. References into the copy
     * follow it, by node ids, like those into a reverted instance.
     */
    private static _restoreRemoved(
        parent: GameObject,
        found: { node: SerializedGameObject; parent: SerializedGameObject },
        scopes: readonly GameObject[],
        assets: SerializedAsset[] | undefined,
        chain: string[],
    ): void {
        const id = found.node.id!;
        const copy = Prefab._childWithId(parent, id);
        const held = [...(copy === null ? [] : Prefab._heldInto(copy)), ...Prefab._heldIntoRemoved(parent, id)];
        copy?.destroyImmediate();
        const index = Prefab._liveIndex(parent, found.parent, found.parent.children.indexOf(found.node));
        const restored = SceneSerializer._restoreChild(scopes, found.node, parent, index, assets, chain);
        Prefab._pointBack(held, restored);
        Prefab._reconnect(restored);
    }

    /**
     * Follows a change's address into the nested instances it passes through.
     *
     * @returns the innermost live instance root, its tree as this prefab
     *   defines it (the nested prefab with the outer prefab's changes to it),
     *   the id left once the nesting is stripped, the instance roots a
     *   reference may count from, and the prefab chain for a cycle check. Null
     *   when a level is missing or its prefab is not loaded.
     */
    private _descend(instance: GameObject, address: string | undefined): {
        live: GameObject;
        tree: SerializedGameObject;
        id: string | null;
        scopes: GameObject[];
        chain: string[];
    } | null {
        const start = this._start(instance);
        let live = instance;
        let tree = start.tree;
        const scopes = start.scopes;
        const chain = start.chain;
        let rest = address ?? null;

        for (let nested = rest === null ? null : splitNested(rest); nested !== null;
            nested = splitNested(rest!)) {
            const node = PrefabDiff.nodeOf(tree, { node: nested.head })?.node;
            const composed = node === undefined ? null : SceneSerializer._linkTree(node);
            const inner = SceneSerializer._findLiveNode(live, nested.head);
            if (composed === null || inner === null) return null;

            tree = composed;
            live = inner;
            scopes.push(inner);
            chain.push(node!.prefab!.guid);
            rest = nested.rest;
        }
        return { live, tree, id: rest, scopes, chain };
    }

    /**
     * What `instance` is compared with, applied against and reverted to: the
     * tree it stands for, the instance roots a reference rebuilt inside it may
     * count from, and the prefab chain a rebuilt link is checked against.
     *
     * @remarks
     * An instance on its own stands for this prefab. A prefab nested inside
     * another instance stands for its node there: this prefab with the changes
     * the prefabs around it make to it, as loading builds it. That is Unity's
     * view of a nested instance — its overrides are what the scene changed,
     * not what the outer prefab did. `around` is then the level that holds
     * it, with its node. When the prefabs around it are not loaded, or that
     * node is not an instance of this prefab, it stands for this prefab alone.
     */
    private _start(instance: GameObject): {
        tree: SerializedGameObject;
        scopes: GameObject[];
        chain: string[];
        around: {
            tree: SerializedGameObject;
            node: SerializedGameObject;
            scopes: GameObject[];
            chain: string[];
        } | null;
    } {
        const alone = { tree: this._resolvedTree(), scopes: [instance], chain: this._chain(), around: null };
        const outermost = instance.outermostPrefabInstanceRoot;
        if (outermost === null || outermost === instance) return alone;
        const outer = outermost.prefabSource;
        const guid = AssetDatabase.guidOf(this);
        if (outer === null || guid === null) return alone;

        const ids: string[] = [];
        for (let go: GameObject | null = instance; go !== outermost;
            go = go.transform.parent?.gameObject.prefabInstanceRoot ?? null) {
            if (go === null || go._prefabNodeId === null) return alone;
            ids.unshift(go._prefabNodeId);
        }
        const at = outer._descend(outermost, joinNested(ids));
        const node = at?.id == null ? undefined : PrefabDiff.nodeOf(at.tree, { node: at.id })?.node;
        const tree = node?.prefab?.guid === guid ? SceneSerializer._linkTree(node) : null;
        if (at === null || node === undefined || tree === null) return alone;

        return {
            tree,
            scopes: [...at.scopes, instance],
            chain: [...at.chain, guid],
            around: { tree: at.tree, node, scopes: at.scopes, chain: at.chain },
        };
    }

    /**
     * Drops the changes `instance` holds for objects this prefab no longer
     * has, and returns them.
     *
     * @remarks
     * Equivalent to Unity's "Remove unused overrides". They are kept otherwise
     * — written back on every save and tried again on every load — because a
     * prefab that gets the object back makes them apply again.
     *
     * @returns what was removed, or null if there was nothing.
     * @throws if `instance` is not an instance of this prefab.
     */
    public removeUnusedOverrides(instance: GameObject): PrefabChanges | null {
        this._requireInstance(instance);
        const info = instance._prefabInfo!;
        const removed = info.unused;
        info.unused = null;
        return removed;
    }

    /** Throws unless `instance` is the root of an instance of this prefab. */
    private _requireInstance(instance: GameObject): void {
        if (instance.prefabSource !== this) {
            throw new Error(`[Prefab] "${instance.name}" is not an instance of the prefab "${this.name}".`);
        }
    }

    /**
     * Reverts one value in place. A nested prefab's whole link is rebuilt from
     * this prefab.
     *
     * @param instance - the root the override's address starts from.
     */
    private _revertValue(
        instance: GameObject,
        tree: SerializedGameObject,
        o: PrefabOverride,
        scopes: readonly GameObject[],
        chain: string[],
    ): void {
        const found = PrefabDiff.nodeOf(tree, o);
        const live = this._liveNode(instance, tree, o);
        if (found === null || live === null) return;
        const json = found.node;

        if (o.component !== null) {
            const original = json.components.filter(c => c.type === o.component)[o.componentIndex];
            const target = SceneSerializer._componentOf(live, o.component, o.componentIndex);
            if (!original || target === null) return;
            SceneSerializer._restoreField(scopes, target, o.field, original.fields[o.field] ?? null, tree.assets);
            return;
        }

        // A nested instance kept as a link takes its active state and scale
        // from its own prefab, not from the shell this prefab keeps of it.
        const own = SceneSerializer._linkTree(json) ?? json;
        const t = live.transform;
        switch (o.field) {
            case "name": live.name = json.name; return;
            case "active": live.setActive(own.active); return;
            case "transform.position": {
                const p = json.transform.position;
                t.localPosition = t.localPosition.set(p.x, p.y, p.z);
                return;
            }
            case "transform.rotation": {
                const r = json.transform.rotation;
                t.localRotation = t.localRotation.set(r.x, r.y, r.z, r.w);
                return;
            }
            case "transform.scale": {
                const sc = own.transform.scale;
                t.localScale = t.localScale.set(sc.x, sc.y, sc.z);
                return;
            }
            case "prefab": {
                const parent = t.parent?.gameObject ?? null;
                if (parent === null || found.parent === null) return;
                const index = t.getSiblingIndex();
                const held = Prefab._heldInto(live);
                live.destroyImmediate();
                const rebuilt = SceneSerializer._restoreChild(scopes, json, parent, index, tree.assets, chain);
                Prefab._pointBack(held, rebuilt);
                Prefab._reconnect(rebuilt);
                return;
            }
        }
    }

    /** The live object a change addresses, inside `instance`. */
    private _liveNode(
        instance: GameObject,
        tree: SerializedGameObject,
        address: { node?: string; path?: readonly number[] },
    ): GameObject | null {
        if (address.node !== undefined) {
            return address.node === tree.id ? instance : SceneSerializer._findLiveNode(instance, address.node);
        }
        let live: GameObject = instance;
        for (const index of address.path ?? []) {
            if (index < 0 || index >= live.transform.childCount) return null;
            live = live.transform.getChild(index).gameObject;
        }
        return live;
    }

    /**
     * Every reference elsewhere in `root`'s scene to `root` or to something
     * below it, with where in `root`'s subtree it points: what a revert that
     * destroys the subtree and builds it again records first, so that
     * {@link _pointBack} can aim each at the object that replaces the one it
     * held — Unity keeps them, since its revert keeps identity. References
     * from inside the subtree are not recorded: they are built again with it.
     *
     * The instance's objects are first given the node ids a save would give
     * them ({@link _nameObjects}), so that an object the instance added is
     * recorded by an id the subtree built again does not have — and its
     * reference left empty — rather than by a position some other object
     * takes.
     */
    private static _heldInto(root: GameObject): HeldReference<HeldTarget>[] {
        Prefab._nameObjects(root);
        const outside = Symbol();
        const pathOf = (go: GameObject): string[] | null | typeof outside => {
            const path: string[] = [];
            let named = true;
            for (let at: GameObject | null = go; at !== root; at = at.transform.parent?.gameObject ?? null) {
                if (at === null) return outside;
                if (at._prefabNodeId === null) named = false;
                else path.unshift(at._prefabNodeId);
            }
            return named ? path : null;
        };
        return SceneSerializer._heldReferences<HeldTarget>(
            root.scene.getRootGameObjects(),
            (go, component) => {
                const path = pathOf(go);
                if (path === outside) return null;
                if (component === null) return { path, component: null };
                const type = SceneSerializer._componentTypeName(component);
                if (type === null) return null;
                if (component === go.transform) return { path, component: { type, index: 0, count: 1 } };
                let index = -1;
                let count = 0;
                for (const candidate of Prefab._componentsOf(go)) {
                    if (SceneSerializer._componentTypeName(candidate) !== type) continue;
                    if (candidate === component) index = count;
                    count++;
                }
                return { path, component: { type, index, count } };
            },
            holder => pathOf(holder) !== outside,
        );
    }

    /**
     * Gives every object of the instance around `go` the node id a save gives
     * it, as {@link getChanges} does: an object the instance added gets a new
     * one, and one of an instance from before ids the id of the prefab node at
     * its place. Nothing is done outside an instance whose prefab is loaded.
     */
    private static _nameObjects(go: GameObject): void {
        const top = go.outermostPrefabInstanceRoot;
        const source = top?.prefabSource ?? null;
        if (top === null || source === null) return;
        let match: SerializedGameObject | undefined;
        try {
            match = source._resolvedTree();
        } catch {
            match = undefined;
        }
        SceneSerializer._nameForPrefab(top, match);
    }

    /**
     * Every reference in `parent`'s scene that still holds an object of the
     * removed child `id` of `parent`, or something below it — destroyed
     * objects, whose place in the tree their parents still record — with where
     * in that child it points. What reverting the removal points at the child
     * built again. A component of a destroyed object no longer knows which of
     * its type it was, and is found again only when it is the one of its type.
     */
    private static _heldIntoRemoved(parent: GameObject, id: string): HeldReference<HeldTarget>[] {
        const pathOf = (go: GameObject): string[] | null => {
            const path: string[] = [];
            for (let at = go; !at.exists();) {
                const up = at.transform.parent?.gameObject ?? null;
                if (up === null) return null;
                if (up.exists()) return at._prefabNodeId === id && up === parent ? path : null;
                if (at._prefabNodeId === null) return null;
                path.unshift(at._prefabNodeId);
                at = up;
            }
            return null;
        };
        return SceneSerializer._heldReferences<HeldTarget>(
            parent.scene.getRootGameObjects(),
            (go, component) => {
                const path = pathOf(go);
                if (path === null) return null;
                if (component === null) return { path, component: null };
                const type = SceneSerializer._componentTypeName(component);
                return type === null ? null : { path, component: { type, index: -1, count: 0 } };
            },
            () => false,
        );
    }

    /**
     * Aims each recorded reference at what now stands where its object stood
     * in `root`'s subtree. One whose place the subtree no longer has — an
     * object the revert removed, or a node the prefab does not have — or
     * whose component cannot be told from others of its type is left empty,
     * with a warning for each of those two reasons naming every holder and
     * field.
     */
    private static _pointBack(held: readonly HeldReference<HeldTarget>[], root: GameObject): void {
        const lost: Record<HeldLoss, string[]> = { gone: [], ambiguous: [] };
        for (const h of held) {
            const found = Prefab._resolveHeld(root, h.target);
            if (typeof found === "string") {
                h.assign(null);
                lost[found].push(h.where);
            } else {
                h.assign(found);
            }
        }
        if (lost.gone.length > 0) {
            Prefab._warnLost(`Reverting "${root.name}"`, lost.gone, "what they pointed at is not there any more");
        }
        if (lost.ambiguous.length > 0) {
            Prefab._warnLost(`Reverting "${root.name}"`, lost.ambiguous,
                "each held one of several components of a type on its object, and which one cannot be told");
        }
    }

    /**
     * What a recorded reference's place finds below `root`, or why it finds
     * nothing.
     */
    private static _resolveHeld(root: GameObject, target: HeldTarget): GameObject | Component | HeldLoss {
        if (target.path === null) return "gone";
        let go: GameObject | null = root;
        for (const segment of target.path) {
            go = Prefab._childWithId(go, segment);
            if (go === null) return "gone";
        }
        const wanted = target.component;
        if (wanted === null) return go;
        if (wanted.index >= 0) {
            const of = Prefab._componentsOf(go).filter(c => SceneSerializer._componentTypeName(c) === wanted.type).length;
            if (wanted.count < of) return "ambiguous";
            return SceneSerializer._componentOf(go, wanted.type, wanted.index) ?? "gone";
        }
        const first = SceneSerializer._componentOf(go, wanted.type, 0);
        if (first === null) return "gone";
        const only = first === go.transform || SceneSerializer._componentOf(go, wanted.type, 1) === null;
        return only ? first : "ambiguous";
    }

    /** One warning for references a revert could not keep, which are left empty. */
    private static _warnLost(what: string, where: readonly string[], why: string): void {
        console.warn(
            `[Prefab] ${what} leaves ${where.length} reference(s) empty, since ${why}: ${where.join(", ")}.`,
        );
    }

    /**
     * Points back at `restored`, just rebuilt from a prefab, every reference
     * in the instance around it that its prefabs aim there and that still
     * holds the destroyed object it replaces (see
     * `SceneSerializer._reconnect`). A `null` is left alone. References from
     * outside the instance are not the prefabs' to say, and are left alone.
     */
    private static _reconnect(restored: GameObject | Component): void {
        const go = "gameObject" in restored ? restored.gameObject : restored;
        const top = go.outermostPrefabInstanceRoot;
        const source = top?.prefabSource ?? null;
        if (top === null || source === null) return;

        for (const o of source.getChanges(top).overrides) {
            if (o.component === null) continue;
            const at = source._descend(top, o.node);
            if (at === null) continue;
            const address = { ...o, node: at.id ?? undefined };
            const saved = PrefabDiff.nodeOf(at.tree, address)?.node
                .components.filter(c => c.type === o.component)[o.componentIndex];
            const live = source._liveNode(at.live, at.tree, address);
            const target = live === null ? null : SceneSerializer._componentOf(live, o.component, o.componentIndex);
            if (saved === undefined || target === null) continue;
            SceneSerializer._reconnect(at.scopes, target, o.field, saved.fields[o.field] ?? null, restored);
        }
    }

    /** The prefab guids a rebuilt nested link is checked against, so a cycle stops. */
    private _chain(): string[] {
        const guid = AssetDatabase.guidOf(this);
        return guid === null ? [] : [guid];
    }

    /**
     * Where among `parent`'s live children the prefab's `prefabIndex`-th child
     * of `prefabParent` belongs: after every live child that is one of the
     * prefab's earlier children.
     */
    private static _liveIndex(parent: GameObject, prefabParent: SerializedGameObject, prefabIndex: number): number {
        const earlier = new Set(prefabParent.children.slice(0, prefabIndex).map(c => c.id));
        let index = 0;
        for (let i = 0; i < parent.transform.childCount; i++) {
            const id = parent.transform.getChild(i).gameObject._prefabNodeId;
            if (id !== null && earlier.has(id)) index = i + 1;
        }
        return index;
    }

    /** The direct child of `parent` with this node id, or null. */
    private static _childWithId(parent: GameObject, id: string): GameObject | null {
        for (let i = 0; i < parent.transform.childCount; i++) {
            const child = parent.transform.getChild(i).gameObject;
            if (child._prefabNodeId === id) return child;
        }
        return null;
    }

    /** A GameObject's components besides its Transform, in order. */
    private static _componentsOf(go: GameObject): readonly object[] {
        return (go as unknown as { _components: object[] })._components;
    }

    /**
     * Whether a saved tree holds an instance of the prefab `guid`: directly,
     * or inside a prefab it holds an instance of.
     */
    private static _holdsPrefab(tree: unknown, guid: string, seen: Set<string>): boolean {
        const held = new Set<string>();
        const walk = (value: unknown): void => {
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            if (value === null || typeof value !== "object") return;
            const obj = value as Record<string, unknown>;
            const link = obj["prefab"] as { guid?: unknown } | undefined;
            if (link && typeof link.guid === "string") held.add(link.guid);
            if (obj["field"] === "prefab") {
                const inner = obj["value"] as { guid?: unknown } | null;
                if (inner && typeof inner.guid === "string") held.add(inner.guid);
            }
            for (const key of Object.keys(obj)) walk(obj[key]);
        };
        walk(tree);

        for (const other of held) {
            if (other === guid) return true;
            if (seen.has(other)) continue;
            seen.add(other);
            const prefab = AssetDatabase.get(other);
            if (!(prefab instanceof Prefab)) continue;
            try {
                if (Prefab._holdsPrefab(prefab._resolvedTree(), guid, seen)) return true;
            } catch {
                // A variant whose base is not loaded holds nothing that can be checked.
            }
        }
        return false;
    }

    /** Whether an override is one of the root fields an instance never takes from its prefab. */
    private static _isDefaultOverride(o: PrefabOverride, tree: SerializedGameObject): boolean {
        const atRoot = o.node !== undefined ? o.node === tree.id : o.path !== undefined && o.path.length === 0;
        return atRoot && o.component === null
            && (o.field === "name" || o.field === "transform.position" || o.field === "transform.rotation");
    }

    /**
     * Marks a freshly built tree as an instance of this prefab. Its node ids
     * stay; the root's is cleared, since an instance root is the whole prefab
     * rather than one of its nodes.
     */
    private _stamp(go: GameObject): GameObject {
        go._prefabNodeId = null;
        go._prefabInfo = { source: this, guid: AssetDatabase.guidOf(this), raw: null, unused: null };
        return go;
    }

    /**
     * JSON representation suitable for saving to disk.
     *
     * @remarks
     * A variant is saved as the id of its base plus its differences, so it goes
     * on following its base once it is loaded again. That needs the base to
     * have an id — to have been saved as a file or loaded from one. A variant
     * whose base has none has nothing to name it by, and is **flattened**: the
     * tree it currently resolves to, correct but no longer connected.
     */
    public toJSON(): SerializedPrefab {
        if (this.isVariant) {
            const baseGuid = this._baseGuid ?? AssetDatabase.guidOf(this._base);
            if (baseGuid !== null) {
                return {
                    name: this.name,
                    version: 2,
                    base: baseGuid,
                    changes: JSON.parse(JSON.stringify(this._changes)) as PrefabChanges,
                };
            }
        }

        const snapshot = this._resolvedTree();
        // Version 2 only when an older reader would misread the file: a nested
        // prefab kept as a link, or a reference that names a node by id.
        return SceneSerializer._needsLinkReader(snapshot)
            ? { name: this.name, version: 2, snapshot }
            : { name: this.name, snapshot };
    }

    /** @internal The resolved tree (read-only). */
    public get _internalSnapshot(): SerializedGameObject { return this._resolvedTree(); }
}
