// path: src/engine/core/components/Light.ts

import * as THREE from "three";
import { Behaviour } from "../Behaviour.ts";
import { profilerHooks } from "../diagnostics/ProfilerHooks.ts";
import { Color } from "../math/Color.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== ENUMS ====================

/**
 * Shadow mode for a light source.
 *
 * @remarks Equivalent to Unity's `LightShadows`.
 */
export enum LightShadows {
    /** No shadows. */
    None = 0,
    /** Hard-edged shadows. */
    Hard = 1,
    /** Soft anti-aliased shadows. */
    Soft = 2,
}

/**
 * Shadow map resolution presets.
 *
 * @remarks Equivalent to Unity's `UnityEngine.Rendering.LightShadowResolution`.
 */
export enum LightShadowResolution {
    /** 512 × 512. */
    Low = 512,
    /** 1024 × 1024. */
    Medium = 1024,
    /** 2048 × 2048. */
    High = 2048,
    /** 4096 × 4096. */
    VeryHigh = 4096,
}

// ==================== LIGHT ====================

/**
 * Abstract base class for all light components.
 *
 * Subclasses must override {@link _createThreeLight} to return their
 * specific Three.js light type. The base class handles:
 * - Attaching / detaching the light from the Transform's scene graph
 * - Syncing color, intensity, and shadow parameters
 * - Lifecycle (onAwake, onDestroy, onEnable, onDisable)
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Light`.
 *
 * Available subclasses:
 * - {@link DirectionalLight} — sunlight (parallel rays from infinity)
 * - `PointLight` — omni-directional (like a lightbulb) *(future)*
 * - `SpotLight` — cone-shaped (like a flashlight) *(future)*
 *
 * **Three.js isolation:**
 * The internal Three.js light is never exposed in public API.
 * Engine code accesses it via the `@internal` accessor
 * {@link _internalThreeLight}.
 */
export abstract class Light extends Behaviour {

    /** @internal Number of currently active Light components. */
    public static _activeLightCount: number = 0;

    // ==================== INTERNAL THREE.JS STATE ====================

    /**
     * The underlying Three.js light object.
     * @internal
     */
    private _threeLight: THREE.Light | null = null;

    // ==================== ENGINE PROPERTIES ====================

    /** Light color. */
    private _color: Color = Color.white;

    /** Light brightness multiplier. */
    private _intensity: number = 1;

    /** Bounce intensity for global illumination (reserved for future GI). */
    private _bounceIntensity: number = 1;

    /** Shadow strength (0 = transparent, 1 = full). */
    private _shadowStrength: number = 1;

    /** Shadow mode. */
    private _shadows: LightShadows = LightShadows.None;

    /** Shadow map resolution. */
    private _shadowResolution: LightShadowResolution = LightShadowResolution.High;

    /** Shadow depth bias (prevents shadow acne). */
    private _shadowBias: number = 0.005;

