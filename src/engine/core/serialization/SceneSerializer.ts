import type { Scene } from "../Scene";
import { GameObject } from "../GameObject";
import { Component } from "../Component";
import { Transform } from "../Transform";
import { SceneManager } from "../SceneManager";
import { TypeRegistry } from "../reflection/TypeRegistry";
import { getAllFields } from "../reflection/Decorators";
import { AssetDatabase } from "../assets/AssetDatabase";
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
    /**
     * Assets carried inside this snapshot. Present only on the **root** of a
     * `serializeGameObject` result, never on a child.
     */
    assets?: SerializedAsset[];
}

/** Serialized snapshot of a single component. */
export interface SerializedComponent {
    type: string;
    fields: Record<string, unknown>;
}

/**
 * An asset the scene carries inside itself, because it has no file behind it.
 *
 * @remarks
 * A material is built in code, so it cannot be referenced by path. It is
 * value-serialized once here and referenced by id from every component that
 * used it, which is what keeps sharing intact across a save.
 */
export interface SerializedAsset {
    guid: string;
    type: string;
    fields: Record<string, unknown>;
}

/** Serialized snapshot of a whole scene. */
export interface SerializedScene {
    name: string;
    version: 1;
    roots: SerializedGameObject[];
    /** Assets carried inside the scene. See {@link SerializedAsset}. */
    assets?: SerializedAsset[];
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
        const roots = scene.getRootGameObjects().map(r => SceneSerializer._serializeGO(r, ctx));

