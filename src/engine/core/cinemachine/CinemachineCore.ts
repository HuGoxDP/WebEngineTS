// path: src/engine/core/cinemachine/CinemachineCore.ts

import { Behaviour } from "../Behaviour.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CAMERA STATE ====================

export class CameraState {
    public readonly position: Vector3;
    public readonly rotation: Quaternion;
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

    public static lerp(a: CameraState, b: CameraState, t: number): CameraState {
        const ct = Math.max(0, Math.min(1, t));
        return new CameraState(
            Vector3.lerp(a.position, b.position, ct),
            Quaternion.slerp(a.rotation, b.rotation, ct),
            a.fieldOfView + (b.fieldOfView - a.fieldOfView) * ct
        );
    }

    /**
     * Computes a rotation that makes the camera at `from` look toward `to`.
     *
     * @remarks
     * `Quaternion.lookRotation` is correct for this engine's coordinate system
     * — a Three.js camera on an Object3D child — and defaults its up vector to
     * `Vector3.up`, which is what a camera wants.
     *
     * It used to pass `new Vector3(0, 1, 0)` explicitly, with a comment saying
     * this avoided "the corrupted `Vector3.up` shared static instance". Nothing
     * can corrupt it: it is frozen, so a write throws, and `lookRotation` only
     * ever reads its up vector. Whatever the original symptom was, the note
     * outlived it and would have sent the next reader hunting a ghost.
     */
    public static cameraLookRotation(from: Vector3, to: Vector3): Quaternion {
        const dir = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
        const len = dir.magnitude();
        if (len < 0.0001) return Quaternion.identity.clone();
        return Quaternion.lookRotation(dir);
    }
}

// ==================== BLEND STYLE ====================

export enum CinemachineBlendStyle {
    Cut = 0,
    EaseInOut = 1,
    Linear = 2,
}

// ==================== ABSTRACT BODY ====================

export abstract class CinemachineBody extends Behaviour {
    public followTarget: import("../Transform.ts").Transform | null = null;
    constructor(gameObject: GameObject) { super(gameObject); }
    public abstract computePosition(currentState: CameraState, dt: number): Vector3;
}

// ==================== ABSTRACT AIM ====================

export abstract class CinemachineAim extends Behaviour {
    public lookAtTarget: import("../Transform.ts").Transform | null = null;
    constructor(gameObject: GameObject) { super(gameObject); }
    public abstract computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion;
}