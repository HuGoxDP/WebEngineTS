import * as THREE from "three";
import { GameObject } from "./GameObject.ts";
import { EngineObject } from "./EngineObject.ts";
import { Transform } from "./Transform.ts";

/**
 * Scene.ts
 * Контейнер для ігрових об'єктів.
 * Аналог UnityEngine.SceneManagement.Scene + обгортка над THREE.Scene.
 */
export class Scene {
    /**
     * Внутрішня сцена Three.js для рендерингу.
     * @internal Використовується рендер-двигуном.
     */
    public readonly threeScene: THREE.Scene;

    /**
     * Назва сцени.
     */
    public name: string;

    /**
     * Шлях до файлу сцени (для ідентифікації при завантаженні).
     */
    public path: string = "";

    /**
     * Список кореневих об'єктів (ті, що не мають батька).
     * Використовується для ітерації при оновленні.
     */
    private _rootGameObjects: GameObject[] = [];

    /**
     * Реєстр усіх об'єктів (включаючи дочірні) для швидкого пошуку за UUID.
     * Замінює старий глобальний EngineObject._allObjects.
     */
    private _registry: Map<string, GameObject> = new Map();

    constructor(name: string = "New Scene") {
        this.name = name;
        this.threeScene = new THREE.Scene();
    }

    /**
     * Додає об'єкт на сцену.
     * @internal Викликається автоматично при створенні GameObject.
     */
    public addGameObject(go: GameObject): void {
        if (this._registry.has(go.uuid)) return;

        // 1. Додаємо в реєстр для пошуку (UUID -> Instance)
        this._registry.set(go.uuid, go);

        // 2. Якщо це корінь - додаємо в список коренів для Update-лупу
        if (!go.transform.parent) {
            this._rootGameObjects.push(go);

            // 3. Додаємо візуальну частину в Three.js
            this.threeScene.add(go.transform.object3D);
        }
    }

    /**
     * Видаляє об'єкт зі сцени.
     * @internal Викликається автоматично при знищенні GameObject.
     */
    public removeGameObject(go: GameObject): void {
        // 1. Видаляємо з реєстру
        this._registry.delete(go.uuid);

        // 2. Якщо це був кореневий об'єкт - видаляємо зі списку
        const index = this._rootGameObjects.indexOf(go);
        if (index !== -1) {
            // Швидке видалення (Swap-Pop idiom)
            const lastIndex = this._rootGameObjects.length - 1;
            const last = this._rootGameObjects[lastIndex];

            if (index !== lastIndex) {
                this._rootGameObjects[index] = last;
            }
            this._rootGameObjects.pop();

            // Видаляємо з Three.js
            this.threeScene.remove(go.transform.object3D);
        }
    }

    /**
     * Обробляє зміну батьківського елемента об'єкта.
     * Викликається з Transform.set parent.
     * @internal
     */
    public onGameObjectParentChanged(go: GameObject, oldParent: Transform | null, newParent: Transform | null): void {
        if (oldParent === null && newParent !== null) {
            const index = this._rootGameObjects.indexOf(go);
            if (index !== -1) {
                // Видаляємо зі списку коренів
                const lastIndex = this._rootGameObjects.length - 1;
                const last = this._rootGameObjects[lastIndex];
                if (index !== lastIndex) {
                    this._rootGameObjects[index] = last;
                }
                this._rootGameObjects.pop();
            }
        }

        if (oldParent !== null && newParent === null) {
            if (!this._rootGameObjects.includes(go)) {
                this._rootGameObjects.push(go);
                // Візуальне додавання до сцени обробляється в Transform (SceneManager.activeScene.threeScene.add)
            }
        }
    }

    /**
     * Знаходить перший активний об'єкт вказаного типу на цій сцені.
     */
    public findObjectOfType<T extends GameObject>(type: new (...args: any[]) => T): T | null {
        for (const obj of this._registry.values()) {
            if (obj instanceof type && obj.exists()) {
                return obj;
            }
        }
        return null;
    }

    /**
     * Знаходить усі об'єкти вказаного типу на цій сцені.
     */
    public findObjectsOfType<T extends GameObject>(type: new (...args: any[]) => T): T[] {
        const results: T[] = [];
        for (const obj of this._registry.values()) {
            if (obj instanceof type && obj.exists()) {
                results.push(obj);
            }
        }
        return results;
    }

    public getRootGameObjects(): GameObject[] {
        return [...this._rootGameObjects];
    }

    public _update(): void {
        for (let i = 0; i < this._rootGameObjects.length; i++) {
            const go = this._rootGameObjects[i];
            if (go.activeSelf) {
                go._systemUpdate();
            }
        }
    }

    public _lateUpdate(): void {
        for (let i = 0; i < this._rootGameObjects.length; i++) {
            const go = this._rootGameObjects[i];
            if (go.activeSelf) {
                go._systemLateUpdate();
            }
        }
    }

    public _fixedUpdate(): void {
        for (let i = 0; i < this._rootGameObjects.length; i++) {
            const go = this._rootGameObjects[i];
            if (go.activeSelf) {
                go._systemFixedUpdate();
            }
        }
    }

    /**
     * Очищає сцену (Destructor).
     */
    public destroy(): void {
        const roots = [...this._rootGameObjects];

        for (const go of roots) {
            EngineObject.destroy(go);
        }

        this._rootGameObjects = [];
        this._registry.clear();
        this.threeScene.clear();
    }
}