import { describe, test, expect, afterEach } from "vitest";
import { CinemachineVirtualCamera } from "../src/engine/core/cinemachine/CinemachineVirtualCamera";
import { CinemachineFollowBody } from "../src/engine/core/cinemachine/CinemachineFollowBody";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * Damping is a rate, and the smoothing is `1 - exp(-damping * dt)`. At zero
 * that expression is zero, so a camera told "no damping" never moved at all —
 * the opposite of what the word means, and of what Unity does with the same
 * value. Audit part 9, F55.
 */

const made: GameObject[] = [];

function rig(damping: number) {
    const camGO = new GameObject("VCam");
    made.push(camGO);
    const vcam = camGO.addComponent(CinemachineVirtualCamera);
    const body = camGO.addComponent(CinemachineFollowBody);
    body.offset = new Vector3(0, 0, -10);
    body.damping = damping;
    vcam.resolveComponents();

    const targetGO = new GameObject("Target");
    targetGO.transform.position = new Vector3(0, 0, 100);
    made.push(targetGO);
    vcam.follow = targetGO.transform;

    return { vcam, body, target: targetGO };
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Follow damping", () => {
    test("zero means the camera is exactly where the target says", () => {
        const { vcam } = rig(0);

        const state = vcam._computeState(1 / 60);

        // Target at z = 100, offset -10 along the target's forward.
        expect(state.position.z).toBeCloseTo(90, 3);
    });

    test("a negative value is treated the same way, not as a rewind", () => {
        const { vcam } = rig(-5);

        const state = vcam._computeState(1 / 60);

        expect(state.position.z).toBeCloseTo(90, 3);
    });

    test("a positive value lags behind and catches up", () => {
        const { vcam } = rig(5);

        const first = vcam._computeState(1 / 60).position.z;
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThan(90);

        for (let i = 0; i < 120; i++) vcam._computeState(1 / 60);

        expect(vcam._computeState(1 / 60).position.z).toBeCloseTo(90, 1);
    });

    test("higher damping catches up faster", () => {
        const slow = rig(1);
        const fast = rig(20);

        for (let i = 0; i < 10; i++) {
            slow.vcam._computeState(1 / 60);
            fast.vcam._computeState(1 / 60);
        }

        const slowZ = slow.vcam._computeState(1 / 60).position.z;
        const fastZ = fast.vcam._computeState(1 / 60).position.z;

        expect(fastZ).toBeGreaterThan(slowZ);
    });

    test("a very small step barely moves the camera", () => {
        const { vcam } = rig(5);

        const state = vcam._computeState(1e-6);

        expect(state.position.z).toBeLessThan(1);
    });

    test("a very large step lands on the target rather than overshooting", () => {
        // 1 - exp(-x) approaches 1 from below, so the factor can never exceed
        // one however long the frame was.
        const { vcam } = rig(5);

        const state = vcam._computeState(1000);

        expect(state.position.z).toBeCloseTo(90, 3);
    });
});
