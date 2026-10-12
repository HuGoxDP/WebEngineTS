import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
    }),
});

const { ScenarioAssets } = await import("../src/engine/core/scenario/ScenarioAssets");
const { GameObject } = await import("../src/engine/core/GameObject");
const { SceneManager } = await import("../src/engine/core/SceneManager");
const { AssetDatabase } = await import("../src/engine/core/assets/AssetDatabase");
const { Resources } = await import("../src/engine/core/assets/Resources");
const { SceneSerializer } = await import("../src/engine/core/serialization/SceneSerializer");
const { AssetFiles } = await import("../src/engine/core/serialization/AssetFiles");
const { Prefab } = await import("../src/engine/core/serialization/Prefab");
const { MeshFilter } = await import("../src/engine/core/rendering/MeshFilter");
const { MeshRenderer } = await import("../src/engine/core/rendering/MeshRenderer");
const { Mesh } = await import("../src/engine/core/graphics/Mesh");
const { StandardMaterial } = await import("../src/engine/core/graphics/StandardMaterial");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");

/**
 * A model placed in a scene saved a MeshFilter with no mesh and a material copy
 * with no textures — the file was the only place they existed, and nothing said
 * which part of it a reference meant. Everything made from a model file now has
 * an id inside that file, so a saved scene can name it.
 *
 * These drive `_convertGLTFScene` with a hand-built node tree, like the axis
 * tests, so no binary fixture is shipped.
 */

type Associations = Map<object, { meshes?: number; primitives?: number; materials?: number; textures?: number }>;

const stubSource = {
    readBytes: async (): Promise<Uint8Array> => new Uint8Array(),
    exists: async (): Promise<boolean> => false,
    list: async (): Promise<string[]> => [],
};

const FILE = "model-guid";

function convert(scene: THREE.Object3D, associations?: Associations, fileGuid: string | null = FILE) {
    const assets = new ScenarioAssets(stubSource as never);
    return (assets as unknown as {
        _convertGLTFScene(gltf: unknown, name: string, fileGuid: string | null): InstanceType<typeof GameObject>;
    })._convertGLTFScene({ scene, parser: associations ? { associations } : undefined }, "Model", fileGuid);
}

function threeMesh(name: string, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = name;
    return mesh;
}

/** A glTF-shaped scene: two meshes, three materials' worth of parts, one shared texture. */
function car(): { scene: THREE.Group; associations: Associations; parts: Record<string, object> } {
    const texture = new THREE.Texture();
    const body = new THREE.MeshStandardMaterial({ map: texture });
    const glass = new THREE.MeshStandardMaterial({ map: texture });
    const bodyMesh = threeMesh("Body", body);
    const glassMesh = threeMesh("Glass", glass);

    const scene = new THREE.Group();
    scene.add(bodyMesh, glassMesh);

    const associations: Associations = new Map();
    associations.set(bodyMesh, { meshes: 0, primitives: 0 });
    associations.set(glassMesh, { meshes: 1, primitives: 0 });
    associations.set(body, { materials: 0 });
    associations.set(glass, { materials: 3 });
    associations.set(texture, { textures: 2 });

    return { scene, associations, parts: { texture, body, glass, bodyMesh, glassMesh } };
}

