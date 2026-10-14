import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Resources, type IAssetSource } from "../src/engine/core/assets/Resources";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import {
    SceneSerializer,
    type SerializedGameObject,
    type SerializedScene,
    type SerializedAssetFile,
} from "../src/engine/core/serialization/SceneSerializer";
import { UnsupportedFormatError } from "../src/engine/core/serialization/UnsupportedFormatError";
import { AssetFiles } from "../src/engine/core/serialization/AssetFiles";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { Material } from "../src/engine/core/graphics/Material";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { PhysicMaterial } from "../src/engine/physics/PhysicMaterial";
import WebEngine, * as Engine from "../src/engine/index";

/**
 * The engine states which file versions it reads, and every reader refuses the
 * rest the same way and before it builds or loads anything. The platform
 * (virtual-lab `player-formats.js`) refuses at upload on the same rule.
 */

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
};

const node = (name: string): SerializedGameObject => ({
    name, active: true, transform: pose, components: [], children: [],
});

const scene = (version?: unknown): SerializedScene =>
    ({ name: "S", ...(version === undefined ? {} : { version }), roots: [node("Root")] }) as unknown as SerializedScene;

/** A prefab file whose tree links another prefab, so reading it makes the loader fetch that one. */
const linkingPrefab = (version?: unknown): string => JSON.stringify({
    name: "outer",
    ...(version === undefined ? {} : { version }),
    snapshot: {
        ...node("outer"), id: "outer-root",
        children: [{
            ...node("holds"), id: "outer-holds",
            prefab: { guid: "prefab-crate", changes: { overrides: [] } },
        }],
    },
});

/** An asset source over a plain map that records every read. */
class MemorySource implements IAssetSource {
    public readonly reads: string[] = [];
    constructor(private readonly _files: Map<string, string>) {}

    has(path: string): boolean { return this._files.has(path); }
    list(prefix = ""): string[] { return [...this._files.keys()].filter(p => p.startsWith(prefix)); }

    async readBytes(path: string): Promise<Uint8Array> {
        this.reads.push(path);
        const file = this._files.get(path);
        if (file === undefined) throw new Error(`No such file: ${path}`);
        return new TextEncoder().encode(file);
    }

    async readText(path: string): Promise<string> {
        return new TextDecoder().decode(await this.readBytes(path));
    }

    async getBlobUrl(path: string): Promise<string> { return `blob:${path}`; }
}

let source: MemorySource;

function install(entries: Record<string, string>): void {
    source = new MemorySource(new Map(Object.entries(entries)));
    Resources.useSource(source);
    AssetDatabase.setManifest([
        { guid: "mat-hull", path: "assets/materials/hull.mat.json" },
        { guid: "phys-ice", path: "assets/physics/ice.physicmat.json" },
        { guid: "prefab-crate", path: "assets/prefabs/crate.prefab.json" },
        { guid: "prefab-outer", path: "assets/prefabs/outer.prefab.json" },
    ]);
}

const crate = JSON.stringify({ name: "crate", snapshot: node("crate") });

/** What a reader throws, as the error it should be. */
function refusal(run: () => unknown): UnsupportedFormatError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedFormatError);
        return error as UnsupportedFormatError;
    }
    throw new Error("The reader accepted the file.");
}

async function refusalOf(run: () => Promise<unknown>): Promise<UnsupportedFormatError> {
    try {
        await run();
    } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedFormatError);
        return error as UnsupportedFormatError;
    }
    throw new Error("The reader accepted the file.");
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

beforeEach(clear);

afterEach(() => {
    vi.restoreAllMocks();
    Resources.releaseSource();
    AssetDatabase.clear();
});

// ---------------------------------------------------------------------------
// the public API
// ---------------------------------------------------------------------------

