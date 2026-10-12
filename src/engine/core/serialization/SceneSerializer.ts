import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import { Component } from "../Component";
import { Transform } from "../Transform";
import { SceneManager } from "../SceneManager";
import { TypeRegistry } from "../reflection/TypeRegistry";
import { getAllFields } from "../reflection/Decorators";
import { AssetDatabase } from "../assets/AssetDatabase";
import { RenderSettings, FogMode } from "../RenderSettings";
import { Cubemap } from "../graphics/Cubemap";
import { Texture2D } from "../graphics/Texture2D";
import { Color } from "../math/Color";
import { MissingComponent, MissingValue } from "./MissingComponent";
import {
    PrefabDiff,
    mintNodeId,
    type PrefabChanges,
    type PrefabOverride,
    type PrefabSource,
    type PrefabInstanceInfo,
    type SerializedPrefabLink,
} from "./PrefabOverride";
import {
    ValueSerializer,
    type SerializeContext,
    type DeserializeContext,
    type RefScope,
} from "./ValueSerializer";

/**
 * The writer's context for one pass. Module-private: not part of the API.
 *
 * @remarks
 * A pass opened for a linked instance nests inside the pass that found it,
 * sharing its asset table and its record of inline assets, so a reference that
 * leaves the instance can be located by walking out through {@link outer}.
 */
interface SceneCtx extends SerializeContext {
    /** Whether a prefab instance is written as prefab plus changes. */
    readonly link: boolean;
    /** The pass this one is nested in, or null for the outermost. */
    readonly outer: SceneCtx | null;
    /** Inline assets already written, shared with {@link outer}. */
    readonly inlined: Map<object, string>;
    /**
     * Node ids given to objects that had none, for a pass that must leave the
     * live objects as they are. Shared with {@link outer}.
     */
    readonly minted: Map<GameObject, string>;
    /** Whether an id minted for an added node is stored on the live object. */
    readonly mintLive: boolean;
    /** Shared with {@link outer}. */
    assetTable: SerializedAsset[];
    locate(go: GameObject): { path: number[]; scope: number } | null;
}

/** The reader's context for one load. Module-private: not part of the API. */
interface LoadCtx extends DeserializeContext {
    scopeStack: object[];
    /**
     * Guids of the prefabs being rebuilt as links, outermost first, plus the
     * prefab being instantiated when there is one: what a prefab that
     * contains itself is caught against.
     */
    chain: string[];
}

/** Root fields a link-mode shell carries itself, so they are never also overrides. */
const SHELL_FIELDS: ReadonlySet<string> = new Set(["name", "transform.position", "transform.rotation"]);

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
    /**
     * Which node of its prefab this is. Written for objects that came from one,
     * so an instance can be compared with the prefab node by node.
     */
    id?: string;
    /**
     * Present on the root of a prefab instance. Without `changes` the tree
     * above is complete and this only records where it came from; with them the
     * instance is saved as the prefab plus its differences, and `components`
     * and `children` are empty.
     */
    prefab?: SerializedPrefabLink;
}

/** How to write a snapshot. */
export interface SerializeOptions {
    /**
     * How an object that is an instance of a prefab is written.
     *
     * - `"expand"` (default) — the whole tree, with a note of the prefab it came
     *   from. Nothing needs the prefab to read it back, and nothing follows an
     *   edit to the prefab either.
     * - `"link"` — only the prefab and what differs from it, which is what lets
     *   an edit to the prefab reach every scene that uses it. Reading it back
     *   needs the prefab loaded first; {@link SceneSerializer.assetReferences}
     *   says which.
     */
    prefabs?: "expand" | "link";
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

/** The `format` of a file written by {@link SceneSerializer.serializeAsset}. */
export const ASSET_FILE_FORMAT = "WebEngineTS.asset";

/**
 * An asset written as a file of its own, rather than inside a scene.
 *
 * @remarks
 * The same shape a scene's own asset table uses, minus the id: a file's id is
 * the one the project gives it, so that renaming or moving the file does not
 * change it.
 */
export interface SerializedAssetFile {
    format: typeof ASSET_FILE_FORMAT;
    version: 1;
    /** The registered type name. */
    type: string;
    fields: Record<string, unknown>;
    /** Assets carried inside this one. See {@link SerializedAsset}. */
    assets?: SerializedAsset[];
}

/**
 * The scene-wide environment: fog, ambient light and the sky.
 *
 * @remarks
 * {@link RenderSettings} is global state, not a component, so it would be lost
 * on every save were it not written here. A sky is stored as the id of the
 * panorama texture it is drawn from; one with no asset behind it (built from a
 * URL, six faces or a color) has nothing to refer to and is left out.
 */
export interface SerializedRenderSettings {
    fog: boolean;
    fogColor: { r: number; g: number; b: number; a: number };
    /** A {@link FogMode} value. */
    fogMode: number;
    fogStartDistance: number;
    fogEndDistance: number;
    fogDensity: number;
    ambientColor: { r: number; g: number; b: number; a: number };
    /** Id of the panorama the skybox is drawn from. */
    skybox?: string;
    /** Id of the panorama used for reflections, when it is not the skybox. */
    environmentReflections?: string;
}

/** Serialized snapshot of a whole scene. */
export interface SerializedScene {
    name: string;
    version: 1;
    roots: SerializedGameObject[];
    /** Assets carried inside the scene. See {@link SerializedAsset}. */
    assets?: SerializedAsset[];
    /**
     * The scene's environment. Absent in files written before it was saved, and
     * then loading leaves the current settings alone.
     */
    renderSettings?: SerializedRenderSettings;
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
    public static serializeScene(scene: Scene, options: SerializeOptions = {}): SerializedScene {
        const ctx = SceneSerializer._buildSerializeCtx(
            scene.getRootGameObjects(), options.prefabs === "link", null,
        );
        const roots = scene.getRootGameObjects().map(r => SceneSerializer._serializeGO(r, ctx, false));

        // Written after the walk: the table is filled as components are visited.
        const out: SerializedScene = {
            name: scene.name,
            version: 1,
            roots,
            renderSettings: SceneSerializer._serializeRenderSettings(),
        };
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
            const ctx = SceneSerializer._newContext();
            SceneSerializer._materializeAssets(json.assets, ctx);
            const roots = json.roots.map(r => SceneSerializer._deserializeGO(r, ctx));
            // Global, not per scene: only the scene that is (becoming) the active
            // one gets to set it. Before _resolveRefs, which publishes the pending
            // list the sky may join.
            if (json.renderSettings && prevActive === null) {
                SceneSerializer._applyRenderSettings(json.renderSettings, ctx);
            }
            SceneSerializer._resolveRefs(ctx, roots);
            return roots;
        } finally {
            if (prevActive) SceneManager.setActiveScene(prevActive);
        }
    }

