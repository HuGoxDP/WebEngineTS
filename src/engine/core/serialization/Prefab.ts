import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import { SceneManager } from "../SceneManager";
import { AssetDatabase } from "../assets/AssetDatabase";
import { SceneSerializer, type SerializedGameObject } from "./SceneSerializer";
import { PrefabDiff, type PrefabOverride } from "./PrefabOverride";

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

    /** @internal The prefab this one varies from, or null. */
    private readonly _base: Prefab | null;

    /** @internal Differences from {@link _base}. Empty unless this is a variant. */
    private readonly _variantOverrides: readonly PrefabOverride[];

    /** @internal */
    constructor(
        snapshot: SerializedGameObject | null,
        name?: string,
        base: Prefab | null = null,
        overrides: readonly PrefabOverride[] = [],
    ) {
        this._snapshot = snapshot;
        this._base = base;
        this._variantOverrides = overrides;
        this.name = name ?? snapshot?.name ?? base?.name ?? "Prefab";
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
     * ```ts
     * const eliteOverrides = base.getOverrides(tweakedInstance);
     * const elite = Prefab.createVariant(base, eliteOverrides, "Elite Enemy");
     * ```
     *
     * @param base - the prefab to vary from.
     * @param overrides - differences, usually from {@link getOverrides}.
     * @param name - display name. Defaults to the base's.
     */
    public static createVariant(
        base: Prefab,
        overrides: readonly PrefabOverride[],
        name?: string,
    ): Prefab {
        return new Prefab(null, name ?? base.name, base, [...overrides]);
    }

    /** Whether this prefab is defined as differences from another. */
    public get isVariant(): boolean { return this._base !== null; }

    /** The prefab this one varies from, or null. */
    public get base(): Prefab | null { return this._base; }

    /** This variant's differences from its {@link base}. Empty otherwise. */
    public get variantOverrides(): readonly PrefabOverride[] {
        return this._variantOverrides;
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
     */
    public _resolvedTree(): SerializedGameObject {
        if (this._snapshot !== null) return this._snapshot;
        if (this._base === null) {
            throw new Error("[Prefab] A prefab must have either a snapshot or a base");
        }
        return PrefabDiff.apply(this._base._resolvedTree(), this._variantOverrides);
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
     */
    public static fromJSON(json: { name?: string; snapshot: SerializedGameObject }): Prefab {
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
     * A variant is **flattened** here: the result is the tree it currently
     * resolves to, not a reference to its base plus differences. Recording the
     * link would mean naming the base, and prefabs have no ids yet — so the
     * saved form is correct but loses the connection. Keep variants in memory,
     * or save the base and the overrides separately, until prefab identity
     * exists (unity-parity Stage 2/3).
     */
    public toJSON(): { name: string; snapshot: SerializedGameObject } {
        return { name: this.name, snapshot: this._resolvedTree() };
    }

    /** @internal The resolved tree (read-only). */
    public get _internalSnapshot(): SerializedGameObject { return this._resolvedTree(); }
}
