import { EngineSettings } from "../EngineSettings.ts";
import { Vector3 } from "./Vector3.ts";
import { Vector4 } from "./Vector4.ts";
import { Quaternion } from "./Quaternion.ts";
import * as THREE from "three";

/**
 * Matrix4x4.ts
 * Клас матриці 4x4 для роботи з трансформаціями в 3D просторі.
 * Використовується для: позиціонування, обертання, масштабування,
 * проекцій камери, шейдерних операцій.
 * 
 * Формат зберігання: Column-major (як в OpenGL/Three.js)
 * Індексація: m[col][row] або elements[col * 4 + row]
 */
export class Matrix4x4 {
    /**
     * Елементи матриці у форматі column-major (16 елементів).
     * Порядок: [m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33]
     */
    public readonly elements: Float32Array;

    /**
     * Внутрішній об'єкт Three.js для інтеграції.
     * НЕ використовувати напряму - лише для двигуна!
     */
    public _internalMatrix: THREE.Matrix4;

    constructor() {
        this.elements = new Float32Array(16);
        this._internalMatrix = new THREE.Matrix4();
        this.setIdentity();
    }


    /**
     * Повертає одиничну матрицю (Identity Matrix).
     */
    static get identity(): Matrix4x4 {
        return new Matrix4x4();
    }

