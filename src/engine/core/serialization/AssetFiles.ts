import { Resources } from "../assets/Resources";
import { AssetDatabase } from "../assets/AssetDatabase";
import { Material } from "../graphics/Material";
import { StandardMaterial } from "../graphics/StandardMaterial";
import { UnlitMaterial } from "../graphics/UnlitMaterial";
import { PhysicMaterial } from "../../physics/PhysicMaterial";
import { Prefab, type SerializedPrefab } from "./Prefab";
import { SceneSerializer, type SerializedAssetFile } from "./SceneSerializer";
import type { FormatKind } from "./UnsupportedFormatError";

/**
 * Materials, physic materials and prefabs as files.
 *
 * @remarks
 * Until these were files, a material lived only inside the scene that used it:
 * two scenes sharing a look meant two copies, and an edit reached neither. As a
 * file it has a path, therefore an id, therefore a scene refers to it by that id
 * and a change to the file reaches everything that uses it.
 *
 * | File | Loaded as |
 * |---|---|
 * | `name.mat.json` | `Material` (a `StandardMaterial` or `UnlitMaterial`, as the file says) |
 * | `name.physicmat.json` | `PhysicMaterial` |
 * | `name.prefab.json` | `Prefab` |
 *
 * Loading goes through `Resources` like any asset, so the cache, the reference
 * count and the id binding are the usual ones. Importing this module registers
 * the decoders; the package index does it.
 */
export const AssetFiles = {
    materialExtension: ".mat.json",
    physicMaterialExtension: ".physicmat.json",
    prefabExtension: ".prefab.json",

    /**
     * The extension an asset is written under, or null if it is not a kind that
     * has a file form.
     */
    extensionFor(asset: object): string | null {
        if (asset instanceof Material) return AssetFiles.materialExtension;
        if (asset instanceof PhysicMaterial) return AssetFiles.physicMaterialExtension;
        if (asset instanceof Prefab) return AssetFiles.prefabExtension;
        return null;
    },

    /**
     * The text to write to disk for an asset.
     *
     * @throws if the asset has no file form.
     */
    toText(asset: object): string {
        if (asset instanceof Prefab) return JSON.stringify(asset.toJSON(), null, 2);
        if (AssetFiles.extensionFor(asset) === null) {
            throw new Error(`[AssetFiles] ${asset.constructor?.name ?? "This object"} has no file form.`);
        }
        return JSON.stringify(SceneSerializer.serializeAsset(asset), null, 2);
    },
} as const;

/**
 * A file being decoded right now, and the files it is waiting on while it
 * loads what it refers to.
 */
interface Decode {
    readonly file: string;
    readonly waits: Set<string>;
}

/** Every decode in progress, from every caller. */
const decoding = new Set<Decode>();

/**
 * Whether waiting on `file` would wait on `target`: `file` is `target`, or is
 * being decoded and waits — directly or through what it waits on — for it.
 */
function waitsFor(file: string, target: string): boolean {
    const seen = new Set<string>();
    const queue = [file];
    while (queue.length > 0) {
        const at = queue.pop()!;
        if (at === target) return true;
        if (seen.has(at)) continue;
        seen.add(at);
        for (const d of decoding) {
            if (d.file === at) queue.push(...d.waits);
        }
    }
    return false;
}

/**
 * Loads what a file refers to, so the synchronous rebuild that follows finds it.
 *
 * @remarks
 * Held by the cache and not released: the asset being built keeps using them.
 * A reference with no known path is reported and left null, the same outcome a
 * scene gets for an asset it cannot find — unless the file reads without it
 * ({@link SceneSerializer.optionalAssetReferences}), which is passed over
 * quietly.
 *
 * A file another load is decoding is waited for — `Resources` hands every
 * caller the same load — unless that load is itself waiting, through the
 * files it refers to, for this one: two prefab files that contain each other.
 * Waiting then would never end, so the reference is skipped.
 */
