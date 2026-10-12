import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Resources, type IAssetSource } from "../src/engine/core/assets/Resources";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import { SceneSerializer, ASSET_FILE_FORMAT } from "../src/engine/core/serialization/SceneSerializer";
import { AssetFiles } from "../src/engine/core/serialization/AssetFiles";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { Material } from "../src/engine/core/graphics/Material";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { UnlitMaterial } from "../src/engine/core/graphics/UnlitMaterial";
import { Texture } from "../src/engine/core/graphics/Texture";
import type { Texture2D } from "../src/engine/core/graphics/Texture2D";
import { Texture2D as Texture2DClass } from "../src/engine/core/graphics/Texture2D";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { Color } from "../src/engine/core/math/Color";
import { PhysicMaterial } from "../src/engine/physics/PhysicMaterial";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { Behaviour } from "../src/engine/core/Behaviour";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";

/**
 * A material, a physic material and a prefab used to live only inside the scene
 * that used them. As files they have a path and therefore an id, and a scene
 * refers to them by it: two scenes share one, and an edit reaches both.
 */

/** An asset source over a plain map — enough for Resources to read from. */
class MemorySource implements IAssetSource {
    constructor(private readonly _files: Map<string, string | Uint8Array>) {}

    has(path: string): boolean { return this._files.has(path); }
    list(prefix = ""): string[] { return [...this._files.keys()].filter(p => p.startsWith(prefix)); }

    async readBytes(path: string): Promise<Uint8Array> {
        const file = this._files.get(path);
        if (file === undefined) throw new Error(`No such file: ${path}`);
        return typeof file === "string" ? new TextEncoder().encode(file) : file;
    }

    async readText(path: string): Promise<string> {
        return new TextDecoder().decode(await this.readBytes(path));
    }

    async getBlobUrl(path: string): Promise<string> { return `blob:${path}`; }
}

@Serializable({ typeName: "AssetFilesSpec.Spawner" })
class Spawner extends Behaviour {
    @SerializedField({ type: FieldType.Asset })
    public prefab: Prefab | null = null;
}

/** An asset with a field of no declared shape — what any project setting looks like. */
@Serializable({ typeName: "AssetFilesSpec.Tuning" })
class Tuning {
    @SerializedField({ type: FieldType.Object })
    public options: unknown = { gain: 2, bands: [1, 2] };
}

let files: Map<string, string | Uint8Array>;
const textureLoads: string[] = [];

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

function install(entries: Record<string, string>): void {
    files = new Map(Object.entries(entries));
    Resources.useSource(new MemorySource(files));
    AssetDatabase.setManifest([
        { guid: "tex-albedo", path: "assets/textures/albedo.png" },
        { guid: "mat-hull", path: "assets/materials/hull.mat.json" },
        { guid: "mat-glow", path: "assets/materials/glow.mat.json" },
        { guid: "phys-ice", path: "assets/physics/ice.physicmat.json" },
        { guid: "prefab-crate", path: "assets/prefabs/crate.prefab.json" },
    ]);
}

/** The text a project would write for an asset. */
const written = (asset: object): string => AssetFiles.toText(asset);

beforeEach(() => {
    clear();
    textureLoads.length = 0;
    // A texture decoder that needs no image decoding.
    Resources.registerDecoder(Texture2DClass, [".png"], async (_bytes: Uint8Array, path: string) => {
        textureLoads.push(path);
        return new Texture() as Texture2D;
    });
});

afterEach(() => {
    Resources.releaseSource();
    AssetDatabase.clear();
});

