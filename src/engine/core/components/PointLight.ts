// path: src/engine/core/components/PointLight.ts

import * as THREE from "three";
import { Light } from "./Light.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * An omni-directional light that emits equally in all directions from
 * its position, with intensity falling off over distance.
 *
 * Perfect for light bulbs, torches, glowing objects (like the Sun in
 * a solar system), explosions, and any localized light source.
 *
 * The light's position is determined by the Transform's world position.
 * Rotation has no effect on a point light.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Light` with `LightType.Point`.
 *
 * **Decay model:** Three.js uses physically-correct decay by default
 * (inverse-square falloff, `decay = 2`). This matches real-world behavior.
 * Unity uses a custom falloff curve that reaches zero at `range`  we
 * approximate this by setting `distance = range` and `decay = 2`.
 *
 * @example
 * ```ts
 * const sunGo = new GameObject("Sun");
 * const sunLight = sunGo.addComponent(PointLight);
 * sunLight.intensity = 2;
 * sunLight.range = 50;
 * sunLight.color = new Color(1, 0.95, 0.8);
 * // Position at origin  light radiates outward in all directions
 * sunGo.transform.position = Vector3.zero;
 * ```
 */
@Serializable({ typeName: "PointLight", category: "Rendering" })
export class PointLight extends Light {

    // ==================== PRIVATE FIELDS ====================

    /**
     * Maximum range of the light. Beyond this distance, the light
     * has no effect.
     *
     * Maps to Three.js `PointLight.distance`.
     * In Unity, this is `Light.range`.
     */
    private _range: number = 10;

    /**
     * Rate at which light intensity falls off with distance.
     *
     * - `0` = no falloff (constant brightness within range)
     * - `1` = linear falloff (1/distance)
     * - `2` = physically correct inverse-square (1/distance²)
     *
     * Maps to Three.js `PointLight.decay`.
     */
    private _decay: number = 2;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "PointLight";
    }


    // ==================== FACTORY (implements Light abstract) ====================

    /**
     * @internal
     * Creates a Three.js PointLight with physically-correct decay.
     *
     * - `distance` = range (light fades to zero at this distance)
     * - `decay` = 2 (inverse-square falloff, physically correct)
     * - Shadow map = 1024 Ã— 1024 (lower default than DirectionalLight
     *   because point light shadows use a cube map = 6Ã— cost)
     */
    protected override _createThreeLight(): THREE.Light {
        const light = new THREE.PointLight(0xFFFFFF, 1, this._range, this._decay);

        // Default shadow setup (point light shadows are expensive  6 faces)
        light.castShadow = false;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = this._range;

        return light;
    }

    // ==================== POINT-LIGHT-SPECIFIC PROPERTIES ====================

    /**
     * The maximum range of the light in world units.
     *
     * Objects beyond this distance are not affected. Set to `0` for
     * infinite range (not recommended for performance).
     *
     * @remarks Equivalent to Unity's `Light.range`.
     *
     * @default 10
     */
    @SerializedField()
    public get range(): number {
        return this._range;
    }

    public set range(value: number) {
        this._range = Math.max(0, value);
        this._syncPointLightParams();
    }

    /**
     * Rate at which light intensity diminishes with distance.
     *
     * Common values:
     * - `0` — no falloff, constant brightness within range (artistic/stylized)
     * - `1` — linear falloff, gentle dimming (good for game scenes)
     * - `2` — inverse-square, physically correct (realistic but aggressive)
     *
     * @remarks
     * Unity does not expose decay directly — it uses a built-in falloff
     * curve. This property gives scenario authors explicit control.
     *
     * For solar system or large scenes, use `decay = 1` with high intensity.
     * For indoor/realistic lighting, use `decay = 2`.
     *
     * @default 2
     */
    @SerializedField()
    public get decay(): number {
        return this._decay;
    }

    public set decay(value: number) {
        this._decay = Math.max(0, value);
        this._syncPointLightParams();
    }

    // ==================== PRIVATE SYNC ====================

    /**
     * @internal
     * Pushes range and decay to the Three.js point light.
     */
    private _syncPointLightParams(): void {
        const light = this._internalThreeLight as THREE.PointLight | null;
        if (light === null) return;

        light.distance = this._range;
        light.decay = this._decay;

        // Keep shadow camera in sync with range
        light.shadow.camera.far = Math.max(0.1, this._range);
    }
}