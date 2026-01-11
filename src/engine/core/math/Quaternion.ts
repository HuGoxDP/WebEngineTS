import { Vector3 } from './Vector3.ts';

/**
 * Quaternion.ts
 * Клас для представлення обертання в 3D просторі.
 * Використовує формат x, y, z, w.
 * Усуває проблему Gimbal Lock, притаманну Euler Angles.
 */
export class Quaternion {
    public x: number;
    public y: number;
    public z: number;
    public w: number;

    /**
     * За замовчуванням створює Identity Quaternion (без обертання).
     */
    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    /**
     * Повертає "нульове" обертання (0, 0, 0, 1).
     */
    static get identity(): Quaternion {
        return new Quaternion(0, 0, 0, 1);
    }

    /**
     * Створює кватерніон з кутів Ейлера (в градусах).
     * Це те, що ми бачимо в інспекторі Unity (Rotation X, Y, Z).
     */
    static fromEuler(x: number, y: number, z: number): Quaternion {
        const q = new Quaternion();
        q.setFromEuler(x, y, z);
        return q;
    }

    /**
     * Slerp (Spherical Linear Interpolation).
     * Плавне обертання від 'a' до 'b' на величину 't' (0..1).
     */
    static slerp(qa: Quaternion, qb: Quaternion, t: number): Quaternion {
        if (t === 0) return qa.clone();
        if (t === 1) return qb.clone();

        const x = qa.x, y = qa.y, z = qa.z, w = qa.w;

        // Ініціалізуємо тимчасові змінні для другого кватерніона
        let qbx = qb.x, qby = qb.y, qbz = qb.z, qbw = qb.w;

        // Рахуємо косинус кута (скалярний добуток)
        let cosHalfTheta = w * qbw + x * qbx + y * qby + z * qbz;

        // Якщо кватерніони "далекі" - інвертуємо один, щоб взяти коротший шлях
        if (cosHalfTheta < 0) {
            qbw = -qbw;
            qbx = -qbx;
            qby = -qby;
            qbz = -qbz;
            cosHalfTheta = -cosHalfTheta;
        }

        if (cosHalfTheta >= 1.0) {
            return qa.clone();
        }

        const sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta;

        // Якщо кут дуже малий — використовуємо лінійну інтерполяцію (швидше і безпечніше)
        if (sqrSinHalfTheta <= Number.EPSILON) {
            const s = 1 - t;
            const res = new Quaternion(
                s * x + t * qbx,
                s * y + t * qby,
                s * z + t * qbz,
                s * w + t * qbw
            );
            return res.normalize();
        }

        const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
        const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);

        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

        return new Quaternion(
            x * ratioA + qbx * ratioB,
            y * ratioA + qby * ratioB,
            z * ratioA + qbz * ratioB,
            w * ratioA + qbw * ratioB
        );
    }


    set(x: number, y: number, z: number, w: number): this {
        this.x = x; this.y = y; this.z = z; this.w = w;
        return this;
    }

    copy(q: Quaternion): this {
        this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w;
        return this;
    }

    clone(): Quaternion {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }

    /**
     * Конвертує кути Ейлера (градуси) у Кватерніон і записує в this.
     * Порядок обертання: Y -> X -> Z (стандарт Unity/Three.js).
     */
    setFromEuler(x: number, y: number, z: number): this {
        // Конвертуємо градуси в радіани
        const c1 = Math.cos(x * (Math.PI / 360)); // x / 2 * degToRad
        const c2 = Math.cos(y * (Math.PI / 360));
        const c3 = Math.cos(z * (Math.PI / 360));

        const s1 = Math.sin(x * (Math.PI / 360));
        const s2 = Math.sin(y * (Math.PI / 360));
        const s3 = Math.sin(z * (Math.PI / 360));

        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 + s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;

        return this;
    }


    /**
     * Множення кватерніонів (Комбінування обертань).
     * this = this * q
     */
    multiply(q: Quaternion): this {
        return this.multiplyQuaternions(this, q);
    }

    /**
     * Внутрішній метод для безпечного множення
     * (щоб уникнути перезапису this.x до завершення розрахунків)
     */
    multiplyQuaternions(a: Quaternion, b: Quaternion): this {
        const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w;
        const qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;

        this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
        this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
        this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
        this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

        return this;
    }

    /**
     * Нормалізація кватерніона.
     * Обов'язково викликати періодично, щоб уникнути накопичення похибок float.
     */
    normalize(): this {
        let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
        if (l === 0) {
            this.x = 0; this.y = 0; this.z = 0; this.w = 1;
        } else {
            l = 1 / l;
            this.x *= l; this.y *= l; this.z *= l; this.w *= l;
        }
        return this;
    }

    /**
     * Інвертує обертання (поворот у зворотний бік).
     */
    invert(): this {
        this.x *= -1;
        this.y *= -1;
        this.z *= -1;
        return this.normalize();
    }

    /**
     * Повертає кути Ейлера (в градусах).
     * Потрібно для відображення в Інспекторі.
     */
    toEuler(): Vector3 {
        const sinr_cosp = 2 * (this.w * this.x + this.y * this.z);
        const cosr_cosp = 1 - 2 * (this.x * this.x + this.y * this.y);
        const x = Math.atan2(sinr_cosp, cosr_cosp);

        const sinp = 2 * (this.w * this.y - this.z * this.x);
        let y;
        if (Math.abs(sinp) >= 1)
            y = (Math.PI / 2) * Math.sign(sinp);
        else
            y = Math.asin(sinp);

        const siny_cosp = 2 * (this.w * this.z + this.x * this.y);
        const cosy_cosp = 1 - 2 * (this.y * this.y + this.z * this.z);
        const z = Math.atan2(siny_cosp, cosy_cosp);

        const radToDeg = 180 / Math.PI;
        return new Vector3(x * radToDeg, y * radToDeg, z * radToDeg);
    }
        toString(): string {
        return `Quat(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)}, ${this.w.toFixed(2)})`;
    }
}
