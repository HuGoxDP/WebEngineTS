import * as THREE from "three";
import { Material } from "./Material";
import { Shader } from "./Shader";
import { Color } from "./Color";
import { Texture2D } from "./Texture2D";

/**
 * Режим рендерингу матеріалу (відповідає Unity).
 */
export enum MaterialRenderMode {
    /** Непрозорий (за замовчуванням) */
    Opaque,
    /** Обрізання по альфа-каналу (cutout) */
    Cutout,
    /** Плавне затухання прозорості */
    Fade,
    /** Повна прозорість */
    Transparent
}

/**
 * Standard матеріал - PBR (Physically Based Rendering).
 * Повна імітація Unity StandardMaterial.
 * 
 * Внутрішньо використовує THREE.MeshStandardMaterial.
 */
export class StandardMaterial extends Material {
    /**
     * Створює новий Standard матеріал.
     */
    constructor() {
        super(Shader.Standard);
        this.name = "Standard Material";

        // Ініціалізуємо дефолтні значення
        this.albedoColor = Color.white;
        this.metallic = 0;
        this.smoothness = 0.5;
        this.normalScale = 1;
        this.occlusionStrength = 1;
        this.emissionColor = Color.black;
        this.renderMode = MaterialRenderMode.Opaque;
        this.alphaCutoff = 0.5;
    }

    // === Albedo (основний колір) ===

    /** Колір альбедо */
    public get albedoColor(): Color {
        return this.getColor("_Color");
    }

    public set albedoColor(value: Color) {
        this.setColor("_Color", value);
    }

    /** Текстура альбедо */
    public get albedoTexture(): Texture2D | null {
        return this.getTexture("_MainTex") as Texture2D;
    }

    public set albedoTexture(value: Texture2D | null) {
        this.setTexture("_MainTex", value);
    }

    // === Metallic Workflow ===

    /** Металічність (0 = діелектрик, 1 = метал) */
    public get metallic(): number {
        return this.getFloat("_Metallic");
    }

    public set metallic(value: number) {
        this.setFloat("_Metallic", Math.max(0, Math.min(1, value)));
    }

    /** Текстура металічності (R канал) */
    public get metallicTexture(): Texture2D | null {
        return this.getTexture("_MetallicGlossMap") as Texture2D;
    }

    public set metallicTexture(value: Texture2D | null) {
        this.setTexture("_MetallicGlossMap", value);
    }

    /** 
     * Гладкість (smoothness) - 0 = шорсткий, 1 = гладкий.
     * Unity використовує smoothness, Three.js - roughness (1 - smoothness).
     */
    public get smoothness(): number {
        return this.getFloat("_Glossiness");
    }

    public set smoothness(value: number) {
        this.setFloat("_Glossiness", Math.max(0, Math.min(1, value)));
    }

    /** Скалювання карти гладкості */
    public get glossMapScale(): number {
        return this.getFloat("_GlossMapScale");
    }

    public set glossMapScale(value: number) {
        this.setFloat("_GlossMapScale", value);
    }

    // === Normal Mapping ===

    /** Текстура нормалей (normal map) */
    public get normalTexture(): Texture2D | null {
        return this.getTexture("_BumpMap") as Texture2D;
    }

    public set normalTexture(value: Texture2D | null) {
        this.setTexture("_BumpMap", value);
        
        // В Three.js потрібно встановити normalScale
        if (value) {
            const mat = this._threeMaterial as THREE.MeshStandardMaterial;
            if (!mat.normalScale) {
                mat.normalScale = new THREE.Vector2(1, 1);
            }
        }
    }

    /** Сила normal map */
    public get normalScale(): number {
        return this.getFloat("_BumpScale");
    }

    public set normalScale(value: number) {
        this.setFloat("_BumpScale", value);
    }

    // === Height Mapping (Parallax) ===

    /** Текстура висоти (height/parallax map) */
    public get heightTexture(): Texture2D | null {
        return this.getTexture("_ParallaxMap") as Texture2D;
    }

    public set heightTexture(value: Texture2D | null) {
        this.setTexture("_ParallaxMap", value);
        
        if (value) {
            (this._threeMaterial as any).displacementMap = value._threeTexture;
        } else {
            (this._threeMaterial as any).displacementMap = null;
        }
        this._threeMaterial.needsUpdate = true;
    }

