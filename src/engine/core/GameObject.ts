import { EngineObject } from "./EngineObject";
import { SceneManager } from "./SceneManager";
import { Transform } from "./Transform";
import { Component } from "./Component";
import { Behaviour } from "./Behaviour";
import { ScriptableBehaviour } from "./ScriptableBehaviour";
import { EngineSettings } from "./EngineSettings";

/**
 * GameObject — це контейнер для компонентів.
 * Керує їх життєвим циклом та станом активності.
 */
export class GameObject extends EngineObject {
    public readonly transform: Transform;

    public layer: number = EngineSettings.Layers.DEFAULT;
    public tag: string = "Untagged";

    private _activeSelf: boolean = true;
    private _components: Component[] = [];

    // Кеш для швидкого доступу getComponent
    private _componentCache: Map<Function, Component[]> = new Map();

    constructor(name: string = "New GameObject") {
        super(name);

        // Transform створюється автоматично і не додається в загальний список _components,
        // бо він є невід'ємною частиною GameObject.
        this.transform = new Transform(this);

        // Реєструємо в активній сцені
        SceneManager.activeScene._registerGameObject(this);
    }

    /**
     * Чи активний об'єкт локально.
     */
    public get activeSelf(): boolean {
        return this._activeSelf;
    }

    /**
     * Вмикає/вимикає об'єкт.
     * Це також ховає/показує його в Three.js і зупиняє скрипти.
     */
    public setActive(value: boolean): void {
        if (this._activeSelf === value) return;

        this._activeSelf = value;

        // 1. Синхронізація видимості в Three.js (Master-Slave)
        // В Unity SetActive(false) ховає весь об'єкт та дітей
        this.transform.object3D.visible = value;

        // 2. Сповіщення компонентів (OnEnable/OnDisable)
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                component._onEnabledChanged();
            }
        }

        // 3. Сповіщення дітей (рекурсивно, якщо треба логіка activeInHierarchy)
        for (let i = 0; i < this.transform.childCount; i++) {
            const child = this.transform.getChild(i);
            child.gameObject._onParentActiveStateChanged();
        }
    }

    /** @internal Викликається, коли батько змінює активність */
    public _onParentActiveStateChanged(): void {
        // Тут можна реалізувати логіку activeInHierarchy
        // Поки що просто оновлюємо стан компонентів
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                component._onEnabledChanged();
            }
        }
    }

    // === COMPONENTS SYSTEM ===

    public addComponent<T extends Component>(type: new (go: GameObject) => T): T {
        const component = new type(this);
        this._components.push(component);

        // Кешування
        // Тут треба бути обережним з наслідуванням, але для простої ECS піде
        const typeKey = Object.getPrototypeOf(component).constructor;
        if (!this._componentCache.has(typeKey)) {
            this._componentCache.set(typeKey, []);
        }
        this._componentCache.get(typeKey)!.push(component);

        // Виклик Awake (якщо це Behaviour/Script)
        if (component instanceof ScriptableBehaviour) {
            component._systemAwake();
        }
        // Виклик OnEnable (якщо об'єкт активний)
        if (component instanceof Behaviour && this._activeSelf && component.enabled) {
            component._onEnabledChanged();
        }

        return component;
    }

    public getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
        // 1. Спробуємо знайти в кеші (точно по класу)
        // (Тут спрощена реалізація, повна потребує перевірки instanceof для наслідування)
        for (const comp of this._components) {
            if (comp instanceof type) {
                return comp;
            }
        }
        return null;
    }

    public getComponents<T extends Component>(type: new (...args: any[]) => T): T[] {
        const results: T[] = [];
        for (const comp of this._components) {
            if (comp instanceof type) {
                results.push(comp);
            }
        }
        return results;
    }

    // === SYSTEM UPDATE LOOPS ===

    public _systemUpdate(): void {
        if (!this._activeSelf) return;

        // Оновлюємо компоненти
        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) {
                component._systemUpdate();
            }
        }

        // Оновлюємо дітей
        const count = this.transform.childCount;
        for (let i = 0; i < count; i++) {
            this.transform.getChild(i).gameObject._systemUpdate();
        }
    }

    public _systemFixedUpdate(): void {
        if (!this._activeSelf) return;
        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) component._systemFixedUpdate();
        }
        const count = this.transform.childCount;
        for (let i = 0; i < count; i++) {
            this.transform.getChild(i).gameObject._systemFixedUpdate();
        }
    }

    public _systemLateUpdate(): void {
        if (!this._activeSelf) return;
        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) component._systemLateUpdate();
        }
        const count = this.transform.childCount;
        for (let i = 0; i < count; i++) {
            this.transform.getChild(i).gameObject._systemLateUpdate();
        }
    }

    protected override onDestroy(): void {
        // 1. Знищуємо компоненти
        for (const component of this._components) {
            component.destroyImmediate();
        }
        this._components = [];
        this._componentCache.clear();

        // 2. Знищуємо дітей (рекурсивно)
        // Копіюємо масив, бо destroy змінює його
        const children = [...this.transform['_children']];
        for (const child of children) {
            child.gameObject.destroyImmediate();
        }

        // 3. Видаляємо зі сцени
        SceneManager.activeScene._unregisterGameObject(this);

        // 4. Очищаємо Transform (відв'язуємо від Three.js)
        this.transform.destroyImmediate();
    }
}