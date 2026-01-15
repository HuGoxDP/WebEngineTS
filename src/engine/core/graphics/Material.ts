import * as THREE from "three";
import { EngineObject } from "../EngineObject";
import { Shader } from "./Shader";
import { Color } from "./Color";
import { Texture } from "./Texture";
import { Vector2 } from "../math/Vector2";
import { Vector4 } from "../math/Vector4";
import { Matrix4x4 } from "../math/Matrix4x4";

/**
 * Базовий клас для всіх матеріалів.
 * Повна імітація Unity Material API.
 * 
 * Material зберігає властивості (колір, текстури, float значення) та посилання на Shader.
 * Внутрішньо використовує THREE.Material, але користувач цього не бачить.
 */
export class Material extends EngineObject {
    /** 
     * @internal - НЕ використовувати напряму!
     * Внутрішній THREE.js матеріал
     */
    public _threeMaterial: THREE.Material;

    /** Шейдер матеріалу */
    private _shader: Shader;

    /** Черга рендерингу (менше = раніше) */
    private _renderQueue: number = 2000;

    /** Увімкнені ключові слова шейдера */
    private _keywords: Set<string> = new Set();

    /** Кастомні властивості матеріалу */
    private _properties: Map<string, any> = new Map();

    /**
     * Створює новий матеріал з вказаним шейдером.
     * @param shader Шейдер для матеріалу
     */
    constructor(shader: Shader);
    
    /**
     * Створює копію матеріалу.
     * @param source Вихідний матеріал для копіювання
     */
    constructor(source: Material);
    
    constructor(shaderOrSource: Shader | Material) {
        super("Material");

        if (shaderOrSource instanceof Material) {
            // Копіюємо з іншого матеріалу
            const source = shaderOrSource;
            this._shader = source._shader;
            this._renderQueue = source._renderQueue;
            this._keywords = new Set(source._keywords);
            this._properties = new Map(source._properties);
            
            // Клонуємо THREE.Material
            this._threeMaterial = source._threeMaterial.clone();
            this.name = source.name + " (Instance)";
        } else {
            // Створюємо з шейдера
            this._shader = shaderOrSource;
            this._threeMaterial = this.createThreeMaterial(this._shader);
            this.name = `Material (${this._shader.shaderName})`;
        }
    }

    // === Властивості ===

    /** Шейдер матеріалу */
    public get shader(): Shader {
        return this._shader;
    }

    public set shader(value: Shader) {
        if (this._shader === value) return;
        
        // Змінюємо шейдер - потрібно пересоздати THREE.Material
        this._shader = value;
        const oldMaterial = this._threeMaterial;
        this._threeMaterial = this.createThreeMaterial(value);
        
        // Копіюємо базові властивості
        this._threeMaterial.transparent = oldMaterial.transparent;
        
        oldMaterial.dispose();
    }

    /** Головний колір матеріалу */
    public get color(): Color {
        return this.getColor("_Color");
    }

    public set color(value: Color) {
        this.setColor("_Color", value);
    }

    /** Головна текстура матеріалу */
    public get mainTexture(): Texture | null {
        return this.getTexture("_MainTex");
    }

    public set mainTexture(value: Texture | null) {
        this.setTexture("_MainTex", value);
    }

    /** Offset головної текстури */
    public get mainTextureOffset(): Vector2 {
        return this.getTextureOffset("_MainTex");
    }

    public set mainTextureOffset(value: Vector2) {
        this.setTextureOffset("_MainTex", value);
    }

    /** Масштаб головної текстури */
    public get mainTextureScale(): Vector2 {
        return this.getTextureScale("_MainTex");
    }

    public set mainTextureScale(value: Vector2) {
        this.setTextureScale("_MainTex", value);
    }

    /** Черга рендерингу */
    public get renderQueue(): number {
        return this._renderQueue;
    }

    public set renderQueue(value: number) {
        this._renderQueue = value;
    }

    // === Методи для роботи з властивостями ===

