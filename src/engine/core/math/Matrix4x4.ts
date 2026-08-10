// path: src/engine/math/Matrix4x4.ts

import { EngineSettings } from '../EngineSettings';
import { Vector3 } from './Vector3';
import { Vector4 } from './Vector4';
import { Quaternion } from './Quaternion';

/**
 * Matrix4x4.ts
 * 4x4 matrix class for 3D transformations.
 * Storage format: Column-major (like OpenGL/WebGL)
 *
 * @remarks
 * API closely follows Unity Matrix4x4.
 */
export class Matrix4x4 {
    /**
     * Matrix elements in column-major format (16 elements).
     */
    public readonly elements: Float32Array;

    // ==================== CACHED READONLY INSTANCES ====================
    private static _identity: Matrix4x4 | null = null;
    private static _zero: Matrix4x4 | null = null;

    private static readonly _tempVec1 = new Vector3();
    private static readonly _tempVec2 = new Vector3();
    private static readonly _tempVec3 = new Vector3();

    constructor() {
        this.elements = new Float32Array(16);
        this.setIdentity();
    }

    // ==================== STATIC READONLY CONSTANTS ====================

    /**
     * Returns identity matrix. Shared instance — do not mutate!
     *
     * @remarks
     * Not frozen, unlike the other math constants: `Object.freeze` throws
     * `TypeError` on a `Float32Array` that has elements, so the guarantee the
     * rest of the math types get cannot be had here. "Do not mutate" is
     * therefore a contract, not an enforcement.
     */
    static get identity(): Matrix4x4 {
        if (!Matrix4x4._identity) {
            Matrix4x4._identity = new Matrix4x4();
        }
        return Matrix4x4._identity;
    }

    /**
     * Returns zero matrix. Shared instance — do not mutate!
     *
     * @remarks See {@link Matrix4x4.identity} on why it is not frozen.
     */
    static get zero(): Matrix4x4 {
        if (!Matrix4x4._zero) {
            Matrix4x4._zero = new Matrix4x4();
            Matrix4x4._zero.elements.fill(0);
        }
        return Matrix4x4._zero;
    }

    /**
     * Gets matrix element by row and column.
     * @param row Row (0-3)
     * @param column Column (0-3)
     */
    get(row: number, column: number): number {
        return this.elements[column * 4 + row];
    }

    /**
     * Sets matrix element by row and column.
     * @param row Row (0-3)
     * @param column Column (0-3)
     * @param value Value
     */
    set(row: number, column: number, value: number): this {
        this.elements[column * 4 + row] = value;
        return this;
    }

    /**
     * Gets matrix column as Vector4.
     * @param index Column index (0-3)
     * @param out Optional vector to write result
     */
    getColumn(index: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        const i = index * 4;
        result.x = this.elements[i];
        result.y = this.elements[i + 1];
        result.z = this.elements[i + 2];
        result.w = this.elements[i + 3];
        return result;
    }

    /**
     * Sets matrix column from Vector4.
     * @param index Column index (0-3)
     * @param column Vector values
     */
    setColumn(index: number, column: Vector4): this {
        const i = index * 4;
        this.elements[i] = column.x;
        this.elements[i + 1] = column.y;
        this.elements[i + 2] = column.z;
        this.elements[i + 3] = column.w;
        return this;
    }

    /**
     * Gets matrix row as Vector4.
     * @param index Row index (0-3)
     * @param out Optional vector to write result
     */
    getRow(index: number, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        result.x = this.elements[index];
        result.y = this.elements[index + 4];
        result.z = this.elements[index + 8];
        result.w = this.elements[index + 12];
        return result;
    }


    /**
     * Sets matrix row from Vector4.
     * @param index Row index (0-3)
     * @param row Vector values
     */
    setRow(index: number, row: Vector4): this {
        this.elements[index] = row.x;
        this.elements[index + 4] = row.y;
        this.elements[index + 8] = row.z;
        this.elements[index + 12] = row.w;
        return this;
    }


    /**
     * Returns position from transformation matrix.
     * @param out Optional vector to write result
     */
    getPosition(out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        result.x = this.elements[12];
        result.y = this.elements[13];
        result.z = this.elements[14];
        return result;
    }