    /** Shadow normal bias. */
    private _shadowNormalBias: number = 0.1;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "Light";
    }

    // ==================== ABSTRACT ====================

    /**
     * Creates the specific Three.js light for this light type.
     *
     * Called once during {@link onAwake}. Subclasses return their
     * specific light type (e.g. `new THREE.DirectionalLight()`).
     *
     * The returned light is automatically attached to the Transform's
     * scene graph, and initial engine properties (color, intensity,
     * shadows) are synced to it.
     *
     * @internal
     */
    protected abstract _createThreeLight(): THREE.Light;

    // ==================== INTERNAL ACCESSOR ====================

    /**
     * @internal
     * The underlying Three.js light, used by engine subsystems.
     *
     * **NEVER use in user-facing code.**
     */
    public get _internalThreeLight(): THREE.Light | null {
        return this._threeLight;
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Creates the Three.js light (via subclass factory), syncs engine
     * properties, and attaches as an internal child of the Transform.
     */
    protected override onAwake(): void {
        // 1. Let subclass create the specific light type
        this._threeLight = this._createThreeLight();

        // 2. Sync all engine state to the Three.js light
        this._syncColorAndIntensity();
        this._syncShadowSettings();

        // 3. Attach to Transform scene graph
        this.gameObject.transform._addInternalChild(this._threeLight);
    }

    /**
     * @internal
     * Detaches the Three.js light from the Transform.
     */
    protected override onDestroy(): void {
        if (this._threeLight !== null) {
            this.gameObject.transform._removeInternalChild(this._threeLight);
            if ("dispose" in this._threeLight && typeof this._threeLight.dispose === "function") {
                this._threeLight.dispose();
            }
            this._threeLight = null;
        }
    }

    /**
     * @internal
     * Makes the light visible when the component becomes active.
     */
    protected override onEnable(): void {
        Light._activeLightCount++;
        if (this._threeLight !== null) {
            this._threeLight.visible = true;
        }
    }

    /**
     * @internal
     * Hides the light when the component becomes inactive.
     */
    protected override onDisable(): void {
        Light._activeLightCount--;
        if (this._threeLight !== null) {
            this._threeLight.visible = false;
        }
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The color of the light.
     *
     * @remarks Equivalent to Unity's `Light.color`.
     */
    public get color(): Color {
        return this._color.clone();
    }

    public set color(value: Color) {
        this._color = value.clone();
        this._syncColorAndIntensity();
    }

    /**
     * The brightness of the light (1 = normal).
     *
     * @remarks Equivalent to Unity's `Light.intensity`.
     */
    public get intensity(): number {
        return this._intensity;
    }

    public set intensity(value: number) {
        this._intensity = Math.max(0, value);
        this._syncColorAndIntensity();
    }

    /**
     * Bounce intensity for global illumination (reserved).
     *
     * @remarks Equivalent to Unity's `Light.bounceIntensity`.
     */
    public get bounceIntensity(): number {
        return this._bounceIntensity;
    }

    public set bounceIntensity(value: number) {
        this._bounceIntensity = Math.max(0, value);
    }

    /**
     * Shadow strength (0 = transparent shadows, 1 = fully opaque).
     *
     * @remarks Equivalent to Unity's `Light.shadowStrength`.
     */
    public get shadowStrength(): number {
        return this._shadowStrength;
    }

    public set shadowStrength(value: number) {
        this._shadowStrength = Math.max(0, Math.min(1, value));
    }

    // ==================== SHADOW PROPERTIES ====================

    /**
     * The shadow casting mode for this light.
     *
     * @remarks Equivalent to Unity's `Light.shadows`.
     */
    public get shadows(): LightShadows {
        return this._shadows;
    }

    public set shadows(value: LightShadows) {
        if (this._shadows === value) return;
        this._shadows = value;
        this._syncShadowSettings();
    }

    /**
     * The shadow map resolution.
     *
     * @remarks Equivalent to Unity's `Light.shadowResolution`.
     */
    public get shadowResolution(): LightShadowResolution {
        return this._shadowResolution;
    }

    public set shadowResolution(value: LightShadowResolution) {
        if (this._shadowResolution === value) return;
        this._shadowResolution = value;
        this._syncShadowSettings();
    }

    /**
     * Depth bias for shadow mapping (prevents shadow acne).
     *
     * Higher values reduce acne but may cause "peter panning"
     * (shadows detaching from objects).
     *
     * @remarks Equivalent to Unity's `Light.shadowBias`.
     */
    public get shadowBias(): number {
        return this._shadowBias;
    }

    public set shadowBias(value: number) {
        this._shadowBias = value;
        this._syncShadowBias();
    }

    /**
     * Normal bias for shadow mapping.
     *
     * @remarks Equivalent to Unity's `Light.shadowNormalBias`.
     */
    public get shadowNormalBias(): number {
        return this._shadowNormalBias;
    }

    public set shadowNormalBias(value: number) {
        this._shadowNormalBias = value;
        this._syncShadowBias();
    }

    // ==================== PRIVATE SYNC HELPERS ====================

    /**
     * @internal Pushes color and intensity to the Three.js light.
     */
    private _syncColorAndIntensity(): void {
        if (this._threeLight === null) return;
        this._threeLight.color.setHex(this._color.getHex());
        this._threeLight.intensity = this._intensity;
    }

    /**
     * @internal Pushes shadow enable/resolution to the Three.js light.
     */
    private _syncShadowSettings(): void {
        if (this._threeLight === null) return;

        const castsShadow = this._shadows !== LightShadows.None;

        // castShadow is on THREE.Object3D but only lights actually use it
        this._threeLight.castShadow = castsShadow;

        // Shadow map resolution — only applies to lights that have .shadow
        const shadow = (this._threeLight as unknown as { shadow?: THREE.LightShadow }).shadow;
        if (shadow) {
            shadow.mapSize.width = this._shadowResolution;
            shadow.mapSize.height = this._shadowResolution;

            // If shadow map type changes (soft vs hard), set Three.js shadow type
            // This is renderer-level in Three.js, but we store the preference per-light
            // for Unity compatibility.
        }

        this._syncShadowBias();
    }

    /**
     * @internal Pushes shadow bias values to the Three.js light shadow.
     */
    private _syncShadowBias(): void {
        if (this._threeLight === null) return;

        const shadow = (this._threeLight as unknown as { shadow?: THREE.LightShadow }).shadow;
        if (shadow) {
            shadow.bias = this._shadowBias;
            shadow.normalBias = this._shadowNormalBias;
        }
    }
}

profilerHooks.lightCount = () => Light._activeLightCount;