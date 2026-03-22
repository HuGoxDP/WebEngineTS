// path: src/engine/core/RenderSettings.ts

import * as THREE from "three";
import type { Cubemap } from "./graphics/Cubemap.ts";
import type { Scene } from "./Scene.ts";
import { Color } from "./math/Color.ts";

// ==================== FOG MODE ENUM ====================

/**
 * Distance fog calculation mode.
 *
 * @remarks Equivalent to Unity's `FogMode`.
 */
export enum FogMode {
    /** Fog increases linearly between start and end distance. */
    Linear = 1,
    /** Fog increases exponentially with distance. */
    Exponential = 2,
    /** Fog increases with the square of the exponential (thicker). */
    ExponentialSquared = 3,
}

/**
 * Global rendering settings that affect the entire scene.
 *
 * All members are static — `RenderSettings` is never instantiated.
 *
 * @remarks Equivalent to Unity's `UnityEngine.RenderSettings`.
 *
 * @example
 * ```ts
 * // Set a skybox from an equirectangular panorama
 * const sky = await Cubemap.fromEquirectangular(assets.getBlobUrl("sky.jpg"));
 * RenderSettings.skybox = sky;
 *
 * // Enable fog
 * RenderSettings.fog = true;
 * RenderSettings.fogColor = new Color(0.7, 0.8, 0.9, 1);
 * RenderSettings.fogDensity = 0.02;
 * ```
 */
export class RenderSettings {

    // ==================== SKYBOX ====================

    /** The current skybox cubemap texture, or null for no skybox. */
    private static _skybox: Cubemap | null = null;

    /** Whether the skybox is dirty and needs sync to Three.js. */
    private static _skyboxDirty: boolean = false;

    /**
     * The skybox cubemap for the scene background.
     *
     * Set to a {@link Cubemap} instance (6-face or equirectangular)
     * to display a skybox. Set to `null` to remove the skybox.
     *
     * Requires `Camera.clearFlags = CameraClearFlags.Skybox` on the
     * main camera to be visible.
     *
     * @remarks Equivalent to Unity's `RenderSettings.skybox` (material),
     * simplified to accept a Cubemap directly.
     *
     * @example
     * ```ts
     * const sky = await Cubemap.fromEquirectangular(url);
     * RenderSettings.skybox = sky;
     * ```
     */
    public static get skybox(): Cubemap | null {
        return RenderSettings._skybox;
    }

    public static set skybox(value: Cubemap | null) {
        RenderSettings._skybox = value;
        RenderSettings._skyboxDirty = true;
    }

    // ==================== ENVIRONMENT REFLECTIONS ====================

    /** The current environment map for reflections, or null. */
    private static _environmentReflections: Cubemap | null = null;
    private static _envDirty: boolean = false;

    /**
     * The environment cubemap used for specular reflections on
     * PBR materials (`StandardMaterial`).
     *
     * If not set, defaults to the skybox (if any).
     *
     * @remarks Equivalent to Unity's reflection probes / environment lighting.
     */
    public static get environmentReflections(): Cubemap | null {
        return RenderSettings._environmentReflections;
    }

    public static set environmentReflections(value: Cubemap | null) {
        RenderSettings._environmentReflections = value;
        RenderSettings._envDirty = true;
    }

    // ==================== FOG ====================

    /** Whether fog is enabled. */
    private static _fog: boolean = false;

    /** Fog color. */
    private static _fogColor: Color = new Color(0.5, 0.5, 0.5, 1);

    /** Fog mode. */
    private static _fogMode: FogMode = FogMode.Exponential;

    /** Start distance for linear fog. */
    private static _fogStartDistance: number = 0;

    /** End distance for linear fog. */
    private static _fogEndDistance: number = 300;

    /** Density for exponential fog. */
    private static _fogDensity: number = 0.01;

    /** Whether fog settings are dirty. */
    private static _fogDirty: boolean = false;

    /**
     * Whether distance fog is enabled.
     *
     * @remarks Equivalent to Unity's `RenderSettings.fog`.
     */
    public static get fog(): boolean {
        return RenderSettings._fog;
    }

    public static set fog(value: boolean) {
        RenderSettings._fog = value;
        RenderSettings._fogDirty = true;
    }

    /**
     * The color of the fog.
     *
     * @remarks Equivalent to Unity's `RenderSettings.fogColor`.
     */
    public static get fogColor(): Color {
        return RenderSettings._fogColor.clone();
    }

    public static set fogColor(value: Color) {
        RenderSettings._fogColor = value.clone();
        RenderSettings._fogDirty = true;
    }

    /**
     * The fog mode (linear or exponential).
     *
     * @remarks Equivalent to Unity's `RenderSettings.fogMode`.
     */
    public static get fogMode(): FogMode {
        return RenderSettings._fogMode;
    }

    public static set fogMode(value: FogMode) {
        RenderSettings._fogMode = value;
        RenderSettings._fogDirty = true;
    }

    /**
     * The start distance for linear fog (world units).
     *
     * @remarks Equivalent to Unity's `RenderSettings.fogStartDistance`.
     */
    public static get fogStartDistance(): number {
        return RenderSettings._fogStartDistance;
    }

