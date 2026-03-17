// path: src/engine/core/cinemachine/CinemachineHardLookAtAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

export class CinemachineHardLookAtAim extends CinemachineAim {
    private _debugFrames: number = 0;

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
            this._debugFrames++;
            if (this._debugFrames <= 3) {
                console.log("[HardLookAtAim] lookAtTarget is NULL");
            }
            return currentState.rotation;
        }

        const target = this.lookAtTarget.position;
        const result = CameraState.cameraLookRotation(cameraPosition, target);

        this._debugFrames++;
        if (this._debugFrames <= 3) {
            const e = result.eulerAngles;
            console.log(
                `[HardLookAtAim] cam=(${cameraPosition.x.toFixed(1)},${cameraPosition.y.toFixed(1)},${cameraPosition.z.toFixed(1)}) ` +
                `target=(${target.x.toFixed(1)},${target.y.toFixed(1)},${target.z.toFixed(1)}) ` +
                `euler=(${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)})`
            );
        }

        return result;
    }
}