import { Component } from "./Component.ts";
import type { GameObject } from "./GameObject.ts";

/**
 * Behaviour — це компонент, який може бути увімкнений або вимкнений.
 * Всі скрипти користувача та більшість вбудованих компонентів (крім Transform)
 * повинні наслідуватися від цього класу.
 * * * Ієрархія: EngineObject -> Component -> Behaviour
 */
export abstract class Behaviour extends Component {

    /**
     * Внутрішній стан увімкнення компонента.
     * За замовчуванням true.
     */
    private _enabled: boolean = true;

    /**
     * Прапор, чи був викликаний Awake.
     */
    private _awoken: boolean = false;

    /**
     * Конструктор.
     * @param gameObject Об'єкт, до якого кріпиться поведінка.
     */
    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * Викликається один раз при створенні компонента.
     * Використовуйте для ініціалізації.
     * @virtual
     */
    protected onAwake(): void {
        // Перевизначається в нащадках
    }

    /**
     * Внутрішній метод для виклику Awake.
     * @internal
     */
    public _systemAwake(): void {
        if (!this._awoken) {
            this.onAwake();
            this._awoken = true;
        }
    }

    /**
     * Вмикає або вимикає компонент.
     * При зміні стану викликаються методи onEnable() або onDisable().
     */
    public get enabled(): boolean {
        return this._enabled;
    }

    public set enabled(value: boolean) {
        if (this._enabled === value) return;

        this._enabled = value;

        if (this.gameObject.activeSelf) {
            if (this._enabled) {
                this.onEnable();
            } else {
                this.onDisable();
            }
        }
    }

    /**
     * Перевіряє, чи компонент активний і чи активний його GameObject.
     * Це головна перевірка для Update-loop'а.
     */
    public get isActiveAndEnabled(): boolean {
        // TODO Тут бажано використовувати activeInHierarchy, якщо буде ієрархія батьків
        return this._enabled && this.gameObject.activeSelf;
    }

    /**
     * Викликається, коли компонент вмикається (enabled = true).
     * Також викликається при старті, якщо компонент був увімкнений.
     * @virtual
     */
    protected onEnable(): void {
        // Перевизначається в нащадках
    }

    /**
     * Викликається, коли компонент вимикається (enabled = false)
     * або коли знищується об'єкт.
     * @virtual
     */
    protected onDisable(): void {
        // Перевизначається в нащадках
    }
}