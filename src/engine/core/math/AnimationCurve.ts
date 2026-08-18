// path: src/engine/core/math/AnimationCurve.ts

/**
 * Wrap mode for AnimationCurve evaluation outside key range.
 *
 * @remarks Equivalent to Unity's `WrapMode`.
 */
export enum WrapMode {
    /** Clamp to the first/last key value. */
    Clamp = 0,
    /** Loop back to the start (modular repeat). */
    Loop = 1,
    /** Ping-pong between start and end. */
    PingPong = 2,
}

/**
 * Which of a key's tangent weights the evaluator applies.
 *
 * @remarks
 * Equivalent to Unity's `WeightedMode`. A segment is evaluated as a cubic
 * Bezier when either end asks for weighting, and as the cheaper Hermite spline
 * when neither does — the two agree exactly at the default weight of `1/3`, so
 * turning weighting on for an untouched key changes nothing.
 */
export enum WeightedMode {
    /** Neither weight is applied. The default, and Unity's. */
    None = 0,
    /** Apply {@link Keyframe.inWeight}. */
    In = 1,
    /** Apply {@link Keyframe.outWeight}. */
    Out = 2,
    /** Apply both. */
    Both = 3,
}

/**
 * A single keyframe in an {@link AnimationCurve}.
 *
 * Stores a time–value pair plus the tangent data the segments either side of it
 * are built from.
 *
 * @remarks Equivalent to Unity's `Keyframe`.
 */
export class Keyframe {
    /** The time of the keyframe (horizontal axis). */
    public time: number;

    /** The value of the keyframe (vertical axis). */
    public value: number;

    /**
     * The incoming tangent (slope arriving at this key from the left).
     * Units: value-change per time-change (rise/run).
     */
    public inTangent: number;

    /**
     * The outgoing tangent (slope leaving this key toward the right).
     * Units: value-change per time-change (rise/run).
     */
    public outTangent: number;

    /**
     * Incoming weight — how far along the segment this key's tangent reaches.
     *
     * @remarks
     * Applied only when {@link weightedMode} includes {@link WeightedMode.In},
     * which is Unity's rule. Expressed as a fraction of the segment's duration:
     * `1/3` is the default, and the value at which a weighted segment and an
     * unweighted one are the same curve.
     *
     * A larger weight holds the curve nearer this key's tangent for longer
     * before it turns towards the other end; a smaller one lets it turn sooner.
     */
    public inWeight: number;

    /**
     * Outgoing weight. See {@link inWeight}; applied when {@link weightedMode}
     * includes {@link WeightedMode.Out}.
     */
    public outWeight: number;

    /**
     * Which of the two weights the evaluator applies.
     *
     * @remarks
     * Defaults to {@link WeightedMode.None}, so a curve built in code behaves
     * exactly as it did before weights were implemented. A curve authored in
     * Unity carries its own mode, and now draws the shape it was drawn as.
     */
    public weightedMode: WeightedMode;

    /**
     * Creates a new Keyframe.
     *
     * @param time — position on the horizontal axis.
     * @param value — position on the vertical axis.
     * @param inTangent — incoming tangent (default 0 = flat).
     * @param outTangent — outgoing tangent (default 0 = flat).
     */
    constructor(
        time: number,
        value: number,
        inTangent: number = 0,
        outTangent: number = 0,
    ) {
        this.time = time;
        this.value = value;
        this.inTangent = inTangent;
        this.outTangent = outTangent;
        this.inWeight = 1 / 3;
        this.outWeight = 1 / 3;
        this.weightedMode = WeightedMode.None;
    }

    /**
     * Returns a deep copy of this keyframe.
     */
    public clone(): Keyframe {
        const k = new Keyframe(this.time, this.value, this.inTangent, this.outTangent);
        k.inWeight = this.inWeight;
        k.outWeight = this.outWeight;
        k.weightedMode = this.weightedMode;
        return k;
    }
}