    /**
     * Returns scale from transformation matrix.
     * @param out Optional vector to write result
     */
    getScale(out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const e = this.elements;
        result.x = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
        result.y = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
        result.z = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
        return result;
    }

    /**
     * Returns rotation from transformation matrix as quaternion.
     * @param out Optional quaternion to write result
     */
    getRotation(out?: Quaternion): Quaternion {
        const result = out ?? new Quaternion();

        // Get scale to normalize
        const e = this.elements;
        const sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
        const sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
        const sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);

        // Normalized rotation matrix elements
        const m00 = sx > 0 ? e[0] / sx : 0;
        const m10 = sx > 0 ? e[1] / sx : 0;
        const m20 = sx > 0 ? e[2] / sx : 0;
        const m01 = sy > 0 ? e[4] / sy : 0;
        const m11 = sy > 0 ? e[5] / sy : 0;
        const m21 = sy > 0 ? e[6] / sy : 0;
        const m02 = sz > 0 ? e[8] / sz : 0;
        const m12 = sz > 0 ? e[9] / sz : 0;
        const m22 = sz > 0 ? e[10] / sz : 0;

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
     * Checks if matrix is identity.
     */
    get isIdentity(): boolean {
        const e = this.elements;
        return (
            Math.abs(e[0] - 1) < EngineSettings.Math.EPSILON &&
            Math.abs(e[5] - 1) < EngineSettings.Math.EPSILON &&
            Math.abs(e[10] - 1) < EngineSettings.Math.EPSILON &&
            Math.abs(e[15] - 1) < EngineSettings.Math.EPSILON &&
            Math.abs(e[1]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[2]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[3]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[4]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[6]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[7]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[8]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[9]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[11]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[12]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[13]) < EngineSettings.Math.EPSILON &&
            Math.abs(e[14]) < EngineSettings.Math.EPSILON
        );
    }

    /**
     * Returns matrix determinant.
     */
    get determinant(): number {
        const e = this.elements;

        const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
        const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
        const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
        const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];

