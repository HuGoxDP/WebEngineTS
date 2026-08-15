// path: src/engine/math/Rect.ts

import { Vector2 } from './Vector2';
import { EngineSettings } from '../EngineSettings';

/**
 * Rect.ts
 * Represents a rectangle in 2D space.
 * Used for: camera viewport, UI elements, sprite bounds, texture coordinates.
 *
 * @remarks
 * Rect is described by position (x, y) and size (width, height), where (x, y) is
 * the corner with the lower coordinate on each axis.
 *
 * **Axis convention:** Rect is deliberately convention-neutral — it stores
 * numbers and does min/max arithmetic, and never assumes which screen direction
 * +Y points in. Its consumers disagree on purpose:
 * - Camera viewports and sprite bounds are **Y-up**, so `yMin` is the bottom edge.
 * - Canvas UI (`RectTransform`, `Canvas`) is **Y-down** (top-left origin, CSS
 *   convention), so `yMin` is the *top* edge there.
 *
 * Members are therefore documented as "lower/upper Y", not "bottom/top". See
 * {@link RectTransform} for the UI coordinate system.
 *
 * API matches Unity Rect as closely as possible.
 */
export class Rect {
    /** X coordinate of the left edge */
    public x: number;
    /** Y coordinate of the lower-Y edge (bottom when Y-up, top when Y-down) */
    public y: number;
    /** Width of the rectangle */
    public width: number;
    /** Height of the rectangle */
    public height: number;

    // ==================== CACHED READONLY INSTANCES ====================

    private static readonly _zero = Object.freeze(new Rect(0, 0, 0, 0));

