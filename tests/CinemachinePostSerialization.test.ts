import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { MissingValue } from "../src/engine/core/serialization/MissingComponent";
import { TypeRegistry } from "../src/engine/core/reflection/TypeRegistry";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";
import { CinemachineBlendStyle } from "../src/engine/core/cinemachine/CinemachineCore";
import { CinemachineVirtualCamera } from "../src/engine/core/cinemachine/CinemachineVirtualCamera";
import { CinemachineBrain } from "../src/engine/core/cinemachine/CinemachineBrain";
import { CinemachineOrbitalBody } from "../src/engine/core/cinemachine/CinemachineOrbitalBody";
import { CinemachineOrbitalAim } from "../src/engine/core/cinemachine/CinemachineOrbitalAim";
import { CinemachineFlyBody } from "../src/engine/core/cinemachine/CinemachineFlyBody";
import { CinemachinePOVAim } from "../src/engine/core/cinemachine/CinemachinePOVAim";
import { CinemachineFollowBody } from "../src/engine/core/cinemachine/CinemachineFollowBody";
import { CinemachineHardLookAtAim } from "../src/engine/core/cinemachine/CinemachineHardLookAtAim";
import { PostProcessing } from "../src/engine/core/postprocessing/PostProcessing";
import { PostProcessVolume } from "../src/engine/core/postprocessing/PostProcessVolume";
import { BloomEffect } from "../src/engine/core/postprocessing/BloomEffect";
import { VignetteEffect } from "../src/engine/core/postprocessing/VignetteEffect";

/**
 * Cinemachine and post-processing had no `@Serializable` anywhere, so an editor
 * could neither add them to an object nor keep their settings: a scene that used
 * either lost it on the first save. These tests pin that they are scene data now.
 */

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    PostProcessing._reset();
}

/** Saves the whole scene, empties it, and loads the file back. */
function roundTrip(): GameObject[] {
    const json = SceneSerializer.serializeScene(SceneManager.activeScene);
    clear();
    return SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(json)));
}

beforeEach(clear);
afterEach(clear);

describe("Cinemachine components", () => {
    test("every one of them is registered under its own name", () => {
        for (const name of [
            "CinemachineVirtualCamera", "CinemachineBrain",
            "CinemachineOrbitalBody", "CinemachineOrbitalAim",
            "CinemachineFlyBody", "CinemachinePOVAim",
            "CinemachineFollowBody", "CinemachineHardLookAtAim",
        ]) {
            expect(TypeRegistry.get(name), name).toBeDefined();
        }
    });

    test("a virtual camera keeps its settings and the objects it follows and looks at", () => {
        const player = new GameObject("Player");
        const sun = new GameObject("Sun");
        const rig = new GameObject("Rig");
        const vcam = rig.addComponent(CinemachineVirtualCamera);
        vcam.priority = 42;
        vcam.fieldOfView = 75;
        vcam.follow = player.transform;
        vcam.lookAt = sun.transform;

        const back = roundTrip().find(g => g.name === "Rig")!.getComponent(CinemachineVirtualCamera)!;

        expect(back.priority).toBe(42);
        expect(back.fieldOfView).toBe(75);
        expect(back.follow!.gameObject.name).toBe("Player");
        expect(back.lookAt!.gameObject.name).toBe("Sun");
    });

    test("a reference to the transform of a child object finds it again", () => {
        const parent = new GameObject("Parent");
        const child = new GameObject("Child");
        child.transform.parent = parent.transform;
        const vcam = new GameObject("Rig").addComponent(CinemachineVirtualCamera);
        vcam.follow = child.transform;

        const back = roundTrip().find(g => g.name === "Rig")!.getComponent(CinemachineVirtualCamera)!;

        expect(back.follow!.gameObject.name).toBe("Child");
        expect(back.follow!.parent!.gameObject.name).toBe("Parent");
    });

    test("a target outside what is saved is dropped rather than half-written", () => {
        const stranger = new GameObject("Stranger");
        const rig = new GameObject("Rig");
        const vcam = rig.addComponent(CinemachineVirtualCamera);
        vcam.follow = stranger.transform;

        const json = SceneSerializer.serializeGameObject(rig);

        expect(json.components[0].fields["follow"]).toBeNull();
    });

    test("the brain keeps its blend", () => {
        const go = new GameObject("Cam");
        const brain = go.addComponent(CinemachineBrain);
        brain.defaultBlendStyle = CinemachineBlendStyle.Linear;
        brain.defaultBlendTime = 2.5;

        const back = roundTrip()[0].getComponent(CinemachineBrain)!;

        expect(back.defaultBlendStyle).toBe(CinemachineBlendStyle.Linear);
        expect(back.defaultBlendTime).toBe(2.5);
    });

    test("an orbital body keeps its centre — the default is not the frozen shared vector", () => {
        const go = new GameObject("Orbit");
        const body = go.addComponent(CinemachineOrbitalBody);
        body.orbitCenter = new Vector3(1, 2, 3);
        body.distance = 33;
        body.enablePan = false;
        go.addComponent(CinemachineOrbitalAim);

        const back = roundTrip()[0];
        const orbit = back.getComponent(CinemachineOrbitalBody)!;

        expect(orbit.orbitCenter.x).toBe(1);
        expect(orbit.orbitCenter.z).toBe(3);
        expect(orbit.distance).toBe(33);
        expect(orbit.enablePan).toBe(false);
        expect(back.getComponent(CinemachineOrbitalAim)).not.toBeNull();
    });

    test("a body that was never touched can be loaded over (its defaults accept a copy)", () => {
        const go = new GameObject("Orbit");
        go.addComponent(CinemachineOrbitalBody);

        expect(() => roundTrip()).not.toThrow();
    });

    test("fly body, point-of-view aim, follow body and hard look-at all round-trip", () => {
        const go = new GameObject("Rig");
        go.addComponent(CinemachineFlyBody).moveSpeed = 25;
        const pov = go.addComponent(CinemachinePOVAim);
        pov.sensitivity = 0.4;
        pov.requirePointerLock = false;
        const follow = go.addComponent(CinemachineFollowBody);
        follow.offset = new Vector3(1, 2, -3);
        follow.damping = 9;
        go.addComponent(CinemachineHardLookAtAim);

        const back = roundTrip()[0];

        expect(back.getComponent(CinemachineFlyBody)!.moveSpeed).toBe(25);
        expect(back.getComponent(CinemachinePOVAim)!.sensitivity).toBe(0.4);
        expect(back.getComponent(CinemachinePOVAim)!.requirePointerLock).toBe(false);
        expect(back.getComponent(CinemachineFollowBody)!.offset.z).toBe(-3);
        expect(back.getComponent(CinemachineFollowBody)!.damping).toBe(9);
        expect(back.getComponent(CinemachineHardLookAtAim)).not.toBeNull();
    });

    test("runtime wiring is not saved: the pipeline's own targets stay out of the file", () => {
        const go = new GameObject("Rig");
        go.addComponent(CinemachineFollowBody);

        const fields = SceneSerializer.serializeGameObject(go).components[0].fields;

        expect(Object.keys(fields).sort()).toEqual(["damping", "offset"]);
    });
});

