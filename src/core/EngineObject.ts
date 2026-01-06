import { v4 as uuidv4 } from 'uuid';

/**
 * Базовий клас для всіх об'єктів двигуна, які можуть бути збережені або на які можна посилатися.
 */
export class EngineObject {
    // Карта всіх живих об'єктів: UUID -> Instance
    private static _allObjects: Map<string, EngineObject> = new Map();


    // Унікальний ідентифікатор. Незмінний після створення.
    public readonly uuid: string;

    // Ім'я об'єкта (відображається в редакторі/назві файлу).
    public name: string;

    // Внутрішній прапор знищення (щоб уникнути помилок доступу до мертвих об'єктів).
    private _isDestroyed: boolean = false;

    constructor(name: string = '') {
        this.uuid = uuidv4();
        this.name = name || this.constructor.name;

        // Реєструємо об'єкт у глобальному списку
        EngineObject._allObjects.set(this.uuid, this);
    }

    /**
     * Знаходить перший активний об'єкт вказаного типу.
     */
    public static findObjectOfType<T extends EngineObject>(type: new (...args: any[]) => T): T | null {
        for (const obj of this._allObjects.values()) {
            if (obj instanceof type && !obj._isDestroyed) {
                return obj;
            }
        }
        return null;
    }

    /**
     * Знаходить усі об'єкти вказаного типу.
     */
    public static findObjectsOfType<T extends EngineObject>(type: new (...args: any[]) => T): T[] {
        const results: T[] = [];
        for (const obj of this._allObjects.values()) {
            if (obj instanceof type && !obj._isDestroyed) {
                results.push(obj);
            }
        }
        return results;
    }


    /**
     * Знищує об'єкт.
     * Об'єкт позначається як знищений і видаляється з реєстру.
     */
    public static destroy(obj: EngineObject | null, delay: number = 0): void {
        if (!obj) return;

        if (delay > 0) {
            setTimeout(() => obj.destroyImmediate(), delay * 1000);
        } else {
            obj.destroyImmediate();
        }
    }

    /**
     * Створює копію об'єкта.
     * TODO (Поки що базова реалізація, повна буде коли буде зроблена серіалізація)
     */
    public static instantiate<T extends EngineObject>(original: T): T {
        // У майбутньому тут буде: clone = Deserialize(Serialize(original))
        // Зараз ми просто вимагаємо реалізації методу clone() у нащадків або використовуємо серіалізацію
        throw new Error("Instantiate logic requires Serialization system to be fully implemented.");
    }

    /**
     * Повертає унікальний ID об'єкта.
     */
    public getInstanceID(): string {
        return this.uuid;
    }

    /**
     * Перевизначення методу toString для зручного логування.
     * @example "GameObject (Player)"
     */
    public toString(): string {
        return `${this.constructor.name} (${this.name})`;
    }

    /**
     * Перевіряє, чи існує цей об'єкт (не null і не знищений).
     * В JS немає перевантаження операторів, тому замість `if (obj)` краще писати `if (obj?.exists())`.
     */
    public exists(): boolean {
        return !this._isDestroyed;
    }

    /**
     * Негайно знищує об'єкт.
     * Викликає віртуальний метод onDestroy() для нащадків.
     */
    protected destroyImmediate(): void {
        if (this._isDestroyed) return;

        // 1. Викликаємо хук для нащадків (очищення Three.js ресурсів, відписка від подій)
        this.onDestroy();

        // 2. Видаляємо з глобального реєстру
        EngineObject._allObjects.delete(this.uuid);

        // 3. Позначаємо як мертвий
        this._isDestroyed = true;
    }

    /**
     * Віртуальний метод, який нащадки (Component, GameObject) повинні перевизначити
     * для очищення своїх ресурсів.
     */
    protected onDestroy(): void {
        // За замовчуванням нічого не робить
    }

    /**
     * Перевіряє рівність двох об'єктів за посиланням або UUID.
     */
    public equals(other: any): boolean {
        if (other instanceof EngineObject) {
            return this.uuid === other.uuid;
        }
        return false;
    }
}