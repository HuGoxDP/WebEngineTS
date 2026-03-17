// path: src/engine/core/math/Mathf.ts

/**
 * A collection of common math functions and constants.
 *
 * All members are static — `Mathf` is never instantiated.
 *
 * @remarks Equivalent to Unity's `UnityEngine.Mathf`.
 *
 * @example
 * ```ts
 * const t = Mathf.inverseLerp(0, 100, 75);   // 0.75
 * const v = Mathf.lerp(10, 20, t);            // 17.5
 * const c = Mathf.clamp01(1.5);               // 1
 * ```
 */
export class Mathf {

    // ==================== CONSTANTS ====================

    /** Ratio of a circle's circumference to its diameter (~3.14159). */
    public static readonly PI: number = Math.PI;

    /** Positive infinity. */
    public static readonly Infinity: number = Infinity;

    /** Negative infinity. */
    public static readonly NegativeInfinity: number = -Infinity;

    /** Degrees-to-radians conversion factor (`PI / 180`). */
    public static readonly Deg2Rad: number = Math.PI / 180;

    /** Radians-to-degrees conversion factor (`180 / PI`). */
    public static readonly Rad2Deg: number = 180 / Math.PI;

    /**
     * A small floating-point value for approximate comparisons.
     *
     * @remarks Equivalent to Unity's `Mathf.Epsilon`.
     * Note: Unity's value is ~1.4e-45 (FLT_EPSILON); we use 1e-6
     * which is more practical for game math in JS (double precision).
     */
    public static readonly Epsilon: number = 0.000001;

    // ==================== CLAMPING ====================