describe("post-processing", () => {
    function volumeObject(): { go: GameObject; volume: PostProcessVolume } {
        const go = new GameObject("Post");
        const volume = go.addComponent(PostProcessVolume);
        volume.effects = [
            new BloomEffect({ intensity: 2, threshold: 0.6, radius: 0.9 }),
            new VignetteEffect({ intensity: 0.8, smoothness: 0.2, color: new Color(0.1, 0, 0.2, 1) }),
        ];
        return { go, volume };
    }

    test("a volume keeps its effects, in order, with their settings", () => {
        volumeObject();

        const back = roundTrip()[0].getComponent(PostProcessVolume)!;

        expect(back.effects).toHaveLength(2);
        const [bloom, vignette] = back.effects as [BloomEffect, VignetteEffect];
        expect(bloom).toBeInstanceOf(BloomEffect);
        expect(bloom.intensity).toBe(2);
        expect(bloom.threshold).toBe(0.6);
        expect(bloom.radius).toBe(0.9);
        expect(vignette).toBeInstanceOf(VignetteEffect);
        expect(vignette.smoothness).toBe(0.2);
        expect(vignette.color.b).toBeCloseTo(0.2);
    });

    test("an effect that is switched off stays switched off", () => {
        const { volume } = volumeObject();
        volume.effects[0].enabled = false;

        const back = roundTrip()[0].getComponent(PostProcessVolume)!;

        expect(back.effects[0].enabled).toBe(false);
        expect(back.effects[1].enabled).toBe(true);
    });

    test("the effects reach the pipeline while the volume is enabled", () => {
        const { volume } = volumeObject();

        expect(PostProcessing.effects).toEqual(volume.effects);
        expect(PostProcessing.enabled).toBe(true);
    });

    test("a loaded scene feeds the pipeline too", () => {
        volumeObject();

        const back = roundTrip()[0].getComponent(PostProcessVolume)!;

        expect(PostProcessing.effects).toEqual(back.effects);
        expect(PostProcessing.effects).toHaveLength(2);
    });

    test("disabling the volume takes its effects out, and enabling puts them back", () => {
        const { volume } = volumeObject();

        volume.enabled = false;
        expect(PostProcessing.effects).toHaveLength(0);

        volume.enabled = true;
        expect(PostProcessing.effects).toHaveLength(2);
    });

    test("destroying the object takes its effects out with it", () => {
        const { go } = volumeObject();

        go.destroyImmediate();

        expect(PostProcessing.effects).toHaveLength(0);
    });

    test("replacing the list swaps what the pipeline runs", () => {
        const { volume } = volumeObject();
        const replacement = new VignetteEffect();

        volume.effects = [replacement];

        expect(PostProcessing.effects).toEqual([replacement]);
    });

    test("an effect added in place is picked up by refresh", () => {
        const { volume } = volumeObject();
        const extra = new BloomEffect();

        volume.effects.push(extra);
        volume.refresh();

        expect(PostProcessing.effects).toContain(extra);
        expect(PostProcessing.effects).toHaveLength(3);
    });

    test("an effect of an unknown class is kept in the file and not run", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { volume } = volumeObject();
        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        const saved = json.roots[0].components[0].fields["effects"] as Array<Record<string, unknown>>;
        saved.push({ $type: "Nested", type: "Unknown.Grain", fields: { amount: 0.3 } });
        volume.destroy();
        clear();

        const [root] = SceneSerializer.deserializeScene(json);
        const back = root.getComponent(PostProcessVolume)!;

        expect(back.effects).toHaveLength(3);
        expect(back.effects[2]).toBeInstanceOf(MissingValue);
        expect(PostProcessing.effects).toHaveLength(2);

        const again = SceneSerializer.serializeGameObject(root).components[0].fields["effects"] as unknown[];
        expect(again[2]).toEqual({ $type: "Nested", type: "Unknown.Grain", fields: { amount: 0.3 } });
        warn.mockRestore();
    });
});
