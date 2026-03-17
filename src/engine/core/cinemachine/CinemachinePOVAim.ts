// path: src/engine/core/cinemachine/CinemachinePOVAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * POV aim: mouse-driven yaw/pitch for FPS camera.
 *
 * Convention:
 * - Positive X rotation (pitch > 0) tilts camera UP in Three.js
 * - So `pitch -= delta.y` (mouse-down → positive delta → pitch decreases → look down)
 * - Positive Y rotation = CCW from above = turn LEFT in right-handed
 * - So `yaw -= delta.x` (mouse-right → positive delta → yaw decreases → turn right)
 */
export class CinemachinePOVAim extends CinemachineAim {

    public sensitivity: number = 0.15;
    public minPitch: number = -89;
    public maxPitch: number = 89;
    public requirePointerLock: boolean = true;

    private _yaw: number = 0;
    private _pitch: number = 0;
    private _initialized: boolean = false;
    private _debugFrames: number = 0;

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
            // Don't extract euler from currentState — it might be NaN
            // from a previous camera. Start at (0, 0) = looking down -Z.
            this._yaw = 0;
            this._pitch = 0;
            this._initialized = true;
        }

        if (!this.requirePointerLock || Input.cursorLocked) {
            const delta = Input.mouseDelta;

            // Mouse right (delta.x > 0) → yaw decreases → CW from above → turn right
            this._yaw -= delta.x * this.sensitivity;

            // Mouse down (delta.y > 0) → pitch decreases → look down
            this._pitch -= delta.y * this.sensitivity;
            this._pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this._pitch));
        }

        const result = Quaternion.euler(this._pitch, this._yaw, 0);

        // Debug first 3 active frames
        this._debugFrames++;
        if (this._debugFrames <= 3) {
            const e = result.eulerAngles;
            console.log(
                `[POVAim] frame=${this._debugFrames} ` +
                `pitch=${this._pitch.toFixed(1)} yaw=${this._yaw.toFixed(1)} ` +
                `euler=(${e.x.toFixed(1)}, ${e.y.toFixed(1)}, ${e.z.toFixed(1)}) ` +
                `quat=(${result.x.toFixed(3)}, ${result.y.toFixed(3)}, ${result.z.toFixed(3)}, ${result.w.toFixed(3)})`
            );
        }

        return result;
    }
}