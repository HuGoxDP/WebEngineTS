// path: src/engine/core/cinemachine/CinemachineOrbitalAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { CinemachineOrbitalBody } from "./CinemachineOrbitalBody.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

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
        // Try to find OrbitalBody via direct instanceof (not getComponent)
        if (!this._orbitalBody) {
            const components = (this.gameObject as any)._components as any[];
            for (const comp of components) {
                if (comp instanceof CinemachineOrbitalBody) {
                    this._orbitalBody = comp;
                    break;
                }
            }
        }

        let lookAtPoint: Vector3;
        if (this._orbitalBody) {
            lookAtPoint = this._orbitalBody.currentOrbitCenter;
        } else if (this.lookAtTarget) {
            lookAtPoint = this.lookAtTarget.position;
        } else {
            // No orbit centre and nothing to look at: keep the current rotation.
            return currentState.rotation;
        }

        const result = CameraState.cameraLookRotation(cameraPosition, lookAtPoint);

        return result;
    }
}