import { describe, test, expect, afterEach } from "vitest";
import { CinemachinePOVAim } from "../src/engine/core/cinemachine/CinemachinePOVAim";
import { CameraState } from "../src/engine/core/cinemachine/CinemachineCore";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";

/**
 * POV smoothing raises `1 - damping` to a fractional power every frame. Any
 * damping above 1 makes that base negative, and a negative base with a
 * fractional exponent is NaN — the camera's rotation becomes NaN and stays
 * there. `damping` on the *bodies* means the opposite thing and is normally in
 * the single digits, so copying a value across was enough to trigger it.
 * Audit part 9, F57.
 *
 * The frame time matters here, and finding that out was the point at which
 * these tests started meaning anything: `dt * 60` with `dt = 1/60` is exactly
 * `1`, an integer exponent, which `Math.pow` handles for a negative base. Every
 * other frame time — 59 fps, 120 fps, a 16 ms step — gives a fractional one and
 * NaN. So the tests use real frame times rather than the tidy one.
 */

const made: GameObject[] = [];

function aim(damping: number): CinemachinePOVAim {
    const go = new GameObject("POV");
    made.push(go);
    const pov = go.addComponent(CinemachinePOVAim);
    pov.damping = damping;
    pov.requirePointerLock = false;
    return pov;
}

const state = () => new CameraState(new Vector3(0, 0, 0), Quaternion.identity.clone(), 60);

/** Every component of a rotation is a real number. */
function isFinite(q: Quaternion): boolean {
    return Number.isFinite(q.x) && Number.isFinite(q.y)
        && Number.isFinite(q.z) && Number.isFinite(q.w);
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("POV aim damping", () => {
    test("a body-style value does not produce NaN", () => {
        // 5 is the FollowBody default; on this class it used to be poison.
        const pov = aim(5);

        const q = pov.computeRotation(new Vector3(0, 0, 0), state(), 1 / 59);

        expect(isFinite(q)).toBe(true);
    });

    test("nor does any other value above one", () => {
        for (const d of [1.0001, 2, 20, 1000]) {
            const pov = aim(d);
            const q = pov.computeRotation(new Vector3(0, 0, 0), state(), 0.016);
            expect(isFinite(q)).toBe(true);
        }
    });

    test("nor a negative one", () => {
        const pov = aim(-3);

        const q = pov.computeRotation(new Vector3(0, 0, 0), state(), 1 / 120);

        expect(isFinite(q)).toBe(true);
    });

    test("zero is still instant", () => {
        const pov = aim(0);

        const q = pov.computeRotation(new Vector3(0, 0, 0), state(), 1 / 60);

        expect(isFinite(q)).toBe(true);
    });

    test("a value in range still smooths", () => {
        const pov = aim(0.2);

        for (let i = 0; i < 10; i++) {
            const q = pov.computeRotation(new Vector3(0, 0, 0), state(), 1 / 59);
            expect(isFinite(q)).toBe(true);
        }
    });

    test("stays finite over many frames, whatever the step", () => {
        const pov = aim(0.3);

        for (const dt of [0, 1e-6, 1 / 59, 0.016, 1, 100]) {
            const q = pov.computeRotation(new Vector3(0, 0, 0), state(), dt);
            expect(isFinite(q)).toBe(true);
        }
    });
});
