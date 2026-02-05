// path: src/engine/math/Bounds.ts

import { Vector3 } from './Vector3';
import { Ray } from './Ray';
import { EngineSettings } from '../EngineSettings';

/**
 * Bounds.ts
 * Осесіметрична обмежувальна коробка (Axis-Aligned Bounding Box - AABB).
 * Використовується для: визначення меж мешів, culling, перевірки перетинів.
 *
 * @remarks
 * Bounds описується центром + розміром (як у Unity).
 * API максимально наближений до Unity Bounds.
 */
export class Bounds {
    /** Центр обмежувальної коробки */
    private _center: Vector3;
    /** Повний розмір коробки (ширина, висота, глибина) */
    private _size: Vector3;

    /**
     * Створює новий Bounds.
     * @param center Центр коробки (за замовчуванням (0,0,0))
     * @param size Розмір коробки (за замовчуванням (0,0,0))
     */
    constructor(center?: Vector3, size?: Vector3) {
        this._center = center ? center.clone() : new Vector3(0, 0, 0);
        this._size = size ? size.clone() : new Vector3(0, 0, 0);
    }

    // ==================== PROPERTIES ====================

    /** Центр обмежувальної коробки */
    get center(): Vector3 {
        return this._center;
    }

    set center(value: Vector3) {
        this._center.copy(value);
    }

    /** Повний розмір коробки */
    get size(): Vector3 {
        return this._size;
    }

    set size(value: Vector3) {
        this._size.copy(value);
    }

    /**
     * Половина розміру (від центру до краю).
     * WARNING: Allocates new Vector3. Use getExtents(out) in hot paths.
     */
    get extents(): Vector3 {
        return new Vector3(
            this._size.x * 0.5,
            this._size.y * 0.5,
            this._size.z * 0.5
        );
    }

    set extents(value: Vector3) {
        this._size.set(value.x * 2, value.y * 2, value.z * 2);
    }


    /**
     * Мінімальна точка коробки.
     * WARNING: Allocates new Vector3. Use getMin(out) in hot paths.
     */
    get min(): Vector3 {
        return new Vector3(
            this._center.x - this._size.x * 0.5,
            this._center.y - this._size.y * 0.5,
            this._center.z - this._size.z * 0.5
        );
    }


    set min(value: Vector3) {
        this.setMinMax(value, this.max);
    }

    /**
     * Максимальна точка коробки.
     * WARNING: Allocates new Vector3. Use getMax(out) in hot paths.
     */
    get max(): Vector3 {
        return new Vector3(
            this._center.x + this._size.x * 0.5,
            this._center.y + this._size.y * 0.5,
            this._center.z + this._size.z * 0.5
        );
    }

    set max(value: Vector3) {
        this.setMinMax(this.min, value);
    }

    // ==================== ZERO-ALLOCATION GETTERS ====================

    /**
     * Gets extents without allocation.
     * @param out Vector to write result
     */
    getExtents(out: Vector3): Vector3 {
        out.x = this._size.x * 0.5;
        out.y = this._size.y * 0.5;
        out.z = this._size.z * 0.5;
        return out;
    }

    /**
     * Gets min point without allocation.
     * @param out Vector to write result
     */
    getMin(out: Vector3): Vector3 {
        out.x = this._center.x - this._size.x * 0.5;
        out.y = this._center.y - this._size.y * 0.5;
        out.z = this._center.z - this._size.z * 0.5;
        return out;
    }

    /**
     * Gets max point without allocation.
     * @param out Vector to write result
     */
    getMax(out: Vector3): Vector3 {
        out.x = this._center.x + this._size.x * 0.5;
        out.y = this._center.y + this._size.y * 0.5;
        out.z = this._center.z + this._size.z * 0.5;
        return out;
    }

    // ==================== INSTANCE METHODS ====================

    /**
     * Встановлює центр та розмір.
     */
    set(center: Vector3, size: Vector3): this {
        this._center.copy(center);
        this._size.copy(size);
        return this;
    }
    /**
     * Встановлює bounds через мінімальну та максимальну точки.
     */
    setMinMax(min: Vector3, max: Vector3): this {
        this._size.set(
            max.x - min.x,
            max.y - min.y,
            max.z - min.z
        );
        this._center.set(
            min.x + this._size.x * 0.5,
            min.y + this._size.y * 0.5,
            min.z + this._size.z * 0.5
        );
        return this;
    }

