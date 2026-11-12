// path: src/engine/core/graphics/UnlitMaterial.ts

import * as THREE from "three";
import { Material } from "./Material.ts";
import { Shader } from "./Shader.ts";
import { Color } from "../math/Color.ts";
import { Texture2D } from "./Texture2D.ts";
import type { RenderTexture } from "./RenderTexture.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";

/**
 * A material that is not affected by scene lighting.
 *
 * Objects rendered with UnlitMaterial display their color/texture
 * at full brightness regardless of lights in the scene. Perfect for:
 * - Self-illuminating objects (sun, neon signs, lava)
 * - UI elements rendered in world space
 * - Debug visualization
 * - Skybox / background elements
 *
 * Internally uses `THREE.MeshBasicMaterial`.
 *
 * @remarks
 * Equivalent to Unity's Unlit shader (`Unlit/Color`, `Unlit/Texture`).
 *
 * @example
 * ```ts
 * const mat = new UnlitMaterial();
 * mat.color = new Color(1, 0.9, 0.3);       // always this color
 * mat.mainTexture = await assets.loadTexture("sun.png");
 * renderer.sharedMaterial = mat;
 * ```
 */
@Serializable({ typeName: "UnlitMaterial", category: "Rendering" })
export class UnlitMaterial extends Material {

    constructor() {
        super(Shader.Unlit);
        this.name = "Unlit Material";

        // Initialize defaults
        this.color = Color.white;
    }

    // ==================== COLOR ====================

    /**
     * The display color.
     *
     * Since this material is unlit, the object always appears
     * this color regardless of lighting conditions.
     *
     * @remarks Equivalent to Unity's `_Color` on Unlit shaders.
     */
    public override get color(): Color {
        return this.getColor("_Color");
    }

    public override set color(value: Color) {
        this.setColor("_Color", value);
    }

    // ==================== TEXTURE ====================

    /**
     * The main texture.
     *
     * Displayed at full brightness, tinted by {@link color}.
     *
     * @remarks Equivalent to Unity's `_MainTex` on Unlit shaders.
     *
     * Accepts a {@link RenderTexture} as well as a {@link Texture2D}: a quad with
     * this material shows what a camera rendered into that target — a monitor, a
     * mirror, a camera preview. A target's colour texture is the texture the
     * base class binds, so no separate slot exists for it.
     *
     * Two consequences of sampling a target, both recorded by the C6 research
     * (D7, D8):
     *
     * - **A target is not tone-mapped.** Three skips the output transform when a
     *   camera renders into a target, so what a target holds is exactly what the
     *   renderer wrote — not what a monitor would show. Drawing it through this
     *   material applies the screen pass's tone mapping once, which is the
     *   correct result; a target read back to the CPU (`Texture2D.readPixels`)
     *   stays un-tone-mapped.
     * - **A feedback loop is a WebGL error.** When a camera renders into the very
     *   texture a visible material samples, the draw is dropped and three logs a
     *   console warning about a feedback loop between framebuffer and texture.
     *   The engine does not guard against it (a follow-up row); nothing here
     *   throws, and the rest of the frame keeps drawing.
     */
    public override get mainTexture(): Texture2D | RenderTexture | null {
        return this.getTexture("_MainTex") as Texture2D | RenderTexture | null;
    }

    public override set mainTexture(value: Texture2D | RenderTexture | null) {
        this.setTexture("_MainTex", value);
    }

    // ==================== TRANSPARENCY ====================

    /**
     * Makes this material transparent with the given alpha.
     *
     * @param alpha — opacity (0 = invisible, 1 = fully opaque).
     */
    public makeTransparent(alpha: number = 0.5): void {
        const mat = this._threeMatHandle as THREE.MeshBasicMaterial;
        mat.transparent = true;
        mat.opacity = alpha;
        mat.depthWrite = false;
        mat.needsUpdate = true;

        const col = this.color;
        col.a = alpha;
        this.color = col;
    }

    // ==================== WIREFRAME ====================

    /**
     * Whether to render in wireframe mode.
     *
     * @remarks Useful for debug visualization.
     */
    @SerializedField()
    public get wireframe(): boolean {
        return (this._threeMatHandle as THREE.MeshBasicMaterial).wireframe;
    }

    public set wireframe(value: boolean) {
        (this._threeMatHandle as THREE.MeshBasicMaterial).wireframe = value;
    }
}