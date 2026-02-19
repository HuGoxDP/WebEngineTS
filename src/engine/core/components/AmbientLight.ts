// path: src/engine/core/components/AmbientLight.ts

import * as THREE from "three";
import { Light } from "./Light.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * A light that illuminates all objects in the scene equally from
 * all directions. It has no position, no direction, and casts no shadows.
 *
 * Use ambient light to prevent completely black shadow areas and to
 * set the overall minimum brightness of a scene.
 *
 * @remarks
 * Equivalent to Unity's `RenderSettings.ambientLight` or a Light
 * component with `LightType.Point` and infinite range / no falloff.
 *
 * In Unity, ambient light is typically configured via Lighting Settings
 * rather than a component. We provide it as a component for simplicity
 * and flexibility — scenario authors can add/remove it dynamically.
 *
 * **Shadows:** Ambient lights never cast shadows. The `shadows` property
 * from the base {@link Light} class is ignored.
 *
 * @example
 * ```ts
 * // Soft space ambient — prevents pitch-black shadow sides
 * const ambientGo = new GameObject("Ambient Light");
 * const ambient = ambientGo.addComponent(AmbientLight);
 * ambient.intensity = 0.15;
 * ambient.color = new Color(0.4, 0.4, 0.6); // cool blue tint
 * ```
 */
export class AmbientLight extends Light {

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "AmbientLight";
    }

    // ==================== FACTORY (implements Light abstract) ====================

    /**
     * @internal
     * Creates a Three.js AmbientLight.
     *
     * Ambient lights have no shadow support — `castShadow` is always false.
     * Position and rotation are irrelevant (light is uniform everywhere).
     */
    protected override _createThreeLight(): THREE.Light {
        const light = new THREE.AmbientLight(0xFFFFFF, 1);

        // Ambient lights cannot cast shadows
        light.castShadow = false;

        return light;
    }
}