import { describe, test, expect, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Transform } from "../src/engine/core/Transform";
import { Camera } from "../src/engine/core/components/Camera";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * C6r9 phase 3 (DW-3.1, DW-3.2): `Camera.render()` flushes deferred transforms
 * and world matrices before handing the camera to the render hook, the same way
 * `Application._render()` does. A camera drawn on demand must see edits made
 * since the last frame.
 */

/** A camera with its Three.js object present, so `render()` reaches the hook. */
function makeCamera(name = "TestCam"): Camera {
    const camera = new GameObject(name).addComponent(Camera);
    (camera as unknown as { _rebuildThreeCamera(): void })._rebuildThreeCamera();
    return camera;
}

afterEach(() => {
    Camera._renderHook = null;
    Transform._setDirtyTransformsEnabled(false);
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    vi.restoreAllMocks();
});

describe("Camera.render pre-render flush", () => {
    test("DW-3.1 a moved object is seen at its new position inside the hook", () => {
        const probe = new GameObject("Probe");
        const camera = makeCamera();
        const previousSwitch = Transform.dirtyTransformsEnabled;
        Transform._setDirtyTransformsEnabled(true);

        try {
            // Deferred: the Three.js object still sits at the origin until the
            // render flushes the dirty set and recomputes world matrices.
            probe.transform.localPosition = new Vector3(5, 0, 0);
            expect(probe.transform._internalObject3D.position.x).toBe(0);

            let seenX = -1;
            Camera._renderHook = () => {
                seenX = probe.transform._internalObject3D.matrixWorld.elements[12];
            };

            camera.render();

            expect(seenX).toBe(5);
        } finally {
            Transform._setDirtyTransformsEnabled(previousSwitch);
        }
        // DW-3.2 the process-wide switch is back where it was.
        expect(Transform.dirtyTransformsEnabled).toBe(previousSwitch);
    });

    test("DW-3.2 with no hook the warning path is unchanged", () => {
        const camera = makeCamera();
        Camera._renderHook = null;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        camera.render();

        expect(warn.mock.calls.some(c => String(c[0]).includes("needs a running Application"))).toBe(true);
    });

    test("DW-3.2 a camera that never woke warns and does not call the hook", () => {
        const camera = makeCamera("Unwoken");
        // Adding the component wakes it in this engine, so force the state the
        // guard describes: a camera with no Three.js object yet.
        (camera as unknown as { _threeCamera: unknown })._threeCamera = null;
        const hook = vi.fn();
        Camera._renderHook = hook;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        camera.render();

        expect(warn.mock.calls.some(c => String(c[0]).includes("before it woke"))).toBe(true);
        expect(hook).not.toHaveBeenCalled();
    });
});
