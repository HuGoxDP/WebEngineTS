import type { Scene } from "../Scene";
import { GameObject } from "../GameObject";
import { Component } from "../Component";
import { Transform } from "../Transform";
import { SceneManager } from "../SceneManager";
import { TypeRegistry } from "../reflection/TypeRegistry";
import { getAllFields } from "../reflection/Decorators";
import {
    ValueSerializer,
    type SerializeContext,
    type DeserializeContext,
} from "./ValueSerializer";

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
 * Used by the Prefab system and by the editor for save / load / undo.
 *
 * Built-in components (Transform, MeshRenderer, ...) are serialized only
 * if they have `@Serializable` metadata. User scripts marked with
 * `@Serializable` round-trip automatically — the `@SerializedField`
 * decorators drive which properties persist.
 *
 * **Cross-references:** GameObject references between siblings round-trip
 * via path-based markers (`{ $type: "GameObjectRef", path: [...] }`).
 * Resolution happens in a deferred second pass, so a script that holds
 * a reference to another object in the same scene still points there
 * after save/load.
 *
 * ```ts
 * const json = SceneSerializer.serializeScene(SceneManager.activeScene);
 * // ...save / undo / send over wire...
 * SceneSerializer.deserializeScene(json);
 * ```
 */
export class SceneSerializer {

    // ==================== SCENE ====================

    /** Serializes every root GameObject in the scene to a JSON tree. */
    public static serializeScene(scene: Scene): SerializedScene {
        const ctx = SceneSerializer._buildSerializeCtx(scene.getRootGameObjects());
        return {
            name: scene.name,
            version: 1,
            roots: scene.getRootGameObjects().map(r => SceneSerializer._serializeGO(r, ctx)),
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
            const ctx: DeserializeContext = {
                pendingGORefs: [],
                currentComponent: null,
                currentField: null,
            };
            const roots = json.roots.map(r => SceneSerializer._deserializeGO(r, ctx));
            SceneSerializer._resolveRefs(ctx, roots);
            return roots;
        } finally {
            if (prevActive) SceneManager.setActiveScene(prevActive);
        }
    }

    // ==================== GAMEOBJECT ====================

    /** Serializes a single GameObject and all its descendants. */
    public static serializeGameObject(go: GameObject): SerializedGameObject {
        const ctx = SceneSerializer._buildSerializeCtx([go]);
        return SceneSerializer._serializeGO(go, ctx);
    }

    /**
     * Reconstructs a GameObject and its descendants from a snapshot.
     * If `scene` is provided it is temporarily made active so the new
     * GameObjects register there; the previous active scene is restored.
     */
    public static deserializeGameObject(json: SerializedGameObject, scene?: Scene): GameObject {
        let prevActive: Scene | null = null;
        if (scene && scene !== SceneManager.activeScene) {
            prevActive = SceneManager.activeScene;
            SceneManager.setActiveScene(scene);
        }
        try {
            const ctx: DeserializeContext = {
                pendingGORefs: [],
                currentComponent: null,
                currentField: null,
            };
            const root = SceneSerializer._deserializeGO(json, ctx);
            SceneSerializer._resolveRefs(ctx, [root]);
            return root;
        } finally {
            if (prevActive) SceneManager.setActiveScene(prevActive);
        }
    }

    // ==================== PRIVATE — SERIALIZE ====================

    private static _buildSerializeCtx(roots: ReadonlyArray<GameObject>): SerializeContext {
        const goToPath = new Map<GameObject, number[]>();
        const walk = (go: GameObject, path: number[]): void => {
            goToPath.set(go, path);
            const t = go.transform;
            for (let i = 0; i < t.childCount; i++) {
                walk(t.getChild(i).gameObject, [...path, i]);
            }
        };
        for (let i = 0; i < roots.length; i++) walk(roots[i], [i]);
        return { goToPath };
    }

    private static _serializeGO(go: GameObject, ctx: SerializeContext): SerializedGameObject {
        const t = go.transform;
        const children: SerializedGameObject[] = [];
        for (let i = 0; i < t.childCount; i++) {
            children.push(SceneSerializer._serializeGO(t.getChild(i).gameObject, ctx));
        }
        return {
            name: go.name,
            active: go.activeSelf,
            transform: {
                position: { x: t.localPosition.x, y: t.localPosition.y, z: t.localPosition.z },
                rotation: {
                    x: t.localRotation.x, y: t.localRotation.y,
                    z: t.localRotation.z, w: t.localRotation.w,
                },
                scale:    { x: t.localScale.x, y: t.localScale.y, z: t.localScale.z },
            },
            components: SceneSerializer._serializeComponents(go, ctx),
            children,
        };
    }

