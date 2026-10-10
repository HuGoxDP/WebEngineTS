import { describe, test, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";

// Cubemap.fromColor draws to a canvas; nothing here needs it to draw anything.
vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
    }),
});

// Loaded for its side effect: it installs the hook SceneSerializer builds objects through.
await import("../src/engine/core/GameObject");
const { SceneManager, LoadSceneMode } = await import("../src/engine/core/SceneManager");
const { SceneSerializer } = await import("../src/engine/core/serialization/SceneSerializer");
const { RenderSettings, FogMode } = await import("../src/engine/core/RenderSettings");
const { AssetDatabase } = await import("../src/engine/core/assets/AssetDatabase");
const { Cubemap } = await import("../src/engine/core/graphics/Cubemap");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { Color } = await import("../src/engine/core/math/Color");

/**
 * RenderSettings is global state, not a component, so a scene file used to
 * forget its fog, its ambient light and its sky — and an editor that opened a
 * scene and saved it again silently reset all three. They are part of the scene
 * now.
 */

function panorama(): InstanceType<typeof Texture2D> {
    const tex = new THREE.Texture({ width: 2048, height: 1024 } as unknown as HTMLImageElement);
    tex.needsUpdate = true;
    return Texture2D._fromThreeTexture(tex);
}

/** A panorama the asset database knows, as `Resources.load` leaves one. */
function loaded(guid: string): InstanceType<typeof Texture2D> {
    const texture = panorama();
    AssetDatabase._bindGuid(guid, texture);
    return texture;
}

function save() {
    return SceneSerializer.serializeScene(SceneManager.activeScene);
}

/** What a saved file does to the process: the previous scene's settings are gone. */
function wipe(): void {
    RenderSettings._reset();
    AssetDatabase.clearLoaded();
}

beforeEach(() => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    wipe();
});

describe("a scene's fog and ambient light", () => {
    test("are written with the scene", () => {
        RenderSettings.fog = true;
        RenderSettings.fogColor = new Color(0.1, 0.2, 0.3, 1);
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogStartDistance = 5;
        RenderSettings.fogEndDistance = 80;
        RenderSettings.fogDensity = 0.07;
        RenderSettings.ambientColor = new Color(0.4, 0.5, 0.6, 1);

        const rs = save().renderSettings!;

        expect(rs.fog).toBe(true);
        expect(rs.fogColor).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
        expect(rs.fogMode).toBe(FogMode.Linear);
        expect(rs.fogStartDistance).toBe(5);
        expect(rs.fogEndDistance).toBe(80);
        expect(rs.fogDensity).toBe(0.07);
        expect(rs.ambientColor).toEqual({ r: 0.4, g: 0.5, b: 0.6, a: 1 });
    });

    test("come back as they were saved", () => {
        RenderSettings.fog = true;
        RenderSettings.fogColor = new Color(0.1, 0.2, 0.3, 1);
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogDensity = 0.07;
        RenderSettings.ambientColor = new Color(0.4, 0.5, 0.6, 1);
        const json = save();

        wipe();
        expect(RenderSettings.fog).toBe(false);
        SceneSerializer.deserializeScene(json);

        expect(RenderSettings.fog).toBe(true);
        expect(RenderSettings.fogMode).toBe(FogMode.ExponentialSquared);
        expect(RenderSettings.fogDensity).toBeCloseTo(0.07);
        expect(RenderSettings.fogColor.g).toBeCloseTo(0.2);
        expect(RenderSettings.ambientColor.b).toBeCloseTo(0.6);
    });

    test("a plain default scene is written too, so opening it resets the last one", () => {
        RenderSettings.fog = true;
        const withFog = save();

        wipe();
        const plain = save();
        expect(plain.renderSettings!.fog).toBe(false);

        SceneSerializer.deserializeScene(withFog);
        expect(RenderSettings.fog).toBe(true);
        SceneSerializer.deserializeScene(plain);
        expect(RenderSettings.fog).toBe(false);
    });

    test("a file from before they were saved leaves the current ones alone", () => {
        RenderSettings.fog = true;
        const json = save();
        delete json.renderSettings;

        SceneSerializer.deserializeScene(json);

        expect(RenderSettings.fog).toBe(true);
    });

    test("a value that is not a number falls back to the default instead of poisoning the scene", () => {
        const json = save();
        Object.assign(json.renderSettings!, {
            fogDensity: "thick",
            fogEndDistance: null,
            fogStartDistance: Number.NaN,
            fogMode: undefined,
        });

        SceneSerializer.deserializeScene(json);

        expect(RenderSettings.fogDensity).toBe(0.01);
        expect(RenderSettings.fogEndDistance).toBe(300);
        expect(RenderSettings.fogStartDistance).toBe(0);
        expect(RenderSettings.fogMode).toBe(FogMode.Exponential);
    });

    test("belong to the active scene only — loading into another leaves them alone", () => {
        RenderSettings.fog = true;
        const json = save();
        wipe();

        // Additive: the active scene stays where it was.
        SceneManager.loadScene("Other", LoadSceneMode.Additive);
        const other = SceneManager.getSceneByName("Other")!;
        SceneSerializer.deserializeScene(json, other);

        expect(RenderSettings.fog).toBe(false);
        SceneManager.unloadScene(other);
    });
});

