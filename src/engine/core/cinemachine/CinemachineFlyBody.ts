// path: src/engine/core/cinemachine/CinemachineFlyBody.ts

import { CinemachineBody, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { KeyCode } from "../KeyCode.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Free-fly WASD + Space/Ctrl movement.
 *
 * Uses Vector3.forward + yaw+=delta convention, which is consistent
 * with Quaternion.euler() operating in the engine's +Z-forward space.
 * The Three.js camera renders -Z, but the euler-based rotation
 * automatically handles the mapping.
 */
export class CinemachineFlyBody extends CinemachineBody {

    public moveSpeed: number = 10;
    public fastMultiplier: number = 3;

    private _position: Vector3 = Vector3.zero;
    private _initialized: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineFlyBody";
    }

    public override computePosition(currentState: CameraState, dt: number): Vector3 {
        if (!this._initialized) {
            this._position = currentState.position.clone();
            this._initialized = true;
        }

        // Cursor lock
        if (Input.getMouseButtonDown(0)) Input.lockCursor();
        if (Input.getKeyDown(KeyCode.Escape)) Input.unlockCursor();

        // Direction from current rotation — use +Z (forward) convention
        // consistent with POVAim's Quaternion.euler(pitch, yaw, 0)
        const rot = currentState.rotation;
        const forward = Vector3.forward.rotatedBy(rot);
        const right = Vector3.right.rotatedBy(rot);

        let speed = this.moveSpeed;
        if (Input.getKey(KeyCode.ShiftLeft) || Input.getKey(KeyCode.ShiftRight)) {
            speed *= this.fastMultiplier;
        }

        const move = new Vector3(0, 0, 0);

        // User-confirmed correct WASD mapping:
        if (Input.getKey(KeyCode.KeyW)) { move.x += forward.x; move.y += forward.y; move.z += forward.z; }
        if (Input.getKey(KeyCode.KeyS)) { move.x -= forward.x; move.y -= forward.y; move.z -= forward.z; }
        if (Input.getKey(KeyCode.KeyA)) { move.x += right.x;   move.y += right.y;   move.z += right.z; }
        if (Input.getKey(KeyCode.KeyD)) { move.x -= right.x;   move.y -= right.y;   move.z -= right.z; }
        if (Input.getKey(KeyCode.Space)) { move.y += 1; }
        if (Input.getKey(KeyCode.ControlLeft) || Input.getKey(KeyCode.ControlRight)) { move.y -= 1; }

        // Normalize diagonal
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