describe("a material as a file", () => {
    test("is written in a format that says what it is", () => {
        const mat = new StandardMaterial();
        mat.albedoColor = new Color(0.2, 0.4, 0.6, 1);

        const file = SceneSerializer.serializeAsset(mat);

        expect(file.format).toBe(ASSET_FILE_FORMAT);
        expect(file.type).toBe("StandardMaterial");
        expect(file.assets).toBeUndefined();
        expect(AssetFiles.extensionFor(mat)).toBe(".mat.json");
    });

    test("is read back as the material it was", async () => {
        const mat = new StandardMaterial();
        mat.albedoColor = new Color(0.2, 0.4, 0.6, 1);
        mat.metallic = 0.7;
        install({ "assets/materials/hull.mat.json": written(mat) });

        const loaded = await Resources.load(Material, "materials/hull");

        expect(loaded).toBeInstanceOf(StandardMaterial);
        expect((loaded as StandardMaterial).albedoColor.g).toBeCloseTo(0.4);
        expect((loaded as StandardMaterial).metallic).toBeCloseTo(0.7);
    });

    test("an unlit one comes back unlit", async () => {
        install({ "assets/materials/glow.mat.json": written(new UnlitMaterial()) });

        expect(await Resources.load(Material, "materials/glow")).toBeInstanceOf(UnlitMaterial);
    });

    test("has the id the project gave its file", async () => {
        install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });

        const loaded = await Resources.load(Material, "materials/hull");

        expect(AssetDatabase.guidOf(loaded)).toBe("mat-hull");
        expect(AssetDatabase.get("mat-hull")).toBe(loaded);
    });

    test("loads the textures it uses before it is built", async () => {
        const albedo = new Texture() as Texture2D;
        AssetDatabase.setManifest([{ guid: "tex-albedo", path: "assets/textures/albedo.png" }]);
        AssetDatabase._bind("assets/textures/albedo.png", albedo);
        const mat = new StandardMaterial();
        mat.albedoTexture = albedo;
        const text = written(mat);
        AssetDatabase.clear();

        install({
            "assets/materials/hull.mat.json": text,
            "assets/textures/albedo.png": "pixels",
        });
        const loaded = await Resources.load(Material, "materials/hull") as StandardMaterial;

        expect(textureLoads).toEqual(["assets/textures/albedo.png"]);
        expect(loaded.albedoTexture).not.toBeNull();
        expect(loaded.albedoTexture).toBe(AssetDatabase.get("tex-albedo"));
        expect(SceneSerializer.pendingAssetGuids).not.toContain("tex-albedo");
    });

    test("a texture the project does not list leaves the slot empty and says so", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const mat = new StandardMaterial();
        const file = SceneSerializer.serializeAsset(mat);
        file.fields["albedoTexture"] = { $type: "AssetRef", guid: "nobody-knows" };
        install({ "assets/materials/hull.mat.json": JSON.stringify(file) });

        const loaded = await Resources.load(Material, "materials/hull") as StandardMaterial;

        expect(loaded.albedoTexture).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test("is loaded once and shared", async () => {
        install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });

        const a = await Resources.load(Material, "materials/hull");
        const b = await Resources.load(Material, "materials/hull");

        expect(b).toBe(a);
    });

    test("a plain .json next to it is not mistaken for one", async () => {
        install({
            "assets/materials/hull.mat.json": written(new StandardMaterial()),
            "assets/data/notes.json": "{}",
        });

        const found = await Resources.loadAll(Material, "");

        expect(found).toHaveLength(1);
        expect(found[0]).toBeInstanceOf(StandardMaterial);
    });

    test("a file that is not a material is refused", async () => {
        install({ "assets/materials/hull.mat.json": written(new PhysicMaterial()) });

        await expect(Resources.load(Material, "materials/hull")).rejects.toThrow(/not a material/);
    });
});