    /**
     * Копіює значення з іншого Bounds.
     */
    copy(other: Bounds): this {
        this._center.copy(other._center);
        this._size.copy(other._size);
        return this;
    }

    /**
     * Створює копію цього Bounds.
     */
    clone(): Bounds {
        return new Bounds(this._center.clone(), this._size.clone());
    }

    /**
     * Перевіряє, чи містить Bounds вказану точку.
     * Zero-allocation implementation.
     */
    contains(point: Vector3): boolean {
        const cx = this._center.x, cy = this._center.y, cz = this._center.z;
        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;

        return (
            point.x >= cx - hx && point.x <= cx + hx &&
            point.y >= cy - hy && point.y <= cy + hy &&
            point.z >= cz - hz && point.z <= cz + hz
        );
    }

    /**
     * Перевіряє, чи перетинається з іншим Bounds.
     * Zero-allocation implementation.
     */
    intersects(other: Bounds): boolean {
        const ax = this._center.x, ay = this._center.y, az = this._center.z;
        const ahx = this._size.x * 0.5, ahy = this._size.y * 0.5, ahz = this._size.z * 0.5;

        const bx = other._center.x, by = other._center.y, bz = other._center.z;
        const bhx = other._size.x * 0.5, bhy = other._size.y * 0.5, bhz = other._size.z * 0.5;

        return (
            ax - ahx <= bx + bhx && ax + ahx >= bx - bhx &&
            ay - ahy <= by + bhy && ay + ahy >= by - bhy &&
            az - ahz <= bz + bhz && az + ahz >= bz - bhz
        );
    }

    /**
     * Розширює Bounds, щоб включити вказану точку.
     */
    encapsulatePoint(point: Vector3): this {
        // Compute current min/max inline
        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;

        let minX = this._center.x - hx;
        let minY = this._center.y - hy;
        let minZ = this._center.z - hz;
        let maxX = this._center.x + hx;
        let maxY = this._center.y + hy;
        let maxZ = this._center.z + hz;

        // Expand to include point
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        minZ = Math.min(minZ, point.z);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        maxZ = Math.max(maxZ, point.z);

        // Update size and center
        this._size.set(maxX - minX, maxY - minY, maxZ - minZ);
        this._center.set(
            minX + this._size.x * 0.5,
            minY + this._size.y * 0.5,
            minZ + this._size.z * 0.5
        );

        return this;
    }

    /**
     * Розширює Bounds, щоб включити інший Bounds.
     */
    encapsulateBounds(bounds: Bounds): this {
        // Get other bounds min/max
        const ohx = bounds._size.x * 0.5, ohy = bounds._size.y * 0.5, ohz = bounds._size.z * 0.5;
        const oMinX = bounds._center.x - ohx, oMinY = bounds._center.y - ohy, oMinZ = bounds._center.z - ohz;
        const oMaxX = bounds._center.x + ohx, oMaxY = bounds._center.y + ohy, oMaxZ = bounds._center.z + ohz;

        // Get current min/max
        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;
        let minX = this._center.x - hx, minY = this._center.y - hy, minZ = this._center.z - hz;
        let maxX = this._center.x + hx, maxY = this._center.y + hy, maxZ = this._center.z + hz;

        // Expand
        minX = Math.min(minX, oMinX);
        minY = Math.min(minY, oMinY);
        minZ = Math.min(minZ, oMinZ);
        maxX = Math.max(maxX, oMaxX);
        maxY = Math.max(maxY, oMaxY);
        maxZ = Math.max(maxZ, oMaxZ);

        // Update
        this._size.set(maxX - minX, maxY - minY, maxZ - minZ);
        this._center.set(
            minX + this._size.x * 0.5,
            minY + this._size.y * 0.5,
            minZ + this._size.z * 0.5
        );

        return this;
    }

