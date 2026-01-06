import { EngineObject } from "./EngineObject";
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
    }

    /**
     * Чи активний об'єкт локально.
     */
    public get activeSelf(): boolean {
        return this._activeSelf;
    }

    /**
     * Чи активний об'єкт в сцені (враховуючи батьків).
     * TODO: Реалізувати перевірку батьківських об'єктів, коли буде готова ієрархія Transform.
     */
    public get activeInHierarchy(): boolean {
        if (!this._activeSelf) return false;
        // Перевірка батька через transform
        const parent = this.transform.parent;
        return parent ? parent.gameObject.activeInHierarchy : true;
    }

    /**
     * Встановлює активність об'єкта.
     * Активує/деактивує компоненти (викликає onEnable/onDisable).
     */
    public setActive(value: boolean): void {
        if (this._activeSelf === value) return;

        this._activeSelf = value;

        // Повідомляємо компоненти про зміну стану
        // Це критично для Behaviour компонентів
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                // Тригер сеттера enabled, який викличе onEnable/onDisable
                // Але тільки якщо сам компонент enabled
                if (component.enabled) {
                    // Хаковний спосіб змусити Behaviour перевірити isActiveAndEnabled
                    // У реальному рушії тут може бути окремий метод refreshState()
                    component.enabled = component.enabled;
                }
            }
        }

        this.onActiveStateChanged?.(value);
    }

    /**
     * Додає компонент типу T до об'єкта.
     * @param type Конструктор компонента.
     */
    public addComponent<T extends Component>(type: new (go: GameObject) => T): T {
        // Перевірка на DisallowMultipleComponent (можна реалізувати через декоратори пізніше)

        const component = new type(this);
        this._components.push(component);

        // Додаємо в кеш для швидкого пошуку
        let list = this._componentCache.get(type);
        if (!list) {
            list = [];
            this._componentCache.set(type, list);
        }
        list.push(component);

        // Якщо це ScriptableBehaviour, спробуємо викликати awake
        if (component instanceof ScriptableBehaviour) {
            component._systemAwake();
            if (this.activeInHierarchy && component.enabled) {
                // onEnable буде викликано через сеттер enabled за замовчуванням в конструкторі Behaviour?
                // Ні, треба перевірити логіку Behaviour.
            }
        }

        return component;
    }

    /**
     * Отримує перший знайдений компонент вказаного типу.
     * Оптимізована версія з використанням кешу (O(1) в найкращому випадку).
     * @param type Тип компонента.
     */
    public getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
        // Швидкий шлях для Transform
        if (type === Transform as any) {
            return this.transform as unknown as T;
        }

        const list = this._componentCache.get(type);
        if (list && list.length > 0) {
            return list[0] as T;
        }

        // Повільний шлях (на випадок наслідування, якого немає в кеші прямого ключа)
        // Наприклад, якщо просимо Behaviour, а у нас є TestScript
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
     * Системний метод оновлення. Викликається менеджером сцени.
     * Проходиться по всіх компонентах і викликає їх update.
     * @internal
     */
    public _systemUpdate(): void {
        if (!this._activeSelf) return;

        // Використовуємо for, а не forEach, щоб уникнути створення колбеків і контексту (Micro-optimization)
        for (let i = 0; i < this._components.length; i++) {
            const component = this._components[i];
            if (component instanceof ScriptableBehaviour) {
                component._systemUpdate();
            }
        }
    }

    public _systemLateUpdate(): void {
        if (!this._activeSelf) return;

        for (let i = 0; i < this._components.length; i++) {
            const component = this._components[i];
            if (component instanceof ScriptableBehaviour) {
                component._systemLateUpdate();
            }
        }
    }

    public _systemFixedUpdate(): void {
        if (!this._activeSelf) return;

        for (let i = 0; i < this._components.length; i++) {
            const component = this._components[i];
            if (component instanceof ScriptableBehaviour) {
                component._systemFixedUpdate();
            }
        }
    }
    /**
     * Знищення об'єкта.
     */
    protected override onDestroy(): void {
        // 1. Знищити всі компоненти
        for (const component of this._components) {
            // Викликаємо destroyImmediate для компонентів,
            // але передаємо flag, щоб вони не намагалися видалити себе з цього масиву під час ітерації
            EngineObject.destroy(component);
        }
        this._components = [];
        this._componentCache.clear();

        // 2. Від'єднати Transform від батька (Three.js cleanup)
        // Це важливо для звільнення пам'яті графічного рушія
        if (this.transform.parent) {
            this.transform.parent = null;
        }

        // Тут можна додати очищення Three.js ресурсів (geometries, materials),
        // якщо ми вирішимо, що GameObject володіє ними.
        // Згідно зі звітом про ассети - краще використовувати Reference Counting в AssetManager.
    }
}