// path: src/engine/core/cinemachine/CinemachineOrbitalAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { CinemachineOrbitalBody } from "./CinemachineOrbitalBody.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

export class CinemachineOrbitalAim extends CinemachineAim {

    private _orbitalBody: CinemachineOrbitalBody | null = null;
    private _debugFrames: number = 0;

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
            console.log(`[OrbitalAim] body discovery: ${this._orbitalBody ? "FOUND" : "NULL"} (${components.length} components)`);
        }

        let lookAtPoint: Vector3;
        if (this._orbitalBody) {
            lookAtPoint = this._orbitalBody.currentOrbitCenter;
        } else if (this.lookAtTarget) {
            lookAtPoint = this.lookAtTarget.position;
        } else {
            console.log("[OrbitalAim] no body, no lookAt → returning currentState.rotation");
            return currentState.rotation;
        }

        const result = CameraState.cameraLookRotation(cameraPosition, lookAtPoint);

        // Debug first 5 frames
        this._debugFrames++;
        if (this._debugFrames <= 5) {
            const e = result.eulerAngles;
            console.log(
                `[OrbitalAim] f=${this._debugFrames} ` +
                `cam=(${cameraPosition.x.toFixed(1)},${cameraPosition.y.toFixed(1)},${cameraPosition.z.toFixed(1)}) ` +
                `target=(${lookAtPoint.x.toFixed(1)},${lookAtPoint.y.toFixed(1)},${lookAtPoint.z.toFixed(1)}) ` +
                `q=(${result.x.toFixed(4)},${result.y.toFixed(4)},${result.z.toFixed(4)},${result.w.toFixed(4)}) ` +
                `euler=(${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)})`
            );
        }

        return result;
    }
}