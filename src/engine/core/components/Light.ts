import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { Color } from "../graphics/Color";
import type { GameObject } from "../GameObject";

/**
 * Режим тіней для світла.
 */
export enum LightShadows {
    /** Без тіней */
    None = 0,
    
    /** Жорсткі краї тіней */
    Hard = 1,
    
    /** М'які краї тіней (anti-aliased) */
    Soft = 2
}

/**
 * Роздільність карти тіней.
 */
export enum LightShadowResolution {
    /** 512x512 (швидко) */
    Low = 0,
    
    /** 1024x1024 (нормально) */
    Medium = 1,
    
    /** 2048x2048 (гарно) */
    High = 2,
    
    /** 4096x4096 (дорого) */
    VeryHigh = 3
}

/**
 * Базовий компонент для світла у сцені.
 * Повна імітація Unity Light.
 * 
 * Це абстрактний клас. Використовуйте:
 * - DirectionalLight — сонячне світло
 * - PointLight — точкове світло (від лампочки)
 * - SpotLight — прожектор
 */
export abstract class Light extends Behaviour {
    /**
     * @internal - НЕ використовувати напряму!
     * THREE.js світло
     */
    public _threeLight: THREE.Light | null = null;

    /** Колір світла */
    private _color: Color = Color.white;

    /** Інтенсивність світла */
    private _intensity: number = 1;

    /** Bounce інтенсивність (для GI) */
    private _bounceIntensity: number = 1;

    /** Сила тіней (0-1) */
    private _shadowStrength: number = 1;

    /** Режим тіней */
    private _shadows: LightShadows = LightShadows.None;

    /** Роздільність карти тіней */
    private _shadowResolution: LightShadowResolution = LightShadowResolution.High;

    /** Bias для тіней (запобігає shadow acne) */
    private _shadowBias: number = 0.005;

    /** Normal bias для тіней */
    private _shadowNormalBias: number = 0.1;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "Light";
    }

    // === Lifecycle ===

    protected onAwake(): void {
        // Цей метод перевизначается в підклассах
        if (!this._threeLight) {
            console.warn("Light._threeLight не встановлений!");
        }

        // Додаємо світло до сцени через Transform
        if (this._threeLight && this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.add(this._threeLight);
        }
    }

    protected onDestroy(): void {
        if (this._threeLight && this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.remove(this._threeLight);
        }

        this._threeLight = null;
        super.onDestroy();
    }

    // === Властивості - Основні ===

    /**
     * Колір світла
     */
    public get color(): Color {
        return this._color.clone();
    }

    public set color(value: Color) {
        this._color = value.clone();
        this.updateThreeLight();
    }

    /**
     * Яскравість світла (1 = нормально)
     */
    public get intensity(): number {
        return this._intensity;
    }

    public set intensity(value: number) {
        this._intensity = Math.max(0, value);
        this.updateThreeLight();
    }

    /**
     * Інтенсивність для Global Illumination
     */
    public get bounceIntensity(): number {
        return this._bounceIntensity;
    }

    public set bounceIntensity(value: number) {
        this._bounceIntensity = Math.max(0, value);
    }

    /**
     * Сила тіней (0 = прозорі, 1 = повні)
     */
    public get shadowStrength(): number {
        return this._shadowStrength;
    }

    public set shadowStrength(value: number) {
        this._shadowStrength = Math.max(0, Math.min(1, value));
        this.updateThreeLight();
    }

    // === Властивості - Тіні ===

    /**
     * Режим тіней (None, Hard, Soft)
     */
    public get shadows(): LightShadows {
        return this._shadows;
    }

    public set shadows(value: LightShadows) {
        if (this._shadows === value) return;

        this._shadows = value;
        this.updateShadowMap();
    }

    /**
     * Роздільність карти тіней
     */
    public get shadowResolution(): LightShadowResolution {
        return this._shadowResolution;
    }

    public set shadowResolution(value: LightShadowResolution) {
        if (this._shadowResolution === value) return;

        this._shadowResolution = value;
        this.updateShadowMap();
    }

    /**
     * Bias для тіней (запобігає shadow acne)
     * Більше значення = менше artifact'ів, але може створити peter panning
     */
    public get shadowBias(): number {
        return this._shadowBias;
    }

    public set shadowBias(value: number) {
        this._shadowBias = value;
        
        if (this._threeLight && "shadow" in this._threeLight) {
            (this._threeLight as any).shadow.bias = value;
        }
    }

    /**
     * Normal bias для тіней
     */
    public get shadowNormalBias(): number {
        return this._shadowNormalBias;
    }

    public set shadowNormalBias(value: number) {
        this._shadowNormalBias = value;
        
        if (this._threeLight && "shadow" in this._threeLight) {
            (this._threeLight as any).shadow.normalBias = value;
        }
    }

    // === Захищені методи для підклассів ===

    /**
     * Встановити внутрішнє THREE.js світло
     * Викликається в підклассах при створенні світла
     */
    protected setThreeLight(light: THREE.Light): void {
        this._threeLight = light;
        this.updateThreeLight();
        this.updateShadowMap();
    }

    /**
     * Оновити параметри THREE.js світла
     */
    protected updateThreeLight(): void {
        if (!this._threeLight) return;

        // Встановлюємо колір
        this._threeLight.color.setHex(this._color.getHex());

        // Встановлюємо інтенсивність
        this._threeLight.intensity = this._intensity;
    }

    /**
     * Оновити карту тіней
     */
    protected updateShadowMap(): void {
        if (!this._threeLight || !("shadow" in this._threeLight)) {
            return;
        }

        const shadow = (this._threeLight as any).shadow;

        // Встановлюємо вмикання тіней
        shadow.map = this._shadows !== LightShadows.None ? true : false;

        // Встановлюємо bias
        shadow.bias = this._shadowBias;
        shadow.normalBias = this._shadowNormalBias;

        // Встановлюємо роздільність
        const resolutionMap: Record<LightShadowResolution, number> = {
            [LightShadowResolution.Low]: 512,
            [LightShadowResolution.Medium]: 1024,
            [LightShadowResolution.High]: 2048,
            [LightShadowResolution.VeryHigh]: 4096
        };

        const resolution = resolutionMap[this._shadowResolution];
        shadow.mapSize.width = resolution;
        shadow.mapSize.height = resolution;
    }
}
