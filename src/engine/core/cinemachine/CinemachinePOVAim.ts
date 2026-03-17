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

    /** Degrees of rotation per pixel of mouse movement. */
    public sensitivity: number = 0.15;

    /** Minimum pitch angle in degrees (looking down). */
    public minPitch: number = -89;

    /** Maximum pitch angle in degrees (looking up). */
    public maxPitch: number = 89;

    /** Whether pointer lock is required before reading mouse input. */
    public requirePointerLock: boolean = true;

    /**
     * Smoothing factor for mouse input. 0 = no smoothing (raw), 1 = maximum smoothing.
     * Recommended range: 0.05–0.3 for FPS-style feel.
     */
    public damping: number = 0;
    /**
     * Maximum yaw/pitch change per frame in degrees.
     * Prevents browser pointer-lock spikes from causing jumps.
     */
    public maxDegreesPerFrame: number = 15;

    private _yaw: number = 0;
    private _pitch: number = 0;
    private _targetYaw: number = 0;
    private _targetPitch: number = 0;
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
            this._targetYaw = 0;
            this._targetPitch = 0;
            this._initialized = true;
        }

        if (!this.requirePointerLock || Input.cursorLocked) {
            const delta = Input.mouseDelta;

            let dyaw = -delta.x * this.sensitivity;
            let dpitch = delta.y * this.sensitivity;

            // Clamp per-frame rotation to reject accumulated spikes
            if (this.maxDegreesPerFrame > 0) {
                dyaw = Math.max(-this.maxDegreesPerFrame, Math.min(this.maxDegreesPerFrame, dyaw));
                dpitch = Math.max(-this.maxDegreesPerFrame, Math.min(this.maxDegreesPerFrame, dpitch));
            }

            this._targetYaw += dyaw;
            this._targetPitch += dpitch;

            this._targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this._targetPitch));
        }

        // Smooth toward target (damping=0 → instant, damping=1 → very slow)
        if (this.damping > 0 && dt > 0) {
            const speed = 1 - this.damping;
            // Exponential smoothing: lerp factor based on damping
            const t = 1 - Math.pow(speed, dt * 60);
            this._yaw += (this._targetYaw - this._yaw) * t;
            this._pitch += (this._targetPitch - this._pitch) * t;
        } else {
            this._yaw = this._targetYaw;
            this._pitch = this._targetPitch;
        }

        // Wrap yaw to [-360, 360] to prevent float overflow over long sessions
        if (this._targetYaw > 360 || this._targetYaw < -360) {
            const offset = Math.trunc(this._targetYaw / 360) * 360;
            this._targetYaw -= offset;
            this._yaw -= offset;
        }

        return Quaternion.euler(this._pitch, this._yaw, 0);
    }
}