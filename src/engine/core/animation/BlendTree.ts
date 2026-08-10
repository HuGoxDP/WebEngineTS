import { Vector2 } from "../math/Vector2";
import type { AnimationClip } from "./AnimationClip";

/** How a {@link BlendTree} turns its parameters into per-clip weights. */
export enum BlendTreeType {
    /**
     * One parameter, children placed on a line by threshold.
     *
     * @remarks
     * Equivalent to Unity's `1D` blend tree. The two children bracketing the
     * parameter share the weight; outside the range the nearest child takes it
     * all.
     */
    Simple1D = "Simple1D",
    /**
     * Two parameters, children placed on a plane.
     *
     * @remarks
     * Equivalent to Unity's `2D Freeform Cartesian`, using the same gradient
     * band interpolation: each child's weight falls off along the direction of
     * every other child, and the smallest of those falloffs wins. Unlike
     * inverse-distance weighting, a child contributes nothing once another
     * child sits between it and the sample point, which is what keeps a
     * strafe-blend from bleeding the backward clip into a forward run.
     */
    FreeformCartesian2D = "FreeformCartesian2D",
}

/** One motion inside a {@link BlendTree}. */
export interface BlendTreeChild {
    /** The clip this child plays. */
    readonly clip: AnimationClip;
    /** Position along the blend parameter. Used by {@link BlendTreeType.Simple1D}. */
    readonly threshold: number;
    /** Position on the blend plane. Used by {@link BlendTreeType.FreeformCartesian2D}. */
    readonly position: Vector2;
}

/**
 * Blends several clips at once from one or two parameters.
 *
 * @remarks
 * Equivalent to Unity's blend tree. An {@link AnimatorState} plays either a
 * single clip or one of these; the difference between them is the difference
 * between switching from walk to run and *speeding up*.
 *
 * ```ts
 * const locomotion = new BlendTree("Locomotion", BlendTreeType.Simple1D);
 * locomotion.blendParameter = "Speed";
 * locomotion.addChild(idleClip, 0);
 * locomotion.addChild(walkClip, 2);
 * locomotion.addChild(runClip, 6);
 *
 * animator.addState("Locomotion", locomotion);
 * ```
 *
 * Weights are recomputed every frame from the animator's parameters and always
 * sum to 1, so a tree can be sampled with the parameter anywhere — including
 * outside the range its children cover.
 *
 * Children are **time-synchronized** by default ({@link synchronizeTime}): every
 * clip is time-scaled so one cycle takes the same weighted-average duration.
 * Without it a walk of 1s blended with a run of 0.6s drifts out of phase within
 * a second and the feet slide.
 */
export class BlendTree {

    /** Name of this tree, used as the state's motion name. */
    public readonly name: string;

    /** How weights are computed. */
    public readonly type: BlendTreeType;

    /** Parameter driving the blend — the X axis for a 2D tree. */
    public blendParameter: string = "Blend";

    /** Second parameter, the Y axis. Ignored by a 1D tree. */
    public blendParameterY: string = "BlendY";

    /**
     * Whether children are time-scaled to a common cycle length.
     *
     * @remarks
     * Equivalent to Unity's homogeneous speed. Defaults to true; turn it off
     * for a tree whose clips are unrelated in length and are not meant to stay
     * in step (a blend between facial expressions, say).
     */
    public synchronizeTime: boolean = true;

    private readonly _children: BlendTreeChild[] = [];

    /** Scratch for the 2D sample point, so evaluation allocates nothing. */
    private static readonly _sample: Vector2 = new Vector2(0, 0);

    constructor(name: string, type: BlendTreeType = BlendTreeType.Simple1D) {
        this.name = name;
        this.type = type;
    }

    /** The motions in this tree. 1D children are kept sorted by threshold. */
    public get children(): ReadonlyArray<BlendTreeChild> { return this._children; }

    /** Every clip this tree can play. */
    public get clips(): AnimationClip[] {
        return this._children.map(c => c.clip);
    }

    /**
     * Adds a motion at a position along the blend parameter.
     *
     * @remarks
     * Insertion keeps the list sorted by threshold, which is what makes
     * evaluation a scan for the bracketing pair rather than a sort per frame.
     *
     * @param clip - the clip to play.
     * @param threshold - where it sits on the blend parameter.
     * @param position - where it sits on the blend plane, for a 2D tree.
     *                   Defaults to `(threshold, 0)`.
     */
    public addChild(clip: AnimationClip, threshold: number, position?: Vector2): BlendTreeChild {
        const child: BlendTreeChild = {
            clip,
            threshold,
            position: position ? new Vector2(position.x, position.y) : new Vector2(threshold, 0),
        };

        let index = this._children.length;
        while (index > 0 && this._children[index - 1].threshold > threshold) index--;
        this._children.splice(index, 0, child);
        return child;
    }

