// path: src/engine/core/cinemachine/CinemachineOrbitalAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { CinemachineOrbitalBody } from "./CinemachineOrbitalBody.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Aims the camera at the {@link CinemachineOrbitalBody}'s orbit center.
 *
 * Discovers the sibling OrbitalBody and reads its smoothed center
 * position each frame, so no separate lookAt Transform is needed.
 * Falls back to the VCam's lookAt target if no OrbitalBody is found.
 *
 * @remarks
 * Designed to pair with {@link CinemachineOrbitalBody}.
 * For following a Transform, use {@link CinemachineHardLookAtAim}.
 */
export class CinemachineOrbitalAim extends CinemachineAim {

    private _orbitalBody: CinemachineOrbitalBody | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineOrbitalAim";
    }

    public override computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion {
        // Lazy-discover sibling body
        if (!this._orbitalBody) {
            this._orbitalBody = this.gameObject.getComponent(CinemachineOrbitalBody);
        }

        // Determine look-at point
        let lookAtPoint: Vector3;
        if (this._orbitalBody) {
            lookAtPoint = this._orbitalBody.currentOrbitCenter;
        } else if (this.lookAtTarget) {
            lookAtPoint = this.lookAtTarget.position;
        } else {
            return currentState.rotation;
        }

        // Use the centralized helper — handles Three.js -Z convention
        return CameraState.cameraLookRotation(cameraPosition, lookAtPoint);
    }
}