describe("which versions the engine reads", () => {
    test("readableVersions is [1, 2] and cannot be changed", () => {
        expect(SceneSerializer.readableVersions).toEqual([1, 2]);
        expect(Object.isFrozen(SceneSerializer.readableVersions)).toBe(true);
        expect(() => (SceneSerializer.readableVersions as number[]).push(3)).toThrow(TypeError);
    });

    test("every version this build writes is one it reads", () => {
        const go = new GameObject("Plain");
        const written = SceneSerializer.serializeScene(SceneManager.activeScene).version;

        expect(SceneSerializer.readableVersions).toContain(written);
        expect(SceneSerializer.canRead(SceneSerializer.serializeScene(SceneManager.activeScene))).toBe(true);
        expect(SceneSerializer.canRead(SceneSerializer.serializeGameObject(go))).toBe(true);
    });

    test.each([
        [{}, 1],
        [{ name: "no version" }, 1],
        [{ version: 1 }, 1],
        [{ version: 2 }, 2],
        [{ version: 3 }, 3],
        [{ version: 40 }, 40],
        [{ version: "2" }, null],
        [{ version: "1" }, null],
        [{ version: 0 }, null],
        [{ version: -1 }, null],
        [{ version: 1.5 }, null],
        [{ version: null }, null],
        [{ version: true }, null],
        [{ version: [1] }, null],
        [{ version: {} }, null],
        [{ version: NaN }, null],
        [{ version: Infinity }, null],
        [null, null],
        [undefined, null],
        ["2", null],
        [2, null],
        [[], null],
    ])("versionOf(%j) is %j", (json, expected) => {
        expect(SceneSerializer.versionOf(json)).toBe(expected);
    });

    test("canRead is true for exactly the versions listed", () => {
        expect(SceneSerializer.canRead({})).toBe(true);
        expect(SceneSerializer.canRead({ version: 1 })).toBe(true);
        expect(SceneSerializer.canRead({ version: 2 })).toBe(true);
        expect(SceneSerializer.canRead({ version: 3 })).toBe(false);
        expect(SceneSerializer.canRead({ version: "2" })).toBe(false);
        expect(SceneSerializer.canRead({ version: 0 })).toBe(false);
        expect(SceneSerializer.canRead({ version: null })).toBe(false);
        expect(SceneSerializer.canRead(null)).toBe(false);
    });
});

describe("UnsupportedFormatError", () => {
    test("is an Error that carries what was found, what is read and what was being read", () => {
        const error = new UnsupportedFormatError("scene", 3, [1, 2]);

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("UnsupportedFormatError");
        expect(error.version).toBe(3);
        expect(error.readable).toEqual([1, 2]);
        expect(error.what).toBe("scene");
        expect(error.message).toMatch(/format version 3/);
        expect(error.message).toMatch(/versions 1 and 2/);
        expect(error.message).toMatch(/Update the engine/);
    });

    test("a version that is not a version says so instead of asking for an update", () => {
        const error = new UnsupportedFormatError("prefab", "3", [1, 2]);

        expect(error.version).toBe("3");
        expect(error.message).toMatch(/invalid format version \("3"\)/);
        expect(error.message).not.toMatch(/Update the engine/);
    });

    test("is exported by name and on the default namespace", () => {
        expect(Engine.UnsupportedFormatError).toBe(UnsupportedFormatError);
        expect(WebEngine.UnsupportedFormatError).toBe(UnsupportedFormatError);
    });
});

// ---------------------------------------------------------------------------
// every reader, one rule
// ---------------------------------------------------------------------------

describe("a scene", () => {
    test.each([undefined, 1, 2])("of version %s is read", (version) => {
        expect(SceneSerializer.deserializeScene(scene(version))).toHaveLength(1);
    });

    test.each([3, 99, "2", 0, -1, 1.5, null])("of version %j is refused before anything is built", (version) => {
        const error = refusal(() => SceneSerializer.deserializeScene(scene(version)));

        expect(error.what).toBe("scene");
        expect(error.version).toBe(version);
        expect(error.readable).toEqual([1, 2]);
        expect(SceneManager.activeScene.getRootGameObjects()).toHaveLength(0);
    });

    test("that is not an object is refused the same way", () => {
        const error = refusal(() => SceneSerializer.deserializeScene(null as unknown as SerializedScene));

        expect(error.what).toBe("scene");
        expect(error.version).toBeNull();
    });
});