describe("a scene's sky", () => {
    test("is saved as the id of its panorama", () => {
        const texture = loaded("sky-1");
        RenderSettings.skybox = Cubemap.fromTexture(texture);

        const rs = save().renderSettings!;

        expect(rs.skybox).toBe("sky-1");
        expect(rs.environmentReflections).toBeUndefined();
    });

    test("is rebuilt over the same panorama when it is loaded", () => {
        const texture = loaded("sky-1");
        RenderSettings.skybox = Cubemap.fromTexture(texture);
        const json = save();

        RenderSettings.skybox = null;
        SceneSerializer.deserializeScene(json);

        expect(RenderSettings.skybox).not.toBeNull();
        expect(RenderSettings.skybox!.sourceTexture).toBe(texture);
        expect(RenderSettings.skybox!.isEquirectangular).toBe(true);
    });

    test("the reflections map is saved and restored the same way", () => {
        const texture = loaded("env-1");
        RenderSettings.environmentReflections = Cubemap.fromTexture(texture);
        const json = save();
        expect(json.renderSettings!.environmentReflections).toBe("env-1");

        RenderSettings.environmentReflections = null;
        SceneSerializer.deserializeScene(json);

        expect(RenderSettings.environmentReflections!.sourceTexture).toBe(texture);
    });

    test("loading the same sky again keeps the cubemap that is already drawing it", () => {
        const texture = loaded("sky-1");
        RenderSettings.skybox = Cubemap.fromTexture(texture);
        const before = RenderSettings.skybox;

        SceneSerializer.deserializeScene(save());

        expect(RenderSettings.skybox).toBe(before);
    });

    test("whose panorama is not loaded yet is picked up when it is", () => {
        const texture = loaded("sky-late");
        RenderSettings.skybox = Cubemap.fromTexture(texture);
        const json = save();

        RenderSettings.skybox = null;
        AssetDatabase.clearLoaded();
        SceneSerializer.deserializeScene(json);

        expect(RenderSettings.skybox).toBeNull();
        expect(SceneSerializer.pendingAssetGuids).toContain("sky-late");

        AssetDatabase._bindGuid("sky-late", texture);
        expect(SceneSerializer.resolvePendingAssets()).toBe(1);

        expect(RenderSettings.skybox!.sourceTexture).toBe(texture);
        expect(SceneSerializer.pendingAssetGuids).not.toContain("sky-late");
    });

    test("a scene saved without one removes the previous scene's sky", () => {
        const plain = save();
        const texture = loaded("sky-1");
        RenderSettings.skybox = Cubemap.fromTexture(texture);
        const withSky = save();

        SceneSerializer.deserializeScene(plain);
        expect(RenderSettings.skybox).toBeNull();

        SceneSerializer.deserializeScene(withSky);
        expect(RenderSettings.skybox).not.toBeNull();
        SceneSerializer.deserializeScene(plain);
        expect(RenderSettings.skybox).toBeNull();
    });

    test("replacing a sky it built disposes that cubemap, and leaves the panorama alone", () => {
        const first = loaded("sky-1");
        loaded("sky-2");
        RenderSettings.skybox = Cubemap.fromTexture(first);
        const one = save();
        RenderSettings.skybox = Cubemap.fromTexture(AssetDatabase.get("sky-2") as InstanceType<typeof Texture2D>);
        const two = save();

        SceneSerializer.deserializeScene(one);
        const built = RenderSettings.skybox!;
        const dispose = vi.spyOn(built, "dispose");

        SceneSerializer.deserializeScene(two);

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(first.exists()).toBe(true);
    });

    test("one somebody else built is let go of, not disposed", () => {
        const texture = loaded("sky-1");
        const mine = Cubemap.fromTexture(texture);
        RenderSettings.skybox = mine;
        const dispose = vi.spyOn(mine, "dispose");

        SceneSerializer.deserializeScene({ ...save(), renderSettings: { ...save().renderSettings!, skybox: undefined } });

        expect(RenderSettings.skybox).toBeNull();
        expect(dispose).not.toHaveBeenCalled();
    });

    test("with no asset behind it has nothing to be saved as", () => {
        RenderSettings.skybox = Cubemap.fromColor(0.2, 0.4, 0.8);

        expect(save().renderSettings!.skybox).toBeUndefined();
    });

    test("a panorama that is not a texture is ignored rather than crashing the load", () => {
        AssetDatabase._bindGuid("not-a-texture", { hello: "world" });
        const json = save();
        json.renderSettings!.skybox = "not-a-texture";

        expect(() => SceneSerializer.deserializeScene(json)).not.toThrow();
        expect(RenderSettings.skybox).toBeNull();
    });
});
