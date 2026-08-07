// path: src/engine/core/components/SpotLight.ts

import * as THREE from "three";
import { Light } from "./Light.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * A cone-shaped light that emits from a point in a specific direction.
 *
 * The light's position is determined by the Transform's world position,
 * and the direction by the Transform's forward axis (rotation).
 *
 * Perfect for flashlights, car headlights, stage spotlights, and any
 * focused directional light source with distance falloff.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Light` with `LightType.Spot`.
 *
 * **Direction sync:** Uses the same target-as-child pattern as
 * {@link DirectionalLight} — a target Object3D is placed at local
 * `(0, 0, 1)` under the Transform, so rotating the Transform
 * automatically rotates the spotlight cone.
 *
 * @example
 * ```ts
 * const flashlightGo = new GameObject("Flashlight");
 * const spot = flashlightGo.addComponent(SpotLight);
 * spot.intensity = 5;
 * spot.range = 30;
 * spot.spotAngle = 45;          // full cone angle in degrees
 * spot.innerSpotAngle = 30;     // inner cone (full brightness)
 * spot.color = new Color(1, 1, 0.9);
 * flashlightGo.transform.rotation = Quaternion.euler(30, 0, 0);
 * ```
 */
@Serializable({ typeName: "SpotLight", category: "Rendering" })
export class SpotLight extends Light {

    // ==================== PRIVATE FIELDS ====================

    /**
     * Maximum range in world units.
     * Maps to Three.js `SpotLight.distance`.
     */
    private _range: number = 10;

    /**
     * Rate of intensity falloff with distance.
     * - `0` = no falloff
     * - `1` = linear
     * - `2` = inverse-square (physically correct)
     */
    private _decay: number = 2;

    /**
     * Full outer cone angle in degrees (Unity convention).
     * Three.js uses half-angle in radians internally.
     */
    private _spotAngle: number = 60;

    /**
     * Inner cone angle in degrees where light is at full intensity.
     * Maps to Three.js `penumbra` as ratio of (outer - inner) / outer.
     */
    private _innerSpotAngle: number = 40;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "SpotLight";
    }

    // ==================== FACTORY ====================

    /**
     * @internal
     * Creates a Three.js SpotLight with default parameters.
     */
    protected override _createThreeLight(): THREE.Light {
        const halfAngleRad = (this._spotAngle / 2) * (Math.PI / 180);
        const penumbra = SpotLight._calcPenumbra(this._spotAngle, this._innerSpotAngle);

        const light = new THREE.SpotLight(
            0xFFFFFF,
            1,
            this._range,
            halfAngleRad,
            penumbra,
            this._decay
        );

        // Position at local origin
        light.position.set(0, 0, 0);

        // Shadow defaults (moderate quality)
        light.castShadow = false;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = this._range;

        return light;
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Attaches `light.target` as a child of the Transform at local (0,0,1)
     * so rotation naturally controls spot direction — zero per-frame cost.
     */
    protected override onAwake(): void {
        super.onAwake();

        const light = this._internalThreeLight as THREE.SpotLight | null;
        if (light === null) return;

        // Target at +Z (forward) in local space
        light.target.position.set(0, 0, 1);
        this.gameObject.transform._addInternalChild(light.target);
    }

    /**
     * @internal
     * Removes target from scene graph.
     */
    protected override onDestroy(): void {
        const light = this._internalThreeLight as THREE.SpotLight | null;
        if (light !== null) {
            this.gameObject.transform._removeInternalChild(light.target);
        }
        super.onDestroy();
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * Maximum range of the spotlight in world units.
     *
     * Objects beyond this distance are not illuminated.
     *
     * @remarks Equivalent to Unity's `Light.range`.
     * @default 10
     */
    @SerializedField()
    public get range(): number {
        return this._range;
    }

    public set range(value: number) {
        this._range = Math.max(0, value);
        this._syncSpotParams();
    }

    /**
     * Rate at which light intensity diminishes with distance.
     *
     * - `0` — no falloff (constant within range)
     * - `1` — linear falloff
     * - `2` — inverse-square (physically correct)
     *
     * @default 2
     */
    @SerializedField()
    public get decay(): number {
        return this._decay;
    }

    public set decay(value: number) {
        this._decay = Math.max(0, value);
        this._syncSpotParams();
    }

    /**
     * The full outer cone angle in degrees.
     *
     * This is the total angle of the spotlight cone (not the half-angle).
     * Light outside this cone is zero.
     *
     * @remarks
     * Equivalent to Unity's `Light.spotAngle`.
     * Three.js uses half-angle in radians — conversion is automatic.
     *
     * @default 60
     */
    @SerializedField()
    public get spotAngle(): number {
        return this._spotAngle;
    }

    public set spotAngle(value: number) {
        this._spotAngle = Math.max(1, Math.min(179, value));
        // Ensure inner ≤ outer
        if (this._innerSpotAngle > this._spotAngle) {
            this._innerSpotAngle = this._spotAngle;
        }
        this._syncSpotParams();
    }

    /**
     * The inner cone angle in degrees where light is at full intensity.
     *
     * Between inner and outer angle, light fades smoothly (penumbra).
     * Setting inner = outer gives a hard edge; inner = 0 gives maximum
     * soft falloff.
     *
     * @remarks
     * Equivalent to Unity's `Light.innerSpotAngle`.
     * Maps to Three.js `penumbra` as a 0–1 ratio.
     *
     * @default 40
     */
    @SerializedField()
    public get innerSpotAngle(): number {
        return this._innerSpotAngle;
    }

    public set innerSpotAngle(value: number) {
        this._innerSpotAngle = Math.max(0, Math.min(this._spotAngle, value));
        this._syncSpotParams();
    }

    // ==================== PRIVATE SYNC ====================

    /**
     * @internal
     * Pushes all spot-specific parameters to the Three.js light.
     */
    private _syncSpotParams(): void {
        const light = this._internalThreeLight as THREE.SpotLight | null;
        if (light === null) return;

        light.distance = this._range;
        light.decay = this._decay;
        light.angle = (this._spotAngle / 2) * (Math.PI / 180);
        light.penumbra = SpotLight._calcPenumbra(this._spotAngle, this._innerSpotAngle);

        // Keep shadow camera in sync
        light.shadow.camera.far = Math.max(0.1, this._range);
    }

    /**
     * Calculates Three.js penumbra (0–1) from Unity angle pair.
     *
     * penumbra = (outer - inner) / outer
     * - 0 = hard edge (inner == outer)
     * - 1 = full soft falloff (inner == 0)
     */
    private static _calcPenumbra(outerAngle: number, innerAngle: number): number {
        if (outerAngle <= 0) return 0;
        return Math.max(0, Math.min(1, (outerAngle - innerAngle) / outerAngle));
    }
}