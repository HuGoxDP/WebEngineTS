// path: src/engine/core/components/DirectionalLight.ts

import * as THREE from "three";
import { Light } from "./Light.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * A light that shines uniformly in one direction, simulating sunlight.
 *
 * Directional lights have no position falloff — all objects are lit as
 * if the light source is infinitely far away. The light direction is
 * determined by the Transform's forward axis (rotation).
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Light` with `LightType.Directional`.
 *
 * **Direction sync:** The Three.js DirectionalLight uses a `target`
 * object to define direction (`light.position` → `target.position`).
 * We place the target at local `(0, 0, 1)` — the engine's forward
 * direction — and attach it to the same Transform Object3D, so
 * rotating the Transform automatically rotates the light direction
 * with zero per-frame sync cost.
 *
 * @example
 * ```ts
 * const lightGo = new GameObject("Sun");
 * const light = lightGo.addComponent(DirectionalLight);
 * light.intensity = 1.2;
 * light.color = new Color(1, 0.95, 0.85); // warm sunlight
 * light.shadows = LightShadows.Soft;
 * lightGo.transform.rotation = Quaternion.euler(50, -30, 0);
 * ```
 */
@Serializable({ typeName: "DirectionalLight", category: "Rendering" })
export class DirectionalLight extends Light {

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "DirectionalLight";
    }

    // ==================== FACTORY (implements Light abstract) ====================

    /**
     * @internal
     * Creates a Three.js DirectionalLight with sensible defaults.
     *
     * Shadow defaults:
     * - castShadow = true
     * - shadow map = 2048 x 2048
     * - shadow camera range = 0.5 - 200
     * - shadow frustum = 20 units (covers most scene content)
     */
    protected override _createThreeLight(): THREE.Light {
        const light = new THREE.DirectionalLight(0xFFFFFF, 1);

        // Light sits at local origin of its Transform.
        light.position.set(0, 0, 0);

        // Default shadow setup
        light.castShadow = true;
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 200;

        // Orthographic frustum for shadow camera
        const frustum = 20;
        light.shadow.camera.left = -frustum;
        light.shadow.camera.right = frustum;
        light.shadow.camera.top = frustum;
        light.shadow.camera.bottom = -frustum;

        return light;
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * After base Light attaches the light to the Transform,
     * we also attach `light.target` to the same Object3D at
     * local offset (0, 0, 1) — the engine's forward direction.
     *
     * This means rotating the Transform automatically rotates
     * the light direction with zero per-frame sync cost.
     */
    protected override onAwake(): void {
        super.onAwake();

        const light = this._internalThreeLight as THREE.DirectionalLight | null;
        if (light === null) return;

        // Place target at +Z (forward) in local space.
        // Three.js direction = normalize(target.worldPos - light.worldPos).
        // Both are children of the same Object3D, so direction = forward.
        light.target.position.set(0, 0, 1);
        this.gameObject.transform._addInternalChild(light.target);
    }

    /**
     * @internal
     * Clean up the target from the scene graph.
     */
    protected override onDestroy(): void {
        const light = this._internalThreeLight as THREE.DirectionalLight | null;
        if (light !== null) {
            this.gameObject.transform._removeInternalChild(light.target);
        }
        super.onDestroy();
    }

    // ==================== DIRECTIONAL-SPECIFIC PROPERTIES ====================

    /**
     * The maximum distance from the camera at which shadows are rendered.
     *
     * This controls the far plane of the shadow camera.
     *
     * @remarks Equivalent to Unity's `QualitySettings.shadowDistance`
     * (applied per-light for simplicity).
     */
    @SerializedField()
    public get shadowDistance(): number {
        const light = this._internalThreeLight as THREE.DirectionalLight | null;
        if (light === null) return 200;
        return light.shadow.camera.far;
    }

    public set shadowDistance(value: number) {
        const light = this._internalThreeLight as THREE.DirectionalLight | null;
        if (light === null) return;
        light.shadow.camera.far = Math.max(0.1, value);
        light.shadow.camera.updateProjectionMatrix();
    }

    /**
     * The half-size of the shadow camera frustum in world units.
     *
     * Larger values capture shadows over a wider area but reduce
     * shadow map resolution (more texels per unit).
     *
     * @remarks
     * In Unity this is controlled by `QualitySettings.shadowDistance`
     * and automatic fitting. We expose it directly for simplicity.
     *
     * @default 20
     */
    @SerializedField()
    public get shadowFrustumSize(): number {
        const light = this._internalThreeLight as THREE.DirectionalLight | null;
        if (light === null) return 20;
        return light.shadow.camera.right;
    }

    public set shadowFrustumSize(value: number) {
        const light = this._internalThreeLight as THREE.DirectionalLight | null;
        if (light === null) return;
        const size = Math.max(1, value);
        light.shadow.camera.left = -size;
        light.shadow.camera.right = size;
        light.shadow.camera.top = size;
        light.shadow.camera.bottom = -size;
        light.shadow.camera.updateProjectionMatrix();
    }
}