import { v4 as uuidv4 } from 'uuid';

/**
 * Базовий клас для всіх об'єктів двигуна (GameObject, Component, Assets).
 * Забезпечує унікальний ID та базову ідентифікацію.
 * Більше не зберігає глобальний реєстр об'єктів (цим займається Scene).
 */
export class EngineObject {

    // Унікальний ідентифікатор. Незмінний.
    public readonly uuid: string;

    // Ім'я об'єкта.
    public name: string;

    // Внутрішній прапор знищення.
    private _isDestroyed: boolean = false;

    constructor(name: string = '') {
        this.uuid = uuidv4();
        this.name = name || this.constructor.name;
    }

    /**
     * Перевіряє, чи існує цей об'єкт (не null і не знищений).
     */
    public exists(): boolean {
        return !this._isDestroyed;
    }

    /**
     * Статичний метод для знищення будь-якого об'єкта двигуна.
     * Аналог Object.Destroy(obj).
     */
    public static destroy(obj: EngineObject | null, delay: number = 0): void {
        if (!obj || !obj.exists()) return;

        if (delay > 0) {
            setTimeout(() => obj.destroyImmediate(), delay * 1000);
        } else {
            obj.destroyImmediate();
        }
    }

    /**
     * Внутрішній метод негайного знищення.
     * Викликається системою або через static destroy().
     */
    public destroyImmediate(): void {
        if (this._isDestroyed) return;

        // 1. Викликаємо віртуальний метод очищення ресурсів
        this.onDestroy();

        // 2. Ставимо прапор, що об'єкт мертвий
        // Видалення зі сцени відбудеться автоматично через callback в GameObject.onDestroy,
        // або через логіку SceneManager, якщо це GameObject.
        this._isDestroyed = true;
    }

    /**
     * Створює копію об'єкта.
     * TODO: Реалізувати через систему серіалізації.
     */
    public static instantiate<T extends EngineObject>(_original: T): T {
        throw new Error("Instantiate logic requires Serialization system to be fully implemented.");
    }

    /**
     * Віртуальний метод для очищення ресурсів нащадками.
     */
    protected onDestroy(): void {
        // Override me in GameObject / Component
    }

    public getInstanceID(): string {
        return this.uuid;
    }

    public toString(): string {
        return `${this.constructor.name} (${this.name})`;
    }

    public equals(other: any): boolean {
        if (other instanceof EngineObject) {
            return this.uuid === other.uuid;
        }
        return false;
    }
}