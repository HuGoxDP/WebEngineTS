// path: src/engine/core/cinemachine/CinemachineHardLookAtAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

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

        return CameraState.cameraLookRotation(
            cameraPosition,
            this.lookAtTarget.position
        );
    }
}