    // ==================== GAMEOBJECT ====================

    /** Serializes a single GameObject and all its descendants. */
    public static serializeGameObject(go: GameObject, options: SerializeOptions = {}): SerializedGameObject {
        const ctx = SceneSerializer._buildSerializeCtx([go], options.prefabs === "link", null);
        const root = SceneSerializer._serializeGO(go, ctx, false);
        if (ctx.assetTable.length > 0) root.assets = ctx.assetTable;
        return root;
    }

    /**
     * @internal
     * The tree a prefab is made from: `go` written out in full whatever it is,
     * with any instance *inside* it kept as a link to its own prefab.
     *
     * @remarks
     * The root is expanded because the prefab being made is a new thing, not an
     * instance of whatever `go` happened to be; the nested ones are links
     * because that is what makes a prefab inside a prefab follow its own edits.
     *
     * **NEVER use in user-facing code.**
     */
    public static _serializeForPrefab(go: GameObject): SerializedGameObject {
        const ctx = SceneSerializer._buildSerializeCtx([go], true, null, false);
        const root = SceneSerializer._serializeNode(go, ctx, false, true);
        if (ctx.assetTable.length > 0) root.assets = ctx.assetTable;
        return root;
    }

    /**
     * Reconstructs a GameObject and its descendants from a snapshot.
     * If `scene` is provided it is temporarily made active so the new
     * GameObjects register there; the previous active scene is restored.
     */
    public static deserializeGameObject(json: SerializedGameObject, scene?: Scene): GameObject {
        return SceneSerializer._deserializeTree(json, scene, []);
    }

    /**
     * @internal
     * Builds a prefab's tree as an instance of it. The prefab's own guid seeds
     * the chain a nested link is checked against, so a prefab that contains
     * itself stops at the first level instead of the second.
     *
     * **NEVER use in user-facing code.**
     */
    public static _instantiatePrefab(json: SerializedGameObject, scene: Scene | undefined, guid: string | null): GameObject {
        return SceneSerializer._deserializeTree(json, scene, guid === null ? [] : [guid]);
    }

    private static _deserializeTree(json: SerializedGameObject, scene: Scene | undefined, chain: string[]): GameObject {
        let prevActive: Scene | null = null;
        if (scene && scene !== SceneManager.activeScene) {
            prevActive = SceneManager.activeScene;
            SceneManager.setActiveScene(scene);
        }
        try {
            const ctx = SceneSerializer._newContext(chain);
            SceneSerializer._materializeAssets(json.assets, ctx);
            const root = SceneSerializer._deserializeGO(json, ctx);
            SceneSerializer._resolveRefs(ctx, [root]);
            return root;
        } finally {
            if (prevActive) SceneManager.setActiveScene(prevActive);
        }
    }

    // ==================== ASSET FILES ====================

    /**
     * Writes an asset as a file of its own — a material, a physic material.
     *
     * @remarks
     * What a scene does for an asset that has no file, done once and kept: the
     * asset is value-serialized, and the textures it uses are referenced by id.
     * Give the result the path `Resources` will find it at and a scene that uses
     * the asset refers to it by that id instead of carrying a copy.
     *
     * @param asset - an instance of a class registered with `@Serializable`.
     * @throws if the class is not registered, which would leave nothing to read back.
     */
    public static serializeAsset(asset: object): SerializedAssetFile {
        const type = TypeRegistry.getTypeName(asset);
        if (type === null) {
            throw new Error(
                `[SceneSerializer] ${asset.constructor?.name ?? "This object"} is not registered ` +
                `with @Serializable, so it cannot be written as an asset file.`,
            );
        }

        const ctx = SceneSerializer._buildSerializeCtx([], false, null);
        const fields: Record<string, unknown> = {};
        for (const f of getAllFields(asset.constructor as any)) {
            if (!f.serialize) continue;
            fields[f.name] = ValueSerializer.serialize(
                (asset as any)[f.name], f.type, ctx, f.elementType,
            );
        }

        const out: SerializedAssetFile = { format: ASSET_FILE_FORMAT, version: 1, type, fields };
        if (ctx.assetTable.length > 0) out.assets = ctx.assetTable;
        return out;
    }

    /**
     * Rebuilds an asset from {@link serializeAsset}'s output.
     *
     * @remarks
     * Synchronous, so what it refers to must already be loaded — {@link
     * assetReferences} says what that is. A reference still missing leaves its
     * field null and is listed in {@link pendingAssetGuids}.
     *
     * @returns the asset, or null if its class is not registered.
     */
    public static deserializeAsset(file: SerializedAssetFile): object | null {
        if (file.format !== ASSET_FILE_FORMAT) {
            throw new Error(`[SceneSerializer] Not an asset file (format "${String(file.format)}").`);
        }

        const ctx = SceneSerializer._newContext();
        SceneSerializer._materializeAssets(file.assets, ctx);
        const asset = SceneSerializer._buildAsset(file.type, file.fields ?? {}, ctx);
        SceneSerializer._pending.push(...ctx.pendingAssetRefs);
        return asset;
    }

