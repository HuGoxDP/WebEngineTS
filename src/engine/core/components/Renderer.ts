import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { Material } from "../graphics/Material";
import { Bounds } from "../math/Bounds";
import type { GameObject } from "../GameObject";

/**
 * Режим відкидання тіней (відповідає Unity ShadowCastingMode).
 */
export enum ShadowCastingMode {
    /** Не відкидає тіні */
    Off,
    /** Відкидає тіні */
    On,
    /** Відкидає тільки двосторонні тіні */
    TwoSided,
    /** Тільки тіні, без рендерингу об'єкта */
    ShadowsOnly
}

/**
 * Використання light probes (відповідає Unity).
 */
export enum LightProbeUsage {
    Off,
    BlendProbes,
    UseProxyVolume,
    CustomProvided
}

/**
 * Використання reflection probes (відповідає Unity).
 */
export enum ReflectionProbeUsage {
    Off,
    BlendProbes,
    BlendProbesAndSkybox,
    Simple
}

/**
 * Базовий клас для всіх рендерерів.
 * Повна імітація Unity Renderer.
 * 
 * Renderer зберігає матеріали та налаштування рендерингу.
 */
export abstract class Renderer extends Behaviour {
    /**
     * @internal - НЕ використовувати напряму!
     * THREE.js об'єкт для рендерингу
     */
    public _threeObject: THREE.Object3D | null = null;

    /** Shared матеріал (спільний ресурс) */
    protected _sharedMaterial: Material | null = null;

    /** Instance матеріалу (копія для редагування) */
    protected _materialInstance: Material | null = null;

    /** Масив shared матеріалів (для multi-material) */
    protected _sharedMaterials: Material[] = [];

    /** Масив instance матеріалів */
    protected _materialInstances: Material[] | null = null;

    /** Локальні bounds (у просторі об'єкта) */
    protected _localBounds: Bounds = new Bounds();

    /** Налаштування тіней */
    protected _receiveShadows: boolean = true;
    protected _shadowCastingMode: ShadowCastingMode = ShadowCastingMode.On;

    /** Сортування */
    protected _sortingLayerID: number = 0;
    protected _sortingLayerName: string = "Default";
    protected _sortingOrder: number = 0;
    protected _renderingLayerMask: number = 1;

