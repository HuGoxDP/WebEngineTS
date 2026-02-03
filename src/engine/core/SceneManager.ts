import { Scene } from "./Scene.ts";
import type { IScenarioManifest } from './scenario/ScenarioTypes';
import type JSZip from 'jszip';

/**
 * SceneManager.ts
 * Керує життєвим циклом сцен: завантаження, вивантаження та доступ до активної сцени.
 * Аналог Unity SceneManager.
 */
export class SceneManager {
    /**
     * Поточна активна сцена.
     */
    private static _activeScene: Scene | null = null;

    /**
     * Кількість завантажених сцен.
     */
    private static _sceneCount: number = 0;

    /**
     * Отримати поточну активну сцену.
     * Якщо сцени немає, створюється дефолтна (Lazy Initialization).
     */
    public static get activeScene(): Scene {
        if (!this._activeScene) {
            this._activeScene = new Scene("Default Scene");
            this._sceneCount = 1;
        }
        return this._activeScene;
    }

    /**
     * Кількість завантажених сцен.
     */
    public static get sceneCount(): number {
        return this._sceneCount;
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
        this._sceneCount = 1;

        console.log(`[SceneManager] Scene '${sceneName}' loaded.`);
    }

    /**
     * Завантажує сцену на основі наданого маніфесту та ZIP-архіву.
     * Використовується для завантаження сцен зі сценаріїв.
     * @param manifest Маніфест сценарію, що містить деталі сцени.
     * @param zip Завантажений ZIP-архів.
     */
    public static async loadSceneFromManifest(manifest: IScenarioManifest, zip: JSZip): Promise<void> {
        console.log(`[SceneManager] Loading scene from manifest: ${manifest.name}`);

        // 1. Очищаємо поточну сцену
        if (this._activeScene) {
            this._activeScene.destroy();
        }

        // 2. Створюємо нову сцену з назвою зі сценарію
        const sceneName = manifest.entryScene || manifest.name || "Scenario Scene";
        this._activeScene = new Scene(sceneName);
        this._activeScene.path = manifest.entryScene || "";
        this._sceneCount = 1;

        // 3. Якщо є entryScene - завантажуємо дані сцени
        if (manifest.entryScene) {
            await this.loadSceneDataFromZip(zip, manifest.entryScene);
        }

        console.log(`[SceneManager] Scene '${sceneName}' loaded from scenario.`);
    }

    /**
     * Завантажує дані сцени з ZIP-архіву.
     * @param zip ZIP-архів
     * @param scenePath Шлях до файлу сцени
     */
    private static async loadSceneDataFromZip(zip: JSZip, scenePath: string): Promise<void> {
        const sceneFile = zip.file(`scenes/${scenePath}`);

        if (!sceneFile) {
            console.warn(`[SceneManager] Scene file not found: scenes/${scenePath}`);
            return;
        }

        try {
            const sceneJson = await sceneFile.async('string');
            const sceneData = JSON.parse(sceneJson);

            // TODO: Десеріалізація сцени з JSON
            // Формат буде визначено пізніше
            console.log(`[SceneManager] Scene data loaded:`, sceneData);

        } catch (error) {
            console.error(`[SceneManager] Failed to load scene data:`, error);
        }
    }

    /**
     * Встановлює активну сцену.
     * @param scene Сцена, яка стане активною.
     */
    public static setActiveScene(scene: Scene): boolean {
        if (!scene) {
            console.warn("[SceneManager] Cannot set null as active scene");
            return false;
        }

        this._activeScene = scene;
        return true;
    }

    /**
     * Вивантажує поточну сцену.
     */
    public static unloadActiveScene(): void {
        if (this._activeScene) {
            this._activeScene.destroy();
            this._activeScene = null;
            this._sceneCount = 0;
        }
    }
}