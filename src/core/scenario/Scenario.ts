import {Scene, GameObject, SceneManager  } from "@engine";



export abstract class Scenario {
    protected _scene: Scene | null = null;
    protected _objects: GameObject[] = [];

    /**
     * Точка входу. Тут ви створюєте об'єкти.
     */
    public abstract init(): Promise<void>;

    /**
     * Системний метод завантаження.
     */
    public async load(): Promise<void> {
        // Створюємо ізольовану сцену
        SceneManager.loadScene("ScenarioScene");
        this._scene = SceneManager.activeScene;

        console.log("[Scenario] Initializing user content...");
        await this.init();
    }

    /**
     * Хелпер для створення об'єктів.
     */
    protected createGameObject(name: string): GameObject {
        const go = new GameObject(name);
        this._objects.push(go);
        return go;
    }

    /**
     * Очищення ресурсів.
     */
    public destroy(): void {
        this.onDestroy();
        this._objects = [];
        this._scene = null;
    }

    protected onDestroy(): void {}
}