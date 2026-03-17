// path: src/engine/core/cinemachine/CinemachinePOVAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * POV aim: mouse-driven yaw/pitch for FPS camera.
 *
 * Uses engine convention (+Z forward) via Quaternion.euler(pitch, yaw, 0).
 * The yaw += delta.x / pitch -= delta.y signs are user-confirmed correct
 * in combination with FlyBody's Vector3.forward convention.
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
            // User-confirmed correct signs:
            this._yaw += delta.x * this.sensitivity;
            this._pitch -= delta.y * this.sensitivity;
            this._pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this._pitch));
        }

        return Quaternion.euler(this._pitch, this._yaw, 0);
    }
}