    /**
     * Clamps `value` between `min` and `max`.
     *
     * @remarks Equivalent to Unity's `Mathf.Clamp()`.
     */
    public static clamp(value: number, min: number, max: number): number {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    /**
     * Clamps `value` between 0 and 1.
     *
     * @remarks Equivalent to Unity's `Mathf.Clamp01()`.
     */
    public static clamp01(value: number): number {
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
    }

    // ==================== INTERPOLATION ====================

    /**
     * Linearly interpolates between `a` and `b` by `t`.
     * `t` is clamped to [0, 1].
     *
     * @remarks Equivalent to Unity's `Mathf.Lerp()`.
     */
    public static lerp(a: number, b: number, t: number): number {
        t = Mathf.clamp01(t);
        return a + (b - a) * t;
    }

    /**
     * Linearly interpolates between `a` and `b` by `t` without clamping.
     *
     * @remarks Equivalent to Unity's `Mathf.LerpUnclamped()`.
     */
    public static lerpUnclamped(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    /**
     * Calculates the lerp parameter `t` that produces `value` between `a` and `b`.
     * Result is clamped to [0, 1].
     *
     * @remarks Equivalent to Unity's `Mathf.InverseLerp()`.
     */
    public static inverseLerp(a: number, b: number, value: number): number {
        if (Math.abs(a - b) < Mathf.Epsilon) return 0;
        return Mathf.clamp01((value - a) / (b - a));
    }

    /**
     * Remaps `value` from one range to another.
     *
     * Same as `Lerp(outMin, outMax, InverseLerp(inMin, inMax, value))` but unclamped.
     */
    public static remap(inMin: number, inMax: number, outMin: number, outMax: number, value: number): number {
        const t = (value - inMin) / (inMax - inMin);
        return outMin + (outMax - outMin) * t;
    }

    /**
     * Interpolates between `a` and `b` with smoothing at the limits.
     * `t` is clamped to [0, 1].
     *
     * @remarks Equivalent to Unity's `Mathf.SmoothStep()`.
     * Uses the classic smoothstep polynomial: `3t² − 2t³`.
     */
    public static smoothStep(from: number, to: number, t: number): number {
        t = Mathf.clamp01(t);
        t = t * t * (3 - 2 * t);
        return from + (to - from) * t;
    }

    // ==================== MOVE TOWARDS ====================

    /**
     * Moves `current` toward `target` by at most `maxDelta`.
     *
     * @remarks Equivalent to Unity's `Mathf.MoveTowards()`.
     */
    public static moveTowards(current: number, target: number, maxDelta: number): number {
        if (Math.abs(target - current) <= maxDelta) return target;
        return current + Math.sign(target - current) * maxDelta;
    }

    /**
     * Same as `MoveTowards` but wraps around at 360 degrees.
     *
     * @remarks Equivalent to Unity's `Mathf.MoveTowardsAngle()`.
     */
    public static moveTowardsAngle(current: number, target: number, maxDelta: number): number {
        const delta = Mathf.deltaAngle(current, target);
        if (-maxDelta < delta && delta < maxDelta) return target;
        return Mathf.moveTowards(current, current + delta, maxDelta);
    }

    // ==================== SMOOTH DAMP ====================

    /**
     * Shared mutable array used by {@link smoothDamp} to return both
     * the smoothed value and the updated velocity. Index 0 = value, index 1 = velocity.
     *
     * @internal
     */
    private static readonly _smoothDampResult: [number, number] = [0, 0];

    /**
     * Gradually moves `current` toward `target` over time.
     *
     * Returns a tuple `[smoothedValue, newVelocity]`.
     * Pass the returned velocity back on the next frame.
     *
     * @param current — current position.
     * @param target — target position.
     * @param currentVelocity — current velocity (mutated by reference in Unity; here returned).
     * @param smoothTime — approximate time to reach the target. Smaller = faster.
     * @param maxSpeed — maximum speed clamp.
     * @param deltaTime — time since last call.
     * @returns `[smoothedValue, newVelocity]`
     *
     * @remarks Equivalent to Unity's `Mathf.SmoothDamp()`.
     * Implementation based on Game Programming Gems 4, Chapter 1.10.
     *
     * @example
     * ```ts
     * private _velocity = 0;
     * update() {
     *     const [pos, vel] = Mathf.smoothDamp(
     *         this.transform.position.x,
     *         this._target,
     *         this._velocity,
     *         0.3,
     *         Infinity,
     *         Time.deltaTime
     *     );
     *     this._velocity = vel;
     *     // use pos …
     * }
     * ```
     */
    public static smoothDamp(
        current: number,
        target: number,
        currentVelocity: number,
        smoothTime: number,
        maxSpeed: number = Infinity,
        deltaTime: number,
    ): [number, number] {
        // Minimum smooth time to avoid division by zero
        smoothTime = Math.max(0.0001, smoothTime);
        const omega = 2 / smoothTime;
        const x = omega * deltaTime;
        // Approximation of exp(-x) using Padé (same as Unity)
        const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

        let change = current - target;
        const originalTo = target;

        // Clamp maximum speed
        const maxChange = maxSpeed * smoothTime;
        change = Mathf.clamp(change, -maxChange, maxChange);
        const adjustedTarget = current - change;

        const temp = (currentVelocity + omega * change) * deltaTime;
        let newVelocity = (currentVelocity - omega * temp) * exp;
        let output = adjustedTarget + (change + temp) * exp;

        // Prevent overshooting
        if (originalTo - current > 0 === output > originalTo) {
            output = originalTo;
            newVelocity = (output - originalTo) / deltaTime;
        }

        const result = Mathf._smoothDampResult;
        result[0] = output;
        result[1] = newVelocity;
        return result;
    }

    /**
     * Gradually moves an angle `current` toward `target` (in degrees),
     * wrapping correctly around 360°.
     *
     * Returns `[smoothedAngle, newVelocity]`.
     *
     * @remarks Equivalent to Unity's `Mathf.SmoothDampAngle()`.
     */
    public static smoothDampAngle(
        current: number,
        target: number,
        currentVelocity: number,
        smoothTime: number,
        maxSpeed: number = Infinity,
        deltaTime: number,
    ): [number, number] {
        target = current + Mathf.deltaAngle(current, target);
        return Mathf.smoothDamp(current, target, currentVelocity, smoothTime, maxSpeed, deltaTime);
    }

    // ==================== ANGLES ====================

    /**
     * Calculates the shortest difference between two angles in degrees.
     * Result is in range (−180, 180].
     *
     * @remarks Equivalent to Unity's `Mathf.DeltaAngle()`.
     */
    public static deltaAngle(current: number, target: number): number {
        let delta = ((target - current) % 360 + 540) % 360 - 180;
        return delta;
    }

    /**
     * Linearly interpolates between two angles in degrees,
     * correctly handling the 360° wrap-around.
     * `t` is clamped to [0, 1].
     *
     * @remarks Equivalent to Unity's `Mathf.LerpAngle()`.
     */
    public static lerpAngle(a: number, b: number, t: number): number {
        let delta = Mathf.deltaAngle(a, b);
        return a + delta * Mathf.clamp01(t);
    }

    // ==================== REPEAT / PINGPONG ====================

    /**
     * Loops `t` so that it is never larger than `length` and never smaller than 0.
     *
     * @remarks Equivalent to Unity's `Mathf.Repeat()`.
     */
    public static repeat(t: number, length: number): number {
        return t - Math.floor(t / length) * length;
    }

    /**
     * PingPongs `t` so it goes back and forth between 0 and `length`.
     *
     * @remarks Equivalent to Unity's `Mathf.PingPong()`.
     */
    public static pingPong(t: number, length: number): number {
        t = Mathf.repeat(t, length * 2);
        return length - Math.abs(t - length);
    }

    // ==================== COMPARISON ====================

    /**
     * Returns `true` if `a` and `b` are approximately equal
     * (within a small epsilon that scales with magnitude).
     *
     * @remarks Equivalent to Unity's `Mathf.Approximately()`.
     */
    public static approximately(a: number, b: number): boolean {
        return Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), Mathf.Epsilon * 8);
    }

