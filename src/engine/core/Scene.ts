import * as THREE from "three";
import { GameObject } from "./GameObject";
import { Component } from "./Component";

/**
 * Scene.ts
 * Контейнер для ігрових об'єктів.
 */
export class Scene {
    /**
     * Внутрішня сцена Three.js для рендерингу.
     * @internal Використовується Renderer-ом.
     */
    public readonly threeScene: THREE.Scene;
    /**
     * Назва сцени.
     */
    public name: string;

    /**
     * Шлях до файлу сцени (для завантаження).
     */
    public path: string = "";

    /**
     * Список кореневих об'єктів (ті, що не мають батька).
     * Використовується для ітерації при оновленні (Update Loop).
     */
    private _rootGameObjects: GameObject[] = [];

    /**
     * Реєстр усіх об'єктів (включаючи дочірні) для швидкого пошуку за UUID.
     * UUID -> GameObject
     */
    private _registry: Map<string, GameObject> = new Map();

    constructor(name: string = "New Scene") {
        this.name = name;
        this.threeScene = new THREE.Scene();

        // Можна додати базове світло або колір фону
        // this.threeScene.background = new THREE.Color(0.1, 0.1, 0.1);
    }

    /**
     * Реєструє об'єкт у сцені.
     * Викликається автоматично в конструкторі GameObject.
     * @internal
     */
    public _registerGameObject(go: GameObject): void {
        if (this._registry.has(go.uuid)) return;

        // 1. Додаємо в загальний реєстр
        this._registry.set(go.uuid, go);

        // 2. Якщо у об'єкта немає батька, він кореневий
        if (go.transform.parent === null) {
            this._rootGameObjects.push(go);
            this.threeScene.add(go.transform.object3D); // Sync with Three.js
        }
    }

    /**
     * Видаляє об'єкт зі сцени.
     * Викликається при знищенні GameObject.
     * @internal
     */
    public _unregisterGameObject(go: GameObject): void {
        // 1. Видаляємо з реєстру
        this._registry.delete(go.uuid);

        // 2. Якщо він був кореневим, видаляємо зі списку коренів
        const rootIndex = this._rootGameObjects.indexOf(go);
        if (rootIndex !== -1) {
            this._rootGameObjects.splice(rootIndex, 1);
        }

        // 3. Видаляємо з Three.js сцени (безпечно, навіть якщо він не прямий нащадок)
        this.threeScene.remove(go.transform.object3D);
    }

    /**
     * Сповіщення про зміну батька (для підтримки актуальності _rootGameObjects).
     * Має викликатися з Transform.set parent.
     * @internal
     */
    public _onGameObjectParentChanged(go: GameObject, isRootNow: boolean): void {
        if (isRootNow) {
            // Став кореневим -> додаємо в список і в Three.Scene
            if (!this._rootGameObjects.includes(go)) {
                this._rootGameObjects.push(go);
                this.threeScene.add(go.transform.object3D);
            }
        } else {
            // Став дитиною -> видаляємо зі списку коренів
            const index = this._rootGameObjects.indexOf(go);
            if (index !== -1) {
                this._rootGameObjects.splice(index, 1);
                // З Three.Scene видаляти не обов'язково, бо додавання до батька (parent.add)
                // автоматично забирає його зі сцени в Three.js
            }
        }
    }
    // ПОШУК ОБ'ЄКТІВ (Unity Style)

    public findGameObject(name: string): GameObject | null {
        for (const go of this._registry.values()) {
            if (go.name === name) return go;
        }
        return null;
    }

    public findGameObjectsWithTag(tag: string): GameObject[] {
        const results: GameObject[] = [];
        for (const go of this._registry.values()) {
            if (go.tag === tag) results.push(go);
        }
        return results;
    }

    public findObjectOfType<T extends Component>(type: new (...args: any[]) => T): T | null {
        for (const go of this._registry.values()) {
            const comp = go.getComponent(type);
            if (comp) return comp;
        }
        return null;
    }

    public findObjectsOfType<T extends Component>(type: new (...args: any[]) => T): T[] {
        const results: T[] = [];
        for (const go of this._registry.values()) {
            const comps = go.getComponents(type);
            results.push(...comps);
        }
        return results;
    }

    public getRootGameObjects(): GameObject[] {
        return [...this._rootGameObjects];
    }

    // UPDATE LOOPS

    /**
     * @internal
     */
    public _update(): void {
        for (let i = 0; i < this._rootGameObjects.length; i++) {
            const go = this._rootGameObjects[i];
            if (go.activeSelf) go._systemUpdate();
        }
    }

    /**
     * @internal
     */
    public _lateUpdate(): void {
        for (let i = 0; i < this._rootGameObjects.length; i++) {
            const go = this._rootGameObjects[i];
            if (go.activeSelf) go._systemLateUpdate();
        }
    }

    /**
     * @internal
     */
    public _fixedUpdate(): void {
        for (let i = 0; i < this._rootGameObjects.length; i++) {
            const go = this._rootGameObjects[i];
            if (go.activeSelf) go._systemFixedUpdate();
        }
    }

    /**
     * Очищає сцену (Destructor).
     */
    public destroy(): void {
        // Створюємо копію масиву, бо destroy() змінюватиме його
        const roots = [...this._rootGameObjects];
        for (const go of roots) {
            go.destroyImmediate();
        }
        this._rootGameObjects = [];
        this._registry.clear();
        this.threeScene.clear();
    }
}