    private static _serializeComponents(go: GameObject, ctx: SerializeContext): SerializedComponent[] {
        const out: SerializedComponent[] = [];
        const components = (go as unknown as { _components: Component[] })._components;
        for (const comp of components) {
            if (comp instanceof Transform) continue;
            const typeName = TypeRegistry.getTypeName(comp);
            if (!typeName) continue;

            const fields: Record<string, unknown> = {};
            for (const f of getAllFields(comp.constructor as any)) {
                if (!f.serialize) continue;
                fields[f.name] = ValueSerializer.serialize((comp as any)[f.name], f.type, ctx);
            }
            out.push({ type: typeName, fields });
        }
        return out;
    }

    // ==================== PRIVATE — DESERIALIZE ====================

    private static _deserializeGO(json: SerializedGameObject, ctx: DeserializeContext): GameObject {
        const go = new GameObject(json.name);
        go.setActive(json.active);

        const t = go.transform;
        const p = json.transform.position;
        const r = json.transform.rotation;
        const s = json.transform.scale;
        t.localPosition = t.localPosition.set(p.x, p.y, p.z);
        t.localRotation = t.localRotation.set(r.x, r.y, r.z, r.w);
        t.localScale    = t.localScale.set(s.x, s.y, s.z);

        for (const compJson of json.components) {
            SceneSerializer._deserializeComponent(compJson, go, ctx);
        }
        for (const childJson of json.children) {
            const child = SceneSerializer._deserializeGO(childJson, ctx);
            child.transform.parent = t;
        }
        return go;
    }

    private static _deserializeComponent(
        json: SerializedComponent,
        go: GameObject,
        ctx: DeserializeContext,
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
            ctx.currentComponent = comp;
            ctx.currentField = f.name;
            const value = ValueSerializer.deserialize(json.fields[f.name], f.type, ctx);
            ctx.currentComponent = null;
            ctx.currentField = null;
            SceneSerializer._assign(comp, f.name, value);
        }
        return comp;
    }

    /**
     * Writes one deserialized value onto a component.
     *
     * @remarks
     * Compound values are copied **into** the field's existing instance rather
     * than replacing it, which matters for two reasons the built-in components
     * hit constantly: a field declared `readonly` (`Selectable.colors`) cannot
     * be replaced without breaking its own contract, and anything holding a
     * reference to the old vector — a cached snapshot, a layout group — would
     * keep writing to an object nothing reads any more.
     *
     * Falls back to plain assignment when the field is empty, holds a different
     * type, or is an accessor with no backing instance to copy into.
     */
    private static _assign(comp: Component, field: string, value: unknown): void {
        const target = (comp as any)[field];

        if (value !== null
            && typeof value === "object"
            && target !== null
            && typeof target === "object"
            && target.constructor === (value as object).constructor
            && typeof (target as { copy?: unknown }).copy === "function") {
            (target as { copy: (v: unknown) => unknown }).copy(value);
            return;
        }

        (comp as any)[field] = value;
    }

    /** Walks every collected GameObjectRef and assigns the resolved object. */
    private static _resolveRefs(ctx: DeserializeContext, roots: ReadonlyArray<GameObject>): void {
        for (const ref of ctx.pendingGORefs) {
            const target = SceneSerializer._lookupByPath(roots, ref.path);
            (ref.component as any)[ref.field] = target;
        }
    }

    /** Walks a path of sibling indices and returns the target GameObject (or null). */
    private static _lookupByPath(roots: ReadonlyArray<GameObject>, path: number[]): GameObject | null {
        if (path.length === 0) return null;
        const rootIdx = path[0];
        if (rootIdx < 0 || rootIdx >= roots.length) return null;
        let cur: GameObject = roots[rootIdx];
        for (let i = 1; i < path.length; i++) {
            const t = cur.transform;
            const idx = path[i];
            if (idx < 0 || idx >= t.childCount) return null;
            cur = t.getChild(idx).gameObject;
        }
        return cur;
    }

    private constructor() {}
}
