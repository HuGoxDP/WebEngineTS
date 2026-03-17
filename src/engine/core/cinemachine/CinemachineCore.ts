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

    private static _debugCount: number = 0;

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
     * Makes a Three.js camera at `from` look toward `to`.
     *
     * Self-contained — does NOT call Quaternion.lookRotation.
     * Camera's -Z faces toward target (Three.js convention).
     */
    public static cameraLookRotation(
        from: Vector3,
        to: Vector3,
        up: Vector3 = Vector3.up
    ): Quaternion {
        const debug = CameraState._debugCount < 5;
        if (debug) CameraState._debugCount++;

        // Z = direction from target to camera (camera's +Z = away from target)
        let zx = from.x - to.x;
        let zy = from.y - to.y;
        let zz = from.z - to.z;
        const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz);

        if (zLen < 0.0001) {
            if (debug) console.log("[cameraLookRotation] from≈to, returning identity");
            return Quaternion.identity;
        }

        zx /= zLen; zy /= zLen; zz /= zLen;

        if (debug) {
            console.log(`[cameraLookRotation] Z=(${zx.toFixed(4)},${zy.toFixed(4)},${zz.toFixed(4)}) up=(${up.x},${up.y},${up.z})`);
        }

        // X = cross(up, Z)
        let xx = up.y * zz - up.z * zy;
        let xy = up.z * zx - up.x * zz;
        let xz = up.x * zy - up.y * zx;
        let xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);

        if (xLen < 0.0001) {
            if (debug) console.log("[cameraLookRotation] up//Z, using alt up");
            const altUp = Math.abs(zy) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
            xx = altUp.y * zz - altUp.z * zy;
            xy = altUp.z * zx - altUp.x * zz;
            xz = altUp.x * zy - altUp.y * zx;
            xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);
            if (xLen < 0.0001) return Quaternion.identity;
        }

        xx /= xLen; xy /= xLen; xz /= xLen;

        // Y = cross(Z, X)
        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        if (debug) {
            console.log(`[cameraLookRotation] X=(${xx.toFixed(4)},${xy.toFixed(4)},${xz.toFixed(4)}) Y=(${yx.toFixed(4)},${yy.toFixed(4)},${yz.toFixed(4)})`);
        }

        // Rotation matrix: column0=X, column1=Y, column2=Z
        // m[row][col]
        const m00 = xx, m01 = yx, m02 = zx;
        const m10 = xy, m11 = yy, m12 = zy;
        const m20 = xz, m21 = yz, m22 = zz;

        const trace = m00 + m11 + m22;

        let qx: number, qy: number, qz: number, qw: number;

        if (trace > 0) {
            const s = 2 * Math.sqrt(trace + 1);
            qw = 0.25 * s;
            qx = (m21 - m12) / s;
            qy = (m02 - m20) / s;
            qz = (m10 - m01) / s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
            qw = (m21 - m12) / s;
            qx = 0.25 * s;
            qy = (m01 + m10) / s;
            qz = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
            qw = (m02 - m20) / s;
            qx = (m01 + m10) / s;
            qy = 0.25 * s;
            qz = (m12 + m21) / s;
        } else {
            const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
            qw = (m10 - m01) / s;
            qx = (m02 + m20) / s;
            qy = (m12 + m21) / s;
            qz = 0.25 * s;
        }

        // Normalize
        const mag = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
        if (mag < 0.0001) {
            if (debug) console.log("[cameraLookRotation] mag≈0 → identity");
            return Quaternion.identity;
        }

        const result = new Quaternion(qx / mag, qy / mag, qz / mag, qw / mag);

        if (debug) {
            console.log(
                `[cameraLookRotation] trace=${trace.toFixed(4)} ` +
                `q=(${result.x.toFixed(4)},${result.y.toFixed(4)},${result.z.toFixed(4)},${result.w.toFixed(4)}) ` +
                `mag=${mag.toFixed(6)}`
            );
        }

        return result;
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