        // Written after the walk: the table is filled as components are visited.
        const out: SerializedScene = { name: scene.name, version: 1, roots };
        if (ctx.assetTable.length > 0) out.assets = ctx.assetTable;
        return out;
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
                pendingComponentRefs: [],
                pendingAssetRefs: [],
                currentComponent: null,
                currentField: null,
            };
            SceneSerializer._materializeAssets(json.assets, ctx);
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
        const root = SceneSerializer._serializeGO(go, ctx);
        if (ctx.assetTable.length > 0) root.assets = ctx.assetTable;
        return root;
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
                pendingComponentRefs: [],
                pendingAssetRefs: [],
                currentComponent: null,
                currentField: null,
            };
            SceneSerializer._materializeAssets(json.assets, ctx);
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

        const assetTable: SerializedAsset[] = [];
        const inlined = new Map<object, string>();
        // The inline-asset closure serializes fields, which needs the very
        // context being built — held in a box so it can refer to itself.
        const ctxRef: { value: SerializeContext | null } = { value: null };

        const ctx: SerializeContext = {
            goToPath,
            assetTable,
            componentTypeName: (component) => TypeRegistry.getTypeName(component),
            componentIndex: (owner, component) => {
                const list = (owner as unknown as { _components: Component[] })._components;
                const name = TypeRegistry.getTypeName(component);
                let index = 0;
                for (const candidate of list) {
                    if (candidate === component) return index;
                    if (TypeRegistry.getTypeName(candidate) === name) index++;
                }
                return 0;
            },
            inlineAsset: (asset) => {
                const already = inlined.get(asset);
                if (already !== undefined) return already;

                const typeName = TypeRegistry.getTypeName(asset);
                if (typeName === null) return null;

                // Registered before the fields are walked, so an asset that
                // somehow refers back to itself cannot recurse forever.
                const guid = AssetDatabase.guidForPath(
                    `inline:${typeName}:${assetTable.length}:${Math.random()}`,
                );
                inlined.set(asset, guid);

                const fields: Record<string, unknown> = {};
                assetTable.push({ guid, type: typeName, fields });
                for (const f of getAllFields(asset.constructor as any)) {
                    if (!f.serialize) continue;
                    fields[f.name] = ValueSerializer.serialize(
                        (asset as any)[f.name], f.type, ctxRef.value!,
                    );
                }
                return guid;
            },
        };

        ctxRef.value = ctx;
        return ctx;
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

    /**
     * Rebuilds the assets a snapshot carries inside itself, before any component
     * can reference one.
     *
     * @remarks
     * An id already in memory is left alone: a scenario that loaded its own
     * materials keeps them, rather than being handed a second copy of each.
     */
    private static _materializeAssets(
        table: SerializedAsset[] | undefined,
        ctx: DeserializeContext,
    ): void {
        if (!table) return;

        for (const entry of table) {
            if (AssetDatabase.isLoaded(entry.guid)) continue;

            const ctor = TypeRegistry.get(entry.type);
            if (!ctor) {
                console.warn(`[SceneSerializer] Unknown asset type "${entry.type}" — skipped`);
                continue;
            }

            const asset = new ctor() as object;
            for (const f of getAllFields(ctor)) {
                if (!f.serialize) continue;
                if (!(f.name in entry.fields)) continue;

                ctx.currentComponent = asset;
                ctx.currentField = f.name;
                const value = ValueSerializer.deserialize(entry.fields[f.name], f.type, ctx);
                ctx.currentComponent = null;
                ctx.currentField = null;
                SceneSerializer._assign(asset, f.name, value);
            }
            AssetDatabase._bindGuid(entry.guid, asset);
        }
    }

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
     * **A property with a setter is always assigned through it**, whatever its
     * type. The setter is the component's own definition of what storing means
     * — `BoxCollider.center` resizes the physics shape, `Camera.backgroundColor`
     * clones defensively, `AspectRatioFitter.aspectRatio` clamps — and writing
     * past it produces a component whose visible state and real state disagree.
     * Only plain data fields are written in place.
     */
    private static _assign(comp: object, field: string, value: unknown): void {
        if (SceneSerializer._hasSetter(comp, field)) {
            (comp as any)[field] = value;
            return;
        }

        const target = (comp as any)[field];
        const isObject = value !== null && typeof value === "object"
            && target !== null && typeof target === "object";

        if (isObject
            && target.constructor === (value as object).constructor
            && typeof (target as { copy?: unknown }).copy === "function") {
            (target as { copy: (v: unknown) => unknown }).copy(value);
            return;
        }

        // A settings struct — `LayoutPadding`, `ColorBlock`, `Navigation` — has
        // no `copy` and comes back from JSON as a bare object, so assigning it
        // would strip the instance of its methods. Its values are merged into
        // the instance the component already owns instead.
        if (isObject
            && (value as object).constructor === Object
            && (target as object).constructor !== Object) {
            for (const key of Object.keys(value as object)) {
                if (key in (target as object)) {
                    (target as any)[key] = (value as any)[key];
                }
            }
            return;
        }

        (comp as any)[field] = value;
    }

    /** Whether `field` resolves to an accessor with a setter, own or inherited. */
    private static _hasSetter(comp: object, field: string): boolean {
        let level: object | null = comp;
        while (level !== null && level !== Object.prototype) {
            const descriptor = Object.getOwnPropertyDescriptor(level, field);
            if (descriptor) return typeof descriptor.set === "function";
            level = Object.getPrototypeOf(level);
        }
        return false;
    }

    /**
     * Asset ids the last load could not resolve, because the asset was not in
     * memory when the scene was rebuilt.
     *
     * @remarks
     * Deserialization is synchronous and asset loading is not, so a scene
     * referring to an unloaded material rebuilds with that field null rather
     * than blocking. This is how a caller finds out: preload these ids and call
     * {@link resolvePendingAssets} to fill them in.
     *
     * Cleared at the start of every load.
     */
    public static get pendingAssetGuids(): readonly string[] {
        return SceneSerializer._pending.map(p => p.guid);
    }

    /**
     * Re-resolves the references from {@link pendingAssetGuids} against what is
     * loaded now.
     *
     * @returns how many were filled in. Anything still missing stays pending.
     */
    public static resolvePendingAssets(): number {
        let resolved = 0;
        const still: typeof SceneSerializer._pending = [];

        for (const ref of SceneSerializer._pending) {
            const asset = AssetDatabase.get(ref.guid);
            if (asset === null) {
                still.push(ref);
                continue;
            }
            const value = ref.sprite !== undefined
                ? ValueSerializer._buildSprite(asset, ref.sprite)
                : asset;
            SceneSerializer._assign(ref.component, ref.field, value);
            resolved++;
        }

        SceneSerializer._pending = still;
        return resolved;
    }

    private static _pending: DeserializeContext["pendingAssetRefs"] = [];

    /** Walks every collected reference and assigns what it resolved to. */
    private static _resolveRefs(ctx: DeserializeContext, roots: ReadonlyArray<GameObject>): void {
        for (const ref of ctx.pendingGORefs) {
            const target = SceneSerializer._lookupByPath(roots, ref.path);
            (ref.component as any)[ref.field] = target;
        }

        for (const ref of ctx.pendingComponentRefs) {
            const owner = SceneSerializer._lookupByPath(roots, ref.path);
            const target = owner === null
                ? null
                : SceneSerializer._findComponent(owner, ref.typeName, ref.index);
            SceneSerializer._assign(ref.component, ref.field, target);
        }

        SceneSerializer._pending = ctx.pendingAssetRefs.slice();
    }

    /** The `index`-th component of `typeName` on `go`, or null. */
    private static _findComponent(
        go: GameObject,
        typeName: string,
        index: number,
    ): Component | null {
        const list = (go as unknown as { _components: Component[] })._components;
        let seen = 0;
        for (const candidate of list) {
            if (TypeRegistry.getTypeName(candidate) !== typeName) continue;
            if (seen === index) return candidate;
            seen++;
        }
        return null;
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