    // ==================== SIGN / ABS / MIN / MAX ====================

    /**
     * Returns the sign of `f`: −1, 0, or 1.
     *
     * @remarks Equivalent to Unity's `Mathf.Sign()`.
     * Note: Unity returns 1 for 0; we return 0 (JS convention).
     */
    public static sign(f: number): number {
        return Math.sign(f);
    }

    /** Returns the absolute value of `f`. */
    public static abs(f: number): number {
        return Math.abs(f);
    }

    /** Returns the smaller of `a` and `b`. */
    public static min(a: number, b: number): number;
    /** Returns the smallest of all given values. */
    public static min(...values: number[]): number;
    public static min(...values: number[]): number {
        return Math.min(...values);
    }

    /** Returns the larger of `a` and `b`. */
    public static max(a: number, b: number): number;
    /** Returns the largest of all given values. */
    public static max(...values: number[]): number;
    public static max(...values: number[]): number {
        return Math.max(...values);
    }

    // ==================== POWER / ROOT / LOG ====================

    /**
     * Returns `f` raised to power `p`.
     *
     * @remarks Equivalent to Unity's `Mathf.Pow()`.
     */
    public static pow(f: number, p: number): number {
        return Math.pow(f, p);
    }

    /** Returns the square root of `f`. */
    public static sqrt(f: number): number {
        return Math.sqrt(f);
    }

    /** Returns the natural logarithm of `f`. */
    public static log(f: number): number {
        return Math.log(f);
    }

    /** Returns the base-10 logarithm of `f`. */
    public static log10(f: number): number {
        return Math.log10(f);
    }

    /** Returns `e` raised to the power `f`. */
    public static exp(f: number): number {
        return Math.exp(f);
    }

    // ==================== ROUNDING ====================

    /** Returns the largest integer less than or equal to `f`. */
    public static floor(f: number): number {
        return Math.floor(f);
    }

    /** Returns the largest integer less than or equal to `f` (as an integer). */
    public static floorToInt(f: number): number {
        return Math.floor(f) | 0;
    }

    /** Returns the smallest integer greater than or equal to `f`. */
    public static ceil(f: number): number {
        return Math.ceil(f);
    }

    /** Returns the smallest integer greater than or equal to `f` (as an integer). */
    public static ceilToInt(f: number): number {
        return Math.ceil(f) | 0;
    }

    /** Returns `f` rounded to the nearest integer. */
    public static round(f: number): number {
        return Math.round(f);
    }

    /** Returns `f` rounded to the nearest integer (as an integer). */
    public static roundToInt(f: number): number {
        return Math.round(f) | 0;
    }

    // ==================== TRIGONOMETRY ====================

    /** Returns the sine of angle `f` (in radians). */
    public static sin(f: number): number { return Math.sin(f); }

    /** Returns the cosine of angle `f` (in radians). */
    public static cos(f: number): number { return Math.cos(f); }

    /** Returns the tangent of angle `f` (in radians). */
    public static tan(f: number): number { return Math.tan(f); }

    /** Returns the arc-sine of `f` (result in radians). */
    public static asin(f: number): number { return Math.asin(f); }

    /** Returns the arc-cosine of `f` (result in radians). */
    public static acos(f: number): number { return Math.acos(f); }

