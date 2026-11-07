import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import JSZip from "jszip";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import { ScenarioBehaviour } from "../src/engine/core/scenario/ScenarioBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { Resources } from "../src/engine/core/assets/Resources";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import type { FetchLike } from "../src/engine/core/assets/StreamingAssetSource";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { AssetFiles } from "../src/engine/core/serialization/AssetFiles";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import { parseStreamingManifest, toScenarioManifest } from "../src/engine/core/assets/StreamingManifest";

/**
 * B0 / E1: `manifest.entryScene`. After the entry point's `awake()` the loader
 * builds that scene, with the files it refers to loaded first. An archive
 * without the field behaves as it always did.
 *
 * `run()` imports the entry point from a blob URL, which Node cannot do, so the
 * entry point is handed in at the one seam that does the import
 * (`_loadEntryPoint`); everything else — archive, manifest, asset source,
 * `Resources`, the scene — is the real thing.
 */

@Serializable({ typeName: "EntrySceneSpec.Spawner" })
class Spawner extends Behaviour {
    @SerializedField({ type: FieldType.Asset })
    public prefab: Prefab | null = null;
}

/** What the entry point saw, in order. */
const log: string[] = [];
let rootsAtAwake: string[] = [];

class Entry extends ScenarioBehaviour {
    override awake(): void {
        log.push("awake");
        rootsAtAwake = SceneManager.activeScene.getRootGameObjects().map(g => g.name);
    }
}

const SCENE = "assets/scenes/main.scene.json";
const PREFAB = "assets/prefabs/crate.prefab.json";
const MATERIAL = "assets/materials/hull.mat.json";

const assetEntries = [
    { guid: "mat-hull", path: MATERIAL },
    { guid: "prefab-crate", path: PREFAB },
];

/** A prefab, a material it uses and a scene with a Spawner and a linked instance, as files. */
function authoredFiles(): Record<string, string> {
    AssetDatabase.setManifest(assetEntries);
    const hull = new StandardMaterial();
    AssetDatabase._bindGuid("mat-hull", hull);

    const crateSource = new GameObject("Crate");
    crateSource.addComponent(MeshRenderer).sharedMaterial = hull;
    const prefab = Prefab.fromGameObject(crateSource);
    crateSource.destroyImmediate();
    AssetDatabase._bindGuid("prefab-crate", prefab);

    const spawner = new GameObject("Spawner");
    spawner.addComponent(Spawner).prefab = prefab;
    prefab.instantiate().name = "CrateInstance";
    const scene = SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });

    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    const files = {
        [SCENE]: JSON.stringify(scene),
        [PREFAB]: AssetFiles.toText(prefab),
        [MATERIAL]: AssetFiles.toText(hull),
    };
    AssetDatabase.clear();
    return files;
}

async function archive(files: Record<string, string>, manifestExtra: object): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
        manifestVersion: "1.0", id: "entry-scene-spec", name: "Entry Scene Spec", version: "1.0.0",
        entryPoint: "main.js", assets: assetEntries, ...manifestExtra,
    }));
    zip.file("scripts/main.js", "export default class Main {}");
    for (const [path, text] of Object.entries(files)) zip.file(path, text);
    return zip.generateAsync({ type: "arraybuffer" });
}

async function loaded(files: Record<string, string>, manifestExtra: object): Promise<Scenario> {
    const scenario = new Scenario();
    await scenario.loadFromData(await archive(files, manifestExtra));
    vi.spyOn(scenario as any, "_loadEntryPoint").mockImplementation(async () => new Entry());
    return scenario;
}

const roots = (): GameObject[] => SceneManager.activeScene.getRootGameObjects();
const names = (): string[] => roots().map(g => g.name).sort();

beforeEach(() => {
    log.length = 0;
    rootsAtAwake = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
    Scenario.current?.unload();
    Resources.releaseSource();
    AssetDatabase.clear();
    vi.restoreAllMocks();
});