// ==================== ANIMATION CURVE ====================

/**
 * A curve of keyframes that can be evaluated at any time.
 *
 * Uses cubic Hermite interpolation between keyframes, matching Unity's
 * `AnimationCurve` behaviour. Supports wrap modes for evaluation outside
 * the key range, and provides factory methods for common curve shapes.
 *
 * @remarks Equivalent to Unity's `AnimationCurve`.
 *
 * @example
 * ```ts
 * // Ease in-out from 0 to 1 over 2 seconds
 * const curve = AnimationCurve.easeInOut(0, 0, 2, 1);
 * const val = curve.evaluate(1.0); // ~0.5
 *
 * // Custom curve
 * const custom = new AnimationCurve(
 *     new Keyframe(0, 0, 0, 2),
 *     new Keyframe(0.5, 1, 0, 0),
 *     new Keyframe(1, 0, -2, 0),
 * );
 * ```
 */
export class AnimationCurve {

    /** The keyframes, always sorted by time ascending. */
    private _keys: Keyframe[];

    /** Wrap mode for times before the first key. */
    public preWrapMode: WrapMode = WrapMode.Clamp;

    /** Wrap mode for times after the last key. */
    public postWrapMode: WrapMode = WrapMode.Clamp;

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates an AnimationCurve from a variable number of keyframes.
     * The keys are sorted by time automatically.
     *
     * @param keys — zero or more Keyframe instances.
     */
    constructor(...keys: Keyframe[]) {
        this._keys = keys.map(k => k.clone());
        this._sortKeys();
    }

    // ==================== KEYS ACCESSORS ====================

    /**
     * The array of keyframes (read-only copy).
     *
     * @remarks Equivalent to Unity's `AnimationCurve.keys`.
     * Returns clones to prevent external mutation. For performance-critical
     * code, use {@link getKey} to read individual keys without cloning all.
     */
    public get keys(): Keyframe[] {
        return this._keys.map(k => k.clone());
    }

    /**
     * Replaces all keyframes. The array is cloned and sorted.
     */
    public set keys(value: Keyframe[]) {
        this._keys = value.map(k => k.clone());
        this._sortKeys();
    }

    /**
     * Returns the number of keyframes.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.length`.
     */
    public get length(): number {
        return this._keys.length;
    }

    /**
     * The time of the first keyframe, or 0 if empty.
     */
    public get startTime(): number {
        return this._keys.length > 0 ? this._keys[0].time : 0;
    }

    /**
     * The time of the last keyframe, or 0 if empty.
     */
    public get endTime(): number {
        return this._keys.length > 0 ? this._keys[this._keys.length - 1].time : 0;
    }

    /**
     * The total duration (endTime − startTime).
     */
    public get duration(): number {
        return this.endTime - this.startTime;
    }

    // ==================== KEY MANAGEMENT ====================

    /**
     * Returns a clone of the keyframe at the given index.
     *
     * @param index — zero-based index.
     * @throws RangeError if index is out of bounds.
     */
    public getKey(index: number): Keyframe {
        if (index < 0 || index >= this._keys.length) {
            throw new RangeError(`Keyframe index ${index} out of range [0, ${this._keys.length - 1}]`);
        }
        return this._keys[index].clone();
    }