    /**
     * The ids of the assets a saved scene, prefab or asset file refers to and
     * does not carry.
     *
     * @remarks
     * What a loader has to have in memory before it rebuilds one — and, since
     * loading is asynchronous and rebuilding is not, the reason this is a
     * separate question. Assets stored inside the file are not listed.
     */
    public static assetReferences(json: object): string[] {
        const carried = new Set<string>(
            ((json as { assets?: SerializedAsset[] }).assets ?? []).map(a => a.guid),
        );
        const found = new Set<string>();

        const walk = (node: unknown): void => {
            if (Array.isArray(node)) {
                for (const item of node) walk(item);
                return;
            }
            if (node === null || typeof node !== "object") return;

            const obj = node as Record<string, unknown>;
            if (obj["$type"] === "AssetRef" && typeof obj["guid"] === "string") {
                found.add(obj["guid"]);
            } else if (obj["$type"] === "Sprite" && typeof obj["texture"] === "string") {
                found.add(obj["texture"]);
            }
            for (const key of Object.keys(obj)) walk(obj[key]);
        };
        walk(json);

        // The sky is named by id rather than wrapped in an AssetRef.
        const sky = (json as { renderSettings?: SerializedRenderSettings }).renderSettings;
        if (sky?.skybox) found.add(sky.skybox);
        if (sky?.environmentReflections) found.add(sky.environmentReflections);

        for (const guid of carried) found.delete(guid);
        return [...found];
    }

    private static _newContext(chain: readonly string[] = []): LoadCtx {
        const ctx: LoadCtx = {
            scopeStack: [],
            chain: [...chain],
            pendingGORefs: [],
            pendingComponentRefs: [],
            pendingAssetRefs: [],
            currentComponent: null,
            currentField: null,
            currentArrayIndex: null,
            buildNested: (type, fields) => SceneSerializer._buildNested(type, fields, ctx),
        };
        return ctx;
    }

    // ==================== PRIVATE — SERIALIZE ====================

    /**
     * @param roots - what paths are counted from.
     * @param link - whether a prefab instance is written as prefab plus changes.
     * @param outer - the pass this one is nested in, when it writes a single
     *   instance on its own: it shares the asset table, and a reference that
     *   leaves the instance is counted from the pass around it.
     * @param mintLive - whether ids minted for added nodes are stored on the
     *   live objects. Inherited from `outer` when there is one.
     */
    private static _buildSerializeCtx(
        roots: ReadonlyArray<GameObject>,
        link: boolean,
        outer: SceneCtx | null,
        mintLive: boolean = true,
    ): SceneCtx {
        const goToPath = new Map<GameObject, number[]>();
        const walk = (go: GameObject, path: number[]): void => {
            goToPath.set(go, path);
            const t = go.transform;
            for (let i = 0; i < t.childCount; i++) {
                walk(t.getChild(i).gameObject, [...path, i]);
            }
        };
        for (let i = 0; i < roots.length; i++) walk(roots[i], [i]);

        const assetTable: SerializedAsset[] = outer ? outer.assetTable : [];
        const inlined = outer ? outer.inlined : new Map<object, string>();
        // The inline-asset closure serializes fields, which needs the very
        // context being built — held in a box so it can refer to itself.
        const ctxRef: { value: SceneCtx | null } = { value: null };

        const ctx: SceneCtx = {
            goToPath,
            link,
            outer,
            inlined,
            minted: outer ? outer.minted : new Map<GameObject, string>(),
            mintLive: outer ? outer.mintLive : mintLive,
            locate: (go) => {
                let level = 0;
                for (let c: SceneCtx | null = ctxRef.value; c !== null; c = c.outer, level++) {
                    const path = c.goToPath.get(go);
                    if (path) return { path, scope: level };
                }
                return null;
            },
            assetTable,
            componentTypeName: (component) => SceneSerializer._typeNameOf(component),
            componentIndex: (owner, component) => {
                const list = (owner as unknown as { _components: Component[] })._components;
                const name = SceneSerializer._typeNameOf(component);
                let index = 0;
                for (const candidate of list) {
                    if (candidate === component) return index;
                    if (SceneSerializer._typeNameOf(candidate) === name) index++;
                }
                return 0;
            },
            nestedValue: (value) => {
                // A value whose class was not registered when the scene loaded is
                // written back as it was read.
                if (value instanceof MissingValue) {
                    return { type: value.type, fields: SceneSerializer._cloneJson(value.fields) };
                }
                const typeName = TypeRegistry.getTypeName(value);
                if (typeName === null) return null;

                const fields: Record<string, unknown> = {};
                for (const f of getAllFields(value.constructor as any)) {
                    if (!f.serialize) continue;
                    fields[f.name] = ValueSerializer.serialize(
                        (value as any)[f.name], f.type, ctxRef.value!, f.elementType,
                    );
                }
                return { type: typeName, fields };
            },
            inlineAsset: (asset) => {
                const already = inlined.get(asset);
                if (already !== undefined) return already;

                const typeName = TypeRegistry.getTypeName(asset);
                if (typeName === null) return null;

                // Registered before the fields are walked, so an asset that
                // somehow refers back to itself cannot recurse forever.
                const guid = SceneSerializer._inlineGuidOf(asset);
                inlined.set(asset, guid);

                const fields: Record<string, unknown> = {};
                assetTable.push({ guid, type: typeName, fields });
                for (const f of getAllFields(asset.constructor as any)) {
                    if (!f.serialize) continue;
                    fields[f.name] = ValueSerializer.serialize(
                        (asset as any)[f.name], f.type, ctxRef.value!, f.elementType,
                    );
                }
                return guid;
            },
        };

        ctxRef.value = ctx;
        return ctx;
    }