describe("a scene that uses a material file", () => {
    function sceneWithMaterial(material: Material): GameObject {
        const go = new GameObject("Box");
        go.addComponent(MeshRenderer).sharedMaterial = material;
        return go;
    }

    test("refers to it by id instead of carrying a copy", async () => {
        install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });
        const material = await Resources.load(Material, "materials/hull");
        const go = sceneWithMaterial(material);

        const json = SceneSerializer.serializeGameObject(go);

        expect(json.assets).toBeUndefined();
        const ref = json.components.find(c => c.type === "MeshRenderer")!.fields["sharedMaterial"] as { guid: string };
        expect(ref.guid).toBe("mat-hull");
    });

    test("finds the same material again when it is opened", async () => {
        install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });
        const material = await Resources.load(Material, "materials/hull");
        const json = SceneSerializer.serializeGameObject(sceneWithMaterial(material));
        clear();

        const back = SceneSerializer.deserializeGameObject(json).getComponent(MeshRenderer)!.sharedMaterial;

        expect(back).toBe(material);
    });

    test("two objects, or two scenes, share the one — an edit reaches both", async () => {
        install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });
        const material = await Resources.load(Material, "materials/hull") as StandardMaterial;
        const a = sceneWithMaterial(material).getComponent(MeshRenderer)!;
        const b = sceneWithMaterial(material).getComponent(MeshRenderer)!;

        material.metallic = 0.9;

        expect((a.sharedMaterial as StandardMaterial).metallic).toBeCloseTo(0.9);
        expect(b.sharedMaterial).toBe(a.sharedMaterial);
    });

    test("lists the material as something to load first", async () => {
        install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });
        const material = await Resources.load(Material, "materials/hull");
        const scene = SceneSerializer.serializeScene(SceneManager.activeScene);
        sceneWithMaterial(material);
        const withMaterial = SceneSerializer.serializeScene(SceneManager.activeScene);

        expect(SceneSerializer.assetReferences(scene)).toEqual([]);
        expect(SceneSerializer.assetReferences(withMaterial)).toEqual(["mat-hull"]);
    });

    test("a scene saved twice still carries its inline material", () => {
        const mat = new StandardMaterial();
        mat.metallic = 0.42;
        sceneWithMaterial(mat);
        const first = SceneSerializer.serializeScene(SceneManager.activeScene);
        clear();
        SceneSerializer.deserializeScene(first);

        const second = SceneSerializer.serializeScene(SceneManager.activeScene);
        expect(second.assets).toHaveLength(1);

        // A fresh session: nothing from this one is in memory.
        clear();
        AssetDatabase.clearLoaded();
        const [box] = SceneSerializer.deserializeScene(second);

        const back = box.getComponent(MeshRenderer)!.sharedMaterial as StandardMaterial;
        expect(back).toBeInstanceOf(StandardMaterial);
        expect(back.metallic).toBeCloseTo(0.42);
        expect(SceneSerializer.pendingAssetGuids).toEqual([]);
    });

    test("an inline material keeps its id from one save to the next", () => {
        sceneWithMaterial(new StandardMaterial());
        const first = SceneSerializer.serializeScene(SceneManager.activeScene);
        const again = SceneSerializer.serializeScene(SceneManager.activeScene);
        clear();
        SceneSerializer.deserializeScene(first);
        const reloaded = SceneSerializer.serializeScene(SceneManager.activeScene);

        expect(again.assets![0].guid).toBe(first.assets![0].guid);
        expect(reloaded.assets![0].guid).toBe(first.assets![0].guid);
    });

    test("an inline asset reference carries no path", () => {
        sceneWithMaterial(new StandardMaterial());
        const first = SceneSerializer.serializeScene(SceneManager.activeScene);
        clear();
        SceneSerializer.deserializeScene(first);

        const saved = SceneSerializer.serializeScene(SceneManager.activeScene);
        const ref = saved.roots[0].components.find(c => c.type === "MeshRenderer")!.fields["sharedMaterial"];

        expect(ref).toEqual({ $type: "AssetRef", guid: first.assets![0].guid });
        expect(Object.keys(ref as object)).toEqual(["$type", "guid"]);
    });

    test("an asset carried inside the scene is not listed as something to load", () => {
        sceneWithMaterial(new StandardMaterial());

        const scene = SceneSerializer.serializeScene(SceneManager.activeScene);

        expect(scene.assets).toHaveLength(1);
        expect(SceneSerializer.assetReferences(scene)).toEqual([]);
    });
});