    /**
     * Adds a keyframe and returns its index after sorting.
     * If a key already exists at the same time, it is replaced.
     *
     * @param key — the keyframe to add.
     * @returns the sorted index of the inserted key.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.AddKey()`.
     */
    public addKey(key: Keyframe): number;
    /**
     * Adds a keyframe with auto-tangents at the given time and value.
     *
     * @param time — keyframe time.
     * @param value — keyframe value.
     * @returns the sorted index of the inserted key.
     */
    public addKey(time: number, value: number): number;
    public addKey(keyOrTime: Keyframe | number, value?: number): number {
        let key: Keyframe;
        if (keyOrTime instanceof Keyframe) {
            key = keyOrTime.clone();
        } else {
            key = new Keyframe(keyOrTime, value!);
        }

        // Replace existing key at the same time
        const existing = this._keys.findIndex(k => Math.abs(k.time - key.time) < 1e-7);
        if (existing !== -1) {
            this._keys[existing] = key;
            return existing;
        }

        this._keys.push(key);
        this._sortKeys();

        // Auto-smooth tangents for the simple (time, value) overload
        if (!(keyOrTime instanceof Keyframe)) {
            const idx = this._keys.indexOf(key);
            this._autoSmoothTangent(idx);
        }

        return this._keys.indexOf(key);
    }

    /**
     * Removes the keyframe at the given index.
     *
     * @param index — zero-based index.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.RemoveKey()`.
     */
    public removeKey(index: number): void {
        if (index < 0 || index >= this._keys.length) return;
        this._keys.splice(index, 1);
    }

    /**
     * Moves the keyframe at `index` to a new time/value, re-sorting as needed.
     * Returns the new index after sort.
     *
     * @param index — current index.
     * @param key — new keyframe data.
     * @returns the new sorted index.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.MoveKey()`.
     */
    public moveKey(index: number, key: Keyframe): number {
        if (index < 0 || index >= this._keys.length) return index;
        this._keys[index] = key.clone();
        this._sortKeys();
        return this._keys.findIndex(k => Math.abs(k.time - key.time) < 1e-7);
    }

    /**
     * Removes all keyframes.
     */
    public clear(): void {
        this._keys.length = 0;
    }

    // ==================== EVALUATION ====================

    /**
     * Evaluates the curve at the given time using cubic Hermite interpolation.
     *
     * Handles wrap modes for times outside the keyframe range.
     *
     * @param time — the time to evaluate at.
     * @returns the interpolated value.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.Evaluate()`.
     */
    public evaluate(time: number): number {
        const n = this._keys.length;
        if (n === 0) return 0;
        if (n === 1) return this._keys[0].value;

        const first = this._keys[0];
        const last = this._keys[n - 1];

        // Apply wrap mode
        time = this._wrapTime(time, first.time, last.time);

        // Clamp edges
        if (time <= first.time) return first.value;
        if (time >= last.time) return last.value;

        // Binary search for the segment [i, i+1] containing `time`
        let lo = 0;
        let hi = n - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >>> 1;
            if (this._keys[mid].time <= time) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        const k0 = this._keys[lo];
        const k1 = this._keys[hi];

        return AnimationCurve._segment(k0, k1, time);
    }

    // ==================== STATIC FACTORIES ====================

    /**
     * Creates a linear curve from `(timeStart, valueStart)` to `(timeEnd, valueEnd)`.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.Linear()`.
     */
    public static linear(timeStart: number, valueStart: number, timeEnd: number, valueEnd: number): AnimationCurve {
        const dt = timeEnd - timeStart;
        const dv = valueEnd - valueStart;
        const slope = dt !== 0 ? dv / dt : 0;

        return new AnimationCurve(
            new Keyframe(timeStart, valueStart, slope, slope),
            new Keyframe(timeEnd, valueEnd, slope, slope),
        );
    }

    /**
     * Creates a smooth ease-in-out curve from `(timeStart, valueStart)` to `(timeEnd, valueEnd)`.
     * Tangents are zero at both ends for smooth acceleration and deceleration.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.EaseInOut()`.
     */
    public static easeInOut(timeStart: number, valueStart: number, timeEnd: number, valueEnd: number): AnimationCurve {
        return new AnimationCurve(
            new Keyframe(timeStart, valueStart, 0, 0),
            new Keyframe(timeEnd, valueEnd, 0, 0),
        );
    }

