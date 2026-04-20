import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import { SceneManager } from "../SceneManager";
import { SceneSerializer, type SerializedGameObject } from "./SceneSerializer";

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

    /** JSON representation suitable for saving to disk. */
    public toJSON(): { name: string; snapshot: SerializedGameObject } {
        return { name: this.name, snapshot: this._snapshot };
    }

    /** @internal Raw snapshot reference (read-only). */
    public get _internalSnapshot(): SerializedGameObject { return this._snapshot; }
}
