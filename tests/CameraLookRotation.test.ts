import { describe, test, expect } from "vitest";
import { CameraState } from "../src/engine/core/cinemachine/CinemachineCore";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";

/**
 * `cameraLookRotation` passed its own up vector to avoid what a comment called
 * "the corrupted Vector3.up shared static instance". Vector3's constants are
 * frozen and `lookRotation` only reads its up vector, so nothing could corrupt
 * it. These pin the rotation itself, so removing the workaround is a change
 * with a witness. Audit part 9, F56.
 */

/** Where a rotation sends the camera's forward axis, as Transform.forward does. */
function forwardOf(q: Quaternion): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(q);
}

describe("CameraState.cameraLookRotation", () => {
    test("looks along +Z", () => {
        const q = CameraState.cameraLookRotation(new Vector3(0, 0, 0), new Vector3(0, 0, 10));

        const f = forwardOf(q);
        expect(f.z).toBeCloseTo(1, 5);
        expect(f.x).toBeCloseTo(0, 5);
        expect(f.y).toBeCloseTo(0, 5);
    });

    test("looks along -X", () => {
        const q = CameraState.cameraLookRotation(new Vector3(0, 0, 0), new Vector3(-5, 0, 0));

        const f = forwardOf(q);
        expect(f.x).toBeCloseTo(-1, 5);
        expect(f.z).toBeCloseTo(0, 5);
    });

    test("looks down, where the up vector matters most", () => {
        // Straight down is where forward and up are parallel and the fallback
        // up has to take over.
        const q = CameraState.cameraLookRotation(new Vector3(0, 10, 0), new Vector3(0, 0, 0));

        const f = forwardOf(q);
        expect(f.y).toBeCloseTo(-1, 5);
    });

    test("looks up too", () => {
        const q = CameraState.cameraLookRotation(new Vector3(0, 0, 0), new Vector3(0, 10, 0));

        const f = forwardOf(q);
        expect(f.y).toBeCloseTo(1, 5);
    });

    test("a diagonal keeps its direction", () => {
        const q = CameraState.cameraLookRotation(new Vector3(0, 0, 0), new Vector3(3, 4, 0));

        const f = forwardOf(q);
        expect(f.x).toBeCloseTo(0.6, 5);
        expect(f.y).toBeCloseTo(0.8, 5);
    });

    test("from and to at the same point gives identity rather than NaN", () => {
        const q = CameraState.cameraLookRotation(new Vector3(1, 1, 1), new Vector3(1, 1, 1));

        expect(q.x).toBe(0);
        expect(q.y).toBe(0);
        expect(q.z).toBe(0);
        expect(q.w).toBe(1);
    });

    test("Vector3.up survives being used as the default", () => {
        // The claim the removed comment made, tested rather than assumed.
        CameraState.cameraLookRotation(new Vector3(0, 0, 0), new Vector3(1, 2, 3));

        expect(Vector3.up.x).toBe(0);
        expect(Vector3.up.y).toBe(1);
        expect(Vector3.up.z).toBe(0);
    });
});
