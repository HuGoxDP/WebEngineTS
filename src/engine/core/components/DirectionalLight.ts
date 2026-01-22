import * as THREE from "three";
import { Light } from "./Light";
import type { GameObject } from "../GameObject";

/**
 * Компонент DirectionalLight - сонячне світло.
 * Світло, що йде з однієї точки у нескінченності (як сонце).
 * 
 * Повна імітація Unity DirectionalLight.
 */
export class DirectionalLight extends Light {
    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "DirectionalLight";
    }

    // === Lifecycle ===

    protected onAwake(): void {
        // Створюємо Three.js DirectionalLight
        const threeLight = new THREE.DirectionalLight(0xffffff, 1);
        
        // Налаштовуємо тіні за замовчуванням
        threeLight.castShadow = true;
        threeLight.shadow.mapSize.width = 2048;
        threeLight.shadow.mapSize.height = 2048;
        threeLight.shadow.camera.far = 200;
        threeLight.shadow.camera.near = 0.5;
        
        // Встановлюємо для Light базового класу
        this.setThreeLight(threeLight);

        // Вызиваємо базовий onAwake
        super.onAwake();
    }

    // === Властивості ===

    /**
     * Дальність світла для тіней (mundo space)
     */
    public get shadowDistance(): number {
        if (!this._threeLight) {
            return 100;
        }

        const light = this._threeLight as THREE.DirectionalLight;
        return light.shadow.camera.far;
    }

    public set shadowDistance(value: number) {
        if (!this._threeLight) return;

        const light = this._threeLight as THREE.DirectionalLight;
        light.shadow.camera.far = Math.max(0.1, value);
    }

    /**
     * Розмір area light для тіней (для soft shadows)
     */
    public get shadowBias(): number {
        if (!this._threeLight) return 0.005;
        return (this._threeLight as any).shadow.bias;
    }

    public set shadowBias(value: number) {
        if (!this._threeLight) return;
        (this._threeLight as THREE.DirectionalLight).shadow.bias = value;
    }

    /**
     * Отримати внутрішнє THREE.js світло
     */
    public getThreeLight(): THREE.DirectionalLight | null {
        return this._threeLight as THREE.DirectionalLight;
    }
}
