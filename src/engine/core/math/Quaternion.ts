// path: src/engine/math/Quaternion.ts

import { EngineSettings } from '../EngineSettings';
import { Vector3 } from './Vector3';

/**
 * Quaternion.ts
 * Клас для представлення обертання в 3D просторі.
 * Використовує формат (x, y, z, w) де w — скалярна частина.
 * Усуває проблему Gimbal Lock, притаманну Euler Angles.
 *
 * @remarks
 * API максимально наближений до Unity Quaternion.
 */
export class Quaternion {
    public x: number;
    public y: number;
    public z: number;
    public w: number;

    // ==================== CACHED READONLY INSTANCES ====================
    private static readonly _identity = new Quaternion(0, 0, 0, 1);

    // Constants
    private static readonly DEG2RAD_HALF = Math.PI / 360; // (PI / 180) / 2
    private static readonly RAD2DEG = 180 / Math.PI;

    /**
     * За замовчуванням створює Identity Quaternion (без обертання).
     */
    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    // ==================== STATIC READONLY CONSTANTS ====================

    /**
     * Returns identity quaternion (0, 0, 0, 1). Shared instance — do not mutate!
     */
    static get identity(): Quaternion {
        return Quaternion._identity;
    }

    // ==================== STATIC METHODS ====================

    /**
     * Створює кватерніон з кутів Ейлера (в градусах).
     * Порядок обертання: Y -> X -> Z (Unity convention).
     */
    static euler(x: number, y: number, z: number, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();
        return result.setFromEuler(x, y, z);
    }

    /**
     * Alias for euler() — Unity compatibility.
     */
    static fromEuler(x: number, y: number, z: number, out?: Quaternion): Quaternion {
        return Quaternion.euler(x, y, z, out);
    }

    /**
     * Створює кватерніон з обертання навколо осі на заданий кут (градуси).
     */
    static angleAxis(angle: number, axis: Vector3, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        const mag = axis.magnitude();
        if (mag < EngineSettings.Math.EPSILON) {
            return result.set(0, 0, 0, 1);
        }

        const halfAngle = angle * Quaternion.DEG2RAD_HALF;
        const s = Math.sin(halfAngle);
        const invMag = 1 / mag;

        result.x = axis.x * invMag * s;
        result.y = axis.y * invMag * s;
        result.z = axis.z * invMag * s;
        result.w = Math.cos(halfAngle);

        return result;
    }

    /**
     * Створює кватерніон, що обертає від напрямку fromDirection до toDirection.
     */
    static fromToRotation(fromDirection: Vector3, toDirection: Vector3, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        const fromMag = fromDirection.magnitude();
        const toMag = toDirection.magnitude();

        if (fromMag < EngineSettings.Math.EPSILON || toMag < EngineSettings.Math.EPSILON) {
            return result.set(0, 0, 0, 1);
        }

        // Normalize
        const fx = fromDirection.x / fromMag;
        const fy = fromDirection.y / fromMag;
        const fz = fromDirection.z / fromMag;
        const tx = toDirection.x / toMag;
        const ty = toDirection.y / toMag;
        const tz = toDirection.z / toMag;

        const dot = fx * tx + fy * ty + fz * tz;

        if (dot > 1 - EngineSettings.Math.EPSILON) {
            // Vectors are parallel
            return result.set(0, 0, 0, 1);
        }

        if (dot < -1 + EngineSettings.Math.EPSILON) {
            // Vectors are opposite — find orthogonal axis
            let ax = 0, ay = 0, az = 1;
            // Cross with X axis
            let cx = fy * az - fz * ay;
            let cy = fz * ax - fx * az;
            let cz = fx * ay - fy * ax;
            let cMag = Math.sqrt(cx * cx + cy * cy + cz * cz);

            if (cMag < EngineSettings.Math.EPSILON) {
                // Cross with Y axis instead
                ax = 0; ay = 1; az = 0;
                cx = fy * az - fz * ay;
                cy = fz * ax - fx * az;
                cz = fx * ay - fy * ax;
                cMag = Math.sqrt(cx * cx + cy * cy + cz * cz);
            }

            cx /= cMag;
            cy /= cMag;
            cz /= cMag;

            // 180 degree rotation around orthogonal axis
            result.x = cx;
            result.y = cy;
            result.z = cz;
            result.w = 0;
            return result;
        }

        // General case
        // Cross product gives rotation axis
        const cx = fy * tz - fz * ty;
        const cy = fz * tx - fx * tz;
        const cz = fx * ty - fy * tx;

        // w = sqrt((1 + dot) / 2), xyz = cross / (2 * w)
        const s = Math.sqrt((1 + dot) * 2);
        const invS = 1 / s;

        result.x = cx * invS;
        result.y = cy * invS;
        result.z = cz * invS;
        result.w = s * 0.5;

        return result.normalize();
    }

