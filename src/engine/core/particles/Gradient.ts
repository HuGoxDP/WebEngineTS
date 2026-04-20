import { Color } from "../math/Color";
import { GradientMode } from "./ParticleTypes";

/** A single color keyframe in a {@link Gradient}. */
export class GradientColorKey {
    constructor(
        public color: Color,
        /** Time position (0–1). */
        public time: number,
    ) {}
}

/** A single alpha keyframe in a {@link Gradient}. */
export class GradientAlphaKey {
    constructor(
        /** Alpha value (0–1). */
        public alpha: number,
        /** Time position (0–1). */
        public time: number,
    ) {}
}

/**
 * A color gradient used for over-lifetime color interpolation in particles.
 *
 * @remarks
 * Equivalent to Unity's `Gradient`. Color and alpha are interpolated on
 * independent tracks, matching Unity's behavior.
 *
 * ```ts
 * const g = new Gradient();
 * g.setKeys(
 *   [new GradientColorKey(Color.red, 0), new GradientColorKey(Color.yellow, 1)],
 *   [new GradientAlphaKey(1, 0), new GradientAlphaKey(0, 1)],
 * );
 * const c = g.evaluate(0.5);  // orange, alpha 0.5
 * ```
 */
export class Gradient {

    /** Interpolation mode. */
    public mode: GradientMode = GradientMode.Blend;

    private _colorKeys: GradientColorKey[] = [
        new GradientColorKey(Color.white.clone(), 0),
        new GradientColorKey(Color.white.clone(), 1),
    ];

    private _alphaKeys: GradientAlphaKey[] = [
        new GradientAlphaKey(1, 0),
        new GradientAlphaKey(1, 1),
    ];

    /** The color keys, sorted by time. */
    public get colorKeys(): readonly GradientColorKey[] { return this._colorKeys; }

    /** The alpha keys, sorted by time. */
    public get alphaKeys(): readonly GradientAlphaKey[] { return this._alphaKeys; }

    /**
     * Replaces all keys.
     * @param colorKeys Color keys (time 0–1).
     * @param alphaKeys Alpha keys (time 0–1).
     */
    public setKeys(colorKeys: GradientColorKey[], alphaKeys: GradientAlphaKey[]): void {
        this._colorKeys = [...colorKeys].sort((a, b) => a.time - b.time);
        this._alphaKeys = [...alphaKeys].sort((a, b) => a.time - b.time);
    }

    /**
     * Convenience: builds a gradient from plain data arrays.
     * Each color entry is `[Color, time]`; each alpha entry is `[alpha, time]`.
     */
    public static fromKeys(
        colorEntries: ReadonlyArray<readonly [Color, number]>,
        alphaEntries: ReadonlyArray<readonly [number, number]>,
    ): Gradient {
        const g = new Gradient();
        g.setKeys(
            colorEntries.map(([c, t]) => new GradientColorKey(c, t)),
            alphaEntries.map(([a, t]) => new GradientAlphaKey(a, t)),
        );
        return g;
    }

    /**
     * Evaluates the gradient at normalized time `t` (0–1).
     * @param t Time in [0, 1]; values outside are clamped.
     * @param out Optional output Color to write into (avoids allocation).
     */
    public evaluate(t: number, out?: Color): Color {
        const result = out ?? new Color();
        t = Math.max(0, Math.min(1, t));

        // ── Color channel ──
        const ck = this._colorKeys;
        let r = 1, g = 1, b = 1;
        if (ck.length === 1) {
            r = ck[0].color.r; g = ck[0].color.g; b = ck[0].color.b;
        } else if (t <= ck[0].time) {
            r = ck[0].color.r; g = ck[0].color.g; b = ck[0].color.b;
        } else if (t >= ck[ck.length - 1].time) {
            const last = ck[ck.length - 1].color;
            r = last.r; g = last.g; b = last.b;
        } else {
            for (let i = 0; i < ck.length - 1; i++) {
                const a = ck[i], bK = ck[i + 1];
                if (t >= a.time && t <= bK.time) {
                    if (this.mode === GradientMode.Fixed) {
                        r = a.color.r; g = a.color.g; b = a.color.b;
                    } else {
                        const span = bK.time - a.time;
                        const f = span > 0 ? (t - a.time) / span : 0;
                        r = a.color.r + (bK.color.r - a.color.r) * f;
                        g = a.color.g + (bK.color.g - a.color.g) * f;
                        b = a.color.b + (bK.color.b - a.color.b) * f;
                    }
                    break;
                }
            }
        }

        // ── Alpha channel ──
        const ak = this._alphaKeys;
        let alpha = 1;
        if (ak.length === 1) {
            alpha = ak[0].alpha;
        } else if (t <= ak[0].time) {
            alpha = ak[0].alpha;
        } else if (t >= ak[ak.length - 1].time) {
            alpha = ak[ak.length - 1].alpha;
        } else {
            for (let i = 0; i < ak.length - 1; i++) {
                const a = ak[i], bK = ak[i + 1];
                if (t >= a.time && t <= bK.time) {
                    if (this.mode === GradientMode.Fixed) {
                        alpha = a.alpha;
                    } else {
                        const span = bK.time - a.time;
                        const f = span > 0 ? (t - a.time) / span : 0;
                        alpha = a.alpha + (bK.alpha - a.alpha) * f;
                    }
                    break;
                }
            }
        }

        result.r = r;
        result.g = g;
        result.b = b;
        result.a = alpha;
        return result;
    }
}