describe("a physic material as a file", () => {
    test("round-trips its friction and bounce", async () => {
        const ice = new PhysicMaterial(0.02, 0.1);
        install({ "assets/physics/ice.physicmat.json": written(ice) });

        const loaded = await Resources.load(PhysicMaterial, "physics/ice");

        expect(loaded.friction).toBeCloseTo(0.02);
        expect(loaded.bounciness).toBeCloseTo(0.1);
        expect(AssetDatabase.guidOf(loaded)).toBe("phys-ice");
    });

    test("a collider that uses it refers to it by id and gets it back", async () => {
        install({ "assets/physics/ice.physicmat.json": written(new PhysicMaterial(0.02, 0.1)) });
        const ice = await Resources.load(PhysicMaterial, "physics/ice");
        const go = new GameObject("Floor");
        go.addComponent(BoxCollider).sharedMaterial = ice;

        const json = SceneSerializer.serializeGameObject(go);
        const ref = json.components.find(c => c.type === "BoxCollider")!.fields["sharedMaterial"] as { guid: string };
        expect(ref.guid).toBe("phys-ice");
        expect(json.assets).toBeUndefined();

        clear();
        expect(SceneSerializer.deserializeGameObject(json).getComponent(BoxCollider)!.sharedMaterial).toBe(ice);
    });

    test("one that has no file is carried by the scene like a material", () => {
        const go = new GameObject("Floor");
        go.addComponent(BoxCollider).sharedMaterial = new PhysicMaterial(0.3, 0.6);

        const json = SceneSerializer.serializeGameObject(go);
        clear();
        const back = SceneSerializer.deserializeGameObject(json).getComponent(BoxCollider)!.sharedMaterial!;

        expect(json.assets![0].type).toBe("PhysicMaterial");
        expect(back.friction).toBeCloseTo(0.3);
        expect(back.bounciness).toBeCloseTo(0.6);
    });
});

describe("a prefab as a file", () => {
    function crate(): Prefab {
        const go = new GameObject("Crate");
        go.addComponent(MeshRenderer).sharedMaterial = new StandardMaterial();
        const prefab = Prefab.fromGameObject(go);
        go.destroyImmediate();
        return prefab;
    }

    test("is read back and instantiates", async () => {
        install({ "assets/prefabs/crate.prefab.json": written(crate()) });

        const prefab = await Resources.load(Prefab, "prefabs/crate");
        const copy = prefab.instantiate();

        expect(copy.name).toBe("Crate");
        expect(copy.getComponent(MeshRenderer)!.sharedMaterial).toBeInstanceOf(StandardMaterial);
        expect(AssetDatabase.guidOf(prefab)).toBe("prefab-crate");
    });

    test("a script that holds one refers to it by id", async () => {
        install({ "assets/prefabs/crate.prefab.json": written(crate()) });
        const prefab = await Resources.load(Prefab, "prefabs/crate");
        const go = new GameObject("Spawner");
        go.addComponent(Spawner).prefab = prefab;

        const json = SceneSerializer.serializeGameObject(go);
        const ref = json.components[0].fields["prefab"] as { guid: string };
        expect(ref.guid).toBe("prefab-crate");

        clear();
        expect(SceneSerializer.deserializeGameObject(json).getComponent(Spawner)!.prefab).toBe(prefab);
    });

    test("loads the materials it uses first", async () => {
        const hull = await (async () => {
            install({ "assets/materials/hull.mat.json": written(new StandardMaterial()) });
            return Resources.load(Material, "materials/hull");
        })();
        const go = new GameObject("Crate");
        go.addComponent(MeshRenderer).sharedMaterial = hull;
        const text = written(Prefab.fromGameObject(go));
        go.destroyImmediate();
        AssetDatabase.clearLoaded();
        Resources.releaseSource();
        install({
            "assets/prefabs/crate.prefab.json": text,
            "assets/materials/hull.mat.json": written(new StandardMaterial()),
        });

        const prefab = await Resources.load(Prefab, "prefabs/crate");

        expect(AssetDatabase.isLoaded("mat-hull")).toBe(true);
        expect(prefab.instantiate().getComponent(MeshRenderer)!.sharedMaterial).toBe(AssetDatabase.get("mat-hull"));
    });
});

describe("an asset with no material in it", () => {
    test("an asset file with an untyped object field is written", () => {
        const file = SceneSerializer.serializeAsset(new Tuning());

        expect(file.type).toBe("AssetFilesSpec.Tuning");
        expect(file.fields["options"]).toEqual({ gain: 2, bands: [1, 2] });
        expect((SceneSerializer.deserializeAsset(file) as Tuning).options).toEqual({ gain: 2, bands: [1, 2] });
    });
});

describe("things that are not files", () => {
    test("an object that is not registered cannot be written", () => {
        expect(() => SceneSerializer.serializeAsset(new Texture())).toThrow(/not registered/);
        expect(() => AssetFiles.toText({})).toThrow(/no file form/);
        expect(AssetFiles.extensionFor({})).toBeNull();
    });

    test("a file in another format is refused", () => {
        expect(() => SceneSerializer.deserializeAsset({ format: "nope" } as never)).toThrow(/Not an asset file/);
    });
});