        return (
            n41 * (
                +n14 * n23 * n32
                - n13 * n24 * n32
                - n14 * n22 * n33
                + n12 * n24 * n33
                + n13 * n22 * n34
                - n12 * n23 * n34
            ) +
            n42 * (
                +n11 * n23 * n34
                - n11 * n24 * n33
                + n14 * n21 * n33
                - n13 * n21 * n34
                + n13 * n24 * n31
                - n14 * n23 * n31
            ) +
            n43 * (
                +n11 * n24 * n32
                - n11 * n22 * n34
                - n14 * n21 * n32
                + n12 * n21 * n34
                + n14 * n22 * n31
                - n12 * n24 * n31
            ) +
            n44 * (
                -n13 * n22 * n31
                - n11 * n23 * n32
                + n11 * n22 * n33
                + n13 * n21 * n32
                - n12 * n21 * n33
                + n12 * n23 * n31
            )
        );
    }

    /**
     * Creates transformation matrix from position, rotation and scale (TRS).
     */
    static TRS(position: Vector3, rotation: Quaternion, scale: Vector3, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setTRS(position, rotation, scale);
        return m;
    }

    /**
     * Creates translation matrix.
     */
    static Translate(translation: Vector3, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setIdentity();
        m.elements[12] = translation.x;
        m.elements[13] = translation.y;
        m.elements[14] = translation.z;
        return m;
    }

    /**
     * Creates rotation matrix from quaternion.
     */
    static Rotate(q: Quaternion, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setRotation(q);
        return m;
    }

    /**
     * Creates scale matrix.
     */
    static Scale(scale: Vector3, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setIdentity();
        m.elements[0] = scale.x;
        m.elements[5] = scale.y;
        m.elements[10] = scale.z;
        return m;
    }

    /**
     * Creates rotation matrix around X axis.
     * @param angle Angle in degrees
     * @param out
     */
    static RotateX(angle: number, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setIdentity();
        const rad = angle * (Math.PI / 180);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        m.elements[5] = c;
        m.elements[6] = s;
        m.elements[9] = -s;
        m.elements[10] = c;
        return m;
    }

    /**
     * Creates rotation matrix around Y axis.
     * @param angle Angle in degrees
     * @param out
     */
    static RotateY(angle: number, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setIdentity();
        const rad = angle * (Math.PI / 180);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        m.elements[0] = c;
        m.elements[2] = -s;
        m.elements[8] = s;
        m.elements[10] = c;
        return m;
    }

    /**
     * Creates rotation matrix around Z axis.
     * @param angle Angle in degrees
     * @param out
     */
    static RotateZ(angle: number, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.setIdentity();
        const rad = angle * (Math.PI / 180);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        m.elements[0] = c;
        m.elements[1] = s;
        m.elements[4] = -s;
        m.elements[5] = c;
        return m;
    }

    /**
     * Creates perspective projection matrix.
     */
    static Perspective(fov: number, aspect: number, near: number, far: number, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.elements.fill(0);

        const tanHalfFov = Math.tan((fov * Math.PI / 180) / 2);

        m.elements[0] = 1 / (aspect * tanHalfFov);
        m.elements[5] = 1 / tanHalfFov;
        m.elements[10] = -(far + near) / (far - near);
        m.elements[11] = -1;
        m.elements[14] = -(2 * far * near) / (far - near);

        return m;
    }

    /**
     * Creates orthographic projection matrix.
     */
    static Ortho(left: number, right: number, bottom: number, top: number, near: number, far: number, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        m.elements.fill(0);

        const w = 1 / (right - left);
        const h = 1 / (top - bottom);
        const p = 1 / (far - near);

        m.elements[0] = 2 * w;
        m.elements[5] = 2 * h;
        m.elements[10] = -2 * p;
        m.elements[12] = -(right + left) * w;
        m.elements[13] = -(top + bottom) * h;
        m.elements[14] = -(far + near) * p;
        m.elements[15] = 1;

        return m;
    }

    /**
     * Creates "look at" matrix (view matrix).
     */
    static LookAt(eye: Vector3, target: Vector3, up: Vector3, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();

        // Use static temp vectors to avoid allocation
        const zAxis = Vector3.subtract(eye, target, Matrix4x4._tempVec1).normalize();
        const xAxis = Vector3.cross(up, zAxis, Matrix4x4._tempVec2).normalize();
        const yAxis = Vector3.cross(zAxis, xAxis, Matrix4x4._tempVec3);

        m.elements[0] = xAxis.x;
        m.elements[1] = yAxis.x;
        m.elements[2] = zAxis.x;
        m.elements[3] = 0;

        m.elements[4] = xAxis.y;
        m.elements[5] = yAxis.y;
        m.elements[6] = zAxis.y;
        m.elements[7] = 0;

        m.elements[8] = xAxis.z;
        m.elements[9] = yAxis.z;
        m.elements[10] = zAxis.z;
        m.elements[11] = 0;

        m.elements[12] = -xAxis.dot(eye);
        m.elements[13] = -yAxis.dot(eye);
        m.elements[14] = -zAxis.dot(eye);
        m.elements[15] = 1;

        return m;
    }


    /**
     * Sets matrix to identity.
     */
    setIdentity(): this {
        this.elements.fill(0);
        this.elements[0] = 1;
        this.elements[5] = 1;
        this.elements[10] = 1;
        this.elements[15] = 1;
        return this;
    }

    /**
     * Sets transformation matrix from position, rotation and scale.
     * @param position Position
     * @param rotation Rotation (quaternion)
     * @param scale Scale
     */
    setTRS(position: Vector3, rotation: Quaternion, scale: Vector3): this {
        // First rotation
        this.setRotation(rotation);

        // Then scale (multiply first three columns by corresponding scale components)
        this.elements[0] *= scale.x;
        this.elements[1] *= scale.x;
        this.elements[2] *= scale.x;

        this.elements[4] *= scale.y;
        this.elements[5] *= scale.y;
        this.elements[6] *= scale.y;

        this.elements[8] *= scale.z;
        this.elements[9] *= scale.z;
        this.elements[10] *= scale.z;

        // Finally position
        this.elements[12] = position.x;
        this.elements[13] = position.y;
        this.elements[14] = position.z;

        return this;
    }

    /**
     * Sets rotation matrix from quaternion.
     * @param q Rotation quaternion
     */
    setRotation(q: Quaternion): this {
        const x = q.x, y = q.y, z = q.z, w = q.w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        this.elements[0] = 1 - (yy + zz);
        this.elements[1] = xy + wz;
        this.elements[2] = xz - wy;
        this.elements[3] = 0;

        this.elements[4] = xy - wz;
        this.elements[5] = 1 - (xx + zz);
        this.elements[6] = yz + wx;
        this.elements[7] = 0;

        this.elements[8] = xz + wy;
        this.elements[9] = yz - wx;
        this.elements[10] = 1 - (xx + yy);
        this.elements[11] = 0;

        this.elements[12] = 0;
        this.elements[13] = 0;
        this.elements[14] = 0;
        this.elements[15] = 1;

        return this;
    }

    /**
     * Copies values from another matrix.
     * @param m Matrix to copy
     */
    copy(m: Matrix4x4): this {
        this.elements.set(m.elements);
        return this;
    }

    /**
     * Creates copy of this matrix.
     */
    clone(): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements.set(this.elements);
        return m;
    }

    /**
     * Multiplies this matrix by another (this = this * m).
     * @param m Matrix to multiply
     */
    multiply(m: Matrix4x4): this {
        return this.multiplyMatrices(this, m);
    }

    /**
     * Static multiply with out parameter.
     */
    static Multiply(a: Matrix4x4, b: Matrix4x4, out?: Matrix4x4): Matrix4x4 {
        const m = out ?? new Matrix4x4();
        return m.multiplyMatrices(a, b);
    }

    /**
     * Premultiplies this matrix by another (this = m * this).
     * @param m Matrix to multiply
     */
    premultiply(m: Matrix4x4): this {
        return this.multiplyMatrices(m, this);
    }

    /**
     * Multiplies two matrices and stores result in current.
     * @param a First matrix
     * @param b Second matrix
     */
    multiplyMatrices(a: Matrix4x4, b: Matrix4x4): this {
        const ae = a.elements;
        const be = b.elements;
        const te = this.elements;

        const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
        const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
        const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
        const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];

        const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
        const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
        const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
        const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];

        te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
        te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
        te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
        te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

        te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
        te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
        te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
        te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

        te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
        te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
        te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
        te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

        te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
        te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
        te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
        te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

        return this;
    }

    /**
     * Multiplies matrix by scalar.
     * @param scalar Number to multiply by
     */
    multiplyScalar(scalar: number): this {
        for (let i = 0; i < 16; i++) {
            this.elements[i] *= scalar;
        }
        return this;
    }

    /**
     * Transforms point (with position, w = 1).
     */
    multiplyPoint(point: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const e = this.elements;
        const x = point.x, y = point.y, z = point.z;
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);

        result.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
        result.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
        result.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;

        return result;
    }


    /**
     * Transforms point without perspective division.
     */
    multiplyPoint3x4(point: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const e = this.elements;
        const x = point.x, y = point.y, z = point.z;

        result.x = e[0] * x + e[4] * y + e[8] * z + e[12];
        result.y = e[1] * x + e[5] * y + e[9] * z + e[13];
        result.z = e[2] * x + e[6] * y + e[10] * z + e[14];

        return result;
    }

    /**
     * Transforms direction (without position, w = 0).
     */
    multiplyVector(vector: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();
        const e = this.elements;
        const x = vector.x, y = vector.y, z = vector.z;

        result.x = e[0] * x + e[4] * y + e[8] * z;
        result.y = e[1] * x + e[5] * y + e[9] * z;
        result.z = e[2] * x + e[6] * y + e[10] * z;

        return result;
    }

    /**
     * Transforms Vector4.
     */
    multiplyVector4(v: Vector4, out?: Vector4): Vector4 {
        const result = out ?? new Vector4();
        const e = this.elements;
        const x = v.x, y = v.y, z = v.z, w = v.w;

        result.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
        result.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
        result.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
        result.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;

        return result;
    }

    /**
     * Inverts matrix.
     */
    invert(): this {
        const e = this.elements;
        const te = new Float32Array(16);

        const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
        const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
        const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
        const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];

        const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
        const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
        const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
        const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

        const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;

        if (det === 0) {
            console.warn("Matrix4x4: Cannot invert matrix, determinant is 0");
            return this.setIdentity();
        }

        const detInv = 1 / det;

        te[0] = t11 * detInv;
        te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
        te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
        te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;

        te[4] = t12 * detInv;
        te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
        te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
        te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;

        te[8] = t13 * detInv;
        te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
        te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
        te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;

        te[12] = t14 * detInv;
        te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
        te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
        te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;

        this.elements.set(te);
        return this;
    }
    /**
     * Returns inverse matrix (without modifying original).
     */
    inverse(): Matrix4x4 {
        return this.clone().invert();
    }

    /**
     * Static inverse with out parameter.
     */
    static Inverse(m: Matrix4x4, out?: Matrix4x4): Matrix4x4 {
        const result = out ?? new Matrix4x4();
        result.copy(m);
        return result.invert();
    }

    /**
     * Transposes matrix.
     */
    transpose(): this {
        const e = this.elements;
        let tmp;

        tmp = e[1]; e[1] = e[4]; e[4] = tmp;
        tmp = e[2]; e[2] = e[8]; e[8] = tmp;
        tmp = e[3]; e[3] = e[12]; e[12] = tmp;
        tmp = e[6]; e[6] = e[9]; e[9] = tmp;
        tmp = e[7]; e[7] = e[13]; e[13] = tmp;
        tmp = e[11]; e[11] = e[14]; e[14] = tmp;

        return this;
    }

    /**
     * Checks matrix equality with tolerance.
     * @param m Matrix to compare
     * @param epsilon Tolerance
     */
    equals(m: Matrix4x4, epsilon = EngineSettings.Math.EPSILON): boolean {
        for (let i = 0; i < 16; i++) {
            if (Math.abs(this.elements[i] - m.elements[i]) > epsilon) {
                return false;
            }
        }
        return true;
    }

    /**
     * Sets values from an array.
     * @param array Array of 16 elements
     * @param offset Offset in an array (default 0)
     */
    fromArray(array: ArrayLike<number>, offset: number = 0): this {
        for (let i = 0; i < 16; i++) {
            this.elements[i] = array[offset + i];
        }
        return this;
    }

    /**
     * Returns array of matrix elements.
     * @param array (Optional) Array to write to
     * @param offset Offset in array (default 0)
     */
    toArray(array?: number[], offset: number = 0): number[] {
        const result = array || [];
        for (let i = 0; i < 16; i++) {
            result[offset + i] = this.elements[i];
        }
        return result;
    }


    /**
     * Returns string representation of matrix.
     */
    toString(): string {
        const e = this.elements;
        return `Matrix4x4:
| ${e[0].toFixed(3)} ${e[4].toFixed(3)} ${e[8].toFixed(3)} ${e[12].toFixed(3)} |
| ${e[1].toFixed(3)} ${e[5].toFixed(3)} ${e[9].toFixed(3)} ${e[13].toFixed(3)} |
| ${e[2].toFixed(3)} ${e[6].toFixed(3)} ${e[10].toFixed(3)} ${e[14].toFixed(3)} |
| ${e[3].toFixed(3)} ${e[7].toFixed(3)} ${e[11].toFixed(3)} ${e[15].toFixed(3)} |`;
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only.

    /**
     * @internal
     * Copies values to a Three.js Matrix4-like object.
     */
    _copyToThree(threeMatrix: { elements: ArrayLike<number> & { set(array: ArrayLike<number>): void } }): void {
        threeMatrix.elements.set(this.elements);
    }

    /**
     * @internal
     * Copies values from a Three.js Matrix4-like object.
     */
    _copyFromThree(threeMatrix: { elements: ArrayLike<number> }): this {
        for (let i = 0; i < 16; i++) {
            this.elements[i] = threeMatrix.elements[i];
        }
        return this;
    }
}