describe("a lone GameObject", () => {
    test.each([undefined, 1, 2])("of version %s is read", (version) => {
        const json = { ...node("Solo"), ...(version === undefined ? {} : { version }) } as SerializedGameObject;

        expect(SceneSerializer.deserializeGameObject(json).name).toBe("Solo");
    });

    test.each([3, "2", 0, null])("of version %j is refused before anything is built", (version) => {
        const json = { ...node("Solo"), version } as unknown as SerializedGameObject;

        const error = refusal(() => SceneSerializer.deserializeGameObject(json));

        expect(error.what).toBe("gameObject");
        expect(error.version).toBe(version);
        expect(SceneManager.activeScene.getRootGameObjects()).toHaveLength(0);
    });

    test("copying an object still works, since its snapshot states no version", () => {
        const original = new GameObject("Original");

        const copy = SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(original));

        expect(copy.name).toBe("Original");
    });
});

describe("a prefab", () => {
    test.each([undefined, 1, 2])("of version %s is read by fromJSON", (version) => {
        const prefab = Prefab.fromJSON({ name: "P", ...(version === undefined ? {} : { version }), snapshot: node("P") });

        expect(prefab.name).toBe("P");
    });

    test.each([3, "2", 0, null, 1.5])("of version %j is refused by fromJSON", (version) => {
        const error = refusal(() => Prefab.fromJSON({ name: "P", version, snapshot: node("P") } as never));

        expect(error.what).toBe("prefab");
        expect(error.version).toBe(version);
        expect(error.readable).toEqual([1, 2]);
    });

    test("a variant of a version this build does not read is refused too", () => {
        const error = refusal(() => Prefab.fromJSON({ name: "V", version: 3, base: "prefab-crate" } as never));

        expect(error.what).toBe("prefab");
    });

    test("read through Resources, a version-3 file is refused before its references are loaded", async () => {
        install({
            "assets/prefabs/outer.prefab.json": linkingPrefab(3),
            "assets/prefabs/crate.prefab.json": crate,
        });
        const loadAtPath = vi.spyOn(Resources, "loadAtPath");

        const error = await refusalOf(() => Resources.load(Prefab, "prefabs/outer"));

        expect(error.what).toBe("prefab");
        expect(error.version).toBe(3);
        expect(loadAtPath).not.toHaveBeenCalled();
        expect(source.reads).toEqual(["assets/prefabs/outer.prefab.json"]);
    });

    test.each([`"2"`, "0", "null"])("a file whose version is %s is refused before its references are loaded", async (stated) => {
        install({
            "assets/prefabs/outer.prefab.json": linkingPrefab(2).replace(`"version":2`, `"version":${stated}`),
            "assets/prefabs/crate.prefab.json": crate,
        });
        const loadAtPath = vi.spyOn(Resources, "loadAtPath");

        await refusalOf(() => Resources.load(Prefab, "prefabs/outer"));

        expect(loadAtPath).not.toHaveBeenCalled();
    });

    test("the same file at version 2 does load what it refers to, which is what the spy above would catch", async () => {
        install({
            "assets/prefabs/outer.prefab.json": linkingPrefab(2),
            "assets/prefabs/crate.prefab.json": crate,
        });
        const loadAtPath = vi.spyOn(Resources, "loadAtPath");

        const prefab = await Resources.load(Prefab, "prefabs/outer");

        expect(prefab.name).toBe("outer");
        expect(loadAtPath).toHaveBeenCalledWith("assets/prefabs/crate.prefab.json");
    });

    test("a file of no stated version is read as 1", async () => {
        install({ "assets/prefabs/outer.prefab.json": linkingPrefab(), "assets/prefabs/crate.prefab.json": crate });

        expect((await Resources.load(Prefab, "prefabs/outer")).name).toBe("outer");
    });
});

