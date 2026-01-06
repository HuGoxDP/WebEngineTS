import { EngineObject } from "./EngineObject";
import { SceneManager } from "./SceneManager";
import { Transform } from "./Transform";
import { Component } from "./Component";
import { ScriptableBehaviour } from "./ScriptableBehaviour";
import { Behaviour } from "./Behaviour";
import { EngineSettings } from "./EngineSettings";

/**
 * GameObject — це основна сутність сцени.
 * В архітектурі Object-based ECS він виступає як контейнер (Entity) для компонентів.
 * Відповідає за життєвий цикл своїх компонентів.
 */
export class GameObject extends EngineObject {
    public readonly transform: Transform;

    /**
     * Шар об'єкта. За замовчуванням беремо з налаштувань.
     */
    public layer: number = EngineSettings.Layers.DEFAULT;

    /**
     * Тег для пошуку. За замовчуванням "Untagged".
     */
    public tag: string = EngineSettings.Tags.UNTAGGED;

    private _activeSelf: boolean = true;
    private _components: Component[] = [];
    private _componentCache: Map<Function, Component[]> = new Map();

    public onActiveStateChanged?: (isActive: boolean) => void;

    constructor(name: string = EngineSettings.Defaults.GAME_OBJECT_NAME) {
        super(name);

        this.transform = new Transform(this);
        this._components.push(this.transform);

        // Реєструємо об'єкт в активній сцені
        SceneManager.activeScene.addGameObject(this);
    }

    /**
     * Чи активний об'єкт локально.
     */
    public get activeSelf(): boolean {
        return this._activeSelf;
    }

    /**
     * Чи активний об'єкт в сцені (враховуючи батьків).
     */
    public get activeInHierarchy(): boolean {
        if (!this._activeSelf) return false;
        const parent = this.transform.parent;
        return parent ? parent.gameObject.activeInHierarchy : true;
    }

    /**
     * Встановлює активність об'єкта.
     */
    public setActive(value: boolean): void {
        if (this._activeSelf === value) return;

        this._activeSelf = value;

        // Повідомляємо компоненти про зміну стану
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                if (component.enabled) {
                    // Trigger state refresh
                    component.enabled = component.enabled;
                }
            }
        }

        this.onActiveStateChanged?.(value);
    }

    /**
     * Додає компонент типу T до об'єкта.
     */
    public addComponent<T extends Component>(type: new (go: GameObject) => T): T {
        const component = new type(this);
        this._components.push(component);

        let list = this._componentCache.get(type);
        if (!list) {
            list = [];
            this._componentCache.set(type, list);
        }
        list.push(component);

        if (component instanceof ScriptableBehaviour) {
            component._systemAwake();
            // Тут можна додати логіку для виклику onEnable, якщо об'єкт активний
        }

        return component;
    }

    /**
     * Отримує перший знайдений компонент вказаного типу.
     */
    public getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
        if (type === Transform as any) {
            return this.transform as unknown as T;
        }

        const list = this._componentCache.get(type);
        if (list && list.length > 0) {
            return list[0] as T;
        }

        for (const component of this._components) {
            if (component instanceof type) {
                return component;
            }
        }

        return null;
    }

    /**
     * Отримує всі компоненти вказаного типу.
     * ПОПЕРЕДЖЕННЯ: Створює новий масив (Allocation). Використовувати обережно в Update.
     */
    public getComponents<T extends Component>(type: new (...args: any[]) => T): T[] {
        const result: T[] = [];
        for (const component of this._components) {
            if (component instanceof type) {
                result.push(component);
            }
        }
        return result;
    }

    public compareTag(tag: string): boolean {
        return this.tag === tag;
    }

    /**
     * Знаходить перший активний об'єкт типу T на активній сцені.
     */
    public static findObjectOfType<T extends GameObject>(type: new (...args: any[]) => T): T | null {
        return SceneManager.activeScene.findObjectOfType(type);
    }

    /**
     * Знаходить усі активні об'єкти типу T на активній сцені.
     */
    public static findObjectsOfType<T extends GameObject>(type: new (...args: any[]) => T): T[] {
        return SceneManager.activeScene.findObjectsOfType(type);
    }

    /**
     * Системний метод оновлення. Викликається менеджером сцени.
     * Проходиться по всіх компонентах і викликає їх update.
     * @internal
     */
    public _systemUpdate(): void {
        if (!this._activeSelf) return;

        // 1. Оновлюємо свої компоненти
        for (let i = 0; i < this._components.length; i++) {
            const component = this._components[i];
            if (component instanceof ScriptableBehaviour) {
                component._systemUpdate();
            }
        }

        // 2. Оновлюємо дітей (Recursion)
        const childCount = this.transform.childCount;
        for (let i = 0; i < childCount; i++) {
            const child = this.transform.getChild(i);
            child.gameObject._systemUpdate();
        }
    }

    public _systemLateUpdate(): void {
        if (!this._activeSelf) return;

        // 1. Components
        for (let i = 0; i < this._components.length; i++) {
            const component = this._components[i];
            if (component instanceof ScriptableBehaviour) {
                component._systemLateUpdate();
            }
        }

        // 2. Children
        const childCount = this.transform.childCount;
        for (let i = 0; i < childCount; i++) {
            const child = this.transform.getChild(i);
            child.gameObject._systemLateUpdate();
        }
    }

    public _systemFixedUpdate(): void {
        if (!this._activeSelf) return;

        // 1. Components
        for (let i = 0; i < this._components.length; i++) {
            const component = this._components[i];
            if (component instanceof ScriptableBehaviour) {
                component._systemFixedUpdate();
            }
        }

        // 2. Children
        const childCount = this.transform.childCount;
        for (let i = 0; i < childCount; i++) {
            const child = this.transform.getChild(i);
            child.gameObject._systemFixedUpdate();
        }
    }

    /**
     * Знищення об'єкта.
     */
    protected override onDestroy(): void {
        // 1. Знищуємо компоненти
        for (const component of this._components) {
            component.destroyImmediate();
        }
        this._components = [];
        this._componentCache.clear();

        // 2. Видаляємо себе з активної сцени
        SceneManager.activeScene.removeGameObject(this);

        // 3. Від'єднуємо трансформацію
        if (this.transform.parent) {
            this.transform.parent = null;
        }
    }
}