    /**
     * Розширює Bounds, щоб включити точку або інший Bounds.
     * @overload
     */
    encapsulate(point: Vector3): this;
    encapsulate(bounds: Bounds): this;
    encapsulate(pointOrBounds: Vector3 | Bounds): this {
        if (pointOrBounds instanceof Bounds) {
            return this.encapsulateBounds(pointOrBounds);
        } else {
            return this.encapsulatePoint(pointOrBounds);
        }
    }

    /**
     * Розширює Bounds на вказану величину.
     */
    expand(amount: number): this;
    expand(amount: Vector3): this;
    expand(amount: number | Vector3): this {
        if (typeof amount === 'number') {
            this._size.x += amount * 2;
            this._size.y += amount * 2;
            this._size.z += amount * 2;
        } else {
            this._size.x += amount.x * 2;
            this._size.y += amount.y * 2;
            this._size.z += amount.z * 2;
        }
        return this;
    }

    /**
     * Повертає найближчу точку на поверхні або всередині Bounds.
     * @param point Вхідна точка
     * @param out Опціонально вектор для результату
     */
    closestPoint(point: Vector3, out?: Vector3): Vector3 {
        const result = out ?? new Vector3();

        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;
        const minX = this._center.x - hx, minY = this._center.y - hy, minZ = this._center.z - hz;
        const maxX = this._center.x + hx, maxY = this._center.y + hy, maxZ = this._center.z + hz;

        result.set(
            Math.max(minX, Math.min(maxX, point.x)),
            Math.max(minY, Math.min(maxY, point.y)),
            Math.max(minZ, Math.min(maxZ, point.z))
        );

        return result;
    }