    /** Light probes */
    protected _lightProbeUsage: LightProbeUsage = LightProbeUsage.BlendProbes;
    protected _reflectionProbeUsage: ReflectionProbeUsage = ReflectionProbeUsage.Off;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "Renderer";
    }

    // === Властивості матеріалів ===

    /**
     * Shared матеріал (спільний ресурс).
     * Не модифікуйте цей матеріал напряму - він спільний!
     * Для редагування використовуйте material (створить копію).
     */
    public get sharedMaterial(): Material | null {
        return this._sharedMaterial;
    }

    public set sharedMaterial(value: Material | null) {
        this._sharedMaterial = value;
        
        // Скидаємо instance
        if (this._materialInstance) {
            this._materialInstance.destroy();
            this._materialInstance = null;
        }
        
        this.updateMaterial();
    }

    /**
     * Матеріал для редагування (instance).
     * При першому доступі створюється копія sharedMaterial.
     */
    public get material(): Material | null {
        // Якщо є instance - повертаємо його
        if (this._materialInstance) {
            return this._materialInstance;
        }

        // Якщо немає instance, але є shared - створюємо копію
        if (this._sharedMaterial) {
            this._materialInstance = new Material(this._sharedMaterial);
            this.updateMaterial();
            return this._materialInstance;
        }

        return null;
    }

    public set material(value: Material | null) {
        if (value === null) {
            if (this._materialInstance) {
                this._materialInstance.destroy();
            }
            this._materialInstance = null;
            this._sharedMaterial = null;
            this.updateMaterial();
            return;
        }

        // При присвоєнні material створюємо копію
        if (this._materialInstance) {
            this._materialInstance.destroy();
        }
        this._materialInstance = new Material(value);
        this._sharedMaterial = null;
        this.updateMaterial();
    }

    /**
     * Масив shared матеріалів (для multi-material підтримки).
     */
    public get sharedMaterials(): Material[] {
        return [...this._sharedMaterials];
    }

    public set sharedMaterials(value: Material[]) {
        // Знищуємо старі instances
        if (this._materialInstances) {
            this._materialInstances.forEach(m => m?.destroy());
            this._materialInstances = null;
        }
        
        this._sharedMaterials = [...value];
        this.updateMaterials();
    }

    /**
     * Масив матеріалів для редагування.
     */
    public get materials(): Material[] {
        // Якщо є instances - повертаємо їх
        if (this._materialInstances) {
            return [...this._materialInstances];
        }

        // Створюємо instances з shared
        if (this._sharedMaterials.length > 0) {
            this._materialInstances = this._sharedMaterials.map(m => 
                m ? new Material(m) : null
            ).filter(m => m !== null) as Material[];
            this.updateMaterials();
            return [...this._materialInstances];
        }

        return [];
    }

    public set materials(value: Material[]) {
        // Знищуємо старі instances
        if (this._materialInstances) {
            this._materialInstances.forEach(m => m?.destroy());
        }
        
        // Створюємо копії
        this._materialInstances = value.map(m => 
            m ? new Material(m) : null
        ).filter(m => m !== null) as Material[];
        
        this._sharedMaterials = [];
        this.updateMaterials();
    }

    /**
     * Отримує матеріал за індексом.
     */
    public getMaterial(index: number): Material | null {
        const mats = this.materials;
        return mats[index] || null;
    }

    /**
     * Отримує shared матеріал за індексом.
     */
    public getSharedMaterial(index: number): Material | null {
        return this._sharedMaterials[index] || null;
    }

    /**
     * Встановлює матеріал за індексом.
     */
    public setMaterial(index: number, material: Material): void {
        const mats = this.materials;
        while (mats.length <= index) {
            mats.push(null as any);
        }
        mats[index] = material;
        this.materials = mats;
    }

    // === Bounds ===

    /**
     * Bounds у світовому просторі.
     */
    public get bounds(): Bounds {
        // Трансформуємо локальні bounds у світовий простір
        const worldBounds = this._localBounds.clone();
        
        if (this.gameObject) {
            const transform = this.gameObject.transform;
            const position = transform.position;
            const scale = transform.lossyScale;
            
            worldBounds.center.add(position);
            worldBounds.size.multiply(scale);
        }
        
        return worldBounds;
    }

    /**
     * Bounds у локальному просторі.
     */
    public get localBounds(): Bounds {
        return this._localBounds.clone();
    }

    public set localBounds(value: Bounds) {
        this._localBounds = value.clone();
    }

    // === Налаштування рендерингу ===

    /** Чи видимий об'єкт (залежить від enabled та frustum culling) */
    public get isVisible(): boolean {
        return this.enabled && this._threeObject?.visible === true;
    }

    /** Чи отримує об'єкт тіні */
    public get receiveShadows(): boolean {
        return this._receiveShadows;
    }

    public set receiveShadows(value: boolean) {
        this._receiveShadows = value;
        if (this._threeObject) {
            this._threeObject.receiveShadow = value;
        }
    }

    /** Режим відкидання тіней */
    public get shadowCastingMode(): ShadowCastingMode {
        return this._shadowCastingMode;
    }

    public set shadowCastingMode(value: ShadowCastingMode) {
        this._shadowCastingMode = value;
        if (this._threeObject) {
            this._threeObject.castShadow = value !== ShadowCastingMode.Off;
        }
    }

    // === Сортування ===

    public get sortingLayerID(): number {
        return this._sortingLayerID;
    }

    public set sortingLayerID(value: number) {
        this._sortingLayerID = value;
    }

    public get sortingLayerName(): string {
        return this._sortingLayerName;
    }

    public set sortingLayerName(value: string) {
        this._sortingLayerName = value;
    }

    public get sortingOrder(): number {
        return this._sortingOrder;
    }

    public set sortingOrder(value: number) {
        this._sortingOrder = value;
        if (this._threeObject) {
            this._threeObject.renderOrder = value;
        }
    }

    public get renderingLayerMask(): number {
        return this._renderingLayerMask;
    }

    public set renderingLayerMask(value: number) {
        this._renderingLayerMask = value;
    }

    // === Light Probes ===

    public get lightProbeUsage(): LightProbeUsage {
        return this._lightProbeUsage;
    }

    public set lightProbeUsage(value: LightProbeUsage) {
        this._lightProbeUsage = value;
    }

    public get reflectionProbeUsage(): ReflectionProbeUsage {
        return this._reflectionProbeUsage;
    }

    public set reflectionProbeUsage(value: ReflectionProbeUsage) {
        this._reflectionProbeUsage = value;
    }

    // === Абстрактні методи ===

    /**
     * Оновлює матеріал на THREE.js об'єкті.
     * Має бути реалізовано в підкласах.
     */
    protected abstract updateMaterial(): void;

    /**
     * Оновлює масив матеріалів на THREE.js об'єкті.
     * Має бути реалізовано в підкласах.
     */
    protected abstract updateMaterials(): void;

    // === Lifecycle ===

    protected override onDestroy(): void {
        // Знищуємо material instances
        if (this._materialInstance) {
            this._materialInstance.destroy();
            this._materialInstance = null;
        }
        
        if (this._materialInstances) {
            this._materialInstances.forEach(m => m?.destroy());
            this._materialInstances = null;
        }
        
        this._sharedMaterial = null;
        this._sharedMaterials = [];
        
        super.onDestroy();
    }
}