    /**
     * Перевіряє, чи матеріал має властивість.
     * @param propertyName Ім'я властивості (наприклад "_Color")
     */
    public hasProperty(propertyName: string): boolean {
        return this._shader.hasProperty(propertyName) || this._properties.has(propertyName);
    }

    /**
     * Отримує колір за іменем властивості.
     */
    public getColor(propertyName: string): Color {
        if (this._properties.has(propertyName)) {
            return (this._properties.get(propertyName) as Color).clone();
        }

        // За замовчуванням білий
        return Color.white;
    }

    /**
     * Встановлює колір для властивості.
     */
    public setColor(propertyName: string, value: Color): void {
        this._properties.set(propertyName, value.clone());
        
        // Оновлюємо THREE.Material
        if (propertyName === "_Color") {
            (this._threeMaterial as any).color?.setHex(value.getHex());
            (this._threeMaterial as any).opacity = value.a;
        } else if (propertyName === "_EmissionColor") {
            (this._threeMaterial as any).emissive?.setHex(value.getHex());
        } else if (propertyName === "_SpecColor") {
            (this._threeMaterial as any).specular?.setHex(value.getHex());
        }
    }

    /**
     * Отримує float значення за іменем властивості.
     */
    public getFloat(propertyName: string): number {
        if (this._properties.has(propertyName)) {
            return this._properties.get(propertyName) as number;
        }
        return 0;
    }

    /**
     * Встановлює float значення для властивості.
     */
    public setFloat(propertyName: string, value: number): void {
        this._properties.set(propertyName, value);
        
        // Оновлюємо THREE.Material
        if (propertyName === "_Metallic") {
            (this._threeMaterial as any).metalness = value;
        } else if (propertyName === "_Glossiness") {
            (this._threeMaterial as any).roughness = 1.0 - value; // Unity Smoothness = 1 - Roughness
        } else if (propertyName === "_BumpScale") {
            (this._threeMaterial as any).normalScale?.set(value, value);
        } else if (propertyName === "_OcclusionStrength") {
            (this._threeMaterial as any).aoMapIntensity = value;
        } else if (propertyName === "_Shininess") {
            (this._threeMaterial as any).shininess = value;
        }
    }

    /**
     * Отримує int значення за іменем властивості.
     */
    public getInt(propertyName: string): number {
        return Math.floor(this.getFloat(propertyName));
    }

    /**
     * Встановлює int значення для властивості.
     */
    public setInt(propertyName: string, value: number): void {
        this.setFloat(propertyName, Math.floor(value));
    }

    /**
     * Отримує Vector4 за іменем властивості.
     */
    public getVector(propertyName: string): Vector4 {
        if (this._properties.has(propertyName)) {
            return (this._properties.get(propertyName) as Vector4).clone();
        }
        return Vector4.zero;
    }

    /**
     * Встановлює Vector4 для властивості.
     */
    public setVector(propertyName: string, value: Vector4): void {
        this._properties.set(propertyName, value.clone());
    }

    /**
     * Отримує Matrix4x4 за іменем властивості.
     */
    public getMatrix(propertyName: string): Matrix4x4 {
        if (this._properties.has(propertyName)) {
            return (this._properties.get(propertyName) as Matrix4x4).clone();
        }
        return Matrix4x4.identity;
    }

    /**
     * Встановлює Matrix4x4 для властивості.
     */
    public setMatrix(propertyName: string, value: Matrix4x4): void {
        this._properties.set(propertyName, value.clone());
    }

    /**
     * Отримує текстуру за іменем властивості.
     */
    public getTexture(propertyName: string): Texture | null {
        if (this._properties.has(propertyName)) {
            return this._properties.get(propertyName) as Texture;
        }
        return null;
    }

