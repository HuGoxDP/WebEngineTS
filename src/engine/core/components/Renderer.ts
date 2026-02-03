import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { Material } from "../graphics/Material";
import { Bounds } from "../math/Bounds";
import { Vector3 } from "../math/Vector3";
import type { GameObject } from "../GameObject";

/**
 * Режим відкидання тіней (відповідає Unity ShadowCastingMode).
 */
export enum ShadowCastingMode {
    Off = 0,
    On = 1,
    TwoSided = 2,
    ShadowsOnly = 3
}

/**
 * Базовий клас для всіх рендерерів.
 * Реалізує логіку роботи з матеріалами та видимістю.
 */
export abstract class Renderer extends Behaviour {
    /**
     * @internal - НЕ використовувати напряму!
     * Посилання на THREE.Object3D, який цей рендерер відображає.
     */
    public _threeObject: THREE.Object3D | null = null;

    // === Material System ===
    protected _sharedMaterial: Material | null = null;
    protected _materialInstance: Material | null = null;

    // === Settings ===
    protected _receiveShadows: boolean = true;
    protected _shadowCastingMode: ShadowCastingMode = ShadowCastingMode.On;

    protected _localBounds: Bounds = new Bounds();

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================================================================================
    // MATERIAL SYSTEM
    // ==================================================================================

    public get sharedMaterial(): Material | null {
        return this._sharedMaterial;
    }

    public set sharedMaterial(value: Material | null) {
        this._sharedMaterial = value;

        // Якщо ми вручну ставимо sharedMaterial, скидаємо instance
        if (this._materialInstance) {
            this._materialInstance.destroy();
            this._materialInstance = null;
        }

        this.updateThreeMaterial();
    }

    public get material(): Material | null {
        if (this._materialInstance) {
            return this._materialInstance;
        }

        if (this._sharedMaterial) {
            const threeClone = this._sharedMaterial._threeMaterial.clone();

            this._materialInstance = new Material(threeClone);
            this.updateThreeMaterial();

            return this._materialInstance;
        }

        return null;
    }

    public set material(value: Material | null) {
        if (this._materialInstance) {
            this._materialInstance.destroy();
        }

        if (value) {
            // ! ВИПРАВЛЕННЯ: використовуємо _threeMaterial
            const threeClone = value._threeMaterial.clone();
            this._materialInstance = new Material(threeClone);
        } else {
            this._materialInstance = null;
        }

        // Оновлюємо відображення
        this.updateThreeMaterial();
    }

    /**
     * @internal Синхронізує матеріал з Three.js об'єктом.
     */
    protected updateThreeMaterial(): void {
        if (!this._threeObject || !(this._threeObject instanceof THREE.Mesh)) return;

        const targetMat = this._materialInstance || this._sharedMaterial;

        if (targetMat) {
            // ! ВИПРАВЛЕННЯ: використовуємо _threeMaterial
            this._threeObject.material = targetMat._threeMaterial;
        } else {
            // Fallback (рожевий колір помилки)
            this._threeObject.material = new THREE.MeshBasicMaterial({ color: 0xFF00FF });
        }
    }

    // ==================================================================================
    // BOUNDS & VISIBILITY
    // ==================================================================================

    public get bounds(): Bounds {
        if (!this._localBounds) return new Bounds();

        // Конвертуємо Bounds в THREE.Box3 для розрахунків
        const min = this._localBounds.center.clone().subtract(this._localBounds.extents);
        const max = this._localBounds.center.clone().add(this._localBounds.extents);

        const box3 = new THREE.Box3(
            new THREE.Vector3(min.x, min.y, min.z),
            new THREE.Vector3(max.x, max.y, max.z)
        );

        // Трансформуємо через матрицю об'єкта
        if (this._threeObject) {
            this._threeObject.updateMatrixWorld(true);
            box3.applyMatrix4(this._threeObject.matrixWorld);
        }

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box3.getCenter(center);
        box3.getSize(size);

        return new Bounds(
            new Vector3(center.x, center.y, center.z),
            new Vector3(size.x, size.y, size.z)
        );
    }

    public get localBounds(): Bounds {
        return this._localBounds;
    }

    public get isVisible(): boolean {
        return this.enabled && this.gameObject.activeSelf;
    }

    // ==================================================================================
    // SETTINGS
    // ==================================================================================

    public get receiveShadows(): boolean { return this._receiveShadows; }
    public set receiveShadows(value: boolean) {
        this._receiveShadows = value;
        if (this._threeObject) this._threeObject.receiveShadow = value;
    }

    public get shadowCastingMode(): ShadowCastingMode { return this._shadowCastingMode; }
    public set shadowCastingMode(value: ShadowCastingMode) {
        this._shadowCastingMode = value;
        if (this._threeObject) {
            this._threeObject.castShadow = (value !== ShadowCastingMode.Off);
        }
    }

    // ==================================================================================
    // LIFECYCLE
    // ==================================================================================

    protected override onEnable(): void {
        if (this._threeObject) this._threeObject.visible = true;
    }

    protected override onDisable(): void {
        if (this._threeObject) this._threeObject.visible = false;
    }

    protected override onDestroy(): void {
        if (this._materialInstance) {
            this._materialInstance.destroy();
            this._materialInstance = null;
        }
        this._sharedMaterial = null;
        this._threeObject = null;
    }
}