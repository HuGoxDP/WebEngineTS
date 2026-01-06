import { Scene } from "./Scene";

/**
 * SceneManager.ts
 * Керує життєвим циклом сцен: завантаження, вивантаження та доступ до активної сцени.
 */
export class SceneManager {
    /**
     * Поточна активна сцена.
     */
    private static _activeScene: Scene | null = null;

    /**
     * Отримати поточну активну сцену.
     * Якщо сцени немає, створюється дефолтна (Lazy Initialization).
     */
    public static get activeScene(): Scene {
        if (!this._activeScene) {
            this._activeScene = new Scene("Default Scene");
        }
        return this._activeScene;
    }

    /**
     * Завантажує нову сцену.
     * Стара сцена знищується, всі її об'єкти видаляються.
     * @param sceneName Назва нової сцени.
     */
    public static loadScene(sceneName: string): void {
        // 1. Якщо є активна сцена — знищуємо її
        if (this._activeScene) {
            this._activeScene.destroy();
        }

        // 2. Створюємо нову чисту сцену
        this._activeScene = new Scene(sceneName);

        console.log(`[SceneManager] Scene '${sceneName}' loaded.`);

        // Тут можна додати виклик подій: onSceneLoaded
    }
}