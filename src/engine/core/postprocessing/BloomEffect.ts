import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { PostEffect } from "./PostEffect";

/**
 * Additive light-bleed effect for bright pixels.
 *
 * @remarks
 * Wraps Three.js `UnrealBloomPass`. Good for glows, emissive materials,
 * and sun halos.
 *
 * ```ts
 * const bloom = new BloomEffect({ intensity: 1.2, threshold: 0.8 });
 * PostProcessing.addEffect(bloom);
 * PostProcessing.enabled = true;
 * ```
 */
export class BloomEffect extends PostEffect {

    /** Strength of the bloom (roughly HDR multiplier). */
    public intensity: number = 1.0;

    /** Brightness above which pixels start to bloom (0–1 in LDR). */
    public threshold: number = 0.85;

    /** Radius of the blur (0–1, soft to large). */
    public radius: number = 0.4;

    constructor(opts: { intensity?: number; threshold?: number; radius?: number } = {}) {
        super();
        if (opts.intensity !== undefined) this.intensity = opts.intensity;
        if (opts.threshold !== undefined) this.threshold = opts.threshold;
        if (opts.radius !== undefined)    this.radius    = opts.radius;
    }

    public override _createPass(width: number, height: number): UnrealBloomPass {
        const pass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.intensity,
            this.radius,
            this.threshold,
        );
        return pass;
    }

    public override _updatePass(pass: UnrealBloomPass): void {
        pass.strength  = this.intensity;
        pass.radius    = this.radius;
        pass.threshold = this.threshold;
    }

    public override _resize(pass: UnrealBloomPass, w: number, h: number): void {
        pass.setSize(w, h);
    }

    public override _dispose(pass: UnrealBloomPass): void {
        pass.dispose?.();
    }
}