    /**
     * Повертає квадрат відстані від точки до найближчої точки Bounds.
     * Zero-allocation implementation.
     */
    sqrDistance(point: Vector3): number {
        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;
        const minX = this._center.x - hx, minY = this._center.y - hy, minZ = this._center.z - hz;
        const maxX = this._center.x + hx, maxY = this._center.y + hy, maxZ = this._center.z + hz;

        // Clamp point to bounds
        const cx = Math.max(minX, Math.min(maxX, point.x));
        const cy = Math.max(minY, Math.min(maxY, point.y));
        const cz = Math.max(minZ, Math.min(maxZ, point.z));

        // Distance squared
        const dx = point.x - cx;
        const dy = point.y - cy;
        const dz = point.z - cz;

        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Перевіряє перетин з променем.
     * @param ray Промінь для перевірки
     * @returns Відстань до точки перетину, або -1 якщо немає перетину
     */
    intersectRay(ray: Ray): number;
    /**
     * Перевіряє перетин з променем (задається напрямом та початком).
     * @param origin Початок променя
     * @param direction Напрямок променя (має бути нормалізований)
     * @returns Відстань до точки перетину, або -1 якщо немає перетину
     */
    intersectRay(origin: Vector3, direction: Vector3): number;
    intersectRay(originOrRay: Vector3 | Ray, direction?: Vector3): number {
        let ox: number, oy: number, oz: number;
        let dx: number, dy: number, dz: number;

        if (originOrRay instanceof Ray) {
            ox = originOrRay.origin.x;
            oy = originOrRay.origin.y;
            oz = originOrRay.origin.z;
            dx = originOrRay.direction.x;
            dy = originOrRay.direction.y;
            dz = originOrRay.direction.z;
        } else {
            ox = originOrRay.x;
            oy = originOrRay.y;
            oz = originOrRay.z;
            dx = direction!.x;
            dy = direction!.y;
            dz = direction!.z;
        }

        // Compute min/max inline
        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;
        const minX = this._center.x - hx, minY = this._center.y - hy, minZ = this._center.z - hz;
        const maxX = this._center.x + hx, maxY = this._center.y + hy, maxZ = this._center.z + hz;

        let tmin = -Infinity;
        let tmax = Infinity;

        // X axis
        if (dx !== 0) {
            const t1 = (minX - ox) / dx;
            const t2 = (maxX - ox) / dx;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (ox < minX || ox > maxX) {
            return -1;
        }

        // Y axis
        if (dy !== 0) {
            const t1 = (minY - oy) / dy;
            const t2 = (maxY - oy) / dy;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (oy < minY || oy > maxY) {
            return -1;
        }

        // Z axis
        if (dz !== 0) {
            const t1 = (minZ - oz) / dz;
            const t2 = (maxZ - oz) / dz;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (oz < minZ || oz > maxZ) {
            return -1;
        }

        if (tmax < 0 || tmin > tmax) {
            return -1;
        }

        return tmin >= 0 ? tmin : tmax;
    }

    /**
     * Порівнює два Bounds на рівність.
     */
    equals(other: Bounds, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this._center.x - other._center.x) < epsilon &&
            Math.abs(this._center.y - other._center.y) < epsilon &&
            Math.abs(this._center.z - other._center.z) < epsilon &&
            Math.abs(this._size.x - other._size.x) < epsilon &&
            Math.abs(this._size.y - other._size.y) < epsilon &&
            Math.abs(this._size.z - other._size.z) < epsilon
        );
    }

    /**
     * Перевіряє чи Bounds порожній (розмір нуль).
     */
    isEmpty(): boolean {
        return this._size.x === 0 && this._size.y === 0 && this._size.z === 0;
    }

    /**
     * Скидає Bounds до початкових значень.
     */
    reset(): this {
        this._center.set(0, 0, 0);
        this._size.set(0, 0, 0);
        return this;
    }

    toString(): string {
        return `Bounds(Center: ${this._center.toString()}, Size: ${this._size.toString()})`;
    }

    // ==================== STATIC METHODS ====================

    /**
     * Створює Bounds з мінімальної та максимальної точок.
     */
    static fromMinMax(min: Vector3, max: Vector3, out?: Bounds): Bounds {
        const bounds = out ?? new Bounds();
        bounds.setMinMax(min, max);
        return bounds;
    }

    /**
     * Створює Bounds, що охоплює набір точок.
     */
    static fromPoints(points: Vector3[], out?: Bounds): Bounds {
        const bounds = out ?? new Bounds();

        if (points.length === 0) {
            bounds.reset();
            return bounds;
        }

        let minX = points[0].x, minY = points[0].y, minZ = points[0].z;
        let maxX = points[0].x, maxY = points[0].y, maxZ = points[0].z;

        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            minZ = Math.min(minZ, p.z);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
            maxZ = Math.max(maxZ, p.z);
        }

        // Set directly to avoid temp vector allocation
        bounds._size.set(maxX - minX, maxY - minY, maxZ - minZ);
        bounds._center.set(
            minX + bounds._size.x * 0.5,
            minY + bounds._size.y * 0.5,
            minZ + bounds._size.z * 0.5
        );

        return bounds;
    }

    /**
     * Об'єднує два Bounds в один.
     */
    static merge(a: Bounds, b: Bounds, out?: Bounds): Bounds {
        const result = out ?? new Bounds();
        result.copy(a);
        result.encapsulateBounds(b);
        return result;
    }

    /**
     * Перевіряє перетин двох Bounds.
     */
    static intersect(a: Bounds, b: Bounds): boolean {
        return a.intersects(b);
    }

    // ==================== THREE.JS ADAPTER METHODS ====================
    // @internal - For engine sync layer only.

    /**
     * @internal
     * Copies values to a Three.js Box3-like object.
     */
    _copyToThreeBox3(threeBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): void {
        const hx = this._size.x * 0.5, hy = this._size.y * 0.5, hz = this._size.z * 0.5;
        threeBox.min.x = this._center.x - hx;
        threeBox.min.y = this._center.y - hy;
        threeBox.min.z = this._center.z - hz;
        threeBox.max.x = this._center.x + hx;
        threeBox.max.y = this._center.y + hy;
        threeBox.max.z = this._center.z + hz;
    }

    /**
     * @internal
     * Copies values from a Three.js Box3-like object.
     */
    _copyFromThreeBox3(threeBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): this {
        this._size.set(
            threeBox.max.x - threeBox.min.x,
            threeBox.max.y - threeBox.min.y,
            threeBox.max.z - threeBox.min.z
        );
        this._center.set(
            threeBox.min.x + this._size.x * 0.5,
            threeBox.min.y + this._size.y * 0.5,
            threeBox.min.z + this._size.z * 0.5
        );
        return this;
    }
}
