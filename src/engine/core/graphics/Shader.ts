import { EngineObject } from "../EngineObject";

/**
 * Типи властивостей шейдерів (відповідає Unity ShaderPropertyType).
 */
export enum ShaderPropertyType {
    Color,
    Vector,
    Float,
    Range,
    Texture,
    Int
}

/**
 * Представлення шейдера.
 * В Unity шейдер - це окремий assets файл, тут це абстракція над Three.js матеріалами.
 * 
 * ⚠️ Користувач НЕ пише GLSL напряму! Він використовує вбудовані шейдери.
 * Внутрішньо кожен Shader відповідає типу THREE.Material.
 */
export class Shader extends EngineObject {
    /** Ім'я шейдера (наприклад "Standard", "Unlit") */
    private _shaderName: string;

    /** Чи підтримується шейдер на поточній платформі */
    private _isSupported: boolean = true;

    /** 
     * Тип Three.js матеріалу, який використовує цей шейдер.
     * @internal - НЕ використовувати напряму!
     */
    public readonly _threeMaterialType: string;

    /**
     * Властивості шейдера (для Material.setFloat, setColor і т.д.)
     * @internal
     */
    public readonly _properties: Map<string, ShaderPropertyType> = new Map();

    constructor(shaderName: string, threeMaterialType: string) {
        super(`Shader:${shaderName}`);
        this._shaderName = shaderName;
        this._threeMaterialType = threeMaterialType;
    }

    // === Властивості ===

    /** Чи підтримується шейдер на поточній платформі */
    public get isSupported(): boolean {
        return this._isSupported;
    }

    /** Ім'я шейдера */
    public get shaderName(): string {
        return this._shaderName;
    }

    // === Методи ===

    /**
     * Отримує тип властивості шейдера за ім'ям.
     * @param propertyName Ім'я властивості (наприклад "_Color", "_MainTex")
     */
    public getPropertyType(propertyName: string): ShaderPropertyType | null {
        return this._properties.get(propertyName) || null;
    }

    /**
     * Знаходить індекс властивості (для сумісності з Unity API).
     * @param propertyName Ім'я властивості
     */
    public findPropertyIndex(propertyName: string): number {
        const keys = Array.from(this._properties.keys());
        return keys.indexOf(propertyName);
    }

    /**
     * Перевіряє, чи шейдер має властивість.
     * @param propertyName Ім'я властивості
     */
    public hasProperty(propertyName: string): boolean {
        return this._properties.has(propertyName);
    }

    /**
     * Додає властивість до шейдера.
     * @internal - Використовується тільки при створенні вбудованих шейдерів
     */
    public _addProperty(propertyName: string, propertyType: ShaderPropertyType): void {
        this._properties.set(propertyName, propertyType);
    }

    // === Статичні вбудовані шейдери ===

    private static _standardShader: Shader | null = null;
    private static _unlitShader: Shader | null = null;
    private static _diffuseShader: Shader | null = null;
    private static _specularShader: Shader | null = null;
    private static _transparentShader: Shader | null = null;

    /** Реєстр всіх шейдерів за ім'ям */
    private static _shaderRegistry: Map<string, Shader> = new Map();

    /**
     * Знаходить шейдер за ім'ям.
     * @param name Ім'я шейдера (наприклад "Standard", "Unlit")
     */
    public static Find(name: string): Shader | null {
        return Shader._shaderRegistry.get(name) || null;
    }

    /**
     * Реєструє шейдер у системі.
     * @internal
     */
    private static _registerShader(shader: Shader): void {
        Shader._shaderRegistry.set(shader.shaderName, shader);
    }

    /**
     * Standard шейдер - PBR (Physically Based Rendering).
     * Використовує THREE.MeshStandardMaterial.
     */
    public static get Standard(): Shader {
        if (!Shader._standardShader) {
            const shader = new Shader("Standard", "MeshStandardMaterial");
            
            // Додаємо властивості Standard шейдера
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_Metallic", ShaderPropertyType.Float);
            shader._addProperty("_MetallicGlossMap", ShaderPropertyType.Texture);
            shader._addProperty("_Glossiness", ShaderPropertyType.Float);
            shader._addProperty("_GlossMapScale", ShaderPropertyType.Float);
            shader._addProperty("_BumpMap", ShaderPropertyType.Texture);
            shader._addProperty("_BumpScale", ShaderPropertyType.Float);
            shader._addProperty("_OcclusionMap", ShaderPropertyType.Texture);
            shader._addProperty("_OcclusionStrength", ShaderPropertyType.Float);
            shader._addProperty("_EmissionColor", ShaderPropertyType.Color);
            shader._addProperty("_EmissionMap", ShaderPropertyType.Texture);
            
            Shader._standardShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._standardShader;
    }

    /**
     * Unlit шейдер - без освітлення.
     * Використовує THREE.MeshBasicMaterial.
     */
    public static get Unlit(): Shader {
        if (!Shader._unlitShader) {
            const shader = new Shader("Unlit", "MeshBasicMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            
            Shader._unlitShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._unlitShader;
    }

    /**
     * Diffuse шейдер - Lambert освітлення (простий дифузний).
     * Використовує THREE.MeshLambertMaterial.
     */
    public static get Diffuse(): Shader {
        if (!Shader._diffuseShader) {
            const shader = new Shader("Diffuse", "MeshLambertMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_EmissionColor", ShaderPropertyType.Color);
            shader._addProperty("_EmissionMap", ShaderPropertyType.Texture);
            
            Shader._diffuseShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._diffuseShader;
    }

    /**
     * Specular шейдер - Blinn-Phong освітлення (з відблисками).
     * Використовує THREE.MeshPhongMaterial.
     */
    public static get Specular(): Shader {
        if (!Shader._specularShader) {
            const shader = new Shader("Specular", "MeshPhongMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_SpecColor", ShaderPropertyType.Color);
            shader._addProperty("_Shininess", ShaderPropertyType.Float);
            shader._addProperty("_BumpMap", ShaderPropertyType.Texture);
            shader._addProperty("_BumpScale", ShaderPropertyType.Float);
            shader._addProperty("_EmissionColor", ShaderPropertyType.Color);
            shader._addProperty("_EmissionMap", ShaderPropertyType.Texture);
            
            Shader._specularShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._specularShader;
    }

    /**
     * Transparent шейдер - прозорий Standard.
     * Використовує THREE.MeshStandardMaterial з прозорістю.
     */
    public static get Transparent(): Shader {
        if (!Shader._transparentShader) {
            const shader = new Shader("Transparent", "MeshStandardMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_Metallic", ShaderPropertyType.Float);
            shader._addProperty("_Glossiness", ShaderPropertyType.Float);
            shader._addProperty("_BumpMap", ShaderPropertyType.Texture);
            shader._addProperty("_BumpScale", ShaderPropertyType.Float);
            
            Shader._transparentShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._transparentShader;
    }

    /**
     * VertexLit шейдер - просте освітлення (Legacy).
     * Використовує THREE.MeshPhongMaterial з простими налаштуваннями.
     */
    private static _vertexLitShader: Shader | null = null;
    
    public static get VertexLit(): Shader {
        if (!Shader._vertexLitShader) {
            const shader = new Shader("VertexLit", "MeshPhongMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_Shininess", ShaderPropertyType.Float);
            
            Shader._vertexLitShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._vertexLitShader;
    }
}
