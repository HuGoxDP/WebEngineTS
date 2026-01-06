import { EngineObject } from "./EngineObject";
import type { GameObject } from "./GameObject";
import type { Transform } from "./Transform";

/**
 * Базовий клас для всього, що може бути прикріплено до GameObjects.
 * Відповідає за зв'язок з контейнером (GameObject) та доступ до сусідніх компонентів.
 * * Ієрархія: EngineObject -> Component
 */
export abstract class Component extends EngineObject {
    /**
     * Посилання на GameObject, до якого прикріплений цей компонент.
     * Readonly: компонент не може "перестрибнути" на інший об'єкт після створення.
     */
    public readonly gameObject: GameObject;

    /**
     * Конструктор компонента.
     * @param gameObject Об'єкт-контейнер, до якого буде додано компонент.
     */
    constructor(gameObject: GameObject) {
        super(gameObject.name);
        this.gameObject = gameObject;
    }

    /**
     * Скорочений доступ до Transform, прикріпленого до того ж GameObject.
     * Це найчастіше використовуваний компонент, тому він винесений окремо.
     */
    public get transform(): Transform {
        return this.gameObject.transform;
    }

    /**
     * Тег ігрового об'єкта.
     */
    public get tag(): string {
        return this.gameObject.tag;
    }

    public set tag(value: string) {
        this.gameObject.tag = value;
    }

    /**
     * Отримує компонент вказаного типу, якщо він прикріплений до цього GameObject.
     * @param type Клас компонента (наприклад, MeshRenderer).
     * @returns Екземпляр компонента або null.
     */
    public getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
        return this.gameObject.getComponent(type);
    }

    /**
     * Перевіряє, чи має GameObject вказаний тег.
     */
    public compareTag(tag: string): boolean {
        return this.gameObject.compareTag(tag);
    }

    /**
     * Викликається, коли сам GameObject або цей компонент знищується.
     * Перевизначаємо метод з EngineObject.
     */
    protected override onDestroy(): void {
        // Тут може бути логіка від'єднання від подій GameObject, якщо така система буде.
        // Важливо: Реальне видалення зі списку компонентів GameObject має робити сам GameObject.
    }

    /**
     * Метод для логування, щоб бачити, на якому об'єкті висить компонент.
     */
    public override toString(): string {
        return `${this.constructor.name} (on ${this.gameObject.name})`;
    }

}