    public static set fogStartDistance(value: number) {
        RenderSettings._fogStartDistance = value;
        RenderSettings._fogDirty = true;
    }

    /**
     * The end distance for linear fog (world units).
     *
     * @remarks Equivalent to Unity's `RenderSettings.fogEndDistance`.
     */
    public static get fogEndDistance(): number {
        return RenderSettings._fogEndDistance;
    }

    public static set fogEndDistance(value: number) {
        RenderSettings._fogEndDistance = value;
        RenderSettings._fogDirty = true;
    }

    /**
     * The density for exponential/exponential-squared fog.
     *
     * @remarks Equivalent to Unity's `RenderSettings.fogDensity`.
     */
    public static get fogDensity(): number {
        return RenderSettings._fogDensity;
    }

    public static set fogDensity(value: number) {
        RenderSettings._fogDensity = value;
        RenderSettings._fogDirty = true;
    }

    // ==================== AMBIENT LIGHT ====================

    /** Ambient light color. */
    private static _ambientColor: Color = new Color(0.2, 0.2, 0.2, 1);
    private static _ambientDirty: boolean = false;

    /**
     * The scene-wide ambient light color.
     *
     * @remarks Equivalent to Unity's `RenderSettings.ambientLight`.
     * This is separate from the `AmbientLight` component and provides
     * a global baseline for environment lighting.
     */
    public static get ambientColor(): Color {
        return RenderSettings._ambientColor.clone();
    }

    public static set ambientColor(value: Color) {
        RenderSettings._ambientColor = value.clone();
        RenderSettings._ambientDirty = true;
    }

    // ==================== INTERNAL SYNC ====================

    /**
     * @internal
     * Applies all dirty settings to the Three.js scene.
     * Called once per frame by Application._render before rendering.
     *
     * @param threeScene — the Three.js scene to update.
     * @param useSkybox — whether the camera's clear flags request a skybox.
     */
    public static _syncToThree(threeScene: THREE.Scene, useSkybox: boolean): void {
        // ── Skybox ──
        if (RenderSettings._skyboxDirty) {
            if (useSkybox && RenderSettings._skybox) {
                threeScene.background = RenderSettings._skybox._internalThreeTexture;
            } else if (!useSkybox) {
                // Let Application handle clear color
                threeScene.background = null;
            }

            // Also apply as environment for reflections (if no explicit env map)
            if (RenderSettings._skybox && !RenderSettings._environmentReflections) {
                threeScene.environment = RenderSettings._skybox._internalThreeTexture as THREE.Texture;
            }

            RenderSettings._skyboxDirty = false;
        }

        // Update background each frame based on camera clear flags
        if (useSkybox && RenderSettings._skybox) {
            threeScene.background = RenderSettings._skybox._internalThreeTexture;
        } else if (!useSkybox) {
            threeScene.background = null;
        }

        // ── Environment reflections ──
        if (RenderSettings._envDirty) {
            if (RenderSettings._environmentReflections) {
                threeScene.environment = RenderSettings._environmentReflections._internalThreeTexture as THREE.Texture;
            } else if (RenderSettings._skybox) {
                threeScene.environment = RenderSettings._skybox._internalThreeTexture as THREE.Texture;
            } else {
                threeScene.environment = null;
            }
            RenderSettings._envDirty = false;
        }

        // ── Fog ──
        if (RenderSettings._fogDirty) {
            if (RenderSettings._fog) {
                const c = RenderSettings._fogColor;
                const threeColor = new THREE.Color(c.r, c.g, c.b);

                if (RenderSettings._fogMode === FogMode.Linear) {
                    threeScene.fog = new THREE.Fog(
                        threeColor,
                        RenderSettings._fogStartDistance,
                        RenderSettings._fogEndDistance,
                    );
                } else {
                    threeScene.fog = new THREE.FogExp2(
                        threeColor,
                        RenderSettings._fogDensity,
                    );
                }
            } else {
                threeScene.fog = null;
            }
            RenderSettings._fogDirty = false;
        }
    }

    /**
     * @internal
     * Resets all render settings to defaults. Called on scene unload.
     */
    public static _reset(): void {
        if (RenderSettings._skybox) {
            RenderSettings._skybox.dispose();
        }
        if (RenderSettings._environmentReflections) {
            RenderSettings._environmentReflections.dispose();
        }

        RenderSettings._skybox = null;
        RenderSettings._environmentReflections = null;
        RenderSettings._fog = false;
        RenderSettings._fogColor = new Color(0.5, 0.5, 0.5, 1);
        RenderSettings._fogMode = FogMode.Exponential;
        RenderSettings._fogStartDistance = 0;
        RenderSettings._fogEndDistance = 300;
        RenderSettings._fogDensity = 0.01;
        RenderSettings._ambientColor = new Color(0.2, 0.2, 0.2, 1);

        RenderSettings._skyboxDirty = true;
        RenderSettings._fogDirty = true;
        RenderSettings._envDirty = true;
        RenderSettings._ambientDirty = true;
    }

    // ==================== PRIVATE CONSTRUCTOR ====================

    /** @internal Static-only class. */
    private constructor() {}
}