describe("manifest.entryScene in a ZIP", () => {
    test("builds the scene after awake, complete with the prefab and material files it refers to", async () => {
        const scenario = await loaded(authoredFiles(), { entryScene: "scenes/main.scene.json" });

        await scenario.run();

        expect(log).toEqual(["awake"]);
        expect(rootsAtAwake).toEqual([]);
        expect(names()).toEqual(["CrateInstance", "Spawner"]);

        const prefab = AssetDatabase.get("prefab-crate") as Prefab;
        expect(prefab).toBeInstanceOf(Prefab);
        const spawner = roots().find(g => g.name === "Spawner")!;
        expect(spawner.getComponent(Spawner)!.prefab).toBe(prefab);

        const hull = AssetDatabase.get("mat-hull");
        expect(hull).toBeInstanceOf(StandardMaterial);
        const crate = roots().find(g => g.name === "CrateInstance")!;
        expect(crate.getComponent(MeshRenderer)!.sharedMaterial).toBe(hull);
    });

    test("accepts the path with the assets/ prefix", async () => {
        const scenario = await loaded(authoredFiles(), { entryScene: SCENE });

        await scenario.run();

        expect(names()).toEqual(["CrateInstance", "Spawner"]);
    });

    test("without entryScene nothing is built and no scene file is read", async () => {
        const scenario = await loaded(authoredFiles(), {});
        const read = vi.spyOn(Resources, "loadAtPath");

        await scenario.run();

        expect(log).toEqual(["awake"]);
        expect(names()).toEqual([]);
        expect(read).not.toHaveBeenCalled();
    });

    test("a missing scene file fails the run and leaves nothing behind", async () => {
        const files = authoredFiles();
        delete files[SCENE];
        const scenario = await loaded(files, { entryScene: "scenes/main.scene.json" });
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(scenario.run()).rejects.toThrow(/Cannot read entryScene "scenes\/main.scene.json"/);

        expect(Scenario.current).toBeNull();
        expect(Resources.hasSource).toBe(false);
    });

    test("a scene of a version this build does not read fails the run before anything is built", async () => {
        const files = authoredFiles();
        files[SCENE] = JSON.stringify({ ...JSON.parse(files[SCENE]), version: 99 });
        const scenario = await loaded(files, { entryScene: "scenes/main.scene.json" });
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(scenario.run()).rejects.toThrow(/version/i);

        expect(SceneManager.getSceneByName("Entry Scene Spec")).toBeNull();
    });
});

describe("manifest.entryScene in a streaming manifest", () => {
    const base = {
        schema: 1, id: "streamed", entry: "scripts/main.js",
        scripts: [{ path: "scripts/main.js", url: "main.js" }],
        assets: [] as unknown[],
    };

    test("is carried to the scenario manifest", () => {
        const parsed = parseStreamingManifest({ ...base, entryScene: "scenes/main.scene.json" });

        expect(toScenarioManifest(parsed).entryScene).toBe("scenes/main.scene.json");
        expect(toScenarioManifest(parseStreamingManifest(base)).entryScene).toBeUndefined();
    });

    test("must be a non-empty string", () => {
        expect(() => parseStreamingManifest({ ...base, entryScene: "" })).toThrow(/entryScene/);
        expect(() => parseStreamingManifest({ ...base, entryScene: 3 })).toThrow(/entryScene/);
    });

    test("a streamed scenario builds it, with the files it refers to fetched first", async () => {
        const files = authoredFiles();
        const url = "https://cdn.test/f/";
        const body: Record<string, string> = {
            [`${url}scenario.json`]: JSON.stringify({
                ...base, entryScene: "scenes/main.scene.json",
                assets: [
                    { path: "scenes/main.scene.json", priority: "critical", lods: [{ level: 0, url: "scene.json" }] },
                    { path: "prefabs/crate.prefab.json", guid: "prefab-crate", priority: "lazy", lods: [{ level: 0, url: "crate.json" }] },
                    { path: "materials/hull.mat.json", guid: "mat-hull", priority: "lazy", lods: [{ level: 0, url: "hull.json" }] },
                ],
            }),
            [`${url}main.js`]: "export default class Main {}",
            [`${url}scene.json`]: files[SCENE],
            [`${url}crate.json`]: files[PREFAB],
            [`${url}hull.json`]: files[MATERIAL],
        };
        const fetch: FetchLike = async (u: string) => {
            const text = body[u];
            if (text === undefined) return { ok: false, status: 404 } as unknown as Response;
            const bytes = new TextEncoder().encode(text);
            return {
                ok: true, status: 200,
                arrayBuffer: async () => bytes.buffer.slice(0),
                json: async () => JSON.parse(text),
            } as unknown as Response;
        };

        const scenario = new Scenario();
        await scenario.loadFromManifestUrl(`${url}scenario.json`, { fetch });
        vi.spyOn(scenario as any, "_loadEntryPoint").mockImplementation(async () => new Entry());
        await scenario.run();

        expect(names()).toEqual(["CrateInstance", "Spawner"]);
        const spawner = roots().find(g => g.name === "Spawner")!;
        const prefab = spawner.getComponent(Spawner)!.prefab;
        expect(prefab).toBeInstanceOf(Prefab);
        expect(prefab).toBe(AssetDatabase.get("prefab-crate"));
    });
});
