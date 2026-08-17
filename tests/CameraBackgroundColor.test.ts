import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Camera } from "../src/engine/core/components/Camera";
import { Color } from "../src/engine/core/math/Color";

/**
 * `WebGLRenderBackend.renderScene` read `camera.backgroundColor` once a frame,
 * and that property is a value type — it hands back a clone. One Color per
 * frame in the render path, in a file whose next line already keeps a reused
 * THREE.Color "so setting the clear colour allocates nothing per frame".
 * Audit part 10, F14 (opened in part 3).
 */

const made: GameObject[] = [];

function camera(): Camera {
    const go = new GameObject("Cam");
    made.push(go);
    return go.addComponent(Camera);
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Camera.getBackgroundColor", () => {
    test("writes into the Color it is given and hands back the same one", () => {
        const cam = camera();
        cam.backgroundColor = new Color(0.1, 0.2, 0.3, 1);
        const scratch = new Color();

        const returned = cam.getBackgroundColor(scratch);

        expect(returned).toBe(scratch);
        expect(scratch.r).toBeCloseTo(0.1);
        expect(scratch.g).toBeCloseTo(0.2);
        expect(scratch.b).toBeCloseTo(0.3);
    });

    test("a reused destination is the whole point — no new object per read", () => {
        // What the render path does: one buffer, once a frame, forever.
        const cam = camera();
        const scratch = new Color();

        const first = cam.getBackgroundColor(scratch);
        const second = cam.getBackgroundColor(scratch);

        expect(first).toBe(second);
        expect(first).toBe(scratch);
    });

    test("without a destination it clones, like the property", () => {
        const cam = camera();
        cam.backgroundColor = new Color(0.4, 0.5, 0.6, 1);

        const a = cam.getBackgroundColor();
        const b = cam.getBackgroundColor();

        expect(a).not.toBe(b);
        expect(a.r).toBeCloseTo(0.4);
    });

    test("agrees with the property it is the fast form of", () => {
        const cam = camera();
        cam.backgroundColor = new Color(0.7, 0.8, 0.9, 0.5);

        const viaProperty = cam.backgroundColor;
        const viaOut = cam.getBackgroundColor(new Color());

        expect(viaOut.r).toBeCloseTo(viaProperty.r);
        expect(viaOut.g).toBeCloseTo(viaProperty.g);
        expect(viaOut.b).toBeCloseTo(viaProperty.b);
        expect(viaOut.a).toBeCloseTo(viaProperty.a);
    });

    test("the camera does not hand out its own instance", () => {
        // The reason the property clones at all: a caller writing to what it
        // was given must not repaint the camera behind its back.
        const cam = camera();
        cam.backgroundColor = new Color(0, 0, 0, 1);

        cam.getBackgroundColor(new Color()).set(1, 1, 1, 1);
        const scratch = new Color();
        cam.getBackgroundColor(scratch).set(1, 0, 0, 1);

        expect(cam.backgroundColor.r).toBe(0);
        expect(cam.backgroundColor.g).toBe(0);
    });

    test("follows the property when it changes", () => {
        const cam = camera();
        const scratch = new Color();

        cam.backgroundColor = new Color(1, 0, 0, 1);
        cam.getBackgroundColor(scratch);
        expect(scratch.r).toBe(1);

        cam.backgroundColor = new Color(0, 1, 0, 1);
        cam.getBackgroundColor(scratch);

        expect(scratch.r).toBe(0);
        expect(scratch.g).toBe(1);
    });

    test("the default is opaque black, and reading it does not freeze the caller", () => {
        // The default is `Color.black`, which is a frozen shared instance. A
        // read must copy out of it rather than hand it over — otherwise the
        // caller's own buffer would be a frozen object it cannot write to.
        const cam = camera();
        const scratch = new Color(1, 1, 1, 1);

        cam.getBackgroundColor(scratch);

        expect(scratch.r).toBe(0);
        expect(scratch.a).toBe(1);
        expect(Object.isFrozen(scratch)).toBe(false);
        expect(() => scratch.set(0.5, 0.5, 0.5, 1)).not.toThrow();
    });
});
