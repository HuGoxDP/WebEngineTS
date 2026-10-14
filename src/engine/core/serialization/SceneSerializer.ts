import type { Scene } from "../Scene";
import type { GameObject } from "../GameObject";
import { Component } from "../Component";
import { Transform } from "../Transform";
import { SceneManager } from "../SceneManager";
import { TypeRegistry, type AnyConstructor } from "../reflection/TypeRegistry";
import { getAllFields } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import { AssetDatabase } from "../assets/AssetDatabase";
import { RenderSettings, FogMode } from "../RenderSettings";
import { Cubemap } from "../graphics/Cubemap";
import { Texture2D } from "../graphics/Texture2D";
import { Color } from "../math/Color";
import { MissingComponent, MissingValue } from "./MissingComponent";
import {
    PrefabDiff,
    mintNodeId,
    encodeNodePath,
    findNodeById,
    type NodeAccess,
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
    /** What paths in this pass are counted from. */
    readonly roots: ReadonlyArray<GameObject>;
    /**
     * The object a prefab is being made from, which counts as an instance root
     * for its own nodes' ids although it is not one; null otherwise.
     */
    readonly prefabRoot: GameObject | null;
    /**
     * Whether a prefab instance is written as prefab plus changes. Paths in
     * such a pass address nodes inside an instance by id.
     */
    readonly link: boolean;
    /** The pass this one is nested in, or null for the outermost. */
    readonly outer: SceneCtx | null;
    /** Inline assets already written, shared with {@link outer}. */
    readonly inlined: Map<object, string>;
    /**
     * Every inline asset written anywhere in the pass, by the id it was
     * written under — what a linked instance's own table is read back
     * against. Shared with {@link outer}.
     */
    readonly writtenAssets: Map<string, object>;
    /**
     * Node ids given to objects that had none, for a pass that must leave the
     * live objects as they are. Shared with {@link outer}.
     */
    readonly minted: Map<GameObject, string>;
    /** Whether an id minted for an added node is stored on the live object. */
    readonly mintLive: boolean;
    /**
     * Whether this pass writes a prefab's tree, or an instance to be compared
     * with one. An asset a prefab carries keeps the prefab's id here, so that
     * an untouched instance compares equal; a table of anything else — a
     * scene's — writes it under an id of its own ({@link SceneSerializer}'s
     * `_tableGuidOf`).
     */
    readonly prefabIds: boolean;
    /** Shared with {@link outer}. */
    assetTable: SerializedAsset[];
    locate(go: GameObject): { path: Array<number | string>; scope: number } | null;
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

/**
 * @internal
 * A field — or one slot of an array in it — that holds a GameObject or a
 * component, found by {@link SceneSerializer._heldReferences}. Not part of the
 * API.
 */
export interface HeldReference<T> {
    /** Puts a value where the reference was. */
    readonly assign: (value: GameObject | Component | null) => void;
    /** The holder's object, component and field, for a warning. */
    readonly where: string;
    /** What the caller made of the object it held. */
    readonly target: T;
}

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
     *   edit to the prefab either. The exception is a placeholder for a prefab
     *   that was not loaded when it was read: having no tree, it is written
     *   back as the link it was read as, in either mode.
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
    /**
     * What this entry is a copy of: an inline asset a prefab carries in its
     * own table, by the prefab's id and the asset's id in that table.
     *
     * @remarks
     * A scene never names a prefab's inline asset by the prefab's id, so it
     * carries a copy under an id of its own. Loading the scene while that
     * prefab is loaded, and its asset still serializes as this entry does,
     * binds the entry to the prefab's own asset instead of building the copy,
     * so the scene's instances go on sharing — and following — the prefab's
     * material; another loaded prefab whose table carries the same id will do.
     * Otherwise the copy is used. Optional: a reader that does not know it
     * ignores it and uses the copy.
     *
     * {@link SceneSerializer.assetReferences} lists the prefab, as one the
     * file reads without ({@link SceneSerializer.optionalAssetReferences}).
     * Loaded only after the scene, it cannot re-bind the copy, but a copy
     * that still serializes as the prefab's asset counts as that asset where
     * an instance is compared with its prefab or saved as a link.
     */
    of?: { prefab: string; id: string };
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
    /**
     * The format. `2` when the file holds something a reader that predates
     * prefab links would misread rather than refuse: an instance saved as its
     * prefab plus changes, or a reference that names a prefab node by id.
     * Anything else is written as `1`, byte for byte as before. A reader
     * refuses a version it does not know.
     */
    version: 1 | 2;
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
        if (ctx.link) for (const root of scene.getRootGameObjects()) SceneSerializer._mintAll(root, ctx);
        const roots = scene.getRootGameObjects().map(r => SceneSerializer._serializeGO(r, ctx, false));

        // Written after the walk: the table is filled as components are visited.
        const out: SerializedScene = {
            name: scene.name,
            version: SceneSerializer._needsLinkReader(roots) ? 2 : 1,
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
        SceneSerializer._refuseUnknownVersion(json.version, "scene");
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
        if (ctx.link) SceneSerializer._mintAll(go, ctx);
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
     * Every node gets an id. Those it lacks are minted for this call only,
     * unless `mintLive`, which stores them on the objects — what makes the
     * objects nodes of the prefab written from them.
     *
     * `match` is the prefab `go` is about to be compared with. When none of
     * `go`'s own objects has an id — a copy made before ids existed, or the
     * object a prefab was made from without connecting it — each takes the id
     * of the prefab node at its place instead of a fresh one, so the two are
     * compared node for node by position, as they were before ids, rather
     * than as an instance whose every child was added and whose every
     * reference names nodes the prefab does not have.
     *
     * `outward` writes a reference that leaves `go` the way a link save of
     * its scene writes it — counted out through the instances around `go` to
     * the scene, with its `scope` — rather than as null, which is all a prefab
     * can hold. What an instance is compared with is read this way, so that a
     * reference to the rest of the scene is a change, as a link save records
     * it.
     *
     * **NEVER use in user-facing code.**
     */
    public static _serializeForPrefab(
        go: GameObject,
        options: { mintLive?: boolean; match?: SerializedGameObject; outward?: boolean } = {},
    ): SerializedGameObject {
        const mintLive = options.mintLive ?? false;
        const outer = options.outward === true ? SceneSerializer._enclosingCtx(go, mintLive) : null;
        const ctx = SceneSerializer._buildSerializeCtx([go], true, outer, {
            mintLive,
            prefabRoot: go,
            ownAssets: true,
        });
        // Every node gets its id before anything is written, so that the
        // prefab's own references can address them by it.
        SceneSerializer._giveAllIds(go, options.match, ctx);
        const root = SceneSerializer._serializeNode(go, ctx, false, true);
        if (ctx.assetTable.length > 0) root.assets = ctx.assetTable;
        return root;
    }

    /**
     * @internal
     * Stores on `go` and the objects below it the node ids
     * {@link _serializeForPrefab} with `mintLive` would give them, and writes
     * nothing: an object added to an instance gets a new id, and one of a copy
     * from before ids the id of the node at its place in `match`. What a
     * revert does first, so that it can tell the objects it builds again from
     * those it takes away.
     *
     * **NEVER use in user-facing code.**
     */
    public static _nameForPrefab(go: GameObject, match?: SerializedGameObject): void {
        const ctx = SceneSerializer._buildSerializeCtx([go], true, null, { mintLive: true, prefabRoot: go });
        SceneSerializer._giveAllIds(go, match, ctx);
    }

    /** {@link _borrowIds} from `match` for a copy from before ids, then {@link _mintAll}. */
    private static _giveAllIds(go: GameObject, match: SerializedGameObject | undefined, ctx: SceneCtx): void {
        if (match !== undefined && !SceneSerializer._hasOwnIds(go, ctx)) {
            SceneSerializer._borrowIds(go, match, ctx);
        }
        SceneSerializer._mintAll(go, ctx);
    }

    /**
     * The passes a link save of `go`'s scene opens around `go`: the scene's,
     * then one for each instance written as a link that `go` lies inside,
     * outermost first. Nothing is minted in them; a reference to an object
     * added to another instance and never saved is written by position.
     */
    private static _enclosingCtx(go: GameObject, mintLive: boolean): SceneCtx {
        let ctx = SceneSerializer._buildSerializeCtx(go.scene.getRootGameObjects(), true, null, { mintLive });
        const around: GameObject[] = [];
        for (let t = go.transform.parent; t !== null; t = t.parent) {
            if (SceneSerializer._writtenAsLink(t.gameObject, ctx)) around.unshift(t.gameObject);
        }
        for (const root of around) {
            ctx = SceneSerializer._buildSerializeCtx([root], true, ctx, { ownAssets: true });
        }
        return ctx;
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
     *
     * Prefabs are listed when something has to be rebuilt from them: an
     * instance saved as its prefab plus changes. An instance saved in full
     * names its prefab too, but reading it needs nothing, and its link is found
     * once the prefab is loaded.
     *
     * A prefab whose inline asset the file carries a copy of
     * ({@link SerializedAsset.of}) is listed too, though the file reads
     * without it: loaded first, it lets the copy be the prefab's own asset, so
     * the file's instances share and follow it. {@link optionalAssetReferences}
     * says which ids those are, so that a loader passes over one the project
     * does not have without a warning.
     */
    public static assetReferences(json: object): string[] {
        const { required, optional } = SceneSerializer._references(json);
        return [...required, ...optional];
    }

    /**
     * The ids {@link assetReferences} lists that the file reads without: the
     * prefabs its asset table holds copies from ({@link SerializedAsset.of}).
     * Load each when the project has it; one it does not have is no error, and
     * the file uses its own copy.
     */
    public static optionalAssetReferences(json: object): string[] {
        return [...SceneSerializer._references(json).optional];
    }

    /** What {@link assetReferences} lists, split by whether reading the file needs it. */
    private static _references(json: object): { required: Set<string>; optional: Set<string> } {
        const table = (json as { assets?: SerializedAsset[] }).assets ?? [];
        const carried = new Set<string>(table.map(a => a.guid));
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
            // A prefab an instance is rebuilt from. One written in full only
            // notes where it came from, and needs nothing to be read.
            const link = SceneSerializer._linkGuid(obj["prefab"])
                ?? (obj["field"] === "prefab" ? SceneSerializer._linkGuid(obj["value"]) : null);
            if (link !== null) found.add(link);
            for (const key of Object.keys(obj)) walk(obj[key]);
        };
        walk(json);

        // A prefab variant's file names its base by id: rebuilding it needs it.
        const base = (json as { base?: unknown }).base;
        if (typeof base === "string") found.add(base);

        // The sky is named by id rather than wrapped in an AssetRef.
        const sky = (json as { renderSettings?: SerializedRenderSettings }).renderSettings;
        if (sky?.skybox) found.add(sky.skybox);
        if (sky?.environmentReflections) found.add(sky.environmentReflections);

        const optional = new Set<string>();
        for (const entry of table) {
            const of = SceneSerializer._originOf(entry);
            if (of !== null && !found.has(of.prefab)) optional.add(of.prefab);
        }
        for (const guid of carried) {
            found.delete(guid);
            optional.delete(guid);
        }
        return { required: found, optional };
    }

    /** The guid of a prefab link that has to be rebuilt from its prefab, or null. */
    private static _linkGuid(value: unknown): string | null {
        if (value === null || typeof value !== "object") return null;
        const link = value as Partial<SerializedPrefabLink>;
        return typeof link.guid === "string" && link.changes !== null && typeof link.changes === "object"
            ? link.guid
            : null;
    }

    /**
     * @internal
     * Whether saved JSON holds what only a reader that knows prefab links can
     * read: a link to rebuild, or a reference path with a node id in it. Such
     * a file is written as version 2, so that an older reader refuses it
     * instead of loading instances hollow or following ids as child indices.
     *
     * **NEVER use in user-facing code.**
     */
    public static _needsLinkReader(json: unknown): boolean {
        if (Array.isArray(json)) return json.some(item => SceneSerializer._needsLinkReader(item));
        if (json === null || typeof json !== "object") return false;

        const obj = json as Record<string, unknown>;
        if (SceneSerializer._linkGuid(obj["prefab"]) !== null) return true;
        const isRef = obj["$type"] === "GameObjectRef" || obj["$type"] === "ComponentRef";
        if (isRef && Array.isArray(obj["path"]) && (obj["path"] as unknown[]).some(s => typeof s === "string")) {
            return true;
        }
        return Object.keys(obj).some(key => SceneSerializer._needsLinkReader(obj[key]));
    }

    /**
     * @internal
     * Throws for a file format version this build does not know. Absent means
     * 1; 1 and 2 are read.
     *
     * **NEVER use in user-facing code.**
     */
    public static _refuseUnknownVersion(version: unknown, what: string): void {
        if (typeof version === "number" && version > 2) {
            throw new Error(
                `[SceneSerializer] This ${what} was written in format version ${version}, which this ` +
                `build of the engine cannot read (it reads versions 1 and 2). Update the engine.`,
            );
        }
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
     * @param options.mintLive - whether ids minted for added nodes are stored
     *   on the live objects. Default true; inherited from `outer` when there
     *   is one.
     * @param options.prefabRoot - see {@link SceneCtx.prefabRoot}.
     * @param options.ownAssets - keep an asset table of its own instead of
     *   sharing `outer`'s, so that a linked instance can pass on only what its
     *   changes need.
     */
    private static _buildSerializeCtx(
        roots: ReadonlyArray<GameObject>,
        link: boolean,
        outer: SceneCtx | null,
        options: { mintLive?: boolean; prefabRoot?: GameObject; ownAssets?: boolean } = {},
    ): SceneCtx {
        const mintLive = options.mintLive ?? true;
        const prefabRoot = options.prefabRoot ?? null;
        const shared = outer !== null && options.ownAssets !== true;
        const prefabIds = prefabRoot !== null || options.ownAssets === true || (outer?.prefabIds ?? false);
        const goToPath = new Map<GameObject, number[]>();
        const walk = (go: GameObject, path: number[]): void => {
            goToPath.set(go, path);
            const t = go.transform;
            for (let i = 0; i < t.childCount; i++) {
                walk(t.getChild(i).gameObject, [...path, i]);
            }
        };
        for (let i = 0; i < roots.length; i++) walk(roots[i], [i]);

        const assetTable: SerializedAsset[] = shared ? outer.assetTable : [];
        const inlined = shared ? outer.inlined : new Map<object, string>();
        // The inline-asset closure serializes fields, which needs the very
        // context being built — held in a box so it can refer to itself.
        const ctxRef: { value: SceneCtx | null } = { value: null };

        const ctx: SceneCtx = {
            goToPath,
            roots,
            prefabRoot,
            link,
            outer,
            inlined,
            writtenAssets: outer ? outer.writtenAssets : new Map<string, object>(),
            minted: outer ? outer.minted : new Map<GameObject, string>(),
            mintLive: outer ? outer.mintLive : mintLive,
            prefabIds,
            locate: (go) => {
                let level = 0;
                for (let c: SceneCtx | null = ctxRef.value; c !== null; c = c.outer, level++) {
                    const path = c.goToPath.get(go);
                    if (path) return { path: c.link ? SceneSerializer._encodePath(c, path) : path, scope: level };
                }
                return null;
            },
            assetTable,
            componentTypeName: (component) => SceneSerializer._typeNameOf(component),
            componentIndex: (owner, component) => {
                // The one component kept outside the list, and found by name.
                if (component instanceof Transform) return component === owner.transform ? 0 : -1;
                const list = (owner as unknown as { _components: Component[] })._components;
                const name = SceneSerializer._typeNameOf(component);
                let index = 0;
                for (const candidate of list) {
                    if (candidate === component) return index;
                    if (SceneSerializer._typeNameOf(candidate) === name) index++;
                }
                return -1;
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
                const guid = SceneSerializer._tableGuidOf(asset, prefabIds);
                inlined.set(asset, guid);
                ctxRef.value!.writtenAssets.set(guid, asset);
                // Already passed up from a linked instance's own table.
                if (assetTable.some(entry => entry.guid === guid)) return guid;

                const fields: Record<string, unknown> = {};
                const of = prefabIds ? null : SceneSerializer._copyOf(asset, guid);
                assetTable.push(of === null ? { guid, type: typeName, fields } : { guid, type: typeName, fields, of });
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
     * The id an asset with no file is written under in a table, given whether
     * the table is a prefab's ({@link SceneCtx.prefabIds}).
     *
     * @remarks
     * A prefab's own inline asset — a material built in code — is written into
     * the prefab's file under an id, and an instance of the prefab uses the
     * asset rebuilt from it. A scene that wrote it under the same id would
     * carry a second copy of one id: whichever file a session read first would
     * decide what the id is, so a scene opened before an edited prefab handed
     * every new instance of the prefab the scene's stale copy, and the other
     * order handed the scene's instance the prefab's. Outside a prefab's tree
     * such an asset is therefore written under an id of the scene's own, kept
     * for the asset so that saving twice writes the same file. While the
     * prefab's asset is in memory that id finds it too
     * (`AssetDatabase._bindAlias`), so a copy, an undo or a Play restore made
     * in the same session goes on sharing it.
     */
    private static _tableGuidOf(asset: object, prefabIds: boolean): string {
        if (prefabIds) {
            const twin = SceneSerializer._twinId(asset);
            if (twin !== null) return twin;
        }
        if (!prefabIds) {
            const copy = SceneSerializer._sceneCopyGuids.get(asset);
            if (copy !== undefined && (!AssetDatabase.isLoaded(copy) || AssetDatabase.get(copy) === asset)) {
                if (AssetDatabase.guidOf(asset) !== null) AssetDatabase._bindAlias(copy, asset);
                return copy;
            }
        }

        const own = SceneSerializer._inlineGuidOf(asset);
        if (prefabIds || !SceneSerializer._prefabAssetGuids.has(own)) return own;

        const fresh = AssetDatabase._newGuid();
        SceneSerializer._sceneCopyGuids.set(asset, fresh);
        if (AssetDatabase.guidOf(asset) !== null) AssetDatabase._bindAlias(fresh, asset);
        return fresh;
    }

    /** Ids a scene writes a prefab's inline asset under, by {@link _tableGuidOf}. */
    private static readonly _sceneCopyGuids = new WeakMap<object, string>();

    /** The ids a prefab's own asset table uses, by {@link _claimPrefabAssets}. */
    private static readonly _prefabAssetGuids = new Set<string>();

    /** The prefabs whose tables use each id, by {@link _claimPrefabAssets}. */
    private static readonly _prefabAssetOwners = new Map<string, WeakRef<PrefabSource>[]>();

    /**
     * What a scene's copy of a prefab's asset that was read back as a copy is
     * a copy of — its `of` — so that saving it again keeps saying so.
     */
    private static readonly _copyOrigins = new WeakMap<object, { prefab: string; id: string }>();

    /**
     * @internal
     * Records the ids of the assets a prefab's tree carries as the prefab's,
     * so that no scene writes its own copy of one under the same id, and which
     * prefab carries them, so that a scene's copy can say what it is a copy
     * of ({@link SerializedAsset.of}). Called by `Prefab` for every tree it
     * holds.
     *
     * **NEVER use in user-facing code.**
     */
    public static _claimPrefabAssets(tree: SerializedGameObject | null, owner?: PrefabSource): void {
        for (const entry of tree?.assets ?? []) {
            SceneSerializer._prefabAssetGuids.add(entry.guid);
            if (owner === undefined) continue;
            const owners = (SceneSerializer._prefabAssetOwners.get(entry.guid) ?? [])
                .filter(ref => ref.deref() !== undefined && ref.deref() !== owner);
            owners.push(new WeakRef(owner));
            SceneSerializer._prefabAssetOwners.set(entry.guid, owners);
        }
    }

    /**
     * The `of` of a table entry: the prefab, and the id in its table, of the
     * prefab's own asset that `asset` is or was read back as a copy of, when
     * the table writes it under another id; null otherwise.
     *
     * @remarks
     * Of the prefabs whose tables use the asset's id, the first that is loaded
     * under an id of its own and still carries it. A prefab that does not is
     * not named: a reader could not find its asset anyway.
     */
    private static _copyOf(asset: object, written: string): { prefab: string; id: string } | null {
        const read = SceneSerializer._copyOrigins.get(asset);
        if (read !== undefined) return read.id === written ? null : { ...read };

        const own = AssetDatabase.guidOf(asset) ?? SceneSerializer._inlineGuids.get(asset) ?? null;
        if (own === null || own === written || !SceneSerializer._prefabAssetGuids.has(own)) return null;
        for (const ref of SceneSerializer._prefabAssetOwners.get(own) ?? []) {
            const owner = ref.deref();
            const prefab = owner === undefined ? null : AssetDatabase.guidOf(owner);
            if (prefab === null) continue;
            const tree = SceneSerializer._prefabTree(prefab);
            if (tree?.assets?.some(entry => entry.guid === own)) return { prefab, id: own };
        }
        return null;
    }

    /**
     * Binds a scene's table entry that is a copy of a prefab's inline asset
     * ({@link SerializedAsset.of}) to the prefab's own asset, when a loaded
     * prefab carrying it ({@link _prefabsCarrying}) has it serialize exactly
     * as the entry does. The prefab's table is built as an instance of it
     * would build it, and the asset keeps the entry's `of` for the next save.
     *
     * @returns whether the entry was bound; when not, the caller builds the copy.
     */
    private static _bindToPrefabAsset(entry: SerializedAsset, ctx: DeserializeContext): boolean {
        const of = SceneSerializer._originOf(entry);
        if (of === null) return false;
        for (const prefab of SceneSerializer._prefabsCarrying(of)) {
            const tree = SceneSerializer._prefabTree(prefab);
            const own = tree?.assets?.find(candidate => candidate.guid === of.id);
            if (tree === null || own === undefined || own.type !== entry.type
                || !SceneSerializer._sameJson(own.fields, entry.fields)) {
                continue;
            }

            SceneSerializer._materializeAssets(tree.assets, ctx, false);
            const asset = AssetDatabase.get(of.id);
            if (asset === null) continue;
            AssetDatabase._bindAlias(entry.guid, asset);
            SceneSerializer._sceneCopyGuids.set(asset, entry.guid);
            // Kept with the asset, so that the scene goes on saying what it
            // copies once the prefab is unloaded.
            SceneSerializer._copyOrigins.set(asset, of);
            return true;
        }
        return false;
    }

    /** A table entry's {@link SerializedAsset.of}, when it is well formed. */
    private static _originOf(entry: SerializedAsset): { prefab: string; id: string } | null {
        const of = entry.of as unknown;
        if (of === null || typeof of !== "object") return null;
        const { prefab, id } = of as Record<string, unknown>;
        return typeof prefab === "string" && typeof id === "string" ? { prefab, id } : null;
    }

    /**
     * The loaded prefabs that may carry the asset `of` names: the prefab it
     * names, then any other loaded prefab whose table uses the same id — one
     * material object saved into two prefabs is written into both under one
     * id, and `of` names only the first.
     */
    private static *_prefabsCarrying(of: { prefab: string; id: string }): Generator<string> {
        yield of.prefab;
        for (const ref of SceneSerializer._prefabAssetOwners.get(of.id) ?? []) {
            const owner = ref.deref();
            const guid = owner === undefined ? null : AssetDatabase.guidOf(owner);
            if (guid !== null && guid !== of.prefab) yield guid;
        }
    }

    /**
     * The id, in a prefab's table, of the prefab asset that `asset` — a
     * scene's copy of it ({@link SerializedAsset.of}) — stands for, or null.
     *
     * @remarks
     * A scene opened before its prefab, as the editor opens one, builds the
     * copy, and nothing re-binds it once the prefab loads. Where an instance
     * is compared with its prefab or written as a link, a copy that still
     * serializes as a loaded prefab's asset does is taken for that asset, so
     * it is no change of the instance's and a link save carries nothing. The
     * copy stays a separate object until the scene is opened again: an edit
     * to the prefab's material does not reach it before then.
     */
    private static _twinId(asset: object): string | null {
        const origin = SceneSerializer._copyOrigins.get(asset);
        if (origin === undefined || SceneSerializer._twinning.has(asset)) return null;
        const type = TypeRegistry.getTypeName(asset);
        SceneSerializer._twinning.add(asset);
        try {
            let fields: Record<string, unknown> | null = null;
            for (const prefab of SceneSerializer._prefabsCarrying(origin)) {
                const own = SceneSerializer._prefabTree(prefab)?.assets?.find(entry => entry.guid === origin.id);
                if (own === undefined || own.type !== type) continue;
                fields ??= SceneSerializer._assetFields(asset);
                if (SceneSerializer._sameJson(own.fields, fields)) return origin.id;
            }
            return null;
        } finally {
            SceneSerializer._twinning.delete(asset);
        }
    }

    /** The copies {@link _twinId} is comparing, so that one that refers to itself stops. */
    private static readonly _twinning = new Set<object>();

    /** An asset's fields as a prefab's table writes them, writing nothing anywhere. */
    private static _assetFields(asset: object): Record<string, unknown> {
        const ctx = SceneSerializer._buildSerializeCtx([], false, null, { ownAssets: true });
        const fields: Record<string, unknown> = {};
        for (const f of getAllFields(asset.constructor as AnyConstructor)) {
            if (!f.serialize) continue;
            fields[f.name] = ValueSerializer.serialize(
                (asset as Record<string, unknown>)[f.name], f.type, ctx, f.elementType,
            );
        }
        return fields;
    }

    /** Whether two pieces of saved JSON are equal, whatever the order of their keys. */
    private static _sameJson(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        const ka = Object.keys(a as object);
        const kb = Object.keys(b as object);
        if (ka.length !== kb.length) return false;
        return ka.every(key => Object.prototype.hasOwnProperty.call(b, key)
            && SceneSerializer._sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
    }

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

        // A prefab nothing can name cannot be linked to; it stays a plain tree,
        // and nothing reading it sees an instance there.
        const guid = SceneSerializer._prefabGuid(info);
        if (guid === null) return SceneSerializer._serializeNode(go, ctx, under, false);

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
     * Objects added to the instance were given node ids before the walk
     * began ({@link _mintAll}), so that saving twice writes the same file. An
     * instance that did something the changes cannot record — moved one of
     * the prefab's own nodes — is written in full instead, and says why.
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

        const local = SceneSerializer._buildSerializeCtx([go], true, outer, { ownAssets: true });
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

        const changes = PrefabDiff.compareChanges(tree, expanded, SceneSerializer._prefabTree);
        changes.overrides = changes.overrides.filter(o => !SceneSerializer._isShellOverride(o, tree));
        if (SceneSerializer._dropsContents(tree, changes)) {
            console.warn(
                `[SceneSerializer] "${go.name}" is saved in full rather than as its prefab plus ` +
                `changes: a prefab instance inside it that its prefab keeps as a link is saved in ` +
                `full, at a place the changes can only address by position. It stops following ` +
                `edits to its prefab until it is reverted.`,
            );
            return SceneSerializer._serializeExpanded(go, guid, info, outer, under);
        }

        const out = SceneSerializer._serializeShell(go, outer, under);
        out.prefab = { guid, changes };
        if (info.unused !== null) out.prefab.unused = SceneSerializer._cloneJson(info.unused);
        SceneSerializer._carryAssets(local, tree, out.prefab, outer);
        return out;
    }

    /**
     * Passes up the inline assets a linked instance's changes need.
     *
     * @remarks
     * The instance was written with a table of its own, which holds every
     * inline asset it uses — mostly the prefab's own, which the prefab carries
     * and which would otherwise be copied into every scene that uses it. Worse,
     * the first copy of an id to load is the one kept, so a stale scene copy
     * could shadow an edited prefab. Only what the changes refer to, directly
     * or through another such asset, and the prefab does not carry, goes up.
     *
     * One that another prefab carries — a material the instance took from a
     * different prefab — goes up into a table that is not a prefab's under
     * the id that table writes it under, for the same reason, and the changes
     * refer to it by that id.
     */
    private static _carryAssets(
        local: SceneCtx,
        tree: SerializedGameObject,
        link: SerializedPrefabLink,
        outer: SceneCtx,
    ): void {
        if (local.assetTable.length === 0) return;
        const byGuid = new Map(local.assetTable.map(entry => [entry.guid, entry]));
        const needed = new Set<string>();
        const visit = (value: unknown): void => {
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (value === null || typeof value !== "object") return;
            const obj = value as Record<string, unknown>;
            if (obj["$type"] === "AssetRef" && typeof obj["guid"] === "string") {
                const entry = byGuid.get(obj["guid"]);
                if (entry !== undefined && !needed.has(entry.guid)) {
                    needed.add(entry.guid);
                    visit(entry.fields);
                }
            }
            for (const key of Object.keys(obj)) visit(obj[key]);
        };
        visit(link.changes);
        visit(link.unused);

        const carried = new Set((tree.assets ?? []).map(entry => entry.guid));
        const going = local.assetTable.filter(entry => needed.has(entry.guid) && !carried.has(entry.guid));

        const renamed = new Map<string, string>();
        if (!outer.prefabIds) {
            for (const entry of going) {
                const asset = local.writtenAssets.get(entry.guid);
                if (asset === undefined || !SceneSerializer._prefabAssetGuids.has(entry.guid)) continue;
                renamed.set(entry.guid, SceneSerializer._tableGuidOf(asset, false));
            }
        }
        if (renamed.size > 0) {
            SceneSerializer._renameAssetRefs(link, renamed);
            for (const entry of going) {
                SceneSerializer._renameAssetRefs(entry.fields, renamed);
                const to = renamed.get(entry.guid);
                if (to === undefined) continue;
                const of = SceneSerializer._copyOf(local.writtenAssets.get(entry.guid)!, to);
                entry.guid = to;
                if (of !== null) entry.of = of;
            }
        }

        const present = new Set(outer.assetTable.map(entry => entry.guid));
        for (const entry of going) {
            if (!present.has(entry.guid)) outer.assetTable.push(entry);
        }
    }

    /** Points every asset reference in saved JSON whose id `renamed` maps at the new id, in place. */
    private static _renameAssetRefs(value: unknown, renamed: ReadonlyMap<string, string>): void {
        if (Array.isArray(value)) {
            for (const item of value) SceneSerializer._renameAssetRefs(item, renamed);
            return;
        }
        if (value === null || typeof value !== "object") return;
        const obj = value as Record<string, unknown>;
        if (obj["$type"] === "AssetRef" && typeof obj["guid"] === "string") {
            obj["guid"] = renamed.get(obj["guid"]) ?? obj["guid"];
        }
        for (const key of Object.keys(obj)) SceneSerializer._renameAssetRefs(obj[key], renamed);
    }

    /**
     * Whether applying `changes` to `tree` would lose what is under a nested
     * instance: an override that replaces a link, whose contents come from its
     * prefab, with a link that carries none.
     *
     * @remarks
     * A nested instance written in full where the prefab keeps a link is
     * recorded as removed and added again when it has an id
     * (`PrefabDiff.compareChanges`). Inside an instance the prefab itself
     * holds in full, nodes are matched by position and have no id to record
     * that against; only its link would be, and its children would be lost.
     */
    private static _dropsContents(tree: SerializedGameObject, changes: PrefabChanges): boolean {
        return changes.overrides.some(o => {
            if (o.component !== null || o.field !== "prefab") return false;
            if ((o.value as SerializedPrefabLink | null)?.changes !== undefined) return false;
            return PrefabDiff.nodeOf(tree, o)?.node.prefab?.changes !== undefined;
        });
    }

    /**
     * Whether an override is one of the root fields the shell already carries:
     * name, position and rotation, which an instance never takes from its
     * prefab (Unity's default overrides).
     */
    private static _isShellOverride(o: PrefabOverride, tree: SerializedGameObject): boolean {
        const atRoot = o.node !== undefined ? o.node === tree.id : (o.path ?? []).length === 0;
        return atRoot && o.component === null && SHELL_FIELDS.has(o.field);
    }

    /**
     * Gives node ids to what was added to every instance under `go` that is
     * written as a link, and to the nodes of a prefab being made, before
     * anything is written.
     *
     * @remarks
     * A reference is encoded when its holder is written, which can be before
     * the object it points at. An id minted only once the walk reached that
     * object's instance left the earlier reference a child index: one that a
     * later prefab edit could misdirect, and that the next save wrote as an id.
     * What stands in for a missing prefab writes nothing under it, so it is
     * not entered.
     */
    private static _mintAll(go: GameObject, ctx: SceneCtx): void {
        if (go._prefabInfo?.raw) return;
        if (go === ctx.prefabRoot || SceneSerializer._writtenAsLink(go, ctx)) {
            SceneSerializer._mintAddedIds(go, ctx);
        }
        for (const child of SceneSerializer._childrenOf(go)) SceneSerializer._mintAll(child, ctx);
    }

    /** Whether {@link _serializeGO} writes `go` as its prefab plus changes. */
    private static _writtenAsLink(go: GameObject, ctx: SceneCtx): boolean {
        const info = go._prefabInfo;
        if (info === null || info.raw !== null || !ctx.link) return false;
        return SceneSerializer._prefabGuid(info) !== null && SceneSerializer._prefabSourceOf(info) !== null;
    }

    /** Whether any object of `root`'s own below it has a node id. */
    private static _hasOwnIds(root: GameObject, ctx: SceneCtx): boolean {
        for (const child of SceneSerializer._childrenOf(root)) {
            if (SceneSerializer._nodeIdOf(child, ctx) !== null) return true;
            if (!SceneSerializer._isWrittenInstance(child) && SceneSerializer._hasOwnIds(child, ctx)) return true;
        }
        return false;
    }

    /**
     * Gives each object of `root`'s own the id of the node at the same place
     * in `match`. One with no counterpart there is left for
     * {@link _mintAddedIds}, as an added object.
     */
    private static _borrowIds(root: GameObject, match: SerializedGameObject, ctx: SceneCtx): void {
        SceneSerializer._childrenOf(root).forEach((child, i) => {
            const twin = match.children[i];
            if (twin === undefined) return;
            if (twin.id !== undefined) SceneSerializer._giveId(child, twin.id, ctx);
            if (!SceneSerializer._isWrittenInstance(child) && twin.prefab === undefined) {
                SceneSerializer._borrowIds(child, twin, ctx);
            }
        });
    }

    /** Stores a node id on the object, or beside it when the pass must leave objects alone. */
    private static _giveId(go: GameObject, id: string, ctx: SceneCtx): void {
        if (ctx.mintLive) go._prefabNodeId = id;
        else ctx.minted.set(go, id);
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
                    SceneSerializer._giveId(child, mintNodeId(), ctx);
                }
                if (!SceneSerializer._isWrittenInstance(child)) walk(child);
            }
        };
        walk(root);
    }

    /**
     * Whether an object is written as a prefab instance — with a link — and so
     * bounds a namespace of node ids. An instance of a prefab with no guid is
     * written as a plain tree and does not.
     */
    private static _isWrittenInstance(go: GameObject): boolean {
        const info = go._prefabInfo;
        return info !== null && (info.raw !== null || SceneSerializer._prefabGuid(info) !== null);
    }

    /**
     * A positional path in `ctx` rewritten to address nodes inside an
     * instance by id (see `encodeNodePath`). Ids start below the first object
     * on the path that is written as an instance, or below the root of a
     * prefab being made.
     */
    private static _encodePath(ctx: SceneCtx, path: number[]): Array<number | string> {
        const chain: GameObject[] = [ctx.roots[path[0]]];
        for (let i = 1; i < path.length; i++) {
            chain.push(chain[i - 1].transform.getChild(path[i]).gameObject);
        }
        const idsFrom = chain.findIndex(go => go === ctx.prefabRoot || SceneSerializer._isWrittenInstance(go));
        if (idsFrom < 0) return path;

        return encodeNodePath(chain, path, idsFrom, {
            id: go => SceneSerializer._nodeIdOf(go, ctx),
            children: SceneSerializer._childrenOf,
            isInstance: go => SceneSerializer._isWrittenInstance(go),
        });
    }

    /** A GameObject's children, in order. */
    private static _childrenOf(go: GameObject): GameObject[] {
        const out: GameObject[] = [];
        for (let i = 0; i < go.transform.childCount; i++) out.push(go.transform.getChild(i).gameObject);
        return out;
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

    /**
     * @internal
     * The tree of the prefab loaded under `guid`, or null when it is not
     * loaded or cannot be resolved. What lets nested instances be compared one
     * field at a time.
     *
     * **NEVER use in user-facing code.**
     */
    public static _prefabTree(this: void, guid: string): SerializedGameObject | null {
        const source = SceneSerializer._prefabById(guid);
        if (source === null) return null;
        try {
            return source._resolvedTree();
        } catch {
            return null;
        }
    }

    /**
     * @internal
     * The tree a nested prefab instance kept as a link stands for, built the
     * way loading builds it: its prefab with the link's changes applied, and
     * the name, position and rotation of `node`, its shell. Null when `node`
     * is not such a link or its prefab is not loaded.
     *
     * A nested instance the tree holds in full stands for itself: a copy of
     * `node` without its link, its root keeping the id it has there.
     *
     * **NEVER use in user-facing code.**
     */
    public static _linkTree(node: SerializedGameObject): SerializedGameObject | null {
        const link = node.prefab;
        if (link !== undefined && link.changes === undefined) {
            const held = SceneSerializer._cloneJson(node);
            delete held.prefab;
            return held;
        }
        if (link?.changes === undefined) return null;
        const base = SceneSerializer._prefabTree(link.guid);
        if (base === null) return null;

        const tree = PrefabDiff.applyChanges(
            base, SceneSerializer._mergeChanges(link.changes, link.unused), SceneSerializer._prefabTree,
        );
        tree.name = node.name;
        tree.transform.position = { ...node.transform.position };
        tree.transform.rotation = { ...node.transform.rotation };
        return tree;
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
     *
     * A scene's copy of a prefab's inline asset is bound to the prefab's own
     * asset when it still is one ({@link SerializedAsset.of}); otherwise the
     * copy is built, and remembers what it is a copy of.
     *
     * @param followOf - whether entries' `of` is read. Off for a prefab's own
     *   table, which never carries one.
     */
    private static _materializeAssets(
        table: SerializedAsset[] | undefined,
        ctx: DeserializeContext,
        followOf = true,
    ): void {
        if (!table) return;

        for (const entry of table) {
            if (AssetDatabase.isLoaded(entry.guid)) continue;
            if (followOf && entry.of !== undefined && SceneSerializer._bindToPrefabAsset(entry, ctx)) continue;

            const asset = SceneSerializer._buildAsset(entry.type, entry.fields, ctx);
            if (asset === null) continue;
            AssetDatabase._bindGuid(entry.guid, asset);
            const of = followOf ? SceneSerializer._originOf(entry) : null;
            if (of !== null) SceneSerializer._copyOrigins.set(asset, of);
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

    // ==================== INTERNAL — EDITING AN INSTANCE IN PLACE ====================

    /**
     * @internal
     * Every serialized field of every component under `roots` that holds a
     * GameObject or a component `match` recognises — element by element
     * through arrays and nested values — with a way to put another value
     * there. What a revert records before it destroys a subtree, so that the
     * references into it can be pointed at what replaces it.
     *
     * @param match - given the object held (and the component, when a
     *   component is held), what to remember about it, or null to pass it by.
     *   It may be called with destroyed objects.
     * @param skip - holders not to look in: those inside what is rebuilt.
     *
     * **NEVER use in user-facing code.**
     */
    public static _heldReferences<T>(
        roots: ReadonlyArray<GameObject>,
        match: (go: GameObject, component: Component | null) => T | null,
        skip: (holder: GameObject) => boolean,
    ): HeldReference<T>[] {
        const out: HeldReference<T>[] = [];
        const seen = new Set<object>();
        const visit = (
            value: unknown,
            assign: (value: GameObject | Component | null) => void,
            where: string,
            type: FieldType | undefined,
            elementType: FieldType | undefined,
        ): void => {
            if (value === null || typeof value !== "object") return;
            if (Array.isArray(value)) {
                value.forEach((item, i) => visit(item, v => { value[i] = v; }, `${where}[${i}]`, elementType, undefined));
                return;
            }
            const held = SceneSerializer._heldObject(value);
            if (held !== null) {
                const target = match(held.go, held.component);
                if (target !== null) out.push({ assign, where, target });
                return;
            }
            // A value of a kind of its own — a vector, an asset, a curve — holds
            // no scene object; a registered struct may.
            if (type !== undefined && type !== FieldType.Object) return;
            if (seen.has(value) || TypeRegistry.getTypeName(value) === null) return;
            seen.add(value);
            for (const f of getAllFields(value.constructor as AnyConstructor)) {
                if (!f.serialize) continue;
                visit((value as Record<string, unknown>)[f.name], v => SceneSerializer._assign(value, f.name, v),
                    `${where}.${f.name}`, f.type, f.elementType);
            }
        };

        const walk = (go: GameObject): void => {
            if (!skip(go)) {
                for (const component of SceneSerializer._componentsOf(go)) {
                    if (component instanceof Transform || component instanceof MissingComponent) continue;
                    const name = `${go.name}.${SceneSerializer._typeNameOf(component) ?? component.constructor.name}`;
                    for (const f of getAllFields(component.constructor as AnyConstructor)) {
                        if (!f.serialize) continue;
                        visit((component as unknown as Record<string, unknown>)[f.name],
                            v => SceneSerializer._assign(component, f.name, v),
                            `${name}.${f.name}`, f.type, f.elementType);
                    }
                }
            }
            for (const child of SceneSerializer._childrenOf(go)) walk(child);
        };
        for (const root of roots) walk(root);
        return out;
    }

    /** A GameObject, or a component with its GameObject, or null for anything else. */
    private static _heldObject(value: object): { go: GameObject; component: Component | null } | null {
        if (value instanceof Component) return { go: value.gameObject, component: value };
        const transform = (value as { transform?: unknown }).transform;
        return transform instanceof Transform && (transform.gameObject as object) === value
            ? { go: value as GameObject, component: null }
            : null;
    }

    /**
     * @internal
     * Builds a saved object as a child of `parent` at sibling `index`, the way
     * the instance would have been built with it: references resolve from the
     * instance, a nested link is rebuilt from its prefab.
     *
     * @param scopes - the instance roots a reference may count from, outermost
     *   first: the instance, then each nested instance the object lies in.
     *
     * **NEVER use in user-facing code.**
     */
    public static _restoreChild(
        scopes: readonly GameObject[],
        json: SerializedGameObject,
        parent: GameObject,
        index: number,
        assets: SerializedAsset[] | undefined,
        chain: string[],
    ): GameObject {
        return SceneSerializer._restore(scopes, assets, chain, ctx => {
            const child = SceneSerializer._deserializeGO(SceneSerializer._cloneJson(json), ctx);
            child.transform.setParent(parent.transform, false);
            child.transform.setSiblingIndex(index);
            return child;
        });
    }

    /**
     * @internal
     * Adds a component built from saved JSON to `go`, at `position` among its
     * components. See {@link _restoreChild}.
     *
     * **NEVER use in user-facing code.**
     */
    public static _restoreComponent(
        scopes: readonly GameObject[],
        json: SerializedComponent,
        go: GameObject,
        position: number,
        assets: SerializedAsset[] | undefined,
    ): Component | null {
        return SceneSerializer._restore(scopes, assets, [], ctx => {
            const comp = SceneSerializer._deserializeComponent(SceneSerializer._cloneJson(json), go, ctx);
            if (comp === null) return null;
            const list = SceneSerializer._componentsOf(go) as Component[];
            list.splice(list.indexOf(comp), 1);
            list.splice(Math.max(0, Math.min(position, list.length)), 0, comp);
            return comp;
        });
    }

    /**
     * @internal
     * Writes one saved field value onto a component or other serialized
     * object. See {@link _restoreChild}.
     *
     * **NEVER use in user-facing code.**
     */
    public static _restoreField(
        scopes: readonly GameObject[],
        owner: object,
        field: string,
        json: unknown,
        assets: SerializedAsset[] | undefined,
    ): void {
        if (owner instanceof MissingComponent) {
            owner.originalFields[field] = SceneSerializer._cloneJson(json);
            return;
        }
        const meta = getAllFields(owner.constructor as any).find(f => f.name === field && f.serialize);
        if (meta === undefined) return;
        SceneSerializer._restore(scopes, assets, [], ctx => {
            ctx.currentComponent = owner;
            ctx.currentField = field;
            const value = ValueSerializer.deserialize(SceneSerializer._cloneJson(json), meta.type, ctx, meta.elementType);
            ctx.currentComponent = null;
            ctx.currentField = null;
            SceneSerializer._assign(owner, field, value);
        });
    }

    /**
     * @internal
     * Points a field back at what was just rebuilt, where it still holds a
     * destroyed object and its saved value `json` finds `restored`: the
     * object, something below it, or, for a component, that component.
     * Reached element by element through arrays and nested values, so nothing
     * else in the field is touched. See {@link _restoreChild} for `scopes`.
     *
     * @remarks
     * Rebuilding a removed child or component makes new objects, and every
     * reference that pointed at the old ones still holds them. This is what
     * puts those references back, without overwriting a field that was
     * pointed somewhere else meanwhile.
     *
     * A field that holds `null` is left alone, even where its saved value
     * would find `restored`: a `null` the scene set on purpose cannot be told
     * from one a save wrote for the removed object, and only the first is
     * the scene's to keep. So a reference to a removed object that was saved
     * and loaded again before the revert stays null.
     *
     * **NEVER use in user-facing code.**
     */
    public static _reconnect(
        scopes: readonly GameObject[],
        owner: object,
        field: string,
        json: unknown,
        restored: GameObject | Component,
    ): void {
        if (owner instanceof MissingComponent) return;
        const reaches = (found: GameObject | Component | null): boolean => {
            if (found === null) return false;
            if (restored instanceof Component) return found === restored;
            const go = found instanceof Component ? found.gameObject : found;
            for (let t: Transform | null = go.transform; t !== null; t = t.parent) {
                if (t.gameObject === restored) return true;
            }
            return false;
        };
        const visit = (live: unknown, saved: unknown, set: (value: unknown) => void): void => {
            if (Array.isArray(saved)) {
                if (!Array.isArray(live) || live.length !== saved.length) return;
                saved.forEach((item, i) => visit(live[i], item, value => { live[i] = value; }));
                return;
            }
            if (saved === null || typeof saved !== "object") return;
            const obj = saved as Record<string, unknown>;
            if (obj["$type"] === "Nested") {
                const fields = obj["fields"] as Record<string, unknown> | undefined;
                if (live === null || typeof live !== "object" || fields === undefined) return;
                for (const key of Object.keys(fields)) {
                    visit((live as Record<string, unknown>)[key], fields[key],
                        value => SceneSerializer._assign(live, key, value));
                }
                return;
            }
            if (obj["$type"] !== "GameObjectRef" && obj["$type"] !== "ComponentRef") return;
            if (!SceneSerializer._destroyed(live)) return;
            const found = SceneSerializer._resolveSaved(scopes, obj);
            if (reaches(found)) set(found);
        };
        visit((owner as Record<string, unknown>)[field], json, value => SceneSerializer._assign(owner, field, value));
    }

    /** Whether a live reference holds an object that was destroyed. `null` is not one. */
    private static _destroyed(value: unknown): boolean {
        if (value === null || typeof value !== "object") return false;
        const exists = (value as { exists?: unknown }).exists;
        return typeof exists === "function" && !(exists as () => boolean).call(value);
    }

    /**
     * What a saved `GameObjectRef` or `ComponentRef` finds, read from inside
     * the instance roots `scopes` the way a reference rebuilt there resolves.
     */
    private static _resolveSaved(
        scopes: readonly GameObject[],
        ref: Record<string, unknown>,
    ): GameObject | Component | null {
        const path = ref["path"];
        if (!Array.isArray(path)) return null;
        const stack = scopes.slice(1);
        const scope = typeof ref["scope"] === "number" && ref["scope"] > 0 ? ref["scope"] : 0;
        const base = scope < stack.length ? [stack[stack.length - 1 - scope]]
            : scope === stack.length ? [scopes[0]]
            : null;
        const go = base === null ? null : SceneSerializer._lookupByPath(base, path as Array<number | string>);
        if (go === null || ref["$type"] === "GameObjectRef") return go;
        return SceneSerializer._findComponent(go, String(ref["component"] ?? ""), Number(ref["index"] ?? 0));
    }

    /**
     * @internal
     * The `index`-th component of a registered type on `go`, or null.
     *
     * **NEVER use in user-facing code.**
     */
    public static _componentOf(go: GameObject, typeName: string, index: number): Component | null {
        return SceneSerializer._findComponent(go, typeName, index);
    }

    /**
     * @internal
     * The name a component is saved under, or null.
     *
     * **NEVER use in user-facing code.**
     */
    public static _componentTypeName(component: object): string | null {
        return SceneSerializer._typeNameOf(component);
    }

    /**
     * @internal
     * The descendant of `from` with this prefab node id, not entering a nested
     * instance — how a saved path is followed.
     *
     * **NEVER use in user-facing code.**
     */
    public static _findLiveNode(from: GameObject, id: string): GameObject | null {
        return findNodeById(from, id, SceneSerializer._LIVE);
    }

    /**
     * Runs `build` in a fresh load context and resolves what it read: the
     * nested instances in `scopes` are on the stack, so a scoped reference
     * counts out through them to the outermost, which is the root.
     */
    private static _restore<T>(
        scopes: readonly GameObject[],
        assets: SerializedAsset[] | undefined,
        chain: string[],
        build: (ctx: LoadCtx) => T,
    ): T {
        const ctx = SceneSerializer._newContext(chain);
        ctx.scopeStack.push(...scopes.slice(1));
        SceneSerializer._materializeAssets(assets, ctx);
        const result = build(ctx);
        SceneSerializer._resolveObjectRefs(ctx, [scopes[0]]);
        SceneSerializer._pending.push(...ctx.pendingAssetRefs);
        return result;
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
        const tree = PrefabDiff.applyChanges(base, all, SceneSerializer._prefabTree);
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
        SceneSerializer._resolveObjectRefs(ctx, roots);
        SceneSerializer._pending = ctx.pendingAssetRefs.slice();
    }

    /** Resolves the collected GameObject and component references, leaving asset ones alone. */
    private static _resolveObjectRefs(ctx: DeserializeContext, roots: ReadonlyArray<GameObject>): void {
        for (const ref of ctx.pendingGORefs) {
            const target = SceneSerializer._lookupScoped(roots, ref);
            SceneSerializer._writeRef(ref.component, ref.field, ref.arrayIndex, target);
        }

        for (const ref of ctx.pendingComponentRefs) {
            const owner = SceneSerializer._lookupScoped(roots, ref);
            const target = owner === null
                ? null
                : SceneSerializer._findComponent(owner, ref.typeName, ref.index);
            // A placeholder has none of its prefab's components to be found.
            if (owner !== null && target === null && owner._prefabInfo?.raw) {
                SceneSerializer._warnLostToPlaceholder(ref, owner);
            }
            SceneSerializer._writeRef(ref.component, ref.field, ref.arrayIndex, target);
        }
    }

    /**
     * Resolves a pending reference against the roots its scope names: the
     * instance `scope` levels out from where it was read, or the roots being
     * loaded when it counts out past every instance. A scope deeper than that
     * is a malformed file and resolves to null.
     */
    private static _lookupScoped(
        roots: ReadonlyArray<GameObject>,
        ref: { component: object; field: string; path: Array<number | string>; ref?: RefScope },
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
        ref: { component: object; field: string; path: Array<number | string> },
    ): void {
        const path = ref.path;
        let cur = SceneSerializer._root(roots, path);
        for (let i = 1; cur !== null && i < path.length; i++) {
            if (cur._prefabInfo?.raw) {
                SceneSerializer._warnLostToPlaceholder(ref, cur);
                return;
            }
            cur = SceneSerializer._step(cur, path[i]);
        }
    }

    /**
     * The warning for a reference into, or onto a component of, an instance
     * whose prefab is missing, naming its holder and field.
     */
    private static _warnLostToPlaceholder(ref: { component: object; field: string }, placeholder: GameObject): void {
        console.warn(
            `[SceneSerializer] ${ref.component.constructor.name}.${ref.field} points into ` +
            `"${placeholder.name}", whose prefab is not loaded. It is null for now, and is lost if ` +
            `the scene is saved before the prefab is loaded.`,
        );
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

    /**
     * Walks a reference path and returns the target GameObject, or null.
     *
     * @remarks
     * The first segment indexes `roots`. After it a number is a child index and
     * a string a prefab node id, found among the current object's descendants
     * without entering a nested prefab instance — the same search the writer
     * checked the id against.
     */
    private static _lookupByPath(roots: ReadonlyArray<GameObject>, path: Array<number | string>): GameObject | null {
        let cur = SceneSerializer._root(roots, path);
        for (let i = 1; cur !== null && i < path.length; i++) {
            cur = SceneSerializer._step(cur, path[i]);
        }
        return cur;
    }

    /** The root a path starts from, or null. */
    private static _root(roots: ReadonlyArray<GameObject>, path: Array<number | string>): GameObject | null {
        const first = path[0];
        if (typeof first !== "number" || first < 0 || first >= roots.length) return null;
        return roots[first] ?? null;
    }

    /** One step of a path: a child by index, or a descendant by node id. */
    private static _step(from: GameObject, segment: number | string): GameObject | null {
        if (typeof segment === "string") return findNodeById(from, segment, SceneSerializer._LIVE);
        const t = from.transform;
        if (!Number.isInteger(segment) || segment < 0 || segment >= t.childCount) return null;
        return t.getChild(segment).gameObject;
    }

    /** How a loaded scene is searched for a node id. */
    private static readonly _LIVE: NodeAccess<GameObject> = {
        id: go => go._prefabNodeId,
        children: go => SceneSerializer._childrenOf(go),
        isInstance: go => go._prefabInfo !== null,
    };

    private constructor() {}
}
