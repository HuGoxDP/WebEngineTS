import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import { SceneManager } from "../SceneManager";
import { SceneSerializer, type SerializedGameObject } from "./SceneSerializer";
import { PrefabDiff, type PrefabOverride } from "./PrefabOverride";

/**
 * A reusable GameObject template — save once, instantiate many times.
 *
 * @remarks
 * Equivalent to Unity's Prefab asset. A Prefab stores the serialized
 * form of a GameObject (plus all its children and component values).
 * Each call to {@link instantiate} produces an independent deep copy.
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

    /** @internal Serialized GameObject tree. */
    private readonly _snapshot: SerializedGameObject;

    /** @internal */
    constructor(snapshot: SerializedGameObject, name?: string) {
        this._snapshot = snapshot;
        this.name = name ?? snapshot.name;
    }

    /** Captures a live GameObject (and its children) as a Prefab. */
    public static fromGameObject(go: GameObject, name?: string): Prefab {
        return new Prefab(SceneSerializer.serializeGameObject(go), name ?? go.name);
    }

    /** Reconstructs a Prefab from its JSON form. */
    public static fromJSON(json: { name?: string; snapshot: SerializedGameObject }): Prefab {
        return new Prefab(json.snapshot, json.name);
    }

    /**
     * Creates a fresh copy of the stored GameObject in the given scene
     * (defaults to the active scene). The returned GameObject is a root
     * object of the scene.
     */
    public instantiate(scene?: Scene): GameObject {
        const target = scene ?? SceneManager.activeScene;
        return SceneSerializer.deserializeGameObject(this._snapshot, target);
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
     * Structural changes are deliberately not reported: a child added to or
     * removed from an instance is a different *shape*, not a different value,
     * and Unity treats it as a separate kind of modification.
     *
     * @param instance - a live GameObject, usually one {@link instantiate} made.
     * @returns the differences, in tree order. Empty when it matches.
     */
    public getOverrides(instance: GameObject): PrefabOverride[] {
        return PrefabDiff.compare(this._snapshot, SceneSerializer.serializeGameObject(instance));
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
        return SceneSerializer.deserializeGameObject(
            PrefabDiff.apply(this._snapshot, overrides),
            target,
        );
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
     * @param instance - the instance to replace.
     * @returns the fresh instance, in the same scene and parent.
     */
    public revert(instance: GameObject): GameObject {
        const parent = instance.transform.parent;
        instance.destroy();

        const fresh = this.instantiate();
        fresh.transform.parent = parent;
        return fresh;
    }

    /** JSON representation suitable for saving to disk. */
    public toJSON(): { name: string; snapshot: SerializedGameObject } {
        return { name: this.name, snapshot: this._snapshot };
    }

    /** @internal Raw snapshot reference (read-only). */
    public get _internalSnapshot(): SerializedGameObject { return this._snapshot; }
}
