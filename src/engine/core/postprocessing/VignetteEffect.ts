import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { PostEffect } from "./PostEffect";
import { Color } from "../math/Color";

const _VIGNETTE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.5 },
        uSmoothness: { value: 0.5 },
        uColor: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity;
        uniform float uSmoothness;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            vec2 centered = vUv - 0.5;
            float d = length(centered) * 1.4142;
            float v = smoothstep(1.0 - uSmoothness, 1.0, d * uIntensity * 2.0);
            gl_FragColor = vec4(mix(tex.rgb, uColor, v), tex.a);
        }
    `,
};

/**
 * Darkens the edges of the frame (classic vignette).
 *
 * @remarks
 * Low-cost shader pass. Useful for focusing attention, horror atmospheres,
 * or simulating lens falloff.
 */
export class VignetteEffect extends PostEffect {

    /** Overall strength (0 = none, 1 = heavy). */
    public intensity: number = 0.5;

    /** Softness of the edge transition (0 = hard, 1 = very soft). */
    public smoothness: number = 0.5;

    /**
     * Color to blend toward at the corners.
     *
     * @remarks
     * An engine {@link Color}, like every other colour in the public API — the
     * alpha channel is ignored, since a vignette blends rather than composites.
     * Mutate it in place (`vignette.color.set(...)`) or assign a new one; either
     * reaches the shader on the next frame.
     */
    public color: Color = new Color(0, 0, 0, 1);

    constructor(opts: { intensity?: number; smoothness?: number; color?: Color } = {}) {
        super();
        if (opts.intensity !== undefined)  this.intensity  = opts.intensity;
        if (opts.smoothness !== undefined) this.smoothness = opts.smoothness;
        if (opts.color !== undefined)      this.color      = opts.color.clone();
    }

    public override _createPass(): ShaderPass {
        return new ShaderPass(_VIGNETTE_SHADER);
    }

    public override _updatePass(pass: ShaderPass): void {
        pass.uniforms.uIntensity.value  = this.intensity;
        pass.uniforms.uSmoothness.value = this.smoothness;
        this.color._copyToThree(pass.uniforms.uColor.value);
    }

    public override _dispose(pass: ShaderPass): void {
        pass.material?.dispose?.();
    }
}
