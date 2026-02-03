import { Component } from "./Component.ts";
import type { GameObject } from "./GameObject.ts";

/**
 * Behaviour — це компонент, який може бути увімкнений або вимкнений.
 * Всі скрипти користувача та більшість вбудованих компонентів (крім Transform)
 * повинні наслідуватися від цього класу.
 * * * Ієрархія: EngineObject -> Component -> Behaviour
 */
export abstract class Behaviour extends Component {
    /** @internal */
    private _enabled: boolean = true;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * Вмикає або вимикає компонент.
     */
    public get enabled(): boolean {
        return this._enabled;
    }

    public set enabled(value: boolean) {
        if (this._enabled !== value) {
            this._enabled = value;
            this._onEnabledChanged();
        }
    }

    /**
     * Чи активний цей компонент І чи активний сам GameObject?
     * В Unity Update працює тільки якщо isActiveAndEnabled = true.
     */
    public get isActiveAndEnabled(): boolean {
        return this._enabled && this.gameObject.activeSelf;
    }

    /**
     * @internal Викликається при зміні enabled або activeSelf батька.
     */
    public _onEnabledChanged(): void {
        if (this.isActiveAndEnabled) {
            this.onEnable();
        } else {
            this.onDisable();
        }
    }

    /**
     * Викликається, коли компонент стає активним (enabled = true і gameObject.activeSelf = true).
     * @virtual
     */
    protected onEnable(): void {}

    /**
     * Викликається, коли компонент стає неактивним.
     * @virtual
     */
    protected onDisable(): void {}
}