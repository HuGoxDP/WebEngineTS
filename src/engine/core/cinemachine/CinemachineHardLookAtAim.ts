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
        // Nothing to look at — keep whatever rotation the state already has,
        // which is what lets an aim be attached before its target exists.
        if (!this.lookAtTarget) return currentState.rotation;

        const target = this.lookAtTarget.position;
        return CameraState.cameraLookRotation(cameraPosition, target);
    }
}