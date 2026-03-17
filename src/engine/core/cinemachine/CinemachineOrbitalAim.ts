// path: src/engine/core/cinemachine/CinemachineOrbitalAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { CinemachineOrbitalBody } from "./CinemachineOrbitalBody.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Aims the camera at the {@link CinemachineOrbitalBody}'s orbit center.
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
        if (!this._orbitalBody) {
            this._orbitalBody = this.gameObject.getComponent(CinemachineOrbitalBody);
        }

        let lookAtPoint: Vector3;
        if (this._orbitalBody) {
            lookAtPoint = this._orbitalBody.currentOrbitCenter;
        } else if (this.lookAtTarget) {
            lookAtPoint = this.lookAtTarget.position;
        } else {
            return currentState.rotation;
        }

        return CameraState.cameraLookRotation(cameraPosition, lookAtPoint);
    }
}