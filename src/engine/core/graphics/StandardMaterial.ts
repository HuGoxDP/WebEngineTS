// path: src/engine/core/graphics/StandardMaterial.ts

import * as THREE from "three";
import { Material } from "./Material.ts";
import { Shader } from "./Shader.ts";
import { Color } from "../math/Color.ts";
import { Texture2D } from "./Texture2D.ts";

/**
 * Rendering mode for a Standard material.
 *
 * @remarks
 * Equivalent to Unity's rendering mode dropdown on Standard shader materials.
 */
export enum MaterialRenderMode {
    /** Fully opaque (default). */
    Opaque = 0,
    /** Alpha cutout — pixels below threshold are discarded. */
    Cutout = 1,
    /** Fade transparency — alpha blending, no depth write. */
    Fade = 2,
    /** Full transparency — alpha blending with depth write. */
    Transparent = 3
}

/**
 * PBR (Physically Based Rendering) material.
 *
 * Provides a Unity-like Standard Shader material with metallic workflow.
 * Internally uses `THREE.MeshStandardMaterial`.
 *
 * @remarks
 * Equivalent to Unity's Standard Shader material.
 *
 * @example
 * ```ts
 * const mat = new StandardMaterial();
 * mat.albedoColor = Color.red;
 * mat.metallic = 0.8;
 * mat.smoothness = 0.6;
 * renderer.sharedMaterial = mat;
 * ```
 */
export class StandardMaterial extends Material {

    constructor() {
        super(Shader.Standard);
        this.name = "Standard Material";

        // Initialize defaults (match Unity Standard Shader defaults)
        this.albedoColor = Color.white;
        this.metallic = 0;
        this.smoothness = 0.5;
        this.normalScale = 1;
        this.occlusionStrength = 1;
        this.emissionColor = Color.black;
        this.renderMode = MaterialRenderMode.Opaque;
        this.alphaCutoff = 0.5;
    }

    // ==================== ALBEDO ====================

    /**
     * Albedo (base) color.
     * @remarks Equivalent to Unity's `_Color` property.
     */
    public get albedoColor(): Color {
        return this.getColor("_Color");
    }

    public set albedoColor(value: Color) {
        this.setColor("_Color", value);
    }

    /**
     * Albedo texture.
     * @remarks Equivalent to Unity's `_MainTex` property.
     */
    public get albedoTexture(): Texture2D | null {
        return this.getTexture("_MainTex") as Texture2D | null;
    }

    public set albedoTexture(value: Texture2D | null) {
        this.setTexture("_MainTex", value);
    }

    // ==================== METALLIC WORKFLOW ====================

    /**
     * Metallic amount (0 = dielectric, 1 = metal).
     * @remarks Equivalent to Unity's `_Metallic` property.
     */
    public get metallic(): number {
        return this.getFloat("_Metallic");
    }

    public set metallic(value: number) {
        this.setFloat("_Metallic", Math.max(0, Math.min(1, value)));
    }

    /**
     * Metallic/smoothness texture (R channel = metallic).
     * @remarks Equivalent to Unity's `_MetallicGlossMap` property.
     */
    public get metallicTexture(): Texture2D | null {
        return this.getTexture("_MetallicGlossMap") as Texture2D | null;
    }

    public set metallicTexture(value: Texture2D | null) {
        this.setTexture("_MetallicGlossMap", value);
    }

    /**
     * Smoothness (0 = rough, 1 = smooth).
     *
     * @remarks
     * Unity uses **smoothness**, Three.js uses **roughness** (= 1 − smoothness).
     * The conversion is handled automatically by `setFloat("_Glossiness", ...)`.
     */
    public get smoothness(): number {
        return this.getFloat("_Glossiness");
    }

    public set smoothness(value: number) {
        this.setFloat("_Glossiness", Math.max(0, Math.min(1, value)));
    }

    /**
     * Gloss map scale factor.
     * @remarks Equivalent to Unity's `_GlossMapScale` property.
     */
    public get glossMapScale(): number {
        return this.getFloat("_GlossMapScale");
    }

    public set glossMapScale(value: number) {
        this.setFloat("_GlossMapScale", value);
    }

    // ==================== NORMAL MAPPING ====================

    /**
     * Normal map texture.
     * @remarks Equivalent to Unity's `_BumpMap` property.
     */
    public get normalTexture(): Texture2D | null {
        return this.getTexture("_BumpMap") as Texture2D | null;
    }

    public set normalTexture(value: Texture2D | null) {
        this.setTexture("_BumpMap", value);

        // Ensure Three.js normalScale is initialized when a normal map is set
        if (value) {
            const mat = this._threeMatHandle as THREE.MeshStandardMaterial;
            if (!mat.normalScale) {
                mat.normalScale = new THREE.Vector2(1, 1);
            }
        }
    }

    /**
     * Normal map strength.
     * @remarks Equivalent to Unity's `_BumpScale` property.
     */
    public get normalScale(): number {
        return this.getFloat("_BumpScale");
    }

    public set normalScale(value: number) {
        this.setFloat("_BumpScale", value);
    }

    // ==================== HEIGHT MAPPING ====================

    /**
     * Height/parallax map texture.
     * @remarks Equivalent to Unity's `_ParallaxMap` property.
     */
    public get heightTexture(): Texture2D | null {
        return this.getTexture("_ParallaxMap") as Texture2D | null;
    }

    public set heightTexture(value: Texture2D | null) {
        this.setTexture("_ParallaxMap", value);

        // Sync displacement map to Three.js
        const mat = this._threeMatHandle as THREE.MeshStandardMaterial;
        if (value) {
            mat.displacementMap = value._internalThreeTexture;
        } else {
            mat.displacementMap = null;
        }
        mat.needsUpdate = true;
    }

