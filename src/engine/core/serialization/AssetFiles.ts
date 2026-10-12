import { Resources } from "../assets/Resources";
import { AssetDatabase } from "../assets/AssetDatabase";
import { Material } from "../graphics/Material";
import { StandardMaterial } from "../graphics/StandardMaterial";
import { UnlitMaterial } from "../graphics/UnlitMaterial";
import { PhysicMaterial } from "../../physics/PhysicMaterial";
import { Prefab, type SerializedPrefab } from "./Prefab";
import { SceneSerializer, type SerializedAssetFile } from "./SceneSerializer";

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
 * Loads what a file refers to, so the synchronous rebuild that follows finds it.
 *
 * @remarks
 * Held by the cache and not released: the asset being built keeps using them.
 * A reference with no known path is reported and left null, the same outcome a
 * scene gets for an asset it cannot find.
 */
async function loadReferences(json: object): Promise<void> {
    const attempted = new Set<string>();

    for (const guid of SceneSerializer.assetReferences(json)) {
        if (AssetDatabase.isLoaded(guid)) continue;

        // A prefab still being decoded further up this chain: waiting for it
        // would wait for this file, which is waiting for it.
        if (decodingPrefabs.has(guid)) {
            console.warn(
                `[AssetFiles] Prefab "${AssetDatabase.pathOf(guid) ?? guid}" contains, through the prefabs ` +
                `inside it, a prefab that contains it. It is not loaded twice; an instance of it nested ` +
                `in itself is kept as a placeholder.`,
            );
            continue;
        }

        // A mesh or material inside a model is loaded by loading the model, once
        // however many of its parts are used.
        const file = AssetDatabase.fileOf(guid);
        if (!attempted.has(file)) {
            attempted.add(file);

            const path = AssetDatabase.pathOf(file);
            if (path === null) {
                console.warn(`[AssetFiles] An asset refers to "${guid}", which the project does not list.`);
                continue;
            }
            try {
                await Resources.loadAtPath(path);
            } catch (error) {
                console.warn(`[AssetFiles] Could not load "${path}" for an asset that uses it:`, error);
                continue;
            }
        }

        if (!AssetDatabase.isLoaded(guid)) {
            console.warn(`[AssetFiles] "${AssetDatabase.pathOf(file)}" has no part called "${guid}".`);
        }
    }
}

function parse(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(bytes));
}

async function decodeAssetFile(bytes: Uint8Array): Promise<object> {
    const file = parse(bytes) as SerializedAssetFile;
    await loadReferences(file);

    const asset = SceneSerializer.deserializeAsset(file);
    if (asset === null) {
        throw new Error(`[AssetFiles] The asset file's type "${file.type}" is not registered.`);
    }
    return asset;
}

async function decodeMaterial(bytes: Uint8Array): Promise<Material> {
    const asset = await decodeAssetFile(bytes);
    if (!(asset instanceof Material)) {
        throw new Error(`[AssetFiles] "${asset.constructor.name}" is not a material.`);
    }
    return asset;
}

async function decodePhysicMaterial(bytes: Uint8Array): Promise<PhysicMaterial> {
    const asset = await decodeAssetFile(bytes);
    if (!(asset instanceof PhysicMaterial)) {
        throw new Error(`[AssetFiles] "${asset.constructor.name}" is not a physic material.`);
    }
    return asset;
}

/** Guids of the prefab files being decoded right now, so a cycle between them is not awaited. */
const decodingPrefabs = new Set<string>();

/**
 * Reads a prefab file, after loading what it refers to — the prefabs nested
 * inside it included, so that instantiating it rebuilds them in full.
 */
async function decodePrefab(bytes: Uint8Array, path: string): Promise<Prefab> {
    const json = parse(bytes) as SerializedPrefab;
    const self = AssetDatabase.guidForPath(path);
    decodingPrefabs.add(self);
    try {
        // A tree carries its inline assets at its root; a variant carries its
        // base's id and its changes, and both are what it refers to.
        await loadReferences((json.snapshot ?? json) as object);
    } finally {
        decodingPrefabs.delete(self);
    }
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
