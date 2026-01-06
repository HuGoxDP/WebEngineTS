import { Behaviour } from "./Behaviour";
import type { GameObject } from "./GameObject";

/**
 * Базовий клас для всіх скриптів користувача.
 * Додає методи життєвого циклу (Lifecycle Hooks): Awake, Start, Update, etc.
 * * * Ієрархія: EngineObject -> Component -> Behaviour -> ScriptableBehaviour
 */
export class ScriptableBehaviour extends Behaviour {
    /**
     * Прапор, який вказує, чи був викликаний метод Start.
     * Гарантує, що Start спрацює лише один раз перед першим Update.
     */
    private _started: boolean = false;

    /**
     * Прапор, який вказує, чи був викликаний метод Awake.
     */
    private _awoken: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
        // Awake викликається одразу при створенні компонента (якщо це можливо в архітектурі),
        // або викликається вручну через GameObject.addComponent.
        // Для надійності, ми реалізуємо метод _tryAwake, який викличе система.
    }

    /**
     * Викликається один раз при створенні скрипта (до Start).
     * Використовуйте для ініціалізації змінних.
     */
    public awake(): void {
        // Virtual method
    }

    /**
     * Викликається перед першим кадром Update, якщо скрипт увімкнений.
     * Використовуйте для логіки, яка залежить від інших компонентів.
     */
    public start(): void {
        // Virtual method
    }

    /**
     * Викликається кожен кадр. Основна логіка гри.
     */
    public update(): void {
        // Virtual method
    }

    /**
     * Викликається кожен кадр після Update.
     * Використовуйте для камер та логіки, яка має відбутися після руху об'єктів.
     */
    public lateUpdate(): void {
        // Virtual method
    }

    /**
     * Викликається з фіксованим інтервалом (наприклад, 50 разів на секунду).
     * Використовуйте для фізики.
     */
    public fixedUpdate(): void {
        // Virtual method
    }

    /**
     * Викликається при знищенні об'єкта або компонента.
     * Перевизначаємо з EngineObject для зручності.
     */
    protected override onDestroy(): void {
        // Virtual method
    }

    /**
     * Внутрішній метод для виклику Awake.
     * @internal
     */
    public _systemAwake(): void {
        if (!this._awoken) {
            this.awake();
            this._awoken = true;
        }
    }

    /**
     * Внутрішній метод, який викликається в циклі оновлення (Update Loop).
     * Керує викликом Start та Update у правильному порядку.
     * @internal
     */
    public _systemUpdate(): void {
        if (!this.isActiveAndEnabled) return;

        // Lazy initialization: Start викликається безпосередньо перед першим Update
        if (!this._started) {
            this.start();
            this._started = true;
        }

        this.update();
    }

    /**
     * Внутрішній метод для LateUpdate.
     * @internal
     */
    public _systemLateUpdate(): void {
        if (this.isActiveAndEnabled && this._started) {
            this.lateUpdate();
        }
    }

    /**
     * Внутрішній метод для FixedUpdate (Фізика).
     * @internal
     */
    public _systemFixedUpdate(): void {
        if (this.isActiveAndEnabled && this._started) {
            this.fixedUpdate();
        }
    }
}