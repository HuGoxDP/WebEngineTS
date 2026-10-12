import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import { SceneManager } from "../SceneManager";
import { AssetDatabase } from "../assets/AssetDatabase";
import { SceneSerializer, type SerializedGameObject } from "./SceneSerializer";
import { PrefabDiff, type PrefabChanges, type PrefabOverride } from "./PrefabOverride";

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
    private readonly _snapshot: SerializedGameObject | null;

    /** @internal The prefab this one varies from, when it was given as an object. */
    private readonly _base: Prefab | null;

    /**
     * @internal The id of the prefab this one varies from, when it was read
     * from a file: the base is found through `AssetDatabase` when needed.
     */
    private readonly _baseGuid: string | null;

    /** @internal Differences from the base. Empty unless this is a variant. */
    private readonly _changes: PrefabChanges;

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
     *   values and shape from `PrefabDiff.compareChanges`.
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
            return PrefabDiff.applyChanges(base._resolvedTree(), this._changes);
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
     * and is written in full. `go` is not modified.
     */
    public static fromGameObject(go: GameObject, name?: string): Prefab {
        const snapshot = PrefabDiff.ensureIds(SceneSerializer._serializeForPrefab(go));
        return new Prefab(snapshot, name ?? go.name);
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
     * @throws if the file is of a format version this build cannot read, or
     *   has neither a tree nor a base.
     */
    public static fromJSON(json: {
        name?: string;
        version?: number;
        snapshot?: SerializedGameObject;
        base?: string;
        changes?: PrefabChanges;
    }): Prefab {
        SceneSerializer._refuseUnknownVersion(json.version, "prefab");
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
     * Unity lists it separately. `PrefabDiff.compareChanges` has both.
     *
     * The instance is read in the shape a prefab is stored in — its root in
     * full, a prefab nested inside it as a link — so an untouched instance has
     * no overrides, nested instances included.
     *
     * @param instance - a live GameObject, usually one {@link instantiate} made.
     * @returns the differences, in tree order. Empty when it matches.
     */
    public getOverrides(instance: GameObject): PrefabOverride[] {
        return PrefabDiff.compare(this._resolvedTree(), SceneSerializer._serializeForPrefab(instance));
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
            PrefabDiff.apply(this._resolvedTree(), overrides),
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
     * reverting means.
     *
     * The fresh instance takes the old one's place: the same scene, parent and
     * sibling index, and — when it is nested inside another instance — the
     * same node id there, so the instance around it does not read the revert
     * as one object removed and another added.
     *
     * @param instance - the instance to replace.
     * @returns the fresh instance, in the same scene, parent and position.
     */
    public revert(instance: GameObject): GameObject {
        const parent = instance.transform.parent;
        const index = instance.transform.getSiblingIndex();
        const nodeId = instance._prefabNodeId;
        instance.destroy();

        const fresh = this.instantiate(instance.scene);
        fresh.transform.setParent(parent, false);
        fresh.transform.setSiblingIndex(index);
        fresh._prefabNodeId = nodeId;
        return fresh;
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
