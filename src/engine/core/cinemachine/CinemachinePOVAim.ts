// path: src/engine/core/cinemachine/CinemachinePOVAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * POV aim: mouse-driven yaw/pitch for FPS camera.
 * Equivalent to Unity's `CinemachinePanTilt`.
 */
export class CinemachinePOVAim extends CinemachineAim {

    public sensitivity: number = 0.15;
    public minPitch: number = -89;
    public maxPitch: number = 89;
    public requirePointerLock: boolean = true;

    private _yaw: number = 0;
    private _pitch: number = 0;
    private _initialized: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachinePOVAim";
    }

    public override computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion {
        if (!this._initialized) {
            this._yaw = 0;
            this._pitch = 0;
            this._initialized = true;
        }

        if (!this.requirePointerLock || Input.cursorLocked) {
            const delta = Input.mouseDelta;
            // Confirmed: yaw -= gives correct left/right
            this._yaw -= delta.x * this.sensitivity;
            // Flipped: += so mouse-down = look down (user requested)
            this._pitch += delta.y * this.sensitivity;
            this._pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this._pitch));
        }

        return Quaternion.euler(this._pitch, this._yaw, 0);
    }
}