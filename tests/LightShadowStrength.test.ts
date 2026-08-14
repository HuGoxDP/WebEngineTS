import { describe, test, expect } from "vitest";
import * as THREE from "three";
import { GameObject } from "../src/engine/core/GameObject";
import { DirectionalLight } from "../src/engine/core/components/DirectionalLight";
import { LightShadows } from "../src/engine/core/components/Light";

/**
 * shadowStrength described an effect it did not have: every other Light setter
 * synced to Three.js, these two did not, and nothing anywhere read the stored
 * value. three 0.182 has LightShadow.intensity with the same 0..1 meaning, so
 * the property was not unimplementable — merely unwired. Audit part 3, F11.
 */

function threeShadow(light: DirectionalLight): THREE.LightShadow {
    const three = (light as unknown as { _threeLight: THREE.DirectionalLight })._threeLight;
    return three.shadow;
}

function makeLight(): DirectionalLight {
    const light = new GameObject("Sun").addComponent(DirectionalLight);
    light.shadows = LightShadows.Soft;
    return light;
}

describe("Light.shadowStrength reaches the shadow", () => {
    test("setting it moves the Three.js shadow intensity", () => {
        const light = makeLight();

        light.shadowStrength = 0.25;

        expect(threeShadow(light).intensity).toBeCloseTo(0.25, 6);
    });

    test("it is clamped to 0..1 on the way through", () => {
        const light = makeLight();

        light.shadowStrength = 5;
        expect(threeShadow(light).intensity).toBe(1);

        light.shadowStrength = -3;
        expect(threeShadow(light).intensity).toBe(0);
    });

    test("the engine-side value and the backend agree", () => {
        const light = makeLight();

        light.shadowStrength = 0.6;

        expect(light.shadowStrength).toBeCloseTo(0.6, 6);
        expect(threeShadow(light).intensity).toBeCloseTo(light.shadowStrength, 6);
    });

    test("changing the bias does not disturb the strength", () => {
        // Both ride the same sync helper, so one must not clobber the other.
        const light = makeLight();
        light.shadowStrength = 0.4;

        light.shadowBias = -0.001;

        expect(threeShadow(light).intensity).toBeCloseTo(0.4, 6);
        expect(threeShadow(light).bias).toBeCloseTo(-0.001, 6);
    });
});
