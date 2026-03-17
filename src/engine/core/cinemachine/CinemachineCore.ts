// path: src/engine/core/cinemachine/CinemachineCore.ts

import { Behaviour } from "../Behaviour.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CAMERA STATE ====================

/**
 * Snapshot of a virtual camera's computed output.
 *
 * @remarks Equivalent to Unity's `Cinemachine.CameraState`.
 */
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

    /** Interpolate between two states. */
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
     * This is a **self-contained** implementation that builds the
     * rotation matrix directly from the direction vector — it does
     * NOT call `Quaternion.lookRotation`.
     *
     * Three.js cameras render along their local **-Z** axis.
     * The rotation is constructed so that:
     * - Camera's -Z faces toward `to` (view direction)
     * - Camera's +Y is as close to world `up` as possible
     * - Camera's +X points right
     *
     * @param from — camera world position.
     * @param to — target world position.
     * @param up — world up (default: `Vector3.up`).
     */
    public static cameraLookRotation(
        from: Vector3,
        to: Vector3,
        up: Vector3 = Vector3.up
    ): Quaternion {
        // Z axis = direction from target to camera (away from target)
        // so that camera's -Z (view direction) faces toward target
        let zx = from.x - to.x;
        let zy = from.y - to.y;
        let zz = from.z - to.z;
        const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz);

        if (zLen < 0.0001) return Quaternion.identity;

        zx /= zLen;
        zy /= zLen;
        zz /= zLen;

        // X axis = normalize(cross(up, Z))
        let xx = up.y * zz - up.z * zy;
        let xy = up.z * zx - up.x * zz;
        let xz = up.x * zy - up.y * zx;
        let xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);

        if (xLen < 0.0001) {
            // up and Z are nearly parallel — pick alternative up
            const altUp = Math.abs(zy) < 0.9 ? Vector3.up : Vector3.right;
            xx = altUp.y * zz - altUp.z * zy;
            xy = altUp.z * zx - altUp.x * zz;
            xz = altUp.x * zy - altUp.y * zx;
            xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);

            if (xLen < 0.0001) return Quaternion.identity;
        }

        xx /= xLen;
        xy /= xLen;
        xz /= xLen;

        // Y axis = cross(Z, X) — guaranteed unit length
        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        // ── Rotation matrix (column-major) ──
        // Column 0 = X (right),  Column 1 = Y (up),  Column 2 = Z (back)
        // m[row][col]:
        const m00 = xx, m01 = yx, m02 = zx;
        const m10 = xy, m11 = yy, m12 = zy;
        const m20 = xz, m21 = yz, m22 = zz;

        // ── Quaternion from rotation matrix ──
        // Using Shepperd's method (numerically stable for all cases)
        const trace = m00 + m11 + m22;
        const q = new Quaternion();

        if (trace > 0) {
            const s = 2 * Math.sqrt(trace + 1);
            q.w = 0.25 * s;
            q.x = (m21 - m12) / s;
            q.y = (m02 - m20) / s;
            q.z = (m10 - m01) / s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
            q.w = (m21 - m12) / s;
            q.x = 0.25 * s;
            q.y = (m01 + m10) / s;
            q.z = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
            q.w = (m02 - m20) / s;
            q.x = (m01 + m10) / s;
            q.y = 0.25 * s;
            q.z = (m12 + m21) / s;
        } else {
            const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
            q.w = (m10 - m01) / s;
            q.x = (m02 + m20) / s;
            q.y = (m12 + m21) / s;
            q.z = 0.25 * s;
        }

        return q.normalize();
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

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public abstract computePosition(currentState: CameraState, dt: number): Vector3;
}

// ==================== ABSTRACT AIM ====================

export abstract class CinemachineAim extends Behaviour {
    public lookAtTarget: import("../Transform.ts").Transform | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public abstract computeRotation(
        cameraPosition: Vector3,
        currentState: CameraState,
        dt: number
    ): Quaternion;
}