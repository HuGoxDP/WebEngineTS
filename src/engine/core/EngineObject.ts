/**
 * Базовий клас для всіх об'єктів двигуна (GameObject, Component, Assets).
 * Забезпечує унікальний ID та базову ідентифікацію.
 */
export class EngineObject {

    // Унікальний ідентифікатор. Незмінний.
    public readonly uuid: string;

    // Ім'я об'єкта.
    public name: string;

    // Внутрішній прапор знищення.
    private _isDestroyed: boolean = false;

    constructor(name: string = '') {
        // Використовуємо вбудований API браузера (працює в сучасних браузерах)
        this.uuid = crypto.randomUUID();
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
     * Знищує об'єкт (інстанс-метод).
     */
    public destroy(delay: number = 0): void {
        EngineObject.destroy(this, delay);
    }

    /**
     * Внутрішній метод негайного знищення.
     */
    public destroyImmediate(): void {
        if (this._isDestroyed) return;

        this.onDestroy();
        this._isDestroyed = true;
    }

    /**
     * Віртуальний метод для очищення ресурсів нащадками.
     */
    protected onDestroy(): void {
        // Override me
    }

    public getInstanceID(): string {
        return this.uuid;
    }

    public toString(): string {
        return `${this.constructor.name} (${this.name})`;
    }
}