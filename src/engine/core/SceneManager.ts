// path: src/engine/core/SceneManager.ts

import { Scene } from "./Scene.ts";

/**
 * Callback signature for scene events.
 */
export type SceneEventCallback = (scene: Scene) => void;

/**
 * Callback signature for the active scene change event.
 */
export type ActiveSceneChangedCallback = (previous: Scene | null, next: Scene) => void;

/**
 * Manages scene lifecycle: loading, unloading, and switching.
 *
 * The engine always has at least one active scene. New GameObjects are
 * automatically registered with the active scene.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.SceneManagement.SceneManager`.
 *
 * Currently supports **single-scene mode** (one scene at a time).
 * Additive scene loading is planned for a future phase.
 *
 * @example
 * ```ts
 * // Load a new scene (destroys the current one)
 * SceneManager.loadScene("Level2");
 *
 * // Listen for scene changes
 * SceneManager.onSceneLoaded.push((scene) => {
 *     console.log(`Scene loaded: ${scene.name}`);
 * });
 *
 * // Access the current scene
 * const player = SceneManager.activeScene.findGameObject("Player");
 * ```
 */
export class SceneManager {

    // ==================== PRIVATE STATE ====================

    /**
     * The currently active scene.
     * Lazy-initialized on first access if null.
     */
    private static _activeScene: Scene | null = null;

    /**
     * List of all loaded scenes. Currently at most one,
     * but structured for future additive loading.
     */
    private static _loadedScenes: Scene[] = [];

    /**
     * Auto-incrementing build index for scenes.
     */
    private static _nextBuildIndex: number = 0;

    // ==================== SCENE EVENTS ====================

    /**
     * Callbacks invoked after a new scene has been fully loaded.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.sceneLoaded`.
     */
    public static readonly onSceneLoaded: SceneEventCallback[] = [];

    /**
     * Callbacks invoked just before a scene is unloaded/destroyed.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.sceneUnloaded`.
     */
    public static readonly onSceneUnloaded: SceneEventCallback[] = [];

    /**
     * Callbacks invoked when the active scene changes.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.activeSceneChanged`.
     */
    public static readonly onActiveSceneChanged: ActiveSceneChangedCallback[] = [];

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The currently active scene.
     *
     * If no scene exists, a default scene is created automatically
     * (lazy initialization).
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.GetActiveScene()`.
     */
    public static get activeScene(): Scene {
        if (!SceneManager._activeScene) {
            SceneManager._activeScene = SceneManager._createScene("Default Scene");
        }
        return SceneManager._activeScene;
    }

    /**
     * The total number of currently loaded scenes.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.sceneCount`.
     */
    public static get sceneCount(): number {
        // Ensure lazy-init scene is counted
        if (SceneManager._loadedScenes.length === 0 && !SceneManager._activeScene) {
            return 0;
        }
        return SceneManager._loadedScenes.length ||
            (SceneManager._activeScene ? 1 : 0);
    }

    // ==================== PUBLIC METHODS ====================

    /**
     * Loads a new scene, destroying the current active scene.
     *
     * All GameObjects in the previous scene are destroyed before
     * the new scene is created.
     *
     * @param sceneName — the name for the new scene.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.LoadScene(name, LoadSceneMode.Single)`.
     *
     * @todo Support `LoadSceneMode.Additive` for multi-scene.
     */
    public static loadScene(sceneName: string): void {
        const previousScene = SceneManager._activeScene;

        // 1. Destroy and unregister the previous scene
        if (previousScene) {
            SceneManager._fireEvent(SceneManager.onSceneUnloaded, previousScene);
            previousScene.destroy();
            SceneManager._removeFromLoaded(previousScene);
        }

        // 2. Create a fresh scene
        const newScene = SceneManager._createScene(sceneName);
        SceneManager._activeScene = newScene;

        // 3. Fire events
        SceneManager._fireEvent(SceneManager.onSceneLoaded, newScene);
        SceneManager._fireActiveChanged(previousScene, newScene);

        console.log(`[SceneManager] Scene '${sceneName}' loaded.`);
    }

