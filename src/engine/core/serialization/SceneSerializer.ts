import type { Scene } from "../Scene";
import { GameObject } from "../GameObject";
import { Component } from "../Component";
import { Transform } from "../Transform";
import { SceneManager } from "../SceneManager";
import { TypeRegistry } from "../reflection/TypeRegistry";
import { getAllFields } from "../reflection/Decorators";
import { ValueSerializer } from "./ValueSerializer";

/** Serialized snapshot of a single GameObject (recursive). */
export interface SerializedGameObject {
    name: string;
    active: boolean;
    transform: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number; w: number };
        scale:    { x: number; y: number; z: number };
    };
    components: SerializedComponent[];
    children: SerializedGameObject[];
}

/** Serialized snapshot of a single component. */
export interface SerializedComponent {
    type: string;
    fields: Record<string, unknown>;
}

/** Serialized snapshot of a whole scene. */
export interface SerializedScene {
    name: string;
    version: 1;
    roots: SerializedGameObject[];
}

/**
 * Converts engine Scenes (and subtrees) to and from JSON.
 *
 * @remarks
 * Used by the Prefab system and by the future web editor for
 * save / load / undo.
 *
 * Built-in components (Transform, MeshRenderer, ...) are serialized only
 * if they have `@Serializable` metadata. User scripts marked with
 * `@Serializable` round-trip automatically — the `@SerializedField`
 * decorators drive which properties persist.
 *
 * ```ts
 * const json = SceneSerializer.serializeScene(SceneManager.activeScene);
 * // ...save to disk / editor / undo stack...
 * const scene = SceneManager.createScene("loaded");
 * SceneSerializer.deserializeScene(json, scene);
 * ```
 */
export class SceneSerializer {

    // ==================== SCENE ====================

    /** Serializes every root GameObject in the scene to a JSON tree. */
    public static serializeScene(scene: Scene): SerializedScene {
        return {
            name: scene.name,
            version: 1,
            roots: scene.getRootGameObjects().map(SceneSerializer.serializeGameObject),
        };
    }

    /**
     * Reconstructs GameObjects from a scene snapshot.
     * The target scene is NOT cleared first — callers that want a
     * clean load should destroy existing objects themselves.
     */
    public static deserializeScene(json: SerializedScene, scene?: Scene): GameObject[] {
        let prevActive: Scene | null = null;
        if (scene && scene !== SceneManager.activeScene) {
            prevActive = SceneManager.activeScene;
            SceneManager.setActiveScene(scene);
        }
        try {
            return json.roots.map(r => SceneSerializer._deserializeGameObjectInternal(r));
        } finally {
            if (prevActive) SceneManager.setActiveScene(prevActive);
        }
    }

    // ==================== GAMEOBJECT ====================

    /** Serializes a single GameObject and all its descendants. */
    public static serializeGameObject(go: GameObject): SerializedGameObject {
        const t = go.transform;
        const children: SerializedGameObject[] = [];
        for (let i = 0; i < t.childCount; i++) {
            children.push(SceneSerializer.serializeGameObject(t.getChild(i).gameObject));
        }
        return {
            name: go.name,
            active: go.activeSelf,
            transform: {
                position: { x: t.localPosition.x, y: t.localPosition.y, z: t.localPosition.z },
                rotation: {
                    x: t.localRotation.x,
                    y: t.localRotation.y,
                    z: t.localRotation.z,
                    w: t.localRotation.w,
                },
                scale:    { x: t.localScale.x,    y: t.localScale.y,    z: t.localScale.z    },
            },
            components: SceneSerializer._serializeComponents(go),
            children,
        };
    }

    /**
     * Reconstructs a GameObject and its descendants from a snapshot.
     * If `scene` is provided it is temporarily made active so that the
     * new GameObjects register there; the previous active scene is restored.
     */
    public static deserializeGameObject(json: SerializedGameObject, scene?: Scene): GameObject {
        let prevActive: Scene | null = null;
        if (scene && scene !== SceneManager.activeScene) {
            prevActive = SceneManager.activeScene;
            SceneManager.setActiveScene(scene);
        }
        try {
            return SceneSerializer._deserializeGameObjectInternal(json);
        } finally {
            if (prevActive) SceneManager.setActiveScene(prevActive);
        }
    }

    private static _deserializeGameObjectInternal(json: SerializedGameObject): GameObject {
        const go = new GameObject(json.name);
        go.setActive(json.active);

        // Transform — assign via property setters so dirty flags fire.
        const t = go.transform;
        const p = json.transform.position;
        const r = json.transform.rotation;
        const s = json.transform.scale;
        t.localPosition = t.localPosition.set(p.x, p.y, p.z);
        t.localRotation = t.localRotation.set(r.x, r.y, r.z, r.w);
        t.localScale    = t.localScale.set(s.x, s.y, s.z);

        // Components
        for (const compJson of json.components) {
            SceneSerializer._deserializeComponent(compJson, go);
        }

        // Children
        for (const childJson of json.children) {
            const child = SceneSerializer._deserializeGameObjectInternal(childJson);
            child.transform.parent = t;
        }

        return go;
    }

    // ==================== PRIVATE ====================

    private static _serializeComponents(go: GameObject): SerializedComponent[] {
        const out: SerializedComponent[] = [];
        const components = (go as unknown as { _components: Component[] })._components;
        for (const comp of components) {
            if (comp instanceof Transform) continue; // handled separately
            const typeName = TypeRegistry.getTypeName(comp);
            if (!typeName) continue; // not registered → skipped

            const fields: Record<string, unknown> = {};
            for (const f of getAllFields(comp.constructor as any)) {
                if (!f.serialize) continue;
                fields[f.name] = ValueSerializer.serialize((comp as any)[f.name], f.type);
            }
            out.push({ type: typeName, fields });
        }
        return out;
    }

    private static _deserializeComponent(
        json: SerializedComponent,
        go: GameObject,
    ): Component | null {
        const ctor = TypeRegistry.get(json.type);
        if (!ctor) {
            console.warn(`[SceneSerializer] Unknown component type "${json.type}" — skipped`);
            return null;
        }

        const comp = go.addComponent(ctor as any) as Component;
        const fields = getAllFields(ctor as any);

        for (const f of fields) {
            if (!f.serialize) continue;
            if (!(f.name in json.fields)) continue;
            const value = ValueSerializer.deserialize(json.fields[f.name], f.type);
            (comp as any)[f.name] = value;
        }

        return comp;
    }

    private constructor() {}
}