    /**
     * Adds a motion at a position on the blend plane.
     *
     * @remarks
     * The 2D form of {@link addChild}; the threshold is taken from `x`, so a
     * tree built this way still evaluates sensibly if it is read as 1D.
     *
     * @param clip - the clip to play.
     * @param position - where it sits on the blend plane.
     */
    public addChild2D(clip: AnimationClip, position: Vector2): BlendTreeChild {
        return this.addChild(clip, position.x, position);
    }

    /**
     * Computes each clip's weight for the current parameters.
     *
     * @remarks
     * Runs every frame, so it writes into the caller's map rather than
     * returning a new one. Weights are normalized to sum to 1; a tree with no
     * children writes nothing. Two children sharing a clip name have their
     * weights summed, since the name is what the {@link Animation} plays.
     *
     * @param params - the animator's parameters.
     * @param out - cleared, then filled with clip name → weight.
     */
    public evaluate(params: ReadonlyMap<string, number | boolean>, out: Map<string, number>): void {
        out.clear();
        if (this._children.length === 0) return;

        const weights = this.type === BlendTreeType.FreeformCartesian2D
            ? this._weights2D(params)
            : this._weights1D(params);

        let total = 0;
        for (let i = 0; i < weights.length; i++) total += weights[i];
        if (total <= 0) return;

        for (let i = 0; i < weights.length; i++) {
            if (weights[i] <= 0) continue;
            const name = this._children[i].clip.name;
            out.set(name, (out.get(name) ?? 0) + weights[i] / total);
        }
    }

    /** Per-child weight buffer, reused across frames. */
    private _weights: number[] = [];

    private _weightBuffer(): number[] {
        const buffer = this._weights;
        buffer.length = this._children.length;
        buffer.fill(0);
        return buffer;
    }

    private _weights1D(params: ReadonlyMap<string, number | boolean>): number[] {
        const weights = this._weightBuffer();
        const value = BlendTree._number(params.get(this.blendParameter));
        const last = this._children.length - 1;

        if (value <= this._children[0].threshold) {
            weights[0] = 1;
            return weights;
        }
        if (value >= this._children[last].threshold) {
            weights[last] = 1;
            return weights;
        }

        for (let i = 0; i < last; i++) {
            const lo = this._children[i].threshold;
            const hi = this._children[i + 1].threshold;
            if (value < lo || value > hi) continue;

            // Children may share a threshold; splitting the weight evenly beats
            // dividing by zero.
            const span = hi - lo;
            const t = span > 0 ? (value - lo) / span : 0.5;
            weights[i] = 1 - t;
            weights[i + 1] = t;
            return weights;
        }

        return weights;
    }

    private _weights2D(params: ReadonlyMap<string, number | boolean>): number[] {
        const weights = this._weightBuffer();
        const sample = BlendTree._sample;
        sample.x = BlendTree._number(params.get(this.blendParameter));
        sample.y = BlendTree._number(params.get(this.blendParameterY));

        const count = this._children.length;
        if (count === 1) {
            weights[0] = 1;
            return weights;
        }

        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        let total = 0;

        for (let i = 0; i < count; i++) {
            const pi = this._children[i].position;
            const sx = sample.x - pi.x;
            const sy = sample.y - pi.y;

            const distance = sx * sx + sy * sy;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }

            let weight = 1;
            for (let j = 0; j < count && weight > 0; j++) {
                if (j === i) continue;
                const pj = this._children[j].position;
                const dx = pj.x - pi.x;
                const dy = pj.y - pi.y;
                const lengthSq = dx * dx + dy * dy;
                if (lengthSq <= 0) continue;

                const along = (sx * dx + sy * dy) / lengthSq;
                const falloff = 1 - along;
                if (falloff < weight) weight = falloff;
            }

            weights[i] = weight > 0 ? weight : 0;
            total += weights[i];
        }

        // Every falloff can cancel out when the sample sits on top of a child
        // that other children surround; the nearest one is then the answer.
        if (total <= 0) weights[best] = 1;
        return weights;
    }

    private static _number(value: number | boolean | undefined): number {
        if (typeof value === "number") return value;
        if (typeof value === "boolean") return value ? 1 : 0;
        return 0;
    }
}
