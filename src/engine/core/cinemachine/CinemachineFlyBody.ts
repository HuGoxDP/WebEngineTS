// path: src/engine/core/cinemachine/CinemachineFlyBody.ts

import { CinemachineBody, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { KeyCode } from "../KeyCode.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Free-fly WASD + Space/Ctrl movement.
 *
 * Camera forward = local -Z (Three.js convention), so
 * `Vector3.back.rotatedBy(rotation)` = visual forward direction.
 */
export class CinemachineFlyBody extends CinemachineBody {

    public moveSpeed: number = 10;
    public fastMultiplier: number = 3;

    private _position: Vector3 = Vector3.zero;
    private _initialized: boolean = false;
    private _debugFrames: number = 0;

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

        // Direction vectors from current rotation
        // Three.js camera looks along local -Z → visual forward = back rotated
        const rot = currentState.rotation;
        const forward = Vector3.back.rotatedBy(rot);   // visual forward
        const right = Vector3.right.rotatedBy(rot);     // visual right

        let speed = this.moveSpeed;
        if (Input.getKey(KeyCode.ShiftLeft) || Input.getKey(KeyCode.ShiftRight)) {
            speed *= this.fastMultiplier;
        }

        const move = new Vector3(0, 0, 0);

        // Standard FPS: W=forward, S=backward, A=left, D=right
        if (Input.getKey(KeyCode.KeyW)) { move.x += forward.x; move.y += forward.y; move.z += forward.z; }
        if (Input.getKey(KeyCode.KeyS)) { move.x -= forward.x; move.y -= forward.y; move.z -= forward.z; }
        if (Input.getKey(KeyCode.KeyD)) { move.x += right.x;   move.y += right.y;   move.z += right.z; }
        if (Input.getKey(KeyCode.KeyA)) { move.x -= right.x;   move.y -= right.y;   move.z -= right.z; }
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

        // Debug: log direction vectors for first 3 active frames
        this._debugFrames++;
        if (this._debugFrames <= 3 && len > 0) {
            console.log(
                `[FlyBody] frame=${this._debugFrames} ` +
                `forward=(${forward.x.toFixed(2)},${forward.y.toFixed(2)},${forward.z.toFixed(2)}) ` +
                `right=(${right.x.toFixed(2)},${right.y.toFixed(2)},${right.z.toFixed(2)}) ` +
                `move=(${move.x.toFixed(2)},${move.y.toFixed(2)},${move.z.toFixed(2)}) ` +
                `pos=(${this._position.x.toFixed(1)},${this._position.y.toFixed(1)},${this._position.z.toFixed(1)})`
            );
        }

        return this._position.clone();
    }
}