    /**
     * Creates a new empty scene and makes it active.
     * Convenience wrapper around {@link loadScene}.
     *
     * @param sceneName — the name for the new scene.
     * @returns the newly created scene.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.CreateScene(name)`.
     */
    public static createScene(sceneName: string): Scene {
        SceneManager.loadScene(sceneName);
        return SceneManager.activeScene;
    }

    /**
     * Returns a loaded scene by its index in the loaded scenes list.
     *
     * @param index — zero-based index.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.GetSceneAt(index)`.
     */
    public static getSceneAt(index: number): Scene | null {
        // Ensure lazy scene exists
        if (SceneManager._loadedScenes.length === 0) {
            // Force lazy init
            void SceneManager.activeScene;
        }
        return SceneManager._loadedScenes[index] ?? null;
    }

    /**
     * Finds a loaded scene by name.
     *
     * @param name — the scene name to search for.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.GetSceneByName(name)`.
     */
    public static getSceneByName(name: string): Scene | null {
        // Ensure lazy scene exists
        if (SceneManager._loadedScenes.length === 0) {
            void SceneManager.activeScene;
        }
        return SceneManager._loadedScenes.find(s => s.name === name) ?? null;
    }

    /**
     * Sets the specified scene as the active scene.
     *
     * Only valid for scenes that are currently loaded.
     *
     * @param scene — the scene to make active.
     * @returns `true` if the scene was successfully set as active.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.SetActiveScene(scene)`.
     */
    public static setActiveScene(scene: Scene): boolean {
        if (!SceneManager._loadedScenes.includes(scene)) {
            console.warn("[SceneManager] Cannot set active — scene is not loaded.");
            return false;
        }

        const previous = SceneManager._activeScene;
        if (previous === scene) return true; // Already active

        SceneManager._activeScene = scene;
        SceneManager._fireActiveChanged(previous, scene);
        return true;
    }

    // ==================== INTERNAL METHODS ====================

    /**
     * @internal
     * Resets the SceneManager to its initial state.
     * Used for testing or full engine restart.
     */
    public static _reset(): void {
        // Destroy all loaded scenes
        for (const scene of SceneManager._loadedScenes) {
            scene.destroy();
        }
        SceneManager._loadedScenes = [];
        SceneManager._activeScene = null;
        SceneManager._nextBuildIndex = 0;

        // Clear event listeners
        SceneManager.onSceneLoaded.length = 0;
        SceneManager.onSceneUnloaded.length = 0;
        SceneManager.onActiveSceneChanged.length = 0;
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Creates a new Scene, assigns a build index, and registers it.
     */
    private static _createScene(name: string): Scene {
        const scene = new Scene(name);
        scene.buildIndex = SceneManager._nextBuildIndex++;
        SceneManager._loadedScenes.push(scene);
        return scene;
    }

    /**
     * Removes a scene from the loaded list.
     */
    private static _removeFromLoaded(scene: Scene): void {
        const index = SceneManager._loadedScenes.indexOf(scene);
        if (index !== -1) {
            SceneManager._loadedScenes.splice(index, 1);
        }
    }

    /**
     * Fires a scene event callback array safely.
     */
    private static _fireEvent(
        callbacks: SceneEventCallback[],
        scene: Scene
    ): void {
        for (const cb of callbacks) {
            try {
                cb(scene);
            } catch (err) {
                console.error("[SceneManager] Event callback error:", err);
            }
        }
    }

    /**
     * Fires the active scene changed event safely.
     */
    private static _fireActiveChanged(
        previous: Scene | null,
        next: Scene
    ): void {
        for (const cb of SceneManager.onActiveSceneChanged) {
            try {
                cb(previous, next);
            } catch (err) {
                console.error("[SceneManager] ActiveSceneChanged callback error:", err);
            }
        }
    }
}