    /** Returns the arc-tangent of `f` (result in radians). */
    public static atan(f: number): number { return Math.atan(f); }

    /** Returns the angle in radians whose tangent is `y/x`. */
    public static atan2(y: number, x: number): number { return Math.atan2(y, x); }

    // ==================== UTILITY ====================

    /**
     * Returns the next power of two that is >= `value`.
     *
     * @remarks Equivalent to Unity's `Mathf.NextPowerOfTwo()`.
     */
    public static nextPowerOfTwo(value: number): number {
        if (value <= 0) return 1;
        value--;
        value |= value >> 1;
        value |= value >> 2;
        value |= value >> 4;
        value |= value >> 8;
        value |= value >> 16;
        return value + 1;
    }

    /**
     * Returns the closest power of two to `value`.
     *
     * @remarks Equivalent to Unity's `Mathf.ClosestPowerOfTwo()`.
     */
    public static closestPowerOfTwo(value: number): number {
        const next = Mathf.nextPowerOfTwo(value);
        const prev = next >> 1;
        return (value - prev) < (next - value) ? prev : next;
    }

    /**
     * Returns `true` if `value` is a power of two.
     *
     * @remarks Equivalent to Unity's `Mathf.IsPowerOfTwo()`.
     */
    public static isPowerOfTwo(value: number): boolean {
        return value > 0 && (value & (value - 1)) === 0;
    }

    /**
     * Returns the Perlin noise value at coordinates `(x, y)`.
     * Result is approximately in range [0, 1].
     *
     * @remarks Equivalent to Unity's `Mathf.PerlinNoise()`.
     * Uses a simple 2D gradient noise implementation.
     */
    public static perlinNoise(x: number, y: number): number {
        // Ken Perlin's improved noise, simplified for 2D
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);

        const u = Mathf._fade(xf);
        const v = Mathf._fade(yf);

        const p = Mathf._perm;
        const aa = p[(p[xi] + yi) & 255];
        const ab = p[(p[xi] + yi + 1) & 255];
        const ba = p[(p[(xi + 1) & 255] + yi) & 255];
        const bb = p[(p[(xi + 1) & 255] + yi + 1) & 255];

        const x1 = Mathf._lerpN(Mathf._grad2d(aa, xf, yf), Mathf._grad2d(ba, xf - 1, yf), u);
        const x2 = Mathf._lerpN(Mathf._grad2d(ab, xf, yf - 1), Mathf._grad2d(bb, xf - 1, yf - 1), u);

        return (Mathf._lerpN(x1, x2, v) + 1) * 0.5;
    }

    // ==================== GAMMA / LINEAR ====================

    /**
     * Converts a color component from gamma space to linear space.
     *
     * @remarks Equivalent to Unity's `Mathf.GammaToLinearSpace()`.
     */
    public static gammaToLinearSpace(value: number): number {
        if (value <= 0.04045) return value / 12.92;
        return Math.pow((value + 0.055) / 1.055, 2.4);
    }

    /**
     * Converts a color component from linear space to gamma space.
     *
     * @remarks Equivalent to Unity's `Mathf.LinearToGammaSpace()`.
     */
    public static linearToGammaSpace(value: number): number {
        if (value <= 0.0031308) return value * 12.92;
        return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
    }

    // ==================== PRIVATE PERLIN HELPERS ====================

    /** Perlin fade curve: 6t⁵ − 15t⁴ + 10t³. */
    private static _fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    /** Simple linear interpolation (no clamp). */
    private static _lerpN(a: number, b: number, t: number): number {
        return a + t * (b - a);
    }

    /** 2D gradient based on hash. */
    private static _grad2d(hash: number, x: number, y: number): number {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    /**
     * Permutation table for Perlin noise (doubled to avoid wrapping).
     * Standard Ken Perlin permutation.
     */
    private static readonly _perm: Uint8Array = (() => {
        const p = [
            151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
            140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
            247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
            57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
            74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
            60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
            65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
            200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
            52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
            207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
            119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
            129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
            218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
            81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
            184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
            222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
        ];
        const perm = new Uint8Array(512);
        for (let i = 0; i < 256; i++) {
            perm[i] = p[i];
            perm[i + 256] = p[i];
        }
        return perm;
    })();

    // ==================== PRIVATE CONSTRUCTOR ====================

    /** @internal Static-only class, cannot be instantiated. */
    private constructor() {}
}