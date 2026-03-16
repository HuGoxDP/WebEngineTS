// path: src/engine/core/cinemachine/CinemachineHardLookAtAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Instantly rotates the camera to look directly at the lookAt target.
 *
 * No damping, dead zones, or screen-space framing — instant, hard
 * rotation every frame. Simple and predictable.
 *
 * @remarks
 * Equivalent to Unity 6's `Cinemachine.CinemachineHardLookAt`.
 * Typically paired with {@link CinemachineFollowBody} or
 * {@link CinemachineOrbitalBody}.
 */
export class CinemachineHardLookAtAim extends CinemachineAim {

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineHardLookAtAim";
    }

    public override computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion {
        if (!this.lookAtTarget) {
            return currentState.rotation;
        }

        // Centralized helper handles Three.js -Z view convention
        return CameraState.cameraLookRotation(
            cameraPosition,
            this.lookAtTarget.position
        );
    }
}