    /**
     * Creates a new Rect.
     * @param x X coordinate (left edge)
     * @param y Y coordinate (lower-Y edge)
     * @param width Width
     * @param height Height
     */
    constructor(x: number = 0, y: number = 0, width: number = 0, height: number = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    // ==================== PROPERTIES ====================

    /** Minimum X coordinate (left edge) */
    get xMin(): number {
        return this.x;
    }

    set xMin(value: number) {
        const xMax = this.xMax;
        this.x = value;
        this.width = xMax - this.x;
    }

    /** Maximum X coordinate (right edge) */
    get xMax(): number {
        return this.x + this.width;
    }

    set xMax(value: number) {
        this.width = value - this.x;
    }

    /** Minimum Y coordinate (bottom edge when Y-up, top edge when Y-down) */
    get yMin(): number {
        return this.y;
    }

    set yMin(value: number) {
        const yMax = this.yMax;
        this.y = value;
        this.height = yMax - this.y;
    }

    /** Maximum Y coordinate (top edge when Y-up, bottom edge when Y-down) */
    get yMax(): number {
        return this.y + this.height;
    }

    set yMax(value: number) {
        this.height = value - this.y;
    }

    /**
     * Position of the rectangle (the lower-coordinate corner on both axes).
     * WARNING: Allocates new Vector2. Use getPosition(out) in hot paths.
     */
    get position(): Vector2 {
        return new Vector2(this.x, this.y);
    }

    set position(value: Vector2) {
        this.x = value.x;
        this.y = value.y;
    }

    /**
     * Size of the rectangle.
     * WARNING: Allocates new Vector2. Use getSize(out) in hot paths.
     */
    get size(): Vector2 {
        return new Vector2(this.width, this.height);
    }

    set size(value: Vector2) {
        this.width = value.x;
        this.height = value.y;
    }

    /**
     * Center of the rectangle.
     * WARNING: Allocates new Vector2. Use getCenter(out) in hot paths.
     */
    get center(): Vector2 {
        return new Vector2(
            this.x + this.width * 0.5,
            this.y + this.height * 0.5
        );
    }

    set center(value: Vector2) {
        this.x = value.x - this.width * 0.5;
        this.y = value.y - this.height * 0.5;
    }

    /**
     * Minimum point (lower X and lower Y).
     * WARNING: Allocates new Vector2. Use getMin(out) in hot paths.
     */
    get min(): Vector2 {
        return new Vector2(this.xMin, this.yMin);
    }

    set min(value: Vector2) {
        this.xMin = value.x;
        this.yMin = value.y;
    }

    /**
     * Maximum point (upper X and upper Y).
     * WARNING: Allocates new Vector2. Use getMax(out) in hot paths.
     */
    get max(): Vector2 {
        return new Vector2(this.xMax, this.yMax);
    }

    set max(value: Vector2) {
        this.xMax = value.x;
        this.yMax = value.y;
    }

    // ==================== ZERO-ALLOCATION GETTERS ====================

    /**
     * Gets position without allocation.
     * @param out Vector to write result
     */
    getPosition(out: Vector2): Vector2 {
        out.x = this.x;
        out.y = this.y;
        return out;
    }

    /**
     * Gets size without allocation.
     * @param out Vector to write result
     */
    getSize(out: Vector2): Vector2 {
        out.x = this.width;
        out.y = this.height;
        return out;
    }

    /**
     * Gets center without allocation.
     * @param out Vector to write result
     */
    getCenter(out: Vector2): Vector2 {
        out.x = this.x + this.width * 0.5;
        out.y = this.y + this.height * 0.5;
        return out;
    }

    /**
     * Gets min point without allocation.
     * @param out Vector to write result
     */
    getMin(out: Vector2): Vector2 {
        out.x = this.xMin;
        out.y = this.yMin;
        return out;
    }

    /**
     * Gets max point without allocation.
     * @param out Vector to write result
     */
    getMax(out: Vector2): Vector2 {
        out.x = this.xMax;
        out.y = this.yMax;
        return out;
    }

    // ==================== SET METHODS ====================

    /**
     * Sets the coordinates and size of the rectangle.
     * @param x X coordinate
     * @param y Y coordinate
     * @param width Width
     * @param height Height
     * @returns this for chaining
     */
    set(x: number, y: number, width: number, height: number): this {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        return this;
    }

    /**
     * Copies values from another Rect.
     * @param other Rect to copy from
     * @returns this for chaining
     */
    copy(other: Rect): this {
        this.x = other.x;
        this.y = other.y;
        this.width = other.width;
        this.height = other.height;
        return this;
    }

    /**
     * Creates a copy of this Rect.
     */
    clone(): Rect {
        return new Rect(this.x, this.y, this.width, this.height);
    }

    // ==================== CHECK METHODS ====================

    /**
     * Checks if the rectangle contains the specified point.
     * @param point Point to check
     * @param allowInverse If true, handles rectangles with negative sizes
     * @returns true if point is inside or on the edge
     */
    contains(point: Vector2, allowInverse: boolean = false): boolean {
        if (!allowInverse) {
            return (
                point.x >= this.xMin &&
                point.x <= this.xMax &&
                point.y >= this.yMin &&
                point.y <= this.yMax
            );
        } else {
            // Handle negative sizes
            const minX = Math.min(this.x, this.x + this.width);
            const maxX = Math.max(this.x, this.x + this.width);
            const minY = Math.min(this.y, this.y + this.height);
            const maxY = Math.max(this.y, this.y + this.height);

            return (
                point.x >= minX &&
                point.x <= maxX &&
                point.y >= minY &&
                point.y <= maxY
            );
        }
    }

    /**
     * Checks if this rectangle overlaps with another.
     * @param other Other Rect to check
     * @param allowInverse If true, handles rectangles with negative sizes
     * @returns true if there is overlap
     */
    overlaps(other: Rect, allowInverse: boolean = false): boolean {
        if (!allowInverse) {
            return (
                this.xMin < other.xMax &&
                this.xMax > other.xMin &&
                this.yMin < other.yMax &&
                this.yMax > other.yMin
            );
        } else {
            // Handle negative sizes
            const thisMinX = Math.min(this.x, this.x + this.width);
            const thisMaxX = Math.max(this.x, this.x + this.width);
            const thisMinY = Math.min(this.y, this.y + this.height);
            const thisMaxY = Math.max(this.y, this.y + this.height);

            const otherMinX = Math.min(other.x, other.x + other.width);
            const otherMaxX = Math.max(other.x, other.x + other.width);
            const otherMinY = Math.min(other.y, other.y + other.height);
            const otherMaxY = Math.max(other.y, other.y + other.height);

            return (
                thisMinX < otherMaxX &&
                thisMaxX > otherMinX &&
                thisMinY < otherMaxY &&
                thisMaxY > otherMinY
            );
        }
    }

    // ==================== UTILITIES ====================

    /**
     * Compares two Rects for equality.
     * @param other Other Rect to compare
     * @param epsilon Comparison tolerance
     */
    equals(other: Rect, epsilon: number = EngineSettings.Math.EPSILON): boolean {
        return (
            Math.abs(this.x - other.x) < epsilon &&
            Math.abs(this.y - other.y) < epsilon &&
            Math.abs(this.width - other.width) < epsilon &&
            Math.abs(this.height - other.height) < epsilon
        );
    }

    /**
     * Returns string representation of the Rect.
     */
    toString(): string {
        return `Rect(x: ${this.x.toFixed(2)}, y: ${this.y.toFixed(2)}, width: ${this.width.toFixed(2)}, height: ${this.height.toFixed(2)})`;
    }

    // ==================== STATIC METHODS ====================

    /**
     * Creates a Rect from min and max coordinates.
     * @param xMin Minimum X coordinate
     * @param yMin Minimum Y coordinate
     * @param xMax Maximum X coordinate
     * @param yMax Maximum Y coordinate
     * @param out Optional Rect to reuse
     */
    static minMaxRect(xMin: number, yMin: number, xMax: number, yMax: number, out?: Rect): Rect {
        const rect = out ?? new Rect();
        rect.x = xMin;
        rect.y = yMin;
        rect.width = xMax - xMin;
        rect.height = yMax - yMin;
        return rect;
    }

    /**
     * Creates a Rect from center and size.
     * @param center Center of the rectangle
     * @param size Size of the rectangle
     * @param out Optional Rect to reuse
     */
    static fromCenterSize(center: Vector2, size: Vector2, out?: Rect): Rect {
        const rect = out ?? new Rect();
        rect.x = center.x - size.x * 0.5;
        rect.y = center.y - size.y * 0.5;
        rect.width = size.x;
        rect.height = size.y;
        return rect;
    }

    /**
     * Creates a Rect from position and size.
     * @param position Position (the lower-coordinate corner on both axes)
     * @param size Size
     * @param out Optional Rect to reuse
     */
    static fromPositionSize(position: Vector2, size: Vector2, out?: Rect): Rect {
        const rect = out ?? new Rect();
        rect.x = position.x;
        rect.y = position.y;
        rect.width = size.x;
        rect.height = size.y;
        return rect;
    }

    /**
     * Finds normalized coordinates of a point relative to the rectangle.
     * Returns (0,0) at ({@link xMin}, {@link yMin}) and (1,1) at
     * ({@link xMax}, {@link yMax}) — which corner that is on screen depends on
     * the caller's axis convention.
     * @param rect Rectangle
     * @param point Point
     * @param out Optional Vector2 to reuse
     */
    static pointToNormalized(rect: Rect, point: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = rect.width !== 0 ? (point.x - rect.x) / rect.width : 0;
        result.y = rect.height !== 0 ? (point.y - rect.y) / rect.height : 0;
        return result;
    }

    /**
     * Finds a point from normalized coordinates.
     * @param rect Rectangle
     * @param normalizedPoint Normalized coordinates (0-1)
     * @param out Optional Vector2 to reuse
     */
    static normalizedToPoint(rect: Rect, normalizedPoint: Vector2, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();
        result.x = rect.x + normalizedPoint.x * rect.width;
        result.y = rect.y + normalizedPoint.y * rect.height;
        return result;
    }

    /**
     * Creates a Rect that contains both specified rectangles.
     * @param a First Rect
     * @param b Second Rect
     * @param out Optional Rect to reuse
     */
    static union(a: Rect, b: Rect, out?: Rect): Rect {
        const xMin = Math.min(a.xMin, b.xMin);
        const yMin = Math.min(a.yMin, b.yMin);
        const xMax = Math.max(a.xMax, b.xMax);
        const yMax = Math.max(a.yMax, b.yMax);
        return Rect.minMaxRect(xMin, yMin, xMax, yMax, out);
    }

    /**
     * Creates a Rect that is the intersection of two rectangles.
     * If no intersection, returns a Rect with zero size.
     * @param a First Rect
     * @param b Second Rect
     * @param out Optional Rect to reuse
     */
    static intersection(a: Rect, b: Rect, out?: Rect): Rect {
        const rect = out ?? new Rect();
        const xMin = Math.max(a.xMin, b.xMin);
        const yMin = Math.max(a.yMin, b.yMin);
        const xMax = Math.min(a.xMax, b.xMax);
        const yMax = Math.min(a.yMax, b.yMax);

        // No intersection
        if (xMin >= xMax || yMin >= yMax) {
            rect.set(0, 0, 0, 0);
            return rect;
        }

        rect.x = xMin;
        rect.y = yMin;
        rect.width = xMax - xMin;
        rect.height = yMax - yMin;
        return rect;
    }

    // ==================== STATIC CONSTANTS ====================

    /**
     * Returns (0, 0, 0, 0). Shared instance — do not mutate!
     */
    static get zero(): Rect {
        return Rect._zero;
    }
}
