// path: src/engine/core/cinemachine/CinemachineCore.ts

import { Behaviour } from "../Behaviour.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CAMERA STATE ====================

/**
 * Snapshot of a virtual camera's computed output.
 *
 * @remarks
 * Equivalent to Unity's `Cinemachine.CameraState`.
 *
 * **Coordinate convention:**
 * Use {@link CameraState.cameraLookRotation} in Aim components so the
 * camera's -Z (Three.js view direction) faces the target.
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
     * Computes a rotation that makes a Three.js camera at `from` look
     * toward `to`.
     *
     * `Quaternion.lookRotation(dir)` aligns +Z with `dir`. Three.js
     * cameras render along -Z. So we pass `from − to` (direction AWAY
     * from target) → +Z points away, -Z points toward target.
     *
     * @param from — camera world position.
     * @param to — target world position.
     * @param up — world up (default: `Vector3.up`).
     */
    public static cameraLookRotation(from: Vector3, to: Vector3, up: Vector3 = Vector3.up): Quaternion {
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const dz = from.z - to.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (len < 0.0001) return Quaternion.identity;

        return Quaternion.lookRotation(
            new Vector3(dx / len, dy / len, dz / len),
            up
        );
    }
}

// ==================== BLEND STYLE ====================

/**
 * Transition style when switching between virtual cameras.
 */
export enum CinemachineBlendStyle {
    /** Instant switch. */
    Cut = 0,
    /** Smooth ease-in/ease-out. */
    EaseInOut = 1,
    /** Constant speed. */
    Linear = 2,
}

// ==================== ABSTRACT BODY ====================

/**
 * Abstract base for position-control components (Body stage).
 *
 * @remarks Equivalent to Unity's `CinemachineComponentBase` with `Stage.Body`.
 */
export abstract class CinemachineBody extends Behaviour {
    /** Optional follow target, set by the owning VCam each frame. */
    public followTarget: import("../Transform.ts").Transform | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Compute desired world-space position for this frame. */
    public abstract computePosition(currentState: CameraState, dt: number): Vector3;
}

// ==================== ABSTRACT AIM ====================

/**
 * Abstract base for rotation-control components (Aim stage).
 *
 * @remarks Equivalent to Unity's `CinemachineComponentBase` with `Stage.Aim`.
 * Use {@link CameraState.cameraLookRotation} when computing look-at rotations.
 */
export abstract class CinemachineAim extends Behaviour {
    /** Optional look-at target, set by the owning VCam each frame. */
    public lookAtTarget: import("../Transform.ts").Transform | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Compute desired world-space rotation for this frame. */
    public abstract computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion;
}