    /**
     * Parallax effect strength.
     * @remarks Equivalent to Unity's `_Parallax` property.
     */
    public get heightScale(): number {
        return this.getFloat("_Parallax");
    }

    public set heightScale(value: number) {
        this.setFloat("_Parallax", value);
        (this._threeMatHandle as THREE.MeshStandardMaterial).displacementScale = value;
    }

    // ==================== OCCLUSION ====================

    /**
     * Ambient occlusion texture.
     * @remarks Equivalent to Unity's `_OcclusionMap` property.
     */
    public get occlusionTexture(): Texture2D | null {
        return this.getTexture("_OcclusionMap") as Texture2D | null;
    }

    public set occlusionTexture(value: Texture2D | null) {
        this.setTexture("_OcclusionMap", value);
    }

    /**
     * Ambient occlusion strength (0–1).
     * @remarks Equivalent to Unity's `_OcclusionStrength` property.
     */
    public get occlusionStrength(): number {
        return this.getFloat("_OcclusionStrength");
    }

    public set occlusionStrength(value: number) {
        this.setFloat("_OcclusionStrength", Math.max(0, Math.min(1, value)));
    }

    // ==================== EMISSION ====================

    /**
     * Emission color.
     * @remarks Equivalent to Unity's `_EmissionColor` property.
     */
    public get emissionColor(): Color {
        return this.getColor("_EmissionColor");
    }

    public set emissionColor(value: Color) {
        this.setColor("_EmissionColor", value);

        // Three.js needs emissiveIntensity synced separately
        const intensity = Math.max(value.r, value.g, value.b);
        (this._threeMatHandle as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
    }

    /**
     * Emission texture.
     * @remarks Equivalent to Unity's `_EmissionMap` property.
     */
    public get emissionTexture(): Texture2D | null {
        return this.getTexture("_EmissionMap") as Texture2D | null;
    }

    public set emissionTexture(value: Texture2D | null) {
        this.setTexture("_EmissionMap", value);
    }

    // ==================== DETAIL TEXTURES ====================

    /** Detail albedo texture. */
    public get detailAlbedoTexture(): Texture2D | null {
        return this.getTexture("_DetailAlbedoMap") as Texture2D | null;
    }

    public set detailAlbedoTexture(value: Texture2D | null) {
        this.setTexture("_DetailAlbedoMap", value);
    }

    /** Detail normal texture. */
    public get detailNormalTexture(): Texture2D | null {
        return this.getTexture("_DetailNormalMap") as Texture2D | null;
    }

    public set detailNormalTexture(value: Texture2D | null) {
        this.setTexture("_DetailNormalMap", value);
    }

    /** Detail mask. */
    public get detailMask(): Texture2D | null {
        return this.getTexture("_DetailMask") as Texture2D | null;
    }

    public set detailMask(value: Texture2D | null) {
        this.setTexture("_DetailMask", value);
    }

    // ==================== RENDERING MODE ====================

    /**
     * Rendering mode (Opaque, Cutout, Fade, Transparent).
     * @remarks Equivalent to Unity's Standard Shader rendering mode dropdown.
     */
    public get renderMode(): MaterialRenderMode {
        const mode = this.getInt("_Mode");
        return (mode as MaterialRenderMode) || MaterialRenderMode.Opaque;
    }

    public set renderMode(value: MaterialRenderMode) {
        this.setInt("_Mode", value);
        this._syncRenderMode(value);
    }

    /**
     * Alpha cutoff threshold (for Cutout mode).
     * @remarks Equivalent to Unity's `_Cutoff` property.
     */
    public get alphaCutoff(): number {
        return this.getFloat("_Cutoff");
    }

    public set alphaCutoff(value: number) {
        this.setFloat("_Cutoff", Math.max(0, Math.min(1, value)));
        (this._threeMatHandle as THREE.MeshStandardMaterial).alphaTest = value;
    }

    // ==================== HELPERS ====================

    /**
     * Convenience: set metallic and smoothness at once.
     */
    public setMetallic(metallicValue: number, smoothnessValue: number): void {
        this.metallic = metallicValue;
        this.smoothness = smoothnessValue;
    }

    /**
     * Convenience: set emission color with intensity.
     */
    public setEmission(color: Color, intensity: number = 1): void {
        const scaledColor = color.clone().multiplyScalar(intensity);
        this.emissionColor = scaledColor;
    }

    /**
     * Convenience: make this material transparent.
     */
    public makeTransparent(alpha: number = 0.5): void {
        this.renderMode = MaterialRenderMode.Transparent;
        const col = this.albedoColor;
        col.a = alpha;
        this.albedoColor = col;
    }

    // ==================== PRIVATE ====================

    /**
     * Syncs Three.js material state for the given render mode.
     */
    private _syncRenderMode(mode: MaterialRenderMode): void {
        const mat = this._threeMatHandle as THREE.MeshStandardMaterial;

        switch (mode) {
            case MaterialRenderMode.Opaque:
                mat.transparent = false;
                mat.alphaTest = 0;
                mat.depthWrite = true;
                break;

            case MaterialRenderMode.Cutout:
                mat.transparent = false;
                mat.alphaTest = this.alphaCutoff;
                mat.depthWrite = true;
                break;

            case MaterialRenderMode.Fade:
            case MaterialRenderMode.Transparent:
                mat.transparent = true;
                mat.alphaTest = 0;
                mat.depthWrite = false;
                break;
        }

        mat.needsUpdate = true;
    }
}