function meshOf(root: InstanceType<typeof GameObject>, name: string): InstanceType<typeof Mesh> {
    const find = (go: InstanceType<typeof GameObject>): InstanceType<typeof GameObject> | null => {
        if (go.name === name) return go;
        for (let i = 0; i < go.transform.childCount; i++) {
            const hit = find(go.transform.getChild(i).gameObject);
            if (hit) return hit;
        }
        return null;
    };
    return find(root)!.getComponent(MeshFilter)!.sharedMesh!;
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

beforeEach(() => {
    clear();
    AssetDatabase.clear();
});
afterEach(() => {
    clear();
    Resources.releaseSource();
    AssetDatabase.clear();
});

describe("what a model is made of has ids inside the model's file", () => {
    test("meshes take the glTF's own mesh and primitive indices", () => {
        const { scene, associations } = car();
        const root = convert(scene, associations);

        expect(AssetDatabase.guidOf(meshOf(root, "Body"))).toBe(`${FILE}#mesh:0.0`);
        expect(AssetDatabase.guidOf(meshOf(root, "Glass"))).toBe(`${FILE}#mesh:1.0`);
    });

    test("materials and textures too", () => {
        const { scene, associations } = car();
        const root = convert(scene, associations);

        const bodyMaterial = root.getComponent(MeshRenderer)
            ?? null;
        expect(bodyMaterial).toBeNull(); // the root itself carries none
        expect(AssetDatabase.get(`${FILE}#material:0`)).toBeInstanceOf(StandardMaterial);
        expect(AssetDatabase.get(`${FILE}#material:3`)).toBeInstanceOf(StandardMaterial);
        expect(AssetDatabase.get(`${FILE}#texture:2`)).toBeInstanceOf(Texture2D);
    });

    test("a texture used by two materials is one engine texture, with one id", () => {
        const { scene, associations } = car();
        convert(scene, associations);

        const body = AssetDatabase.get(`${FILE}#material:0`) as InstanceType<typeof StandardMaterial>;
        const glass = AssetDatabase.get(`${FILE}#material:3`) as InstanceType<typeof StandardMaterial>;

        expect(body.albedoTexture).not.toBeNull();
        expect(glass.albedoTexture).toBe(body.albedoTexture);
        expect(AssetDatabase.guidOf(body.albedoTexture)).toBe(`${FILE}#texture:2`);
    });

    test("without the loader's indices they are numbered by discovery, and never collide", () => {
        const { scene } = car();
        const root = convert(scene, undefined);

        expect(AssetDatabase.guidOf(meshOf(root, "Body"))).toBe(`${FILE}#mesh~0`);
        expect(AssetDatabase.guidOf(meshOf(root, "Glass"))).toBe(`${FILE}#mesh~1`);
        expect(AssetDatabase.get(`${FILE}#material~0`)).not.toBeNull();
        expect(AssetDatabase.get(`${FILE}#material~1`)).not.toBeNull();
    });

    test("two parts the loader gave one index still get two ids", () => {
        const { scene, associations, parts } = car();
        associations.set(parts.glassMesh, { meshes: 0, primitives: 0 });

        const root = convert(scene, associations);

        const ids = [meshOf(root, "Body"), meshOf(root, "Glass")].map(m => AssetDatabase.guidOf(m));
        expect(new Set(ids).size).toBe(2);
        expect(ids[0]).toBe(`${FILE}#mesh:0.0`);
    });

    test("nothing is bound when the file has no id to be relative to", () => {
        const { scene, associations } = car();

        const root = convert(scene, associations, null);

        expect(AssetDatabase.guidOf(meshOf(root, "Body"))).toBeNull();
    });
});

describe("a saved scene names parts of a model instead of losing them", () => {
    test("the mesh and material are written as references into the file", () => {
        const { scene, associations } = car();
        const root = convert(scene, associations);

        const json = SceneSerializer.serializeGameObject(root);
        const body = findJson(json, "Body");
        const filter = body.components.find(c => c.type === "MeshFilter")!.fields["sharedMesh"] as { guid: string };
        const renderer = body.components.find(c => c.type === "MeshRenderer")!.fields["sharedMaterial"] as { guid: string };

        expect(filter.guid).toBe(`${FILE}#mesh:0.0`);
        expect(renderer.guid).toBe(`${FILE}#material:0`);
        expect(json.assets).toBeUndefined();
    });

    test("opening the scene finds the very same mesh and material", () => {
        const { scene, associations } = car();
        const root = convert(scene, associations);
        const json = SceneSerializer.serializeGameObject(root);
        const mesh = meshOf(root, "Body");
        root.destroyImmediate();

        const back = SceneSerializer.deserializeGameObject(json);

        expect(meshOf(back, "Body")).toBe(mesh);
        expect(meshOf(back, "Glass")).toBe(AssetDatabase.get(`${FILE}#mesh:1.0`));
    });

    test("a copy made through a prefab shares the model's parts", () => {
        const { scene, associations } = car();
        const root = convert(scene, associations);

        const copy = Prefab.fromGameObject(root).instantiate();

        expect(meshOf(copy, "Body")).toBe(meshOf(root, "Body"));
    });

    function findJson(
        node: ReturnType<typeof SceneSerializer.serializeGameObject>,
        name: string,
    ): ReturnType<typeof SceneSerializer.serializeGameObject> {
        if (node.name === name) return node;
        for (const child of node.children) {
            const hit = findJson(child, name);
            if (hit) return hit;
        }
        return null as never;
    }
});

describe("sub-asset ids", () => {
    test("name a part of a file, and say which file", () => {
        const guid = AssetDatabase.subGuid("abc", "mesh:2.0");

        expect(guid).toBe("abc#mesh:2.0");
        expect(AssetDatabase.isSub(guid)).toBe(true);
        expect(AssetDatabase.isSub("abc")).toBe(false);
        expect(AssetDatabase.fileOf(guid)).toBe("abc");
        expect(AssetDatabase.fileOf("abc")).toBe("abc");
    });

    test("resolve to the path of their file", () => {
        AssetDatabase.setManifest([{ guid: "abc", path: "models/car.glb" }]);

        expect(AssetDatabase.pathOf("abc#mesh:0.0")).toBe("models/car.glb");
    });

    test("go when the file's instance goes", () => {
        const { scene, associations } = car();
        AssetDatabase.setManifest([{ guid: FILE, path: "models/car.glb" }]);
        const root = convert(scene, associations);
        AssetDatabase._bindGuid(FILE, root);
        expect(AssetDatabase.isLoaded(`${FILE}#mesh:0.0`)).toBe(true);

        AssetDatabase._unbind(root);

        expect(AssetDatabase.isLoaded(`${FILE}#mesh:0.0`)).toBe(false);
        expect(AssetDatabase.isLoaded(`${FILE}#material:3`)).toBe(false);
    });

    test("do not take an unrelated file's parts with them", () => {
        const { scene, associations } = car();
        const root = convert(scene, associations);
        AssetDatabase._bindGuid(FILE, root);
        const other = new Mesh("Other");
        AssetDatabase._bindSub("other-file", "mesh:0.0", other);

        AssetDatabase._unbind(root);

        expect(AssetDatabase.get("other-file#mesh:0.0")).toBe(other);
    });
});

describe("loading what refers to a part of a model", () => {
    test("loads the model first, once, however many parts are used", async () => {
        const decoded: string[] = [];
        const { scene, associations } = car();

        // The model decoder ScenarioAssets installs, standing in for the real
        // GLTF parse: it converts the same hand-built tree.
        Resources.registerDecoder(GameObject, [".glb"], async (_bytes: Uint8Array, path: string) => {
            decoded.push(path);
            return convert(scene, associations, AssetDatabase.guidForPath(path));
        });
        AssetDatabase.setManifest([
            { guid: FILE, path: "assets/models/car.glb" },
            { guid: "prefab-car", path: "assets/prefabs/car.prefab.json" },
        ]);

        // A prefab that uses two parts of a model that has not been loaded.
        const first = car();
        const loadedModel = convert(first.scene, first.associations);
        const prefabText = AssetFiles.toText(Prefab.fromGameObject(loadedModel));
        loadedModel.destroyImmediate();
        AssetDatabase.clearLoaded();

        const files = new Map<string, string | Uint8Array>([
            ["assets/prefabs/car.prefab.json", prefabText],
            ["assets/models/car.glb", new Uint8Array(1)],
        ]);
        Resources.useSource({
            has: (p: string) => files.has(p),
            list: (prefix = "") => [...files.keys()].filter(p => p.startsWith(prefix)),
            readBytes: async (p: string) => {
                const f = files.get(p)!;
                return typeof f === "string" ? new TextEncoder().encode(f) : f;
            },
            readText: async (p: string) => String(files.get(p)),
            getBlobUrl: async (p: string) => `blob:${p}`,
        });

        const prefab = await Resources.load(Prefab, "prefabs/car");

        expect(decoded).toEqual(["assets/models/car.glb"]);
        const copy = prefab.instantiate();
        expect(meshOf(copy, "Body")).toBe(AssetDatabase.get(`${FILE}#mesh:0.0`));
        expect(meshOf(copy, "Glass")).toBe(AssetDatabase.get(`${FILE}#mesh:1.0`));
    });
});
