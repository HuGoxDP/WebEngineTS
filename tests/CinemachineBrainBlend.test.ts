import { describe, test, expect, afterEach } from "vitest";
import { CinemachineBrain } from "../src/engine/core/cinemachine/CinemachineBrain";
import { CinemachineBlendStyle } from "../src/engine/core/cinemachine/CinemachineCore";
import { CinemachineVirtualCamera } from "../src/engine/core/cinemachine/CinemachineVirtualCamera";
import { Camera } from "../src/engine/core/components/Camera";
import { GameObject } from "../src/engine/core/GameObject";
import { Time } from "../src/engine/core/Time";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * Cinemachine had no tests at all across eleven classes. These cover the one
 * behaviour the engine documents as a decision — "always Cut on first
 * activation, because blending from a null CameraState puts the camera at the
 * origin" — plus the blend it does when there is something to blend from.
 * Audit part 9.
 */

const made: GameObject[] = [];

function brain(): CinemachineBrain {
    const go = new GameObject("Main Camera");
    made.push(go);
    go.addComponent(Camera);
    return go.addComponent(CinemachineBrain);
}

function vcam(name: string, at: Vector3, priority = 10): CinemachineVirtualCamera {
    const go = new GameObject(name);
    go.transform.position = at;
    made.push(go);
    const cam = go.addComponent(CinemachineVirtualCamera);
    cam.priority = priority;
    return cam;
}

/** One brain update with a 1/60 s step. */
function frame(b: CinemachineBrain): void {
    Time._update(1 / 60);
    b.lateUpdate();
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("CinemachineBrain", () => {
    test("cuts to the first camera rather than blending from nothing", () => {
        // The documented decision: there is no previous state to blend from, so
        // a blend would start at the origin and slide.
        const b = brain();
        b.defaultBlendStyle = CinemachineBlendStyle.Linear;
        b.defaultBlendTime = 2;
        vcam("A", new Vector3(0, 5, -10));

        frame(b);

        expect(b.isBlending).toBe(false);
        expect(b.transform.position.y).toBeCloseTo(5, 3);
        expect(b.transform.position.z).toBeCloseTo(-10, 3);
    });

    test("picks the highest-priority camera", () => {
        const b = brain();
        vcam("Low", new Vector3(0, 0, 0), 5);
        const high = vcam("High", new Vector3(1, 2, 3), 20);

        frame(b);

        expect(b.activeVirtualCamera).toBe(high);
    });

    test("a Cut style switches instantly", () => {
        const b = brain();
        b.defaultBlendStyle = CinemachineBlendStyle.Cut;
        vcam("A", new Vector3(0, 0, 0), 5);
        frame(b);

        vcam("B", new Vector3(0, 0, 100), 20);
        frame(b);

        expect(b.isBlending).toBe(false);
        expect(b.transform.position.z).toBeCloseTo(100, 3);
    });

    test("a Linear style takes the time it was given", () => {
        const b = brain();
        b.defaultBlendStyle = CinemachineBlendStyle.Linear;
        b.defaultBlendTime = 1;
        vcam("A", new Vector3(0, 0, 0), 5);
        frame(b);

        vcam("B", new Vector3(0, 0, 60), 20);

        // Half a second in, a linear blend is half way.
        for (let i = 0; i < 30; i++) frame(b);

        expect(b.isBlending).toBe(true);
        expect(b.transform.position.z).toBeGreaterThan(20);
        expect(b.transform.position.z).toBeLessThan(40);
    });

    test("and finishes", () => {
        const b = brain();
        b.defaultBlendStyle = CinemachineBlendStyle.Linear;
        b.defaultBlendTime = 0.5;
        vcam("A", new Vector3(0, 0, 0), 5);
        frame(b);
        vcam("B", new Vector3(0, 0, 60), 20);

        for (let i = 0; i < 60; i++) frame(b);

        expect(b.isBlending).toBe(false);
        expect(b.transform.position.z).toBeCloseTo(60, 3);
    });

    test("no cameras at all leaves the transform alone", () => {
        const b = brain();
        b.transform.position = new Vector3(7, 7, 7);

        frame(b);

        expect(b.transform.position.x).toBe(7);
    });
});