    /**
     * The id an asset with no file is written under.
     *
     * @remarks
     * The id it already has, when a scene's asset table gave it one; otherwise
     * the one minted the last time it was saved, so saving twice writes the
     * same file. A minted id is dropped once something else has been loaded
     * under it — a copy rebuilt from the saved table — since one id cannot name
     * two assets. Minted ids are kept beside the asset, not bound to it: binding
     * would make the next load reuse this instance instead of building the
     * values it saved.
     */
    private static _inlineGuidOf(asset: object): string {
        const bound = AssetDatabase.guidOf(asset);
        if (bound !== null) return bound;

        const minted = SceneSerializer._inlineGuids.get(asset);
        if (minted !== undefined && !AssetDatabase.isLoaded(minted)) return minted;

        const fresh = AssetDatabase._newGuid();
        SceneSerializer._inlineGuids.set(asset, fresh);
        return fresh;
    }

    /** Ids minted for assets with no file, by {@link _inlineGuidOf}. */
    private static readonly _inlineGuids = new WeakMap<object, string>();

    /**
     * Writes one object, deciding how a prefab instance is written.
     *
     * @param under - whether an instance root lies strictly above `go` in the
     *   tree being written, which is what decides whether `go` keeps its node
     *   id. A copy of a node from inside an instance therefore carries none and
     *   becomes an ordinary object, as a duplicate of one does in Unity.
     */
    private static _serializeGO(go: GameObject, ctx: SceneCtx, under: boolean): SerializedGameObject {
        const info = go._prefabInfo;
        if (info === null) return SceneSerializer._serializeNode(go, ctx, under, false);

        // An instance whose prefab could not be found: nothing was built from it,
        // so there is nothing to write but what it was read as.
        if (info.raw !== null) {
            if (go.transform.childCount > 0 || SceneSerializer._componentsOf(go).length > 0) {
                console.warn(
                    `[SceneSerializer] "${go.name}" stands in for a prefab that is not loaded, ` +
                    `so what was added under it has nothing to be recorded against and is not saved. ` +
                    `Load the prefab and open the scene again before changing it.`,
                );
            }
            const out = SceneSerializer._serializeShell(go, ctx, under);
            out.prefab = SceneSerializer._cloneJson(info.raw);
            return out;
        }

        // A prefab nothing can name cannot be linked to; it stays a plain tree.
        const guid = SceneSerializer._prefabGuid(info);
        if (guid === null) return SceneSerializer._serializeNode(go, ctx, under, true);

        const source = ctx.link ? SceneSerializer._prefabSourceOf(info) : null;
        if (source === null) return SceneSerializer._serializeExpanded(go, guid, info, ctx, under);
        return SceneSerializer._serializeInstance(go, guid, source, info, ctx, under);
    }

    /** An instance written in full, with a note of its prefab. */
    private static _serializeExpanded(
        go: GameObject,
        guid: string,
        info: PrefabInstanceInfo,
        ctx: SceneCtx,
        under: boolean,
    ): SerializedGameObject {
        const full = SceneSerializer._serializeNode(go, ctx, under, true);
        full.prefab = SceneSerializer._expandedLink(guid, info);
        return full;
    }

    /** The link an instance written in full carries: its prefab, and what no longer applies. */
    private static _expandedLink(guid: string, info: PrefabInstanceInfo): SerializedPrefabLink {
        const link: SerializedPrefabLink = { guid };
        if (info.unused !== null) link.unused = SceneSerializer._cloneJson(info.unused);
        return link;
    }

    /**
     * An instance as *prefab plus changes*.
     *
     * @remarks
     * Written by itself, as if it were the only thing in the file, so that it can
     * be compared with the prefab on equal terms — a reference between two of
     * its own objects is the same path in both. References that leave it are the
     * one thing that cannot be, and say how far out they count from.
     *
     * Objects added to the instance are given node ids first, so that saving
     * twice writes the same file. An instance that did something the changes
     * cannot record — moved one of the prefab's own nodes — is written in full
     * instead, and says why.
     */
    private static _serializeInstance(
        go: GameObject,
        guid: string,
        source: PrefabSource,
        info: PrefabInstanceInfo,
        outer: SceneCtx,
        under: boolean,
    ): SerializedGameObject {
        let tree: SerializedGameObject;
        try {
            tree = source._resolvedTree();
        } catch {
            return SceneSerializer._serializeExpanded(go, guid, info, outer, under);
        }

        SceneSerializer._mintAddedIds(go, outer);
        const local = SceneSerializer._buildSerializeCtx([go], true, outer);
        const expanded = SceneSerializer._serializeNode(go, local, false, true);

        const reason = PrefabDiff.inexpressible(tree, expanded);
        if (reason !== null) {
            console.warn(
                `[SceneSerializer] "${go.name}" is saved in full rather than as its prefab plus ` +
                `changes: ${reason}, which a prefab instance cannot record. It stops following ` +
                `edits to its prefab until it is reverted.`,
            );
            return SceneSerializer._serializeExpanded(go, guid, info, outer, under);
        }

        const changes = PrefabDiff.compareChanges(tree, expanded);
        changes.overrides = changes.overrides.filter(o => !SceneSerializer._isShellOverride(o, tree));

        const out = SceneSerializer._serializeShell(go, outer, under);
        out.prefab = { guid, changes };
        if (info.unused !== null) out.prefab.unused = SceneSerializer._cloneJson(info.unused);
        return out;
    }

    /**
     * Whether an override is one of the root fields the shell already carries:
     * name, position and rotation, which an instance never takes from its
     * prefab (Unity's default overrides).
     */
    private static _isShellOverride(o: PrefabOverride, tree: SerializedGameObject): boolean {
        const atRoot = o.node !== undefined ? o.node === tree.id : o.path.length === 0;
        return atRoot && o.component === null && SHELL_FIELDS.has(o.field);
    }

    /**
     * Gives every object of an instance's own that has no node id one: the
     * objects added to it. A nested instance's root is one of them; its
     * interior is not, since it belongs to the nested prefab.
     */
    private static _mintAddedIds(root: GameObject, ctx: SceneCtx): void {
        const walk = (parent: GameObject): void => {
            for (let i = 0; i < parent.transform.childCount; i++) {
                const child = parent.transform.getChild(i).gameObject;
                if (SceneSerializer._nodeIdOf(child, ctx) === null) {
                    const id = mintNodeId();
                    if (ctx.mintLive) child._prefabNodeId = id;
                    else ctx.minted.set(child, id);
                }
                if (child._prefabInfo === null) walk(child);
            }
        };
        walk(root);
    }

