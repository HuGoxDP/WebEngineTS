// path: src/engine/core/cinemachine/CinemachineFlyBody.ts

import { CinemachineBody, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { KeyCode } from "../KeyCode.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Free-fly movement: WASD + Space/Ctrl for up/down.
 *
 * Automatically locks the cursor on LMB click and unlocks on Escape.
 * Movement direction is driven by the current aim rotation (from the
 * Aim component on the same VCam).
 *
 * @remarks
 * Equivalent to a simplified Cinemachine TrackedDolly in free-fly mode.
 * Typically paired with {@link CinemachinePOVAim} for full FPS control.
 *
 * **Coordinate convention:** Three.js cameras look down their local -Z
 * axis, so the camera's visual forward direction is `(0, 0, -1)` rotated
 * by the current rotation — NOT `(0, 0, +1)`.
 *
 * @example
 * ```ts
 * const vcamGo = new GameObject("FPS Cam");
 * vcamGo.addComponent(CinemachineVirtualCamera);
 * const body = vcamGo.addComponent(CinemachineFlyBody);
 * body.moveSpeed = 15;
 * vcamGo.addComponent(CinemachinePOVAim);
 * ```
 */
export class CinemachineFlyBody extends CinemachineBody {

    // ==================== PUBLIC SETTINGS ====================

    /** Movement speed in units per second. */
    public moveSpeed: number = 10;

    /** Speed multiplier when Shift is held. */
    public fastMultiplier: number = 3;

    // ==================== INTERNAL STATE ====================

    /** Current position (smoothed). */
    private _position: Vector3 = Vector3.zero;
    private _initialized: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineFlyBody";
    }

    // ==================== PIPELINE ====================

    public override computePosition(currentState: CameraState, dt: number): Vector3 {
        if (!this._initialized) {
            this._position = currentState.position.clone();
            this._initialized = true;
        }

        // ── Cursor lock on click ──
        if (Input.getMouseButtonDown(0)) {
            Input.lockCursor();
        }
        if (Input.getKeyDown(KeyCode.Escape)) {
            Input.unlockCursor();
        }

        // ── Compute movement direction from current rotation ──
        // Three.js cameras look down local -Z, so the visual forward
        // direction is (0, 0, -1) rotated — NOT (0, 0, +1).
        const rot = currentState.rotation;
        const forward = Vector3.back.rotatedBy(rot);
        const right = Vector3.right.rotatedBy(rot);

        let speed = this.moveSpeed;
        if (Input.getKey(KeyCode.ShiftLeft) || Input.getKey(KeyCode.ShiftRight)) {
            speed *= this.fastMultiplier;
        }

        const move = new Vector3(0, 0, 0);

        if (Input.getKey(KeyCode.KeyW)) { move.z += forward.z; }
        if (Input.getKey(KeyCode.KeyS)) { move.z -= forward.z; }
        if (Input.getKey(KeyCode.KeyD)) { move.x += right.x; }
        if (Input.getKey(KeyCode.KeyA)) { move.x -= right.x;}
        if (Input.getKey(KeyCode.Space)) { move.y += 1; }
        if (Input.getKey(KeyCode.ControlLeft)) { move.y -= 1; }

        // Normalize to prevent faster diagonal movement
        const len = Math.sqrt(move.x * move.x + move.y * move.y + move.z * move.z);
        if (len > 0) {
            const s = speed * dt / len;
            this._position = new Vector3(
                this._position.x + move.x * s,
                this._position.y + move.y * s,
                this._position.z + move.z * s
            );
        }

        return this._position.clone();
    }
}