    /**
     * Creates a constant-value curve.
     *
     * @param timeStart — start time.
     * @param timeEnd — end time.
     * @param value — the constant value.
     *
     * @remarks Equivalent to Unity's `AnimationCurve.Constant()`.
     */
    public static constant(timeStart: number, timeEnd: number, value: number): AnimationCurve {
        return new AnimationCurve(
            new Keyframe(timeStart, value, 0, 0),
            new Keyframe(timeEnd, value, 0, 0),
        );
    }

    // ==================== CLONING ====================

    /**
     * Returns a deep copy of this curve.
     */
    public clone(): AnimationCurve {
        const curve = new AnimationCurve();
        curve._keys = this._keys.map(k => k.clone());
        curve.preWrapMode = this.preWrapMode;
        curve.postWrapMode = this.postWrapMode;
        return curve;
    }

    // ==================== PRIVATE HELPERS ====================

    /** Sorts keys by time ascending. */
    private _sortKeys(): void {
        this._keys.sort((a, b) => a.time - b.time);
    }

    /**
     * Applies wrap modes to transform `time` into the key range.
     */
    private _wrapTime(time: number, start: number, end: number): number {
        if (time >= start && time <= end) return time;

        const duration = end - start;
        if (duration <= 0) return start;

        const mode = time < start ? this.preWrapMode : this.postWrapMode;

        switch (mode) {
            case WrapMode.Clamp:
                return time < start ? start : end;

            case WrapMode.Loop: {
                const t = ((time - start) % duration + duration) % duration;
                return start + t;
            }

            case WrapMode.PingPong: {
                const t = ((time - start) % duration + duration) % duration;
                const cycles = Math.floor(((time - start) / duration));
                // Odd cycle → reverse
                return (cycles & 1) !== 0 ? end - t : start + t;
            }

            default:
                return time;
        }
    }

    /**
     * Cubic Hermite interpolation between two keyframes.
     *
     * Given keyframes k0 and k1 and a time t in [k0.time, k1.time],
     * returns the Hermite spline value.
     *
     * The standard Hermite basis:
     *   h00(s) = 2s³ − 3s² + 1
     *   h10(s) = s³ − 2s² + s
     *   h01(s) = −2s³ + 3s²
     *   h11(s) = s³ − s²
     *
     * p(s) = h00·v0 + h10·(dt·m0) + h01·v1 + h11·(dt·m1)
     *
     * where s = (t − t0) / (t1 − t0), dt = t1 − t0,
     * m0 = k0.outTangent, m1 = k1.inTangent.
     */
    /**
     * Evaluates one segment, weighted or not.
     *
     * @remarks
     * Unity's rule: the segment is a cubic Bezier when either end asks for
     * weighting, and a Hermite spline otherwise. The two are the same curve at
     * the default weight of `1/3`, so this is a fast path rather than a
     * different answer — the unweighted branch exists because it costs a
     * handful of multiplies instead of a root solve.
     */
    private static _segment(k0: Keyframe, k1: Keyframe, time: number): number {
        const weightedOut = (k0.weightedMode & WeightedMode.Out) !== 0;
        const weightedIn = (k1.weightedMode & WeightedMode.In) !== 0;
        if (!weightedOut && !weightedIn) return AnimationCurve._hermite(k0, k1, time);

        return AnimationCurve._weighted(
            k0, k1, time,
            weightedOut ? k0.outWeight : 1 / 3,
            weightedIn ? k1.inWeight : 1 / 3,
        );
    }