    /** An object's node id, as this pass writes it. */
    private static _nodeIdOf(go: GameObject, ctx: SceneCtx): string | null {
        return go._prefabNodeId ?? ctx.minted.get(go) ?? null;
    }

    /** The components a GameObject carries besides its Transform. */
    private static _componentsOf(go: GameObject): readonly Component[] {
        return (go as unknown as { _components: Component[] })._components;
    }

    /**
     * An object's own state, with nothing under it: name, activity, transform,
     * and its node id when `withId`.
     */
    private static _serializeShell(go: GameObject, ctx: SceneCtx, withId: boolean): SerializedGameObject {
        const t = go.transform;
        const out: SerializedGameObject = {
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
            components: [],
            children: [],
        };
        const id = withId ? SceneSerializer._nodeIdOf(go, ctx) : null;
        if (id !== null) out.id = id;
        return out;
    }

    /**
     * An object written in full, children before components (which fixes the
     * order of the asset table).
     *
     * @param under - see {@link _serializeGO}.
     * @param instanceRoot - whether `go` counts as an instance root for its
     *   children's ids. The root of a prefab being made always does.
     */
    private static _serializeNode(
        go: GameObject,
        ctx: SceneCtx,
        under: boolean,
        instanceRoot: boolean,
    ): SerializedGameObject {
        const t = go.transform;
        const out = SceneSerializer._serializeShell(go, ctx, under);
        for (let i = 0; i < t.childCount; i++) {
            out.children.push(SceneSerializer._serializeGO(t.getChild(i).gameObject, ctx, under || instanceRoot));
        }
        out.components = SceneSerializer._serializeComponents(go, ctx);
        return out;
    }

    /** The id a prefab instance's prefab is saved under, or null if it has none. */
    private static _prefabGuid(info: PrefabInstanceInfo): string | null {
        if (info.guid !== null) return info.guid;
        return info.source === null ? null : AssetDatabase.guidOf(info.source);
    }

    /**
     * The prefab an instance came from, if this session has it. The one loaded
     * under its id now wins over the one it was built from, so a prefab file
     * loaded again is the one its instances follow.
     */
    private static _prefabSourceOf(info: PrefabInstanceInfo): PrefabSource | null {
        const current = info.guid === null ? null : SceneSerializer._prefabById(info.guid);
        return current ?? info.source;
    }

    private static _prefabById(guid: string): PrefabSource | null {
        const found = AssetDatabase.get(guid) as Partial<PrefabSource> | null;
        return found !== null && typeof found._resolvedTree === "function"
            ? found as PrefabSource
            : null;
    }

    private static _serializeComponents(go: GameObject, ctx: SerializeContext): SerializedComponent[] {
        const out: SerializedComponent[] = [];
        const components = (go as unknown as { _components: Component[] })._components;
        for (const comp of components) {
            if (comp instanceof Transform) continue;

            // A component whose class was not registered when the scene loaded goes
            // back exactly as it came. Skipping it here is what used to delete it.
            if (comp instanceof MissingComponent) {
                out.push({
                    type: comp.originalType,
                    fields: SceneSerializer._cloneJson(comp.originalFields),
                });
                continue;
            }

            const typeName = TypeRegistry.getTypeName(comp);
            if (!typeName) continue;

            const fields: Record<string, unknown> = {};
            for (const f of getAllFields(comp.constructor as any)) {
                if (!f.serialize) continue;
                fields[f.name] = ValueSerializer.serialize(
                    (comp as any)[f.name], f.type, ctx, f.elementType,
                );
            }
            out.push({ type: typeName, fields });
        }
        return out;
    }

    private static _serializeRenderSettings(): SerializedRenderSettings {
        const fog = RenderSettings.fogColor;
        const ambient = RenderSettings.ambientColor;
        const out: SerializedRenderSettings = {
            fog: RenderSettings.fog,
            fogColor: { r: fog.r, g: fog.g, b: fog.b, a: fog.a },
            fogMode: RenderSettings.fogMode,
            fogStartDistance: RenderSettings.fogStartDistance,
            fogEndDistance: RenderSettings.fogEndDistance,
            fogDensity: RenderSettings.fogDensity,
            ambientColor: { r: ambient.r, g: ambient.g, b: ambient.b, a: ambient.a },
        };

        const skybox = SceneSerializer._skyGuid(RenderSettings.skybox);
        if (skybox !== null) out.skybox = skybox;
        const reflections = SceneSerializer._skyGuid(RenderSettings.environmentReflections);
        if (reflections !== null) out.environmentReflections = reflections;
        return out;
    }

    /** The id of the panorama a sky is drawn from, or null if it has no asset. */
    private static _skyGuid(sky: Cubemap | null): string | null {
        return sky === null ? null : AssetDatabase.guidOf(sky.sourceTexture);
    }

    // ==================== PRIVATE — DESERIALIZE ====================

    /**
     * Makes the global render settings what the file says.
     *
     * @remarks
     * The file is authoritative for everything in it, the sky included: a scene
     * saved without one is a scene without one, so opening it removes whatever
     * the previous scene had. A cubemap this serializer built is disposed when
     * it is replaced; one somebody else built is only let go of.
     */
    private static _applyRenderSettings(rs: SerializedRenderSettings, ctx: DeserializeContext): void {
        const num = (value: unknown, fallback: number): number =>
            typeof value === "number" && Number.isFinite(value) ? value : fallback;
        const color = (value: SerializedRenderSettings["fogColor"] | undefined, fallback: Color): Color =>
            value ? new Color(num(value.r, fallback.r), num(value.g, fallback.g),
                num(value.b, fallback.b), num(value.a, fallback.a)) : fallback;

        RenderSettings.fog = rs.fog === true;
        RenderSettings.fogColor = color(rs.fogColor, RenderSettings.fogColor);
        RenderSettings.fogMode = num(rs.fogMode, FogMode.Exponential) as FogMode;
        RenderSettings.fogStartDistance = num(rs.fogStartDistance, 0);
        RenderSettings.fogEndDistance = num(rs.fogEndDistance, 300);
        RenderSettings.fogDensity = num(rs.fogDensity, 0.01);
        RenderSettings.ambientColor = color(rs.ambientColor, RenderSettings.ambientColor);

        SceneSerializer._applySky("skybox", rs.skybox, ctx);
        SceneSerializer._applySky("environmentReflections", rs.environmentReflections, ctx);
    }

