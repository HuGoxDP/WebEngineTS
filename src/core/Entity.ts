import 'reflect-metadata';
import { v4 as uuidv4 } from 'uuid';
import { Component, SerializedComponent } from './Component';
import { Transform } from './components/Transform';

/**
 * Entity (Сутність) — це основний об'єкт сцени.
 */
export class Entity {
    // Унікальний ID (генерується автоматично)
    public readonly uuid: string;
    public name: string;
    public tag: string = "Untagged";

    private _activeSelf: boolean = true;
    private _components: Component[] = [];

    public readonly transform: Transform;

    // Стан життєвого циклу
    private _isAwake: boolean = false;
    private _isStarted: boolean = false;
    private _isDestroyed: boolean = false;


    private static _componentRegistry: Map<string, new (entity: Entity) => Component> = new Map();
    /**
     * Реєструє компонент, щоб його можна було завантажити з JSON.
     * @example Entity.registerComponent('Rotator', Rotator);
     */
    public static registerComponent(name: string, constructor: new (entity: Entity) => Component) {
        this._componentRegistry.set(name, constructor);
    }

    constructor(name: string = "New Entity") {
        this.uuid = uuidv4();
        this.name = name;

        this.transform = new Transform(this);
        this._components.push(this.transform);
    }

    // ==========================================
    // 🔹 COMPONENT MANAGEMENT (Generics)
    // ==========================================

    /**
     * Додає новий компонент до сутності.
     * @param type Клас компонента (напр. MeshRenderer)
     * @returns Створений екземпляр компонента
     */
    public addComponent<T extends Component>(type: new (entity: Entity) => T): T {
        if (this._isDestroyed) {
            console.warn(`Attempt to add component to destroyed entity ${this.name}`);
            return null as any;
        }

        // Перевірка: Transform можна мати тільки один
        if (type === Transform as any) {
            return this.transform as unknown as T;
        }

        const component = new type(this);
        this._components.push(component);

        // Ініціалізація компонента залежно від стану Entity
        if (this._isAwake) {
            component.awake();
        }

        // Якщо Entity активна, вмикаємо компонент
        if (this._activeSelf && component.enabled) {
            component.onEnable();
        }

        if (this._isStarted) {
            component._ensureStart();
        }

        return component;
    }

    /**
     * Отримує компонент вказаного типу.
     */
    public getComponent<T extends Component>(type: new (...args: any[]) => T): T | undefined {
        return this._components.find(c => c instanceof type) as T;
    }

    /**
     * Видаляє компонент.
     */
    public removeComponent<T extends Component>(component: T): void {
        const index = this._components.indexOf(component);
        if (index > -1) {
            // Transform видаляти не можна
            if (component instanceof Transform) {
                console.warn("Cannot remove Transform component!");
                return;
            }

            if (component.enabled) component.onDisable();
            component.onDestroy();
            this._components.splice(index, 1);
        }
    }

    // ==========================================
    // 🔹 STATE & LIFECYCLE
    // ==========================================

    get activeSelf(): boolean { return this._activeSelf; }

    set activeSelf(value: boolean) {
        if (this._activeSelf === value) return;
        this._activeSelf = value;

        // Повідомляємо компоненти про зміну стану
        if (this._activeSelf) {
            this._components.forEach(c => c.enabled && c.onEnable());
        } else {
            this._components.forEach(c => c.enabled && c.onDisable());
        }
    }

    public awake(): void {
        if (this._isAwake) return;
        this._isAwake = true;

        // Transform повинен прокинутись першим
        this.transform.awake();

        for (const component of this._components) {
            if (component !== this.transform) component.awake();
        }
    }

    public start(): void {
        if (this._isStarted) return;
        this._isStarted = true;

        for (const component of this._components) {
            if (component.enabled) component._ensureStart();
        }
    }

    public update(deltaTime: number): void {
        if (!this._activeSelf) return;

        for (const component of this._components) {
            if (component.enabled) {
                component._ensureStart(); // На випадок, якщо компонент додали динамічно
                component.update(deltaTime);
            }
        }
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        // Спочатку вимикаємо
        this.activeSelf = false;

        // Знищуємо компоненти
        for (const component of this._components) {
            component.onDestroy();
        }
        this._components = [];

        // Від'єднуємо від батька (якщо є)
        if (this.transform.parent) {
            this.transform.setParent(null);
        }

        // Знищуємо дітей (Three.js mesh видаляється в Transform.onDestroy або Engine)
    }

    // ==========================================
    // 🔹 SERIALIZATION
    // ==========================================

    public toJSON(): any {
        return {
            uuid: this.uuid,
            name: this.name,
            tag: this.tag,
            active: this.activeSelf,
            // Серіалізуємо компоненти (включно з Transform)
            components: this._components.map(c => c.toJSON()),
            // Серіалізуємо дітей рекурсивно (через Transform)
            children: this.getAllChildren().map(child => child.toJSON())
        };
    }

    /**
     * Створює Entity з JSON даних.
     */
    public static deserialize(data: any): Entity {
        const entity = new Entity(data.name);
        entity.tag = data.tag || "Untagged";
        // uuid ми не можемо перезаписати, бо він readonly, але при завантаженні
        // можна створити Entity з конкретним UUID, якщо змінити конструктор,
        // або просто ігнорувати це для нових клонів.
        // Для точного відновлення збереження краще мати метод forceSetUUID, але це деталі.

        // 1. Відновлення компонентів
        if (data.components && Array.isArray(data.components)) {
            for (const compData of data.components as SerializedComponent[]) {
                // Transform вже є, його просто оновлюємо
                if (compData.type === 'Transform') {
                    entity.transform.deserialize(compData.data);
                    continue;
                }

                // Шукаємо клас компонента в реєстрі
                const ComponentClass = Entity._componentRegistry.get(compData.type);
                if (ComponentClass) {
                    const newComp = entity.addComponent(ComponentClass);
                    newComp.enabled = compData.enabled;
                    newComp.deserialize(compData.data); // Відновлюємо поля (швидкість, HP і т.д.)
                } else {
                    console.warn(`Unknown component type: ${compData.type}. Did you forget Entity.registerComponent?`);
                }
            }
        }

        entity.activeSelf = data.active;
        return entity;
    }

    // ==========================================
    // 🔹 HELPERS
    // ==========================================

    // Допоміжний метод для отримання дітей (через Transform)
    private getAllChildren(): Entity[] {
        const children: Entity[] = [];
        for (let i = 0; i < this.transform.childCount; i++) {
            const childTr = this.transform.getChild(i);
            if (childTr) children.push(childTr.entity);
        }
        return children;
    }
}