    /**
     * Створює кватерніон, що дивиться у напрямку forward з вказаним напрямком "вгору".
     */
    static lookRotation(forward: Vector3, up: Vector3 = Vector3.up, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        const forwardMag = forward.magnitude();
        if (forwardMag < EngineSettings.Math.EPSILON) {
            return result.set(0, 0, 0, 1);
        }

        // Normalize forward
        const fz = forward.x / forwardMag;
        const fy_temp = forward.y / forwardMag;
        const fx = forward.z / forwardMag;

        // Right = up x forward
        let rx = up.y * fx - up.z * fy_temp;
        let ry = up.z * fz - up.x * fx;
        let rz = up.x * fy_temp - up.y * fz;
        let rMag = Math.sqrt(rx * rx + ry * ry + rz * rz);

        if (rMag < EngineSettings.Math.EPSILON) {
            // up and forward are parallel, pick different up
            const altUp = Math.abs(forward.y) < 0.9 ? Vector3.up : Vector3.right;
            rx = altUp.y * fx - altUp.z * fy_temp;
            ry = altUp.z * fz - altUp.x * fx;
            rz = altUp.x * fy_temp - altUp.y * fz;
            rMag = Math.sqrt(rx * rx + ry * ry + rz * rz);
        }

        rx /= rMag;
        ry /= rMag;
        rz /= rMag;

        // Recalculate up = forward x right
        const ux = fy_temp * rz - fx * ry;
        const uy = fx * rx - fz * rz;
        const uz = fz * ry - fy_temp * rx;

        // Build rotation matrix and convert to quaternion
        const m00 = rx, m01 = ux, m02 = fz;
        const m10 = ry, m11 = uy, m12 = fy_temp;
        const m20 = rz, m21 = uz, m22 = fx;

        const trace = m00 + m11 + m22;

        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1);
            result.w = 0.25 / s;
            result.x = (m21 - m12) * s;
            result.y = (m02 - m20) * s;
            result.z = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
            result.w = (m21 - m12) / s;
            result.x = 0.25 * s;
            result.y = (m01 + m10) / s;
            result.z = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
            result.w = (m02 - m20) / s;
            result.x = (m01 + m10) / s;
            result.y = 0.25 * s;
            result.z = (m12 + m21) / s;
        } else {
            const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
            result.w = (m10 - m01) / s;
            result.x = (m02 + m20) / s;
            result.y = (m12 + m21) / s;
            result.z = 0.25 * s;
        }

        return result.normalize();
    }

    /**
     * Повертає інверсію кватерніона (обертання у зворотному напрямку).
     */
    static inverse(q: Quaternion, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();
        const sqrMag = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;

        if (sqrMag < EngineSettings.Math.EPSILON) {
            return result.set(0, 0, 0, 1);
        }

        const invSqrMag = 1 / sqrMag;
        result.x = -q.x * invSqrMag;
        result.y = -q.y * invSqrMag;
        result.z = -q.z * invSqrMag;
        result.w = q.w * invSqrMag;

        return result;
    }

    /**
     * Скалярний добуток кватерніонів.
     */
    static dot(a: Quaternion, b: Quaternion): number {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }

    /**
     * Кут між двома кватерніонами в градусах.
     */
    static angle(a: Quaternion, b: Quaternion): number {
        const dot = Math.abs(Quaternion.dot(a, b));
        const clamped = Math.min(dot, 1);
        return Math.acos(clamped) * 2 * Quaternion.RAD2DEG;
    }

    /**
     * Множення кватерніонів (комбінування обертань).
     */
    static multiply(a: Quaternion, b: Quaternion, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        const ax = a.x, ay = a.y, az = a.z, aw = a.w;
        const bx = b.x, by = b.y, bz = b.z, bw = b.w;

        result.x = ax * bw + aw * bx + ay * bz - az * by;
        result.y = ay * bw + aw * by + az * bx - ax * bz;
        result.z = az * bw + aw * bz + ax * by - ay * bx;
        result.w = aw * bw - ax * bx - ay * by - az * bz;

        return result;
    }

    /**
     * Лінійна інтерполяція кватерніонів (швидша за Slerp, але менш точна).
     * @param a
     * @param b
     * @param t Параметр інтерполяції (0 = a, 1 = b). Обмежується до [0,1].
     * @param out
     */
    static lerp(a: Quaternion, b: Quaternion, t: number, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();
        t = Math.max(0, Math.min(1, t));

        // Choose shorter path
        let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        const sign = dot < 0 ? -1 : 1;

        const oneMinusT = 1 - t;
        result.x = oneMinusT * a.x + t * b.x * sign;
        result.y = oneMinusT * a.y + t * b.y * sign;
        result.z = oneMinusT * a.z + t * b.z * sign;
        result.w = oneMinusT * a.w + t * b.w * sign;

        return result.normalize();
    }

    /**
     * Лінійна інтерполяція без обмеження t.
     */
    static lerpUnclamped(a: Quaternion, b: Quaternion, t: number, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        const sign = dot < 0 ? -1 : 1;

        const oneMinusT = 1 - t;
        result.x = oneMinusT * a.x + t * b.x * sign;
        result.y = oneMinusT * a.y + t * b.y * sign;
        result.z = oneMinusT * a.z + t * b.z * sign;
        result.w = oneMinusT * a.w + t * b.w * sign;

        return result.normalize();
    }

    /**
     * Сферична інтерполяція кватерніонів (Slerp).
     * Плавне обертання від 'a' до 'b' на величину 't' (0..1).
     */
    static slerp(a: Quaternion, b: Quaternion, t: number, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        t = Math.max(0, Math.min(1, t));

        if (t === 0) return result.copy(a);
        if (t === 1) return result.copy(b);

        const ax = a.x, ay = a.y, az = a.z, aw = a.w;
        let bx = b.x, by = b.y, bz = b.z, bw = b.w;

        // Dot product
        let cosHalfTheta = aw * bw + ax * bx + ay * by + az * bz;

        // Choose shorter path
        if (cosHalfTheta < 0) {
            bw = -bw;
            bx = -bx;
            by = -by;
            bz = -bz;
            cosHalfTheta = -cosHalfTheta;
        }

        // If nearly identical, use linear interpolation
        if (cosHalfTheta >= 1 - EngineSettings.Math.EPSILON) {
            result.x = ax + t * (bx - ax);
            result.y = ay + t * (by - ay);
            result.z = az + t * (bz - az);
            result.w = aw + t * (bw - aw);
            return result.normalize();
        }

        const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
        const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);

        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

        result.x = ax * ratioA + bx * ratioB;
        result.y = ay * ratioA + by * ratioB;
        result.z = az * ratioA + bz * ratioB;
        result.w = aw * ratioA + bw * ratioB;

        return result;
    }

    /**
     * Сферична інтерполяція без обмеження t.
     */
    static slerpUnclamped(a: Quaternion, b: Quaternion, t: number, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        if (t === 0) return result.copy(a);
        if (t === 1) return result.copy(b);

        const ax = a.x, ay = a.y, az = a.z, aw = a.w;
        let bx = b.x, by = b.y, bz = b.z, bw = b.w;

        let cosHalfTheta = aw * bw + ax * bx + ay * by + az * bz;

        if (cosHalfTheta < 0) {
            bw = -bw;
            bx = -bx;
            by = -by;
            bz = -bz;
            cosHalfTheta = -cosHalfTheta;
        }

        if (cosHalfTheta >= 1 - EngineSettings.Math.EPSILON) {
            result.x = ax + t * (bx - ax);
            result.y = ay + t * (by - ay);
            result.z = az + t * (bz - az);
            result.w = aw + t * (bw - aw);
            return result.normalize();
        }

        const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
        const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);

        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

        result.x = ax * ratioA + bx * ratioB;
        result.y = ay * ratioA + by * ratioB;
        result.z = az * ratioA + bz * ratioB;
        result.w = aw * ratioA + bw * ratioB;

        return result;
    }

    /**
     * Поступово обертає від from до to, не перевищуючи maxDegreesDelta.
     */
    static rotateTowards(from: Quaternion, to: Quaternion, maxDegreesDelta: number, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        const angle = Quaternion.angle(from, to);
        if (angle < EngineSettings.Math.EPSILON) {
            return result.copy(to);
        }

        const t = Math.min(1, maxDegreesDelta / angle);
        return Quaternion.slerp(from, to, t, result);
    }

    /**
     * Нормалізує кватерніон.
     */
    static normalized(q: Quaternion, out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();
        return result.copy(q).normalize();
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Встановлює значення компонентів.
     */
    set(x: number, y: number, z: number, w: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }

    /**
     * Копіює значення з іншого кватерніона.
     */
    copy(q: Quaternion): this {
        this.x = q.x;
        this.y = q.y;
        this.z = q.z;
        this.w = q.w;
        return this;
    }

    /**
     * Створює копію цього кватерніона.
     */
    clone(): Quaternion {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }

    /**
     * Конвертує кути Ейлера (градуси) у Кватерніон і записує в this.
     * Порядок обертання: Y -> X -> Z (Unity convention).
     */
    setFromEuler(x: number, y: number, z: number): this {
        const c1 = Math.cos(x * Quaternion.DEG2RAD_HALF);
        const c2 = Math.cos(y * Quaternion.DEG2RAD_HALF);
        const c3 = Math.cos(z * Quaternion.DEG2RAD_HALF);

        const s1 = Math.sin(x * Quaternion.DEG2RAD_HALF);
        const s2 = Math.sin(y * Quaternion.DEG2RAD_HALF);
        const s3 = Math.sin(z * Quaternion.DEG2RAD_HALF);

        // YXZ order (Unity default): R = Ry · Rx · Rz
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 + s1 * s2 * s3;

        return this;
    }

    /**
     * Встановлює кватерніон з обертання навколо осі.
     */
    setFromAxisAngle(axis: Vector3, angle: number): this {
        return Quaternion.angleAxis(angle, axis, this) as this;
    }

    /**
     * Множення кватерніонів (Комбінування обертань).
     * this = this * q
     */
    multiply(q: Quaternion): this {
        return this.multiplyQuaternions(this, q);
    }

    /**
     * Premultiply: this = q * this
     */
    premultiply(q: Quaternion): this {
        return this.multiplyQuaternions(q, this);
    }

    /**
     * Внутрішній метод для безпечного множення.
     */
    multiplyQuaternions(a: Quaternion, b: Quaternion): this {
        const ax = a.x, ay = a.y, az = a.z, aw = a.w;
        const bx = b.x, by = b.y, bz = b.z, bw = b.w;

        this.x = ax * bw + aw * bx + ay * bz - az * by;
        this.y = ay * bw + aw * by + az * bx - ax * bz;
        this.z = az * bw + aw * bz + ax * by - ay * bx;
        this.w = aw * bw - ax * bx - ay * by - az * bz;

        return this;
    }

    /**
     * Нормалізація кватерніона.
     */
    normalize(): this {
        const mag = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
        if (mag < EngineSettings.Math.EPSILON) {
            this.x = 0;
            this.y = 0;
            this.z = 0;
            this.w = 1;
        } else {
            const invMag = 1 / mag;
            this.x *= invMag;
            this.y *= invMag;
            this.z *= invMag;
            this.w *= invMag;
        }
        return this;
    }

    /**
     * Повертає нормалізовану копію (не мутує поточний).
     */
    get normalized(): Quaternion {
        return this.clone().normalize();
    }

    /**
     * Інвертує обертання (мутує поточний).
     * Для не-нормалізованих кватерніонів використовується повна інверсія.
     */
    invert(): this {
        const sqrMag = this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
        if (sqrMag < EngineSettings.Math.EPSILON) {
            return this.set(0, 0, 0, 1);
        }

        const invSqrMag = 1 / sqrMag;
        this.x *= -invSqrMag;
        this.y *= -invSqrMag;
        this.z *= -invSqrMag;
        this.w *= invSqrMag;

        return this;
    }

    /**
     * Conjugate (швидша інверсія для unit quaternions).
     */
    conjugate(): this {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        return this;
    }

    /**
     * Скалярний добуток з іншим кватерніоном.
     */
    dot(q: Quaternion): number {
        return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
    }

    /**
     * Кут до іншого кватерніона в градусах.
     */
    angleTo(q: Quaternion): number {
        return Quaternion.angle(this, q);
    }

    /**
     * Повертає кути Ейлера (в градусах).
     */
    toEuler(out?: Vector3): Vector3 {
        const result = out ?? new Vector3();

        // YXZ intrinsic order: R = Ry · Rx · Rz
        // Matrix element m23 = -sin(x) → x = asin(-m23)
        // m23 from quaternion = 2(qy·qz - qw·qx)
        const sinX = 2 * (this.w * this.x - this.y * this.z);

        let x: number;
        if (Math.abs(sinX) >= 0.9999999) {
            // Gimbal lock — set z=0, solve y
            x = (Math.PI / 2) * Math.sign(sinX);
            const y = 2 * Math.atan2(this.y, this.w);
            result.x = x * Quaternion.RAD2DEG;
            result.y = y * Quaternion.RAD2DEG;
            result.z = 0;
            return result;
        }

        x = Math.asin(sinX);

        // y = atan2(m13, m33)
        // m13 = 2(qx·qz + qw·qy),  m33 = 1 - 2(qx² + qy²)
        const y = Math.atan2(
            2 * (this.x * this.z + this.w * this.y),
            1 - 2 * (this.x * this.x + this.y * this.y)
        );

        // z = atan2(m21, m22)
        // m21 = 2(qx·qy + qw·qz),  m22 = 1 - 2(qx² + qz²)
        const z = Math.atan2(
            2 * (this.x * this.y + this.w * this.z),
            1 - 2 * (this.x * this.x + this.z * this.z)
        );

        result.x = x * Quaternion.RAD2DEG;
        result.y = y * Quaternion.RAD2DEG;
        result.z = z * Quaternion.RAD2DEG;

        return result;
    }

    /**
     * Unity-style property: Get/set euler angles in degrees.
     */
    get eulerAngles(): Vector3 {
        return this.toEuler();
    }

    set eulerAngles(value: Vector3) {
        this.setFromEuler(value.x, value.y, value.z);
    }

    /**
     * Перевіряє рівність кватерніонів з урахуванням похибки.
     */
    equals(q: Quaternion, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - q.x) < epsilon &&
            Math.abs(this.y - q.y) < epsilon &&
            Math.abs(this.z - q.z) < epsilon &&
            Math.abs(this.w - q.w) < epsilon
        );
    }

    /**
     * Повертає рядкове представлення.
     */
    toString(): string {
        return `Quaternion(${this.x.toFixed(3)}, ${this.y.toFixed(3)}, ${this.z.toFixed(3)}, ${this.w.toFixed(3)})`;
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only.

    /**
     * @internal
     * Copies values to a Three.js Quaternion-like object.
     */
    _copyToThree(threeQuat: { x: number; y: number; z: number; w: number }): void {
        threeQuat.x = this.x;
        threeQuat.y = this.y;
        threeQuat.z = this.z;
        threeQuat.w = this.w;
    }

    /**
     * @internal
     * Copies values from a Three.js Quaternion-like object.
     */
    _copyFromThree(threeQuat: { x: number; y: number; z: number; w: number }): this {
        this.x = threeQuat.x;
        this.y = threeQuat.y;
        this.z = threeQuat.z;
        this.w = threeQuat.w;
        return this;
    }
}