async function loadReferences(json: object, self: Decode): Promise<void> {
    const attempted = new Set<string>();
    // Loaded when the project has them, passed over quietly when it does not.
    const optional = new Set(SceneSerializer.optionalAssetReferences(json));

    for (const guid of SceneSerializer.assetReferences(json)) {
        if (AssetDatabase.isLoaded(guid)) continue;

        // A mesh or material inside a model is loaded by loading the model, once
        // however many of its parts are used.
        const file = AssetDatabase.fileOf(guid);
        if (waitsFor(file, self.file)) {
            console.warn(
                `[AssetFiles] Prefab "${AssetDatabase.pathOf(guid) ?? guid}" contains, through the prefabs ` +
                `inside it, a prefab that contains it. It is not loaded twice; an instance of it nested ` +
                `in itself is kept as a placeholder.`,
            );
            continue;
        }

        if (!attempted.has(file)) {
            attempted.add(file);

            const path = AssetDatabase.pathOf(file);
            if (path === null) {
                if (!optional.has(guid)) {
                    console.warn(`[AssetFiles] An asset refers to "${guid}", which the project does not list.`);
                }
                continue;
            }
            self.waits.add(file);
            try {
                await Resources.loadAtPath(path);
            } catch (error) {
                console.warn(`[AssetFiles] Could not load "${path}" for an asset that uses it:`, error);
                continue;
            } finally {
                self.waits.delete(file);
            }
        }

        if (!AssetDatabase.isLoaded(guid) && !optional.has(guid)) {
            console.warn(`[AssetFiles] "${AssetDatabase.pathOf(file)}" has no part called "${guid}".`);
        }
    }
}

/** Runs `load` as a decode of the file at `path`, visible to every other decode while it runs. */
async function asDecode<T>(path: string, load: (self: Decode) => Promise<T>): Promise<T> {
    const self: Decode = { file: AssetDatabase.guidForPath(path), waits: new Set() };
    decoding.add(self);
    try {
        return await load(self);
    } finally {
        decoding.delete(self);
    }
}

function parse(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Reads a material or physic material file. These carry `version: 1` and no
 * other is read: the version is checked before anything the file refers to is
 * loaded, and the writers (`SceneSerializer.serializeAsset`) are unchanged.
 */
async function decodeAssetFile(bytes: Uint8Array, path: string, what: FormatKind): Promise<object> {
    const file = parse(bytes) as SerializedAssetFile;
    SceneSerializer._refuseUnknownVersion(file, what);
    await asDecode(path, self => loadReferences(file, self));

    const asset = SceneSerializer.deserializeAsset(file);
    if (asset === null) {
        throw new Error(`[AssetFiles] The asset file's type "${file.type}" is not registered.`);
    }
    return asset;
}

async function decodeMaterial(bytes: Uint8Array, path: string): Promise<Material> {
    const asset = await decodeAssetFile(bytes, path, "material");
    if (!(asset instanceof Material)) {
        throw new Error(`[AssetFiles] "${asset.constructor.name}" is not a material.`);
    }
    return asset;
}

async function decodePhysicMaterial(bytes: Uint8Array, path: string): Promise<PhysicMaterial> {
    const asset = await decodeAssetFile(bytes, path, "physicMaterial");
    if (!(asset instanceof PhysicMaterial)) {
        throw new Error(`[AssetFiles] "${asset.constructor.name}" is not a physic material.`);
    }
    return asset;
}

/**
 * Reads a prefab file, after loading what it refers to — the prefabs nested
 * inside it included, so that instantiating it rebuilds them in full. A file of
 * a version this build does not read is refused first, so that nothing it
 * refers to is loaded for nothing.
 */
async function decodePrefab(bytes: Uint8Array, path: string): Promise<Prefab> {
    const json = parse(bytes) as SerializedPrefab;
    SceneSerializer._refuseUnknownVersion(json, "prefab");
    // A tree carries its inline assets at its root; a variant carries its
    // base's id and its changes, and both are what it refers to.
    await asDecode(path, self => loadReferences((json.snapshot ?? json) as object, self));
    return Prefab.fromJSON(json as Parameters<typeof Prefab.fromJSON>[0]);
}

// The type token is what a caller passes to `Resources.load`; the file says what
// it actually is. `Material` goes last so that a path alone (prefetch, loadAtPath)
// is read as the general kind.
Resources.registerDecoder(StandardMaterial, [AssetFiles.materialExtension], decodeMaterial as never);
Resources.registerDecoder(UnlitMaterial, [AssetFiles.materialExtension], decodeMaterial as never);
Resources.registerDecoder(Material, [AssetFiles.materialExtension], decodeMaterial);
Resources.registerDecoder(PhysicMaterial, [AssetFiles.physicMaterialExtension], decodePhysicMaterial);
Resources.registerDecoder(Prefab, [AssetFiles.prefabExtension], decodePrefab);