    /**
     * Evaluates a segment as the cubic Bezier its weights describe.
     *
     * @remarks
     * The control points are the two keys and their tangents extended by the
     * weights:
     *
     * ```
     * P0 = (t0, v0)
     * P1 = (t0 + dt·w0, v0 + dt·w0·m0)
     * P2 = (t1 − dt·w1, v1 − dt·w1·m1)
     * P3 = (t1, v1)
     * ```
     *
     * A Bezier is parameterised by `u`, not by time, so evaluating at a *time*
     * means first finding the `u` whose x-coordinate is that time. That root
     * solve is the whole reason weighting is more than a change of formula, and
     * why the unweighted path is kept.
     */
    private static _weighted(
        k0: Keyframe,
        k1: Keyframe,
        time: number,
        w0: number,
        w1: number,
    ): number {
        const dt = k1.time - k0.time;
        if (dt <= 0) return k0.value;

        // Keep x(u) monotonic. Weights that reach past each other would make the
        // segment fold back on itself and give a time more than one value;
        // Unity clamps for the same reason.
        let a = w0 < 0 ? 0 : w0 > 1 ? 1 : w0;
        let b = w1 < 0 ? 0 : w1 > 1 ? 1 : w1;
        const sum = a + b;
        if (sum > 1) { a /= sum; b /= sum; }

        const s = (time - k0.time) / dt;
        const u = AnimationCurve._solveBezierParam(s, a, b);

        const y1 = k0.value + dt * a * k0.outTangent;
        const y2 = k1.value - dt * b * k1.inTangent;

        const omu = 1 - u;
        return omu * omu * omu * k0.value
            + 3 * omu * omu * u * y1
            + 3 * omu * u * u * y2
            + u * u * u * k1.value;
    }

    /**
     * Finds the Bezier parameter whose normalized x-coordinate is `s`.
     *
     * @remarks
     * Bisection rather than Newton: x is monotonic once the weights are
     * clamped, so bisection cannot diverge, and 24 halvings of [0, 1] land
     * within 6e-8 — far below anything an animation can show. Newton would be
     * faster and would need a guard against a zero derivative at the ends,
     * which is a worse trade for a method that has to be right at `t = 0`.
     */
    private static _solveBezierParam(s: number, w0: number, w1: number): number {
        if (s <= 0) return 0;
        if (s >= 1) return 1;

        let lo = 0;
        let hi = 1;
        let u = s;

        for (let i = 0; i < 24; i++) {
            const omu = 1 - u;
            const x = 3 * omu * omu * u * w0
                + 3 * omu * u * u * (1 - w1)
                + u * u * u;
            if (x < s) lo = u; else hi = u;
            u = (lo + hi) * 0.5;
        }

        return u;
    }

    private static _hermite(k0: Keyframe, k1: Keyframe, time: number): number {
        const dt = k1.time - k0.time;
        if (dt <= 0) return k0.value;

        const s = (time - k0.time) / dt;
        const s2 = s * s;
        const s3 = s2 * s;

        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;

        return h00 * k0.value
            + h10 * dt * k0.outTangent
            + h01 * k1.value
            + h11 * dt * k1.inTangent;
    }

    /**
     * Computes a smooth tangent for the key at `index` based on its neighbours.
     * Uses the Catmull-Rom formula: tangent = (next.value − prev.value) / (next.time − prev.time).
     */
    private _autoSmoothTangent(index: number): void {
        const n = this._keys.length;
        if (n < 2 || index < 0 || index >= n) return;

        const key = this._keys[index];

        if (index === 0) {
            // First key: slope toward next
            const next = this._keys[1];
            const dt = next.time - key.time;
            const slope = dt > 0 ? (next.value - key.value) / dt : 0;
            key.inTangent = slope;
            key.outTangent = slope;
        } else if (index === n - 1) {
            // Last key: slope from prev
            const prev = this._keys[n - 2];
            const dt = key.time - prev.time;
            const slope = dt > 0 ? (key.value - prev.value) / dt : 0;
            key.inTangent = slope;
            key.outTangent = slope;
        } else {
            // Interior key: Catmull-Rom
            const prev = this._keys[index - 1];
            const next = this._keys[index + 1];
            const dt = next.time - prev.time;
            const slope = dt > 0 ? (next.value - prev.value) / dt : 0;
            key.inTangent = slope;
            key.outTangent = slope;
        }
    }
}