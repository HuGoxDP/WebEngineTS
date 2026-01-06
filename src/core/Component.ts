import 'reflect-metadata';
import { v4 as uuidv4 } from 'uuid';
import type { Entity } from './Entity';
import type { Transform } from './components/Transform';

/**
 * Інтерфейс для даних, що зберігаються.
 */
export interface SerializedComponent {
    uuid: string;
    type: string;
    enabled: boolean;
    data: Record<string, any>;
}

/**
 * Abstract Base Component.
 * Реалізує Unity-подібний API та автоматичну серіалізацію.
 */
export abstract class Component {
    // Унікальний ID
    public uuid: string;

    // Посилання на власника (readonly)
    public readonly entity: Entity;

    // Внутрішні списки для декораторів
    public static _serializableFields: string[];

    private _enabled: boolean = true;
    private _isStarted: boolean = false;
    private _isAwake: boolean = false;

    // Для корутин
    private _coroutines: Set<Generator> = new Set();

    constructor(entity: Entity) {
        this.entity = entity;
        this.uuid = uuidv4();
    }

    // 🔹 SHORTCUTS

    /**
     * Доступ до Transform без this.entity.transform.
     * Використовуємо 'any' або 'Transform' (через type import), щоб уникнути помилок імпорту.
     */
    get transform(): Transform {
        return this.entity.transform;
    }

    /** Доступ до Entity як до gameObject */
    get gameObject(): Entity {
        return this.entity;
    }

    /** Тег об'єкта */
    get tag(): string {
        return this.entity.tag;
    }

    /**
     * Знаходить компонент на цьому ж об'єкті.
     */
    getComponent<T extends Component>(type: new (...args: any[]) => T): T | undefined {
        return this.entity.getComponent(type);
    }

    /**
     * Намагається знайти компонент, якщо немає - додає його.
     */
    getOrAddComponent<T extends Component>(type: new (...args: any[]) => T): T {
        let comp = this.getComponent(type);
        if (!comp) {
            comp = this.entity.addComponent(type);
        }
        return comp as T;
    }

    // 🔹 LIFECYCLE & STATE

    get enabled(): boolean { return this._enabled; }
    set enabled(value: boolean) {
        if (this._enabled === value) return;
        this._enabled = value;
        if (value) {
            this.onEnable();
        } else {
            this.onDisable();
        }
    }

    public awake(): void {
        // Тепер змінна використовується для запобігання повторного awake
        if (this._isAwake) return;
        this._isAwake = true;
    }

    public start(): void {
        if (this._isStarted) return;
        this._isStarted = true;
    }
    public update(_deltaTime: number): void {
        this._processCoroutines();
    }
    public lateUpdate(_deltaTime: number): void {}

    public fixedUpdate(_fixedDeltaTime: number): void {}

    public onEnable(): void {}

    public onDisable(): void {}

    public onDestroy(): void {
        this.stopAllCoroutines();
    }

    /** @internal */
    public _ensureStart(): void {
        if (!this._isStarted && this.enabled) {
            this.start();
            this._isStarted = true;
        }
    }

    // 🔹 AUTOMATIC SERIALIZATION

    /**
     * Автоматично збирає всі поля, позначені @serializable
     */
    public toJSON(): SerializedComponent {
        const data: Record<string, any> = {};

        // Отримуємо список полів з конструктора (декоратор туди писав)
        const fields = (this.constructor as any)._serializableFields || [];

        for (const key of fields) {
            const value = (this as any)[key];

            // Якщо в об'єкта є свій toJSON (як у Vector3), викликаємо його
            if (value && typeof value.toJSON === 'function') {
                data[key] = value.toJSON();
            } else {
                data[key] = value;
            }
        }

        return {
            uuid: this.uuid,
            type: this.constructor.name,
            enabled: this.enabled,
            data: data
        };
    }
    public deserialize(data: any): void {
        const fields = (this.constructor as any)._serializableFields || [];

        for (const key of fields) {
            if (data[key] === undefined) continue;

            const currentValue = (this as any)[key];
            const newValue = data[key];

            // Розумна десеріалізація для Vector3/Quaternion
            if (currentValue && typeof currentValue.copy === 'function') {
                currentValue.copy(newValue);
            } else {
                (this as any)[key] = newValue;
            }
        }
    }

    // 🔹 COROUTINES (Спрощена версія)

    /**
     * Запускає генератор як корутину.
     * @example this.startCoroutine(this.waitAndPrint());
     */
    public startCoroutine(generator: Generator): void {
        this._coroutines.add(generator);
    }

    public stopAllCoroutines(): void {
        this._coroutines.clear();
    }

    private _processCoroutines() {
        for (const routine of this._coroutines) {
            const result = routine.next();
            if (result.done) {
                this._coroutines.delete(routine);
            }
        }
    }

    // 🔹 MESSAGING

    /**
     * Викликає метод methodName на всіх компонентах цього Entity.
     */
    public sendMessage(methodName: string, ...args: any[]): void {
        this.entity.components.forEach((comp: any) => {
            if (typeof comp[methodName] === 'function') {
                comp[methodName](...args);
            }
        });
    }
}