    /**
     * Повертає нульову матрицю (всі елементи = 0).
     */
    static get zero(): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements.fill(0);
        m._syncToThree();
        return m;
    }


    /**
     * Отримує елемент матриці за рядком та стовпцем.
     * @param row Рядок (0-3)
     * @param column Стовпець (0-3)
     */
    get(row: number, column: number): number {
        return this.elements[column * 4 + row];
    }

    /**
     * Встановлює елемент матриці за рядком та стовпцем.
     * @param row Рядок (0-3)
     * @param column Стовпець (0-3)
     * @param value Значення
     */
    set(row: number, column: number, value: number): this {
        this.elements[column * 4 + row] = value;
        this._syncToThree();
        return this;
    }

    /**
     * Отримує стовпець матриці як Vector4.
     * @param index Індекс стовпця (0-3)
     */
    getColumn(index: number): Vector4 {
        const i = index * 4;
        return new Vector4(
            this.elements[i],
            this.elements[i + 1],
            this.elements[i + 2],
            this.elements[i + 3]
        );
    }

    /**
     * Встановлює стовпець матриці з Vector4.
     * @param index Індекс стовпця (0-3)
     * @param column Вектор значень
     */
    setColumn(index: number, column: Vector4): this {
        const i = index * 4;
        this.elements[i] = column.x;
        this.elements[i + 1] = column.y;
        this.elements[i + 2] = column.z;
        this.elements[i + 3] = column.w;
        this._syncToThree();
        return this;
    }

    /**
     * Отримує рядок матриці як Vector4.
     * @param index Індекс рядка (0-3)
     */
    getRow(index: number): Vector4 {
        return new Vector4(
            this.elements[index],
            this.elements[index + 4],
            this.elements[index + 8],
            this.elements[index + 12]
        );
    }

    /**
     * Встановлює рядок матриці з Vector4.
     * @param index Індекс рядка (0-3)
     * @param row Вектор значень
     */
    setRow(index: number, row: Vector4): this {
        this.elements[index] = row.x;
        this.elements[index + 4] = row.y;
        this.elements[index + 8] = row.z;
        this.elements[index + 12] = row.w;
        this._syncToThree();
        return this;
    }


    /**
     * Повертає позицію з матриці трансформації.
     */
    getPosition(): Vector3 {
        return new Vector3(
            this.elements[12],
            this.elements[13],
            this.elements[14]
        );
    }

    /**
     * Повертає масштаб з матриці трансформації.
     */
    getScale(): Vector3 {
        const sx = Math.sqrt(
            this.elements[0] ** 2 + this.elements[1] ** 2 + this.elements[2] ** 2
        );
        const sy = Math.sqrt(
            this.elements[4] ** 2 + this.elements[5] ** 2 + this.elements[6] ** 2
        );
        const sz = Math.sqrt(
            this.elements[8] ** 2 + this.elements[9] ** 2 + this.elements[10] ** 2
        );
        return new Vector3(sx, sy, sz);
    }

    /**
     * Повертає обертання з матриці трансформації як кватерніон.
     */
    getRotation(): Quaternion {
        const scale = this.getScale();
        const m = new Matrix4x4();
        m.copy(this);
        
        // Нормалізуємо колонки для видалення масштабу
        if (scale.x !== 0) {
            m.elements[0] /= scale.x;
            m.elements[1] /= scale.x;
            m.elements[2] /= scale.x;
        }
        if (scale.y !== 0) {
            m.elements[4] /= scale.y;
            m.elements[5] /= scale.y;
            m.elements[6] /= scale.y;
        }
        if (scale.z !== 0) {
            m.elements[8] /= scale.z;
            m.elements[9] /= scale.z;
            m.elements[10] /= scale.z;
        }

        const trace = m.elements[0] + m.elements[5] + m.elements[10];
        const q = new Quaternion();

        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            q.w = 0.25 / s;
            q.x = (m.elements[6] - m.elements[9]) * s;
            q.y = (m.elements[8] - m.elements[2]) * s;
            q.z = (m.elements[1] - m.elements[4]) * s;
        } else if (m.elements[0] > m.elements[5] && m.elements[0] > m.elements[10]) {
            const s = 2.0 * Math.sqrt(1.0 + m.elements[0] - m.elements[5] - m.elements[10]);
            q.w = (m.elements[6] - m.elements[9]) / s;
            q.x = 0.25 * s;
            q.y = (m.elements[4] + m.elements[1]) / s;
            q.z = (m.elements[8] + m.elements[2]) / s;
        } else if (m.elements[5] > m.elements[10]) {
            const s = 2.0 * Math.sqrt(1.0 + m.elements[5] - m.elements[0] - m.elements[10]);
            q.w = (m.elements[8] - m.elements[2]) / s;
            q.x = (m.elements[4] + m.elements[1]) / s;
            q.y = 0.25 * s;
            q.z = (m.elements[9] + m.elements[6]) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m.elements[10] - m.elements[0] - m.elements[5]);
            q.w = (m.elements[1] - m.elements[4]) / s;
            q.x = (m.elements[8] + m.elements[2]) / s;
            q.y = (m.elements[9] + m.elements[6]) / s;
            q.z = 0.25 * s;
        }

        return q.normalize();
    }

    /**
     * Перевіряє, чи є матриця одиничною.
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
     * Повертає детермінант матриці.
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
     * Створює матрицю трансформації з позиції, обертання та масштабу (TRS).
     * @param position Позиція
     * @param rotation Обертання (кватерніон)
     * @param scale Масштаб
     */
    static TRS(position: Vector3, rotation: Quaternion, scale: Vector3): Matrix4x4 {
        const m = new Matrix4x4();
        m.setTRS(position, rotation, scale);
        return m;
    }

    /**
     * Створює матрицю переміщення.
     * @param translation Вектор переміщення
     */
    static Translate(translation: Vector3): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements[12] = translation.x;
        m.elements[13] = translation.y;
        m.elements[14] = translation.z;
        m._syncToThree();
        return m;
    }

    /**
     * Створює матрицю обертання з кватерніона.
     * @param q Кватерніон обертання
     */
    static Rotate(q: Quaternion): Matrix4x4 {
        const m = new Matrix4x4();
        m.setRotation(q);
        return m;
    }

    /**
     * Створює матрицю масштабування.
     * @param scale Вектор масштабу
     */
    static Scale(scale: Vector3): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements[0] = scale.x;
        m.elements[5] = scale.y;
        m.elements[10] = scale.z;
        m._syncToThree();
        return m;
    }

    /**
     * Створює матрицю обертання навколо осі X.
     * @param angle Кут в градусах
     */
    static RotateX(angle: number): Matrix4x4 {
        const m = new Matrix4x4();
        const rad = angle * (Math.PI / 180);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        m.elements[5] = c;
        m.elements[6] = s;
        m.elements[9] = -s;
        m.elements[10] = c;
        m._syncToThree();
        return m;
    }

    /**
     * Створює матрицю обертання навколо осі Y.
     * @param angle Кут в градусах
     */
    static RotateY(angle: number): Matrix4x4 {
        const m = new Matrix4x4();
        const rad = angle * (Math.PI / 180);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        m.elements[0] = c;
        m.elements[2] = -s;
        m.elements[8] = s;
        m.elements[10] = c;
        m._syncToThree();
        return m;
    }

    /**
     * Створює матрицю обертання навколо осі Z.
     * @param angle Кут в градусах
     */
    static RotateZ(angle: number): Matrix4x4 {
        const m = new Matrix4x4();
        const rad = angle * (Math.PI / 180);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        m.elements[0] = c;
        m.elements[1] = s;
        m.elements[4] = -s;
        m.elements[5] = c;
        m._syncToThree();
        return m;
    }

    /**
     * Створює перспективну проекційну матрицю.
     * @param fov Поле зору в градусах
     * @param aspect Співвідношення сторін (width / height)
     * @param near Ближня площина відсікання
     * @param far Дальня площина відсікання
     */
    static Perspective(fov: number, aspect: number, near: number, far: number): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements.fill(0);
        
        const tanHalfFov = Math.tan((fov * Math.PI / 180) / 2);
        
        m.elements[0] = 1 / (aspect * tanHalfFov);
        m.elements[5] = 1 / tanHalfFov;
        m.elements[10] = -(far + near) / (far - near);
        m.elements[11] = -1;
        m.elements[14] = -(2 * far * near) / (far - near);
        
        m._syncToThree();
        return m;
    }

    /**
     * Створює ортографічну проекційну матрицю.
     * @param left Ліва межа
     * @param right Права межа
     * @param bottom Нижня межа
     * @param top Верхня межа
     * @param near Ближня площина відсікання
     * @param far Дальня площина відсікання
     */
    static Ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements.fill(0);
        
        const w = 1.0 / (right - left);
        const h = 1.0 / (top - bottom);
        const p = 1.0 / (far - near);

        m.elements[0] = 2 * w;
        m.elements[5] = 2 * h;
        m.elements[10] = -2 * p;
        m.elements[12] = -(right + left) * w;
        m.elements[13] = -(top + bottom) * h;
        m.elements[14] = -(far + near) * p;
        m.elements[15] = 1;
        
        m._syncToThree();
        return m;
    }

    /**
     * Створює матрицю "погляду" (Look At).
     * @param eye Позиція камери
     * @param target Точка, на яку дивиться камера
     * @param up Напрямок "вгору"
     */
    static LookAt(eye: Vector3, target: Vector3, up: Vector3): Matrix4x4 {
        const m = new Matrix4x4();
        
        const zAxis = Vector3.subtract(eye, target, new Vector3()).normalize();
        const xAxis = Vector3.cross(up, zAxis, new Vector3()).normalize();
        const yAxis = Vector3.cross(zAxis, xAxis, new Vector3());

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

        m._syncToThree();
        return m;
    }


    /**
     * Встановлює матрицю як одиничну (Identity).
     */
    setIdentity(): this {
        this.elements.fill(0);
        this.elements[0] = 1;
        this.elements[5] = 1;
        this.elements[10] = 1;
        this.elements[15] = 1;
        this._syncToThree();
        return this;
    }

    /**
     * Встановлює матрицю трансформації з позиції, обертання та масштабу.
     * @param position Позиція
     * @param rotation Обертання (кватерніон)
     * @param scale Масштаб
     */
    setTRS(position: Vector3, rotation: Quaternion, scale: Vector3): this {
        // Спочатку обертання
        this.setRotation(rotation);
        
        // Потім масштаб (множимо перші три стовпці на відповідні компоненти масштабу)
        this.elements[0] *= scale.x;
        this.elements[1] *= scale.x;
        this.elements[2] *= scale.x;
        
        this.elements[4] *= scale.y;
        this.elements[5] *= scale.y;
        this.elements[6] *= scale.y;
        
        this.elements[8] *= scale.z;
        this.elements[9] *= scale.z;
        this.elements[10] *= scale.z;
        
        // Нарешті позиція
        this.elements[12] = position.x;
        this.elements[13] = position.y;
        this.elements[14] = position.z;
        
        this._syncToThree();
        return this;
    }

    /**
     * Встановлює матрицю обертання з кватерніона.
     * @param q Кватерніон обертання
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

        this._syncToThree();
        return this;
    }

    /**
     * Копіює значення з іншої матриці.
     * @param m Матриця для копіювання
     */
    copy(m: Matrix4x4): this {
        this.elements.set(m.elements);
        this._syncToThree();
        return this;
    }

    /**
     * Створює копію цієї матриці.
     */
    clone(): Matrix4x4 {
        const m = new Matrix4x4();
        m.elements.set(this.elements);
        m._syncToThree();
        return m;
    }

    /**
     * Множить цю матрицю на іншу (this = this * m).
     * @param m Матриця для множення
     */
    multiply(m: Matrix4x4): this {
        return this.multiplyMatrices(this, m);
    }

    /**
     * Множить цю матрицю зліва на іншу (this = m * this).
     * @param m Матриця для множення
     */
    premultiply(m: Matrix4x4): this {
        return this.multiplyMatrices(m, this);
    }

    /**
     * Множить дві матриці і записує результат в поточну.
     * @param a Перша матриця
     * @param b Друга матриця
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

        this._syncToThree();
        return this;
    }

    /**
     * Множить матрицю на скаляр.
     * @param scalar Число для множення
     */
    multiplyScalar(scalar: number): this {
        for (let i = 0; i < 16; i++) {
            this.elements[i] *= scalar;
        }
        this._syncToThree();
        return this;
    }

    /**
     * Трансформує точку (з урахуванням позиції, w = 1).
     * @param point Точка для трансформації
     * @param out (Опціонально) Вектор для запису результату
     */
    multiplyPoint(point: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        const e = this.elements;
        const x = point.x, y = point.y, z = point.z;
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);

        result.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
        result.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
        result.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;

        return result;
    }

    /**
     * Трансформує точку без урахування перспективного ділення.
     * Швидше за multiplyPoint, але некоректно працює з проекційними матрицями.
     * @param point Точка для трансформації
     * @param out (Опціонально) Вектор для запису результату
     */
    multiplyPoint3x4(point: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        const e = this.elements;
        const x = point.x, y = point.y, z = point.z;

        result.x = e[0] * x + e[4] * y + e[8] * z + e[12];
        result.y = e[1] * x + e[5] * y + e[9] * z + e[13];
        result.z = e[2] * x + e[6] * y + e[10] * z + e[14];

        return result;
    }

    /**
     * Трансформує напрямок (без урахування позиції, w = 0).
     * @param vector Напрямок для трансформації
     * @param out (Опціонально) Вектор для запису результату
     */
    multiplyVector(vector: Vector3, out?: Vector3): Vector3 {
        const result = out || new Vector3();
        const e = this.elements;
        const x = vector.x, y = vector.y, z = vector.z;

        result.x = e[0] * x + e[4] * y + e[8] * z;
        result.y = e[1] * x + e[5] * y + e[9] * z;
        result.z = e[2] * x + e[6] * y + e[10] * z;

        return result;
    }

    /**
     * Трансформує Vector4.
     * @param v Вектор для трансформації
     * @param out (Опціонально) Вектор для запису результату
     */
    multiplyVector4(v: Vector4, out?: Vector4): Vector4 {
        const result = out || new Vector4();
        const e = this.elements;
        const x = v.x, y = v.y, z = v.z, w = v.w;

        result.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
        result.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
        result.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
        result.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;

        return result;
    }

    /**
     * Інвертує матрицю.
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
        this._syncToThree();
        return this;
    }

    /**
     * Повертає інверсну матрицю (не змінюючи оригінал).
     */
    inverse(): Matrix4x4 {
        return this.clone().invert();
    }

    /**
     * Транспонує матрицю.
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

        this._syncToThree();
        return this;
    }

    /**
     * Перевіряє рівність матриць з урахуванням похибки.
     * @param m Матриця для порівняння
     * @param epsilon Допустима похибка
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
     * Встановлює значення з масиву.
     * @param array Масив з 16 елементів
     * @param offset Зсув в масиві (за замовчуванням 0)
     */
    fromArray(array: ArrayLike<number>, offset: number = 0): this {
        for (let i = 0; i < 16; i++) {
            this.elements[i] = array[offset + i];
        }
        this._syncToThree();
        return this;
    }

    /**
     * Повертає масив з елементів матриці.
     * @param array (Опціонально) Масив для запису
     * @param offset Зсув в масиві (за замовчуванням 0)
     */
    toArray(array?: number[], offset: number = 0): number[] {
        const result = array || [];
        for (let i = 0; i < 16; i++) {
            result[offset + i] = this.elements[i];
        }
        return result;
    }

    /**
     * Повертає рядкове представлення матриці.
     */
    toString(): string {
        const e = this.elements;
        return `Matrix4x4:
| ${e[0].toFixed(3)} ${e[4].toFixed(3)} ${e[8].toFixed(3)} ${e[12].toFixed(3)} |
| ${e[1].toFixed(3)} ${e[5].toFixed(3)} ${e[9].toFixed(3)} ${e[13].toFixed(3)} |
| ${e[2].toFixed(3)} ${e[6].toFixed(3)} ${e[10].toFixed(3)} ${e[14].toFixed(3)} |
| ${e[3].toFixed(3)} ${e[7].toFixed(3)} ${e[11].toFixed(3)} ${e[15].toFixed(3)} |`;
    }

    // === Внутрішні методи ===

    /**
     * Синхронізує елементи з внутрішньою матрицею Three.js.
     * @internal
     */
    _syncToThree(): void {
        this._internalMatrix.fromArray(this.elements);
    }

    /**
     * Синхронізує елементи з внутрішньої матриці Three.js.
     * @internal
     */
    _syncFromThree(): void {
        this._internalMatrix.toArray(this.elements);
    }

    /**
     * Встановлює значення з матриці Three.js.
     * @internal
     */
    _setFromThreeMatrix(m: THREE.Matrix4): this {
        m.toArray(this.elements);
        this._internalMatrix.copy(m);
        return this;
    }
}
