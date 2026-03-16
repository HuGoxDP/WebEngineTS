// path: src/engine/core/cinemachine/CinemachineCore.ts

import { Behaviour } from "../Behaviour.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CAMERA STATE ====================

/**
 * Snapshot of a virtual camera's computed output.
 *
 * Produced by {@link CinemachineVirtualCamera} each frame and consumed
 * by {@link CinemachineBrain} to position the real Camera.
 *
 * @remarks
 * Equivalent to Unity's `Cinemachine.CameraState`.
 *
 * **Coordinate convention:**
 * `Quaternion.lookRotation(dir)` aligns the object's +Z axis with `dir`
 * (Unity convention). Three.js cameras view along their local **-Z** axis.
 * Use {@link CameraState.cameraLookRotation} in Aim components so the
 * camera's -Z (view direction) faces the target — the negation is handled
 * internally in one place.
 */
export class CameraState {
    /** World-space position. */
    public readonly position: Vector3;
    /** World-space rotation. */
    public readonly rotation: Quaternion;
    /** Vertical field of view in degrees. */
    public readonly fieldOfView: number;

    constructor(
        position: Vector3 = Vector3.zero,
        rotation: Quaternion = Quaternion.identity,
        fieldOfView: number = 60
    ) {
        this.position = position.clone();
        this.rotation = rotation.clone();
        this.fieldOfView = fieldOfView;
    }

    /**
     * Linearly interpolates between two CameraStates.
     *
     * Position is lerped, rotation is slerped, FOV is linearly blended.
     *
     * @param a — start state.
     * @param b — end state.
     * @param t — blend factor (0 = a, 1 = b), clamped to [0, 1].
     */
    public static lerp(a: CameraState, b: CameraState, t: number): CameraState {
        const ct = Math.max(0, Math.min(1, t));
        return new CameraState(
            Vector3.lerp(a.position, b.position, ct),
            Quaternion.slerp(a.rotation, b.rotation, ct),
            a.fieldOfView + (b.fieldOfView - a.fieldOfView) * ct
        );
    }

    /**
     * Computes a rotation that makes a **Three.js camera** at `from`
     * look toward `to`.
     *
     * Three.js cameras render along their local **-Z** axis, but
     * `Quaternion.lookRotation(dir)` aligns the **+Z** axis with `dir`
     * (Unity convention). This helper passes the **negated** direction
     * so that +Z points away from the target and -Z (the camera's
     * view direction) points **toward** it.
     *
     * All Aim components should use this instead of calling
     * `Quaternion.lookRotation` directly.
     *
     * @param from — camera world position.
     * @param to — target world position.
     * @param up — world up vector (default: `Vector3.up`).
     * @returns rotation that makes the camera face the target.
     */
    public static cameraLookRotation(from: Vector3, to: Vector3, up: Vector3 = Vector3.up): Quaternion {
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const dz = from.z - to.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (len < 0.0001) {
            return Quaternion.identity;
        }

        // Direction FROM target (away) so +Z faces away, -Z faces toward
        return Quaternion.lookRotation(
            new Vector3(dx / len, dy / len, dz / len),
            up
        );
    }
}

// ==================== BLEND STYLE ====================

/**
 * Transition style when switching between virtual cameras.
 *
 * @remarks Equivalent to Unity's `CinemachineBlendDefinition.Style`.
 */
export enum CinemachineBlendStyle {
    /** Instant switch — no transition. */
    Cut = 0,
    /** Smooth ease-in/ease-out interpolation over time. */
    EaseInOut = 1,
    /** Constant-speed interpolation. */
    Linear = 2,
}

// ==================== ABSTRACT BODY ====================

/**
 * Abstract base for cinemachine body algorithms (Position Control).
 *
 * A **body** determines **how the virtual camera moves** — its world-space
 * position. It does NOT control where the camera looks.
 *
 * Attach one concrete Body subclass to the same GameObject as a
 * {@link CinemachineVirtualCamera}. The VCam discovers it automatically.
 *
 * @remarks
 * Equivalent to Unity's `CinemachineComponentBase` with `Stage.Body`.
 *
 * The pipeline calls {@link computePosition} to produce the camera's
 * `RawPosition` each frame. The owning VCam drives execution — this
 * component is NOT auto-updated by the engine game loop.
 */
export abstract class CinemachineBody extends Behaviour {
    /**
     * Optional transform to follow.
     * Propagated each frame by the owning VCam from its `follow` property.
     */
    public followTarget: import("../Transform.ts").Transform | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * Compute the desired world-space position for this frame.
     *
     * @param currentState — the camera state from the previous frame.
     * @param dt — delta time in seconds.
     * @returns desired world-space position.
     */
    public abstract computePosition(currentState: CameraState, dt: number): Vector3;
}

// ==================== ABSTRACT AIM ====================

/**
 * Abstract base for cinemachine aim algorithms (Rotation Control).
 *
 * An **aim** determines **where the virtual camera looks** — its world-space
 * rotation. It does NOT control the camera's position.
 *
 * Attach one concrete Aim subclass to the same GameObject as a
 * {@link CinemachineVirtualCamera}. The VCam discovers it automatically.
 *
 * @remarks
 * Equivalent to Unity's `CinemachineComponentBase` with `Stage.Aim`.
 *
 * **Important:** Use {@link CameraState.cameraLookRotation} when computing
 * a rotation that should make the camera face a target. It handles the
 * Three.js -Z view convention internally.
 */
export abstract class CinemachineAim extends Behaviour {
    /**
     * Optional transform to look at.
     * Propagated each frame by the owning VCam from its `lookAt` property.
     */
    public lookAtTarget: import("../Transform.ts").Transform | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * Compute the desired world-space rotation for this frame.
     *
     * @param cameraPosition — the position computed by the Body stage.
     * @param currentState — the camera state from the previous frame.
     * @param dt — delta time in seconds.
     * @returns desired world-space rotation.
     */
    public abstract computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion;
}