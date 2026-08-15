import { describe, test, expect, afterEach } from "vitest";
import { CinemachineVirtualCamera } from "../src/engine/core/cinemachine/CinemachineVirtualCamera";
import { CinemachineFollowBody } from "../src/engine/core/cinemachine/CinemachineFollowBody";
import { CinemachineHardLookAtAim } from "../src/engine/core/cinemachine/CinemachineHardLookAtAim";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * A virtual camera holds `follow` and `lookAt` as references a scenario assigns
 * once — and the thing a camera follows is very often the thing that gets
 * destroyed. Nothing told the camera, so it went on reading a destroyed
 * Transform every frame and kept it alive. F44's shape, in Cinemachine.
 * Audit part 9, F53.
 */

const made: GameObject[] = [];

function object(name: string, at = new Vector3(0, 0, 0)): GameObject {
    const go = new GameObject(name);
    go.transform.position = at;
    made.push(go);
    return go;
}

function camera(): CinemachineVirtualCamera {
    const go = object("VCam");
    const vcam = go.addComponent(CinemachineVirtualCamera);
    go.addComponent(CinemachineFollowBody);
    go.addComponent(CinemachineHardLookAtAim);
    vcam.resolveComponents();
    return vcam;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A virtual camera whose target is destroyed", () => {
    test("lets go of what it was following", () => {
        const vcam = camera();
        const target = object("Target", new Vector3(0, 0, 10));
        vcam.follow = target.transform;

        target.destroyImmediate();
        vcam._computeState(1 / 60);

        expect(vcam.follow).toBeNull();
    });

    test("lets go of what it was looking at", () => {
        const vcam = camera();
        const target = object("Target", new Vector3(5, 0, 0));
        vcam.lookAt = target.transform;

        target.destroyImmediate();
        vcam._computeState(1 / 60);

        expect(vcam.lookAt).toBeNull();
    });

    test("keeps computing a state rather than throwing", () => {
        const vcam = camera();
        const target = object("Target", new Vector3(0, 0, 10));
        vcam.follow = target.transform;
        vcam.lookAt = target.transform;
        vcam._computeState(1 / 60);

        target.destroyImmediate();

        expect(() => vcam._computeState(1 / 60)).not.toThrow();
    });

    test("a live target is left alone", () => {
        const vcam = camera();
        const target = object("Target", new Vector3(0, 0, 10));
        vcam.follow = target.transform;

        vcam._computeState(1 / 60);

        expect(vcam.follow).toBe(target.transform);
    });

    test("a replacement target works as before", () => {
        // The usual sequence: the followed object dies and another takes over.
        const vcam = camera();
        const first = object("First", new Vector3(0, 0, 10));
        vcam.follow = first.transform;
        first.destroyImmediate();
        vcam._computeState(1 / 60);

        const second = object("Second", new Vector3(0, 0, 20));
        vcam.follow = second.transform;
        vcam._computeState(1 / 60);

        expect(vcam.follow).toBe(second.transform);
    });

    test("having no target at all was always fine", () => {
        const vcam = camera();

        expect(() => vcam._computeState(1 / 60)).not.toThrow();
        expect(vcam.follow).toBeNull();
    });
});