describe("a material file", () => {
    const text = (version?: unknown): string => {
        const file: Record<string, unknown> = { ...SceneSerializer.serializeAsset(new StandardMaterial()) };
        if (version === undefined) delete file["version"];
        else file["version"] = version;
        return JSON.stringify(file);
    };

    test("is still written as version 1, byte for byte", () => {
        const file = SceneSerializer.serializeAsset(new StandardMaterial());

        expect(file.version).toBe(1);
        expect(Object.keys(file)).toEqual(["format", "version", "type", "fields"]);
    });

    test.each([undefined, 1])("of version %s is read", async (version) => {
        install({ "assets/materials/hull.mat.json": text(version) });

        expect(await Resources.load(Material, "materials/hull")).toBeInstanceOf(StandardMaterial);
    });

    test.each([2, 3, "1", 0, null])("of version %j is refused", async (version) => {
        install({ "assets/materials/hull.mat.json": text(version) });

        const error = await refusalOf(() => Resources.load(Material, "materials/hull"));

        expect(error.what).toBe("material");
        expect(error.version).toBe(version);
        expect(error.readable).toEqual([1]);
    });

    test("is refused by deserializeAsset too, for a caller that reads it without Resources", () => {
        const file = { ...SceneSerializer.serializeAsset(new StandardMaterial()), version: 3 } as unknown as SerializedAssetFile;

        const error = refusal(() => SceneSerializer.deserializeAsset(file));

        expect(error.what).toBe("material");
        expect(error.version).toBe(3);
    });
});

describe("a physic material file", () => {
    const text = (version?: unknown): string => {
        const file: Record<string, unknown> = { ...SceneSerializer.serializeAsset(new PhysicMaterial(0.1, 0.2)) };
        if (version === undefined) delete file["version"];
        else file["version"] = version;
        return JSON.stringify(file);
    };

    test("is still written as version 1, byte for byte", () => {
        const file = SceneSerializer.serializeAsset(new PhysicMaterial(0.1, 0.2));

        expect(file.version).toBe(1);
        expect(Object.keys(file)).toEqual(["format", "version", "type", "fields"]);
    });

    test.each([undefined, 1])("of version %s is read", async (version) => {
        install({ "assets/physics/ice.physicmat.json": text(version) });

        const loaded = await Resources.load(PhysicMaterial, "physics/ice");

        expect(loaded.friction).toBeCloseTo(0.1);
    });

    test.each([2, 3, "1", 0, null])("of version %j is refused", async (version) => {
        install({ "assets/physics/ice.physicmat.json": text(version) });

        const error = await refusalOf(() => Resources.load(PhysicMaterial, "physics/ice"));

        expect(error.what).toBe("physicMaterial");
        expect(error.version).toBe(version);
        expect(error.readable).toEqual([1]);
    });

    test("is refused by deserializeAsset with the right kind", () => {
        const file = { ...SceneSerializer.serializeAsset(new PhysicMaterial()), version: 3 } as unknown as SerializedAssetFile;

        expect(refusal(() => SceneSerializer.deserializeAsset(file)).what).toBe("physicMaterial");
    });
});

describe("a file the writers produce is unchanged", () => {
    test("an asset file has the same bytes as before", () => {
        expect(AssetFiles.toText(new StandardMaterial())).toBe(
            JSON.stringify(SceneSerializer.serializeAsset(new StandardMaterial()), null, 2),
        );
    });

    test("a scene with no prefab link is version 1 and a prefab made of a plain tree states none", () => {
        const go = new GameObject("Plain");

        expect(SceneSerializer.serializeScene(SceneManager.activeScene).version).toBe(1);
        expect(new Prefab(SceneSerializer.serializeGameObject(go), "Plain").toJSON().version).toBeUndefined();
    });
});
