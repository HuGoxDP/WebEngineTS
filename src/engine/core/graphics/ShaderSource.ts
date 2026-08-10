import { Color } from "../math/Color";
import { Vector4 } from "../math/Vector4";
import { Matrix4x4 } from "../math/Matrix4x4";
import type { Texture } from "./Texture";

/**
 * A value a custom shader uniform can hold.
 *
 * @remarks
 * Engine types only — the GLSL type each one becomes is fixed and documented,
 * so an author never has to guess how a {@link Color} arrives in the shader.
 *
 * | Declared as | GLSL type |
 * |---|---|
 * | `number` | `float` |
 * | {@link Color} | `vec4` (r, g, b, a) |
 * | {@link Vector4} | `vec4` |
 * | {@link Matrix4x4} | `mat4` |
 * | {@link Texture} or `null` | `sampler2D` |
 *
 * `Color` becomes a `vec4` rather than a `vec3` deliberately: Unity's `_Color`
 * is a `fixed4`, and a mapping that silently drops alpha would be found the
 * hard way, in a shader that cannot fade.
 */
export type ShaderUniformValue = number | Color | Vector4 | Matrix4x4 | Texture | null;

/**
 * The GLSL and defaults a custom shader is built from.
 *
 * @remarks
 * Passed to {@link Shader.create}. The engine compiles this into one Three.js
 * shader material; the author never names Three.js, and the built-in
 * attributes and matrices below are supplied for them.
 */
export interface IShaderSource {
    /**
     * Vertex shader source.
     *
     * @remarks
     * `position`, `normal` and `uv` attributes and the `modelMatrix`,
     * `modelViewMatrix`, `projectionMatrix`, `viewMatrix` and `normalMatrix`
     * uniforms are declared for you, as are `cameraPosition` and any uniform in
     * {@link uniforms}. Omit it to use a pass-through vertex shader that
     * forwards `uv` as `vUv`.
     */
    vertex?: string;

    /** Fragment shader source. Required — a shader that draws nothing is a bug, not a default. */
    fragment: string;

    /**
     * Uniforms the material exposes, with their defaults.
     *
     * @remarks
     * The declaration is what fixes each uniform's GLSL type, so it must list
     * every uniform the material will set: a uniform first seen at
     * `setFloat` time has no declared type and no slot in the compiled
     * program, and setting it would silently do nothing.
     */
    uniforms?: Record<string, ShaderUniformValue>;

    /** Whether the material blends. Defaults to false. */
    transparent?: boolean;

    /** Whether both faces are drawn. Defaults to false. */
    doubleSided?: boolean;

    /** Whether fragments write depth. Defaults to true. */
    depthWrite?: boolean;
}

/**
 * The vertex shader a source without one gets.
 *
 * @remarks
 * Forwards UVs and applies the standard transform, which is what almost every
 * fragment-only effect wants; writing it out by hand each time is noise.
 */
export const DEFAULT_VERTEX_SHADER: string = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`.trim();