    /**
     * Встановлює текстуру для властивості.
     */
    public setTexture(propertyName: string, value: Texture | null): void {
        this._properties.set(propertyName, value);
        
        // Оновлюємо THREE.Material
        const threeTexture = value ? value._threeTexture : null;
        
        if (propertyName === "_MainTex") {
            (this._threeMaterial as any).map = threeTexture;
        } else if (propertyName === "_BumpMap") {
            (this._threeMaterial as any).normalMap = threeTexture;
        } else if (propertyName === "_MetallicGlossMap") {
            (this._threeMaterial as any).metalnessMap = threeTexture;
            (this._threeMaterial as any).roughnessMap = threeTexture;
        } else if (propertyName === "_OcclusionMap") {
            (this._threeMaterial as any).aoMap = threeTexture;
        } else if (propertyName === "_EmissionMap") {
            (this._threeMaterial as any).emissiveMap = threeTexture;
        }
        
        this._threeMaterial.needsUpdate = true;
    }

    /**
     * Отримує offset текстури.
     */
    public getTextureOffset(propertyName: string): Vector2 {
        const texture = this.getTexture(propertyName);
        if (texture) {
            const offset = texture._threeTexture.offset;
            return new Vector2(offset.x, offset.y);
        }
        return Vector2.zero;
    }

    /**
     * Встановлює offset текстури.
     */
    public setTextureOffset(propertyName: string, value: Vector2): void {
        const texture = this.getTexture(propertyName);
        if (texture) {
            texture.setOffset(value.x, value.y);
        }
    }

    /**
     * Отримує масштаб (tiling) текстури.
     */
    public getTextureScale(propertyName: string): Vector2 {
        const texture = this.getTexture(propertyName);
        if (texture) {
            const repeat = texture._threeTexture.repeat;
            return new Vector2(repeat.x, repeat.y);
        }
        return Vector2.one;
    }

    /**
     * Встановлює масштаб (tiling) текстури.
     */
    public setTextureScale(propertyName: string, value: Vector2): void {
        const texture = this.getTexture(propertyName);
        if (texture) {
            texture.setTiling(value.x, value.y);
        }
    }

    // === Система ключових слів (keywords) ===

    /**
     * Вмикає ключове слово шейдера.
     */
    public enableKeyword(keyword: string): void {
        this._keywords.add(keyword);
    }

    /**
     * Вимикає ключове слово шейдера.
     */
    public disableKeyword(keyword: string): void {
        this._keywords.delete(keyword);
    }

    /**
     * Перевіряє, чи увімкнено ключове слово.
     */
    public isKeywordEnabled(keyword: string): boolean {
        return this._keywords.has(keyword);
    }

    // === Копіювання ===

    /**
     * Копіює властивості з іншого матеріалу.
     */
    public copyPropertiesFromMaterial(source: Material): void {
        this._properties = new Map(source._properties);
        this._keywords = new Set(source._keywords);
        this._renderQueue = source._renderQueue;
        
        // Оновлюємо THREE.Material
        this._threeMaterial.needsUpdate = true;
    }

    // === Приватні методи ===

    /**
     * Створює відповідний THREE.Material на основі шейдера.
     */
    private createThreeMaterial(shader: Shader): THREE.Material {
        const materialType = shader._threeMaterialType;

        switch (materialType) {
            case "MeshStandardMaterial":
                return new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    metalness: 0,
                    roughness: 1
                });

            case "MeshBasicMaterial":
                return new THREE.MeshBasicMaterial({
                    color: 0xffffff
                });

            case "MeshLambertMaterial":
                return new THREE.MeshLambertMaterial({
                    color: 0xffffff
                });

            case "MeshPhongMaterial":
                return new THREE.MeshPhongMaterial({
                    color: 0xffffff,
                    shininess: 30
                });

            default:
                console.warn(`Material: Невідомий тип матеріалу ${materialType}, використовуємо Standard`);
                return new THREE.MeshStandardMaterial();
        }
    }

    // === Знищення ===

    protected override onDestroy(): void {
        this._threeMaterial.dispose();
        this._properties.clear();
        this._keywords.clear();
    }
}
