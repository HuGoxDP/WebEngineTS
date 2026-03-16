// path: src/engine/core/cinemachine/CinemachinePOVAim.ts

import { CinemachineAim, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Point-of-view aim: mouse controls camera rotation (FPS-style).
 *
 * Yaw (horizontal) and Pitch (vertical) are driven by mouse movement.
 * Typically used with pointer lock for unlimited rotation.
 *
 * @remarks
 * Equivalent to Unity's `Cinemachine.CinemachinePOV`.
 * Typically paired with {@link CinemachineFlyBody}.
 *
 * **Coordinate convention:** In Three.js's right-handed system, positive
 * Y rotation is counter-clockwise from above (= left turn). We negate
 * the yaw delta so that moving the mouse right correctly turns the
 * camera right.
 *
 * @example
 * ```ts
 * const vcamGo = new GameObject("FPS Cam");
 * vcamGo.addComponent(CinemachineVirtualCamera);
 * vcamGo.addComponent(CinemachineFlyBody);
 * const aim = vcamGo.addComponent(CinemachinePOVAim);
 * aim.sensitivity = 0.15;
 * ```
 */
export class CinemachinePOVAim extends CinemachineAim {

    // ==================== PUBLIC SETTINGS ====================

    /** Mouse look sensitivity (degrees per pixel). */
    public sensitivity: number = 0.15;

    /** Minimum pitch angle in degrees. */
    public minPitch: number = -89;

    /** Maximum pitch angle in degrees. */
    public maxPitch: number = 89;

    /**
     * Whether to only apply mouse look when cursor is locked.
     * Set to `false` to always rotate with mouse movement.
     */
    public requirePointerLock: boolean = true;

    // ==================== INTERNAL STATE ====================

    /** Current yaw angle in degrees. */
    private _yaw: number = 0;

    /** Current pitch angle in degrees. */
    private _pitch: number = 0;

    /** Whether initial angles have been extracted. */
    private _initialized: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachinePOVAim";
    }

    // ==================== PIPELINE ====================

    public override computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion {
        // Initialize from current rotation on first frame
        if (!this._initialized) {
            const euler = currentState.rotation.eulerAngles;
            this._yaw = euler.y;
            this._pitch = euler.x;
            this._initialized = true;
        }

        // Only process mouse when locked (or if requirePointerLock is off)
        if (!this.requirePointerLock || Input.cursorLocked) {
            const delta = Input.mouseDelta;

            // Three.js right-handed convention: positive Y rotation = turn LEFT.
            // We negate so that mouse-right (positive delta.x) = turn RIGHT.
            this._yaw -= delta.x * this.sensitivity;

            // DOM movementY is positive-downward; -= makes mouse-up = look up.
            this._pitch -= delta.y * this.sensitivity;
            this._pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this._pitch));
        }

        return Quaternion.euler(this._pitch, this._yaw, 0);
    }
}