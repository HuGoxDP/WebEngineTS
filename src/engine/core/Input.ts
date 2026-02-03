import { Vector2 } from "./math/Vector2";
import { KeyCode } from "./KeyCode";

/**
 * Статичний клас для обробки введення (клавіатура, миша).
 * Працює аналогічно Unity Input.
 */
export class Input {
    // --- Keyboard State ---
    private static _currentKeys: Set<string> = new Set();
    private static _downKeys: Set<string> = new Set();
    private static _upKeys: Set<string> = new Set();

    // --- Mouse State ---
    private static _mouseButtons: boolean[] = [false, false, false]; // 0: Left, 1: Middle, 2: Right
    private static _mouseDowns: boolean[] = [false, false, false];
    private static _mouseUps: boolean[] = [false, false, false];

    // Позиція миші відносно лівого верхнього кута Canvas
    private static _mousePosition: Vector2 = new Vector2(0, 0);

    /**
     * Ініціалізація слухачів подій. Викликається один раз в Application.
     * @internal
     */
    public static _init(canvas: HTMLCanvasElement): void {
        window.addEventListener("keydown", (e) => {
            if (e.repeat) return; // Игнорируем авто-повтор при зажатии
            this._currentKeys.add(e.code);
            this._downKeys.add(e.code);
        });

        window.addEventListener("keyup", (e) => {
            this._currentKeys.delete(e.code);
            this._upKeys.add(e.code);
        });

        // Mouse Buttons
        canvas.addEventListener("mousedown", (e) => {
            if (e.button >= 0 && e.button <= 2) {
                this._mouseButtons[e.button] = true;
                this._mouseDowns[e.button] = true;
            }
        });

        canvas.addEventListener("mouseup", (e) => {
            if (e.button >= 0 && e.button <= 2) {
                this._mouseButtons[e.button] = false;
                this._mouseUps[e.button] = true;
            }
        });

        // Mouse Position
        canvas.addEventListener("mousemove", (e) => {
            const rect = canvas.getBoundingClientRect();
            // Координати відносно канвасу, а не вікна
            this._mousePosition.set(e.clientX - rect.left, e.clientY - rect.top);
        });

        // Блокуємо контекстне меню на правий клік (опціонально)
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    /**
     * Очищає буфери "одноразових" подій (Down/Up).
     * Має викликатися в кінці кожного кадру.
     * @internal
     */
    public static _resetFrame(): void {
        this._downKeys.clear();
        this._upKeys.clear();

        for (let i = 0; i < 3; i++) {
            this._mouseDowns[i] = false;
            this._mouseUps[i] = false;
        }
    }

    // ================== PUBLIC API (UNITY STYLE) ==================

    /**
     * Повертає true, поки клавіша утримується натиснутою.
     */
    public static getKey(keyCode: KeyCode | string): boolean {
        return this._currentKeys.has(keyCode);
    }

    /**
     * Повертає true тільки в кадр, коли клавіша була натиснута.
     */
    public static getKeyDown(keyCode: KeyCode | string): boolean {
        return this._downKeys.has(keyCode);
    }

    /**
     * Повертає true тільки в кадр, коли клавіша була відпущена.
     */
    public static getKeyUp(keyCode: KeyCode | string): boolean {
        return this._upKeys.has(keyCode);
    }

    /**
     * Перевірка кнопки миші (0 - Ліва, 1 - Середня, 2 - Права).
     * @returns true, поки кнопка натиснута.
     */
    public static getMouseButton(button: number): boolean {
        return this._mouseButtons[button] || false;
    }

    /**
     * @returns true в момент натискання кнопки миші.
     */
    public static getMouseButtonDown(button: number): boolean {
        return this._mouseDowns[button] || false;
    }

    /**
     * @returns true в момент відпускання кнопки миші.
     */
    public static getMouseButtonUp(button: number): boolean {
        return this._mouseUps[button] || false;
    }

    /**
     * Поточна позиція миші (в пікселях екрану).
     */
    public static get mousePosition(): Vector2 {
        return this._mousePosition;
    }

    /**
     * Віртуальні осі, як в Unity Input Manager.
     * Повертає значення від -1 до 1.
     */
    public static getAxis(axisName: "Horizontal" | "Vertical"): number {
        let value = 0;

        if (axisName === "Horizontal") {
            if (this.getKey(KeyCode.KeyD) || this.getKey(KeyCode.ArrowRight)) value += 1;
            if (this.getKey(KeyCode.KeyA) || this.getKey(KeyCode.ArrowLeft)) value -= 1;
        } else if (axisName === "Vertical") {
            if (this.getKey(KeyCode.KeyW) || this.getKey(KeyCode.ArrowUp)) value += 1;
            if (this.getKey(KeyCode.KeyS) || this.getKey(KeyCode.ArrowDown)) value -= 1;
        }

        return value;
    }
}