    private static _applySky(
        slot: "skybox" | "environmentReflections",
        guid: string | undefined,
        ctx: DeserializeContext,
    ): void {
        const current = RenderSettings[slot];
        const wanted = guid === undefined ? null : AssetDatabase.get(guid);

        // The same panorama again — an undo to a state that kept the sky — costs
        // nothing: the cubemap already drawing it stays.
        if (wanted !== null && current !== null && current.sourceTexture === wanted) return;

        const release = (): void => {
            if (current !== null && SceneSerializer._ownCubemaps.has(current)) current.dispose();
        };

        if (guid === undefined) {
            release();
            RenderSettings[slot] = null;
            return;
        }

        if (wanted === null) {
            // Not in memory yet. The slot is emptied rather than left showing the
            // previous scene's sky, and filled in by resolvePendingAssets.
            release();
            RenderSettings[slot] = null;
            ctx.pendingAssetRefs.push({
                component: RenderSettings,
                field: slot,
                guid,
                wrap: (asset) => SceneSerializer._skyFrom(asset),
            });
            return;
        }

        release();
        RenderSettings[slot] = SceneSerializer._skyFrom(wanted);
    }

    /** A cubemap over a loaded panorama, or null if the asset is not one. */
    private static _skyFrom(asset: object): Cubemap | null {
        if (!(asset instanceof Texture2D)) return null;
        const sky = Cubemap.fromTexture(asset);
        SceneSerializer._ownCubemaps.add(sky);
        return sky;
    }

    /** Cubemaps built here, which are therefore ours to dispose. */
    private static _ownCubemaps = new WeakSet<Cubemap>();

    /**
     * Rebuilds a nested serializable value from its type and fields.
     *
     * @remarks
     * References inside it defer exactly as they do inside a component: the
     * pending record points at *this* object, so the second pass fills it in
     * once the scene exists.
     */
    private static _buildNested(
        type: string,
        fields: Record<string, unknown>,
        ctx: DeserializeContext,
    ): object | null {
        const ctor = TypeRegistry.get(type);
        if (!ctor) {
            console.warn(`[SceneSerializer] Unknown nested type "${type}" — kept as it was saved`);
            return new MissingValue(type, SceneSerializer._cloneJson(fields));
        }

        const value = new ctor() as object;
        const outerComponent = ctx.currentComponent;
        const outerField = ctx.currentField;
        const outerIndex = ctx.currentArrayIndex;

        for (const f of getAllFields(ctor)) {
            if (!f.serialize) continue;
            if (!(f.name in fields)) continue;

            ctx.currentComponent = value;
            ctx.currentField = f.name;
            ctx.currentArrayIndex = null;
            const decoded = ValueSerializer.deserialize(fields[f.name], f.type, ctx, f.elementType);
            SceneSerializer._assign(value, f.name, decoded);
        }

        ctx.currentComponent = outerComponent;
        ctx.currentField = outerField;
        ctx.currentArrayIndex = outerIndex;
        return value;
    }

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

