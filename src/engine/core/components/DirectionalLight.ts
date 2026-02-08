// path: src/engine/core/components/DirectionalLight.ts

import * as THREE from "three";
import { Light } from "./Light.ts";
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
     * - shadow map = 2048 × 2048
     * - shadow camera range = 0.5 – 200
     */
    protected override _createThreeLight(): THREE.Light {
        const light = new THREE.DirectionalLight(0xFFFFFF, 1);

        // Default shadow setup
        light.castShadow = true;
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 200;

        return light;
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
}