    /** Сила parallax ефекту */
    public get heightScale(): number {
        return this.getFloat("_Parallax");
    }

    public set heightScale(value: number) {
        this.setFloat("_Parallax", value);
        (this._threeMaterial as any).displacementScale = value;
    }

    // === Occlusion ===

    /** Текстура ambient occlusion */
    public get occlusionTexture(): Texture2D | null {
        return this.getTexture("_OcclusionMap") as Texture2D;
    }

    public set occlusionTexture(value: Texture2D | null) {
        this.setTexture("_OcclusionMap", value);
    }

    /** Сила ambient occlusion */
    public get occlusionStrength(): number {
        return this.getFloat("_OcclusionStrength");
    }

    public set occlusionStrength(value: number) {
        this.setFloat("_OcclusionStrength", Math.max(0, Math.min(1, value)));
    }

    // === Emission ===

    /** Колір свічення (emission) */
    public get emissionColor(): Color {
        return this.getColor("_EmissionColor");
    }

    public set emissionColor(value: Color) {
        this.setColor("_EmissionColor", value);
        
        // В Three.js потрібно встановити emissiveIntensity
        const intensity = Math.max(value.r, value.g, value.b);
        (this._threeMaterial as any).emissiveIntensity = intensity;
    }

    /** Текстура свічення */
    public get emissionTexture(): Texture2D | null {
        return this.getTexture("_EmissionMap") as Texture2D;
    }

    public set emissionTexture(value: Texture2D | null) {
        this.setTexture("_EmissionMap", value);
    }

    // === Detail Textures (опціонально) ===

    /** Текстура деталей альбедо */
    public get detailAlbedoTexture(): Texture2D | null {
        return this.getTexture("_DetailAlbedoMap") as Texture2D;
    }

    public set detailAlbedoTexture(value: Texture2D | null) {
        this.setTexture("_DetailAlbedoMap", value);
    }

    /** Текстура деталей нормалей */
    public get detailNormalTexture(): Texture2D | null {
        return this.getTexture("_DetailNormalMap") as Texture2D;
    }

    public set detailNormalTexture(value: Texture2D | null) {
        this.setTexture("_DetailNormalMap", value);
    }

    /** Маска деталей */
    public get detailMask(): Texture2D | null {
        return this.getTexture("_DetailMask") as Texture2D;
    }

    public set detailMask(value: Texture2D | null) {
        this.setTexture("_DetailMask", value);
    }

    // === Rendering Mode ===

    /** Режим рендерингу (Opaque, Cutout, Fade, Transparent) */
    public get renderMode(): MaterialRenderMode {
        const mode = this.getInt("_Mode");
        return mode as MaterialRenderMode || MaterialRenderMode.Opaque;
    }

    public set renderMode(value: MaterialRenderMode) {
        this.setInt("_Mode", value);
        this.updateRenderMode(value);
    }

    /** Поріг відсікання альфа-каналу (для Cutout режиму) */
    public get alphaCutoff(): number {
        return this.getFloat("_Cutoff");
    }

    public set alphaCutoff(value: number) {
        this.setFloat("_Cutoff", Math.max(0, Math.min(1, value)));
        (this._threeMaterial as any).alphaTest = value;
    }

    /**
     * Оновлює налаштування THREE.Material на основі режиму рендерингу.
     */
    private updateRenderMode(mode: MaterialRenderMode): void {
        const mat = this._threeMaterial as THREE.MeshStandardMaterial;

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

    // === Допоміжні методи ===

    /**
     * Встановлює матеріал як метал з вказаною гладкістю.
     */
    public setMetallic(metallicValue: number, smoothnessValue: number): void {
        this.metallic = metallicValue;
        this.smoothness = smoothnessValue;
    }

    /**
     * Встановлює емісію (свічення).
     */
    public setEmission(color: Color, intensity: number = 1): void {
        const scaledColor = color.clone().multiplyScalar(intensity);
        this.emissionColor = scaledColor;
    }

    /**
     * Робить матеріал прозорим.
     */
    public makeTransparent(alpha: number = 0.5): void {
        this.renderMode = MaterialRenderMode.Transparent;
        const col = this.albedoColor;
        col.a = alpha;
        this.albedoColor = col;
    }
}
