import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { CinemachineBrain } from "../src/engine/core/cinemachine/CinemachineBrain";
import { CinemachineVirtualCamera } from "../src/engine/core/cinemachine/CinemachineVirtualCamera";
import { Camera } from "../src/engine/core/components/Camera";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Application } from "../src/engine/core/Application";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * C2 Phase 5, F8: the two Cinemachine drivers are `@ExecuteAlways` (plan
 * Assumption 3), so their lifecycle and their camera drive must work in the
 * editor's edit mode — pinned here, with the registry clean in both modes.
 */

const made: GameObject[] = [];
const clear = (): void => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    clear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    Application.enterPlayMode();
    clear();
});

const camera = (): { go: GameObject; cam: Camera; brain: CinemachineBrain } => {
    const go = new GameObject("Main Camera");
    made.push(go);
    const cam = go.addComponent(Camera);
    const brain = go.addComponent(CinemachineBrain);
    return { go, cam, brain };
};

const vcam = (at: Vector3, priority = 10): CinemachineVirtualCamera => {
    const go = new GameObject("Vcam");
    made.push(go);
    go.transform.position = at;
    const v = go.addComponent(CinemachineVirtualCamera);
    v.priority = priority;
    return v;
};

describe("the Cinemachine drivers in edit mode", () => {
    test("a brain drives the live camera from the active vcam in one edit frame", () => {
        Application.enterEditMode();
        const { brain } = camera();
        vcam(new Vector3(0, 5, -10), 20);
        vcam(new Vector3(0, 0, 0), 5);

        // One edit frame is all a host needs after moving a vcam.
        Application.updateEditMode(1 / 60);

        expect(brain.activeVirtualCamera).not.toBeNull();
        expect(brain.transform.position.y).toBeCloseTo(5, 3);
        expect(brain.transform.position.z).toBeCloseTo(-10, 3);
    });

    test("the vcam registry fills on awake and empties on destroy, in both modes", () => {
        for (const mode of ["edit", "play"] as const) {
            if (mode === "edit") Application.enterEditMode(); else Application.enterPlayMode();
            expect(CinemachineVirtualCamera._allVCams).toHaveLength(0);

            const a = vcam(new Vector3(0, 0, 0), 10);
            const b = vcam(new Vector3(1, 0, 0), 20);
            expect(CinemachineVirtualCamera._allVCams).toEqual([a, b]);

            // `start` (component discovery + first state) runs on the frames
            // the mode offers: an edit frame for edit mode, a play frame for
            // play mode.
            if (mode === "edit") Application.updateEditMode(1 / 60);
            else SceneManager.activeScene._update();

            clear();
            expect(CinemachineVirtualCamera._allVCams).toHaveLength(0);
        }
    });

    test("a brain with no camera and no vcam does not throw in an edit frame", () => {
        Application.enterEditMode();
        const go = new GameObject("Lonely");
        made.push(go);
        const brain = go.addComponent(CinemachineBrain);

        expect(() => Application.updateEditMode(1 / 60)).not.toThrow();
        expect(brain.activeVirtualCamera).toBeNull();
    });
});