            const asset = SceneSerializer._buildAsset(entry.type, entry.fields, ctx);
            if (asset === null) continue;
            AssetDatabase._bindGuid(entry.guid, asset);
        }
    }

    /** Builds one asset from its type and fields, or null if the type is unknown. */
    private static _buildAsset(
        type: string,
        fields: Record<string, unknown>,
        ctx: DeserializeContext,
    ): object | null {
        const ctor = TypeRegistry.get(type);
        if (!ctor) {
            console.warn(`[SceneSerializer] Unknown asset type "${type}" — skipped`);
            return null;
        }

        const asset = new ctor() as object;
        for (const f of getAllFields(ctor)) {
            if (!f.serialize) continue;
            if (!(f.name in fields)) continue;

            ctx.currentComponent = asset;
            ctx.currentField = f.name;
            const value = ValueSerializer.deserialize(fields[f.name], f.type, ctx, f.elementType);
            ctx.currentComponent = null;
            ctx.currentField = null;
            SceneSerializer._assign(asset, f.name, value);
        }
        return asset;
    }

    /**
     * @internal
     * Builds an empty GameObject. Installed by `GameObject` when it loads.
     *
     * @remarks
     * A callback rather than an import, for the same reason as
     * {@link Texture._onDestroyed}. Constructing the class here was the edge
     * that closed the loop `GameObject` → `Prefab` → `SceneSerializer` →
     * `GameObject`, which Rollup warned about on every build. The loop was
     * harmless only because no module in it touched another while being
     * evaluated — nothing enforced that, and a single static field initializer
     * would have turned the warning into an `undefined` at load.
     *
     * The direction is deliberate. `GameObject` still reaches this module (its
     * `_clone` round-trips through it directly), so it is always the module
     * loaded first, and installing from there means the hook is in place before
     * anything can call it. Installing the other way round is what does not
     * work: nothing guarantees `Prefab` is loaded at all, and a build that
     * dropped it would leave `Instantiate` broken.
     *
     * **NEVER use in user-facing code.**
     */
    public static _createGameObject: ((name: string) => GameObject) | null = null;

    private static _deserializeGO(json: SerializedGameObject, ctx: LoadCtx): GameObject {
        const create = SceneSerializer._createGameObject;
        if (!create) {
            // Only reachable if this module was used without GameObject ever
            // being loaded, which leaves nothing to deserialize into.
            throw new Error(
                "[SceneSerializer] Cannot create GameObjects: the GameObject " +
                "module is not loaded. Import GameObject from \"WebEngineTS\".",
            );
        }

        if (json.prefab?.changes !== undefined) {
            return SceneSerializer._deserializeLink(json, ctx, create);
        }

        const go = create(json.name);
        go.setActive(json.active);
        SceneSerializer._applyPose(go, json.transform);
        SceneSerializer._buildContents(go, json, ctx);

        go._prefabNodeId = typeof json.id === "string" ? json.id : null;
        if (json.prefab && typeof json.prefab.guid === "string") {
            go._prefabInfo = {
                source: SceneSerializer._prefabById(json.prefab.guid),
                guid: json.prefab.guid,
                raw: null,
                unused: json.prefab.unused ? SceneSerializer._cloneJson(json.prefab.unused) : null,
            };
        }
        return go;
    }

    /** Builds an object's components, then its children, from saved JSON. */
    private static _buildContents(go: GameObject, json: SerializedGameObject, ctx: LoadCtx): void {
        for (const compJson of json.components) {
            SceneSerializer._deserializeComponent(compJson, go, ctx);
        }
        for (const childJson of json.children) {
            const child = SceneSerializer._deserializeGO(childJson, ctx);
            // The saved pose is already local; keeping the world pose instead
            // would subtract the parent's from it.
            child.transform.setParent(go.transform, false);
        }
    }

    /**
     * Rebuilds an instance saved as its prefab plus changes.
     *
     * @remarks
     * The shell supplies name, position and rotation, which an instance never
     * takes from its prefab; active and scale come from the prefab with the
     * changes applied, so an edit to the prefab's scale reaches an instance
     * that did not override it. While its contents are built the instance is
     * on the scope stack, which is what a scoped reference inside it is counted
     * against.
     */
    private static _deserializeLink(
        json: SerializedGameObject,
        ctx: LoadCtx,
        create: (name: string) => GameObject,
    ): GameObject {
        const link = json.prefab!;
        const guid = link.guid;

        if (ctx.chain.includes(guid)) {
            console.warn(
                `[SceneSerializer] "${json.name}" is an instance of a prefab that contains itself ` +
                `(${guid}). It is kept as a placeholder instead of being rebuilt without end.`,
            );
            return SceneSerializer._placeholder(json, create);
        }

        const source = SceneSerializer._prefabById(guid);
        let base: SerializedGameObject | null = null;
        if (source === null) {
            console.warn(
                `[SceneSerializer] "${json.name}" is an instance of prefab ${guid}, which is not ` +
                `loaded. It is kept as a placeholder and saved back as it was read; load the ` +
                `prefab and open the scene again to rebuild it.`,
            );
        } else {
            try {
                base = source._resolvedTree();
            } catch (error) {
                console.warn(
                    `[SceneSerializer] "${json.name}": prefab ${guid} could not be resolved, so the ` +
                    `instance is kept as a placeholder.`, error,
                );
            }
        }
        if (source === null || base === null) return SceneSerializer._placeholder(json, create);

        const all = SceneSerializer._mergeChanges(link.changes!, link.unused);
        const tree = PrefabDiff.applyChanges(base, all);
        const unused = PrefabDiff.unused(base, all);
        if (unused !== null) {
            const count = unused.overrides.length
                + (unused.addedChildren?.length ?? 0) + (unused.addedComponents?.length ?? 0);
            console.warn(
                `[SceneSerializer] "${json.name}": ${count} change(s) address objects its prefab ` +
                `no longer has. They are kept, and apply again if the prefab gets them back.`,
            );
        }

        SceneSerializer._materializeAssets(tree.assets, ctx);

        const go = create(json.name);
        go.setActive(tree.active);
        SceneSerializer._applyPose(go, {
            position: json.transform.position,
            rotation: json.transform.rotation,
            scale: tree.transform.scale,
        });
        go._prefabNodeId = typeof json.id === "string" ? json.id : null;
        // Set before the contents are built, so the instance is on the chain
        // for anything nested inside it.
        go._prefabInfo = { source, guid, raw: null, unused };

        ctx.scopeStack.push(go);
        ctx.chain.push(guid);
        try {
            SceneSerializer._buildContents(go, tree, ctx);
        } finally {
            ctx.scopeStack.pop();
            ctx.chain.pop();
        }
        return go;
    }

    /** An instance's changes together with the ones that did not apply last time. */
    private static _mergeChanges(changes: PrefabChanges, unused: PrefabChanges | undefined): PrefabChanges {
        if (!unused) return changes;
        return {
            overrides: [...changes.overrides, ...unused.overrides],
            addedChildren: [...(changes.addedChildren ?? []), ...(unused.addedChildren ?? [])],
            removedChildren: changes.removedChildren,
            addedComponents: [...(changes.addedComponents ?? []), ...(unused.addedComponents ?? [])],
            removedComponents: changes.removedComponents,
        };
    }

    /**
     * An instance that cannot be rebuilt, made from its saved shell: name,
     * activity, transform and id, with the link kept verbatim so that saving
     * writes it back unchanged.
     */
    private static _placeholder(
        json: SerializedGameObject,
        create: (name: string) => GameObject,
    ): GameObject {
        const go = create(json.name);
        go.setActive(json.active);
        SceneSerializer._applyPose(go, json.transform);
        go._prefabNodeId = typeof json.id === "string" ? json.id : null;
        go._prefabInfo = {
            source: null,
            guid: json.prefab!.guid,
            raw: SceneSerializer._cloneJson(json.prefab!),
            unused: null,
        };
        return go;
    }

    /** Sets an object's local position, rotation and scale from saved values. */
    private static _applyPose(go: GameObject, transform: SerializedGameObject["transform"]): void {
        const t = go.transform;
        const p = transform.position;
        const r = transform.rotation;
        const s = transform.scale;
        t.localPosition = t.localPosition.set(p.x, p.y, p.z);
        t.localRotation = t.localRotation.set(r.x, r.y, r.z, r.w);
        t.localScale    = t.localScale.set(s.x, s.y, s.z);
    }

    private static _deserializeComponent(
        json: SerializedComponent,
        go: GameObject,
        ctx: DeserializeContext,
    ): Component | null {
        const ctor = TypeRegistry.get(json.type);
        if (!ctor) {
            // Not skipped: a skipped component is a deleted one the next time the
            // scene is saved. It is kept inert, with its data, until the type
            // exists again.
            console.warn(`[SceneSerializer] Unknown component type "${json.type}" — kept as it was saved`);
            const missing = go.addComponent(MissingComponent);
            missing.originalType = json.type;
            missing.originalFields = SceneSerializer._cloneJson(json.fields ?? {});
            return missing;
        }

        const comp = go.addComponent(ctor as any) as Component;
        const fields = getAllFields(ctor as any);

        for (const f of fields) {
            if (!f.serialize) continue;
            if (!(f.name in json.fields)) continue;
            ctx.currentComponent = comp;
            ctx.currentField = f.name;
            const value = ValueSerializer.deserialize(
                json.fields[f.name], f.type, ctx, f.elementType,
            );
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
            const value = ref.wrap !== undefined
                ? ref.wrap(asset)
                : ref.sprite !== undefined
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
            const target = SceneSerializer._lookupScoped(roots, ref);
            SceneSerializer._writeRef(ref.component, ref.field, ref.arrayIndex, target);
        }

        for (const ref of ctx.pendingComponentRefs) {
            const owner = SceneSerializer._lookupScoped(roots, ref);
            const target = owner === null
                ? null
                : SceneSerializer._findComponent(owner, ref.typeName, ref.index);
            SceneSerializer._writeRef(ref.component, ref.field, ref.arrayIndex, target);
        }

        SceneSerializer._pending = ctx.pendingAssetRefs.slice();
    }

    /**
     * Resolves a pending reference against the roots its scope names: the
     * instance `scope` levels out from where it was read, or the roots being
     * loaded when it counts out past every instance. A scope deeper than that
     * is a malformed file and resolves to null.
     */
    private static _lookupScoped(
        roots: ReadonlyArray<GameObject>,
        ref: { component: object; field: string; path: number[]; ref?: RefScope },
    ): GameObject | null {
        const { stack, scope } = ref.ref ?? { stack: [], scope: 0 };
        let base: ReadonlyArray<GameObject>;
        if (scope < stack.length) base = [stack[stack.length - 1 - scope] as GameObject];
        else if (scope === stack.length) base = roots;
        else return null;

        const target = SceneSerializer._lookupByPath(base, ref.path);
        if (target === null) SceneSerializer._warnIfIntoPlaceholder(base, ref);
        return target;
    }

    /**
     * Says so when a reference came out null because it points into an
     * instance whose prefab is missing: it is lost if the scene is saved in
     * that state, and nobody would otherwise know why.
     */
    private static _warnIfIntoPlaceholder(
        roots: ReadonlyArray<GameObject>,
        ref: { component: object; field: string; path: number[] },
    ): void {
        const path = ref.path;
        if (path.length === 0 || path[0] < 0 || path[0] >= roots.length) return;
        let cur = roots[path[0]];
        for (let i = 1; i < path.length; i++) {
            if (cur._prefabInfo?.raw) {
                console.warn(
                    `[SceneSerializer] ${ref.component.constructor.name}.${ref.field} points into ` +
                    `"${cur.name}", whose prefab is not loaded. It is null for now, and is lost if ` +
                    `the scene is saved before the prefab is loaded.`,
                );
                return;
            }
            const idx = path[i];
            if (idx < 0 || idx >= cur.transform.childCount) return;
            cur = cur.transform.getChild(idx).gameObject;
        }
    }

    /**
     * Writes a resolved reference either over the field or into its array slot.
     *
     * @param owner - the component holding the field.
     * @param field - the field name.
     * @param arrayIndex - slot when the field is an array, null when it is not.
     * @param value - the resolved reference.
     */
    private static _writeRef(
        owner: object,
        field: string,
        arrayIndex: number | null,
        value: unknown,
    ): void {
        if (arrayIndex === null) {
            SceneSerializer._assign(owner, field, value);
            return;
        }

        const list = (owner as any)[field];
        if (Array.isArray(list)) list[arrayIndex] = value;
    }

    /** The `index`-th component of `typeName` on `go`, or null. */
    private static _findComponent(
        go: GameObject,
        typeName: string,
        index: number,
    ): Component | null {
        // A plain Transform has no registered name — it is never a component of
        // the saved list — yet a camera that follows one, or a script that holds
        // one, must still find it again.
        if (typeName === SceneSerializer._TRANSFORM) return go.transform;

        const list = (go as unknown as { _components: Component[] })._components;
        let seen = 0;
        for (const candidate of list) {
            if (SceneSerializer._typeNameOf(candidate) !== typeName) continue;
            if (seen === index) return candidate;
            seen++;
        }
        return null;
    }

    /**
     * The name a component is saved under: its registered type, or — for a
     * placeholder — the type it stands in for, so references to it round-trip.
     */
    private static _typeNameOf(component: object): string | null {
        if (component instanceof MissingComponent) return component.originalType;

        const registered = TypeRegistry.getTypeName(component);
        if (registered !== null) return registered;

        // The one component every object has and no registry lists: it is saved
        // as the object's own transform block, so references to it get a name
        // here instead.
        return component instanceof Transform ? SceneSerializer._TRANSFORM : null;
    }

    /** What a reference to a plain `Transform` calls its target. */
    private static readonly _TRANSFORM = "Transform";

    /** A deep copy of saved JSON, so a placeholder never shares its data with the file it came from. */
    private static _cloneJson<T>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
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
