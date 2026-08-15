// path: src/engine/core/cinemachine/CinemachineFollowBody.ts

import { CinemachineBody, CameraState } from "./CinemachineCore.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Smoothly follows a target Transform with a configurable offset.
 *
 * The offset is in the target's local coordinate space:
 * `x` = right, `y` = up, `z` = forward. As the target rotates,
 * the camera's desired position rotates with it.
 *
 * @remarks
 * Equivalent to Unity's `Cinemachine.CinemachineTransposer`
 * with `BindingMode.LockToTarget`.
 *
 * Typically paired with {@link CinemachineHardLookAtAim} or
 * {@link CinemachineComposerAim}.
 *
 * @example
 * ```ts
 * const vcamGo = new GameObject("Follow Cam");
 * const vcam = vcamGo.addComponent(CinemachineVirtualCamera);
 * vcam.follow = playerTransform;
 * vcam.lookAt = playerTransform;
 * const body = vcamGo.addComponent(CinemachineFollowBody);
 * body.offset = new Vector3(0, 5, -10);
 * body.damping = 4;
 * vcamGo.addComponent(CinemachineHardLookAtAim);
 * ```
 */
export class CinemachineFollowBody extends CinemachineBody {

    // ==================== PUBLIC SETTINGS ====================

    /**
     * Offset from the follow target in the target's local space.
     *
     * `(0, 5, -10)` = 5 units above, 10 units behind.
     */
    public offset: Vector3 = new Vector3(0, 5, -10);

    /**
     * How quickly the camera catches up with its target, as a rate.
     *
     * @remarks
     * Higher is snappier, lower is smoother, and the response is
     * framerate-independent — the camera closes the same fraction of the gap
     * per second whatever the frame rate.
     *
     * `0` — or any non-positive value — means **no damping**: the camera is
     * exactly where the target says, every frame. Unity reads a damping of zero
     * the same way.
     */
    public damping: number = 5;

    // ==================== INTERNAL STATE ====================

    private _position: Vector3 = Vector3.zero;
    private _initialized: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineFollowBody";
    }

    // ==================== PIPELINE ====================

    public override computePosition(currentState: CameraState, dt: number): Vector3 {
        if (!this.followTarget) {
            return currentState.position;
        }

        if (!this._initialized) {
            this._position = currentState.position.clone();
            this._initialized = true;
        }

        // Compute desired position using target's local axes
        const targetPos = this.followTarget.position;
        const targetFwd = this.followTarget.forward;
        const targetRight = this.followTarget.right;
        const targetUp = this.followTarget.up;

        const desiredPos = new Vector3(
            targetPos.x + targetRight.x * this.offset.x + targetUp.x * this.offset.y + targetFwd.x * this.offset.z,
            targetPos.y + targetRight.y * this.offset.x + targetUp.y * this.offset.y + targetFwd.y * this.offset.z,
            targetPos.z + targetRight.z * this.offset.x + targetUp.z * this.offset.y + targetFwd.z * this.offset.z
        );

        // Smooth follow using exponential decay
        // `damping` is a rate, so zero means "no damping at all" — snap to the
        // target — rather than "never move". Exponential decay gives the second
        // for free: 1 - exp(0) is 0, and the camera would sit where it started.
        const lerpFactor = this.damping > 0 ? 1 - Math.exp(-this.damping * dt) : 1;
        this._position = new Vector3(
            this._position.x + (desiredPos.x - this._position.x) * lerpFactor,
            this._position.y + (desiredPos.y - this._position.y) * lerpFactor,
            this._position.z + (desiredPos.z - this._position.z) * lerpFactor
        );

        return this._position.clone();
    }
}