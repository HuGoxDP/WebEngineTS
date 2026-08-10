// path: src/engine/core/SceneManager.ts

import { Scene } from "./Scene.ts";
import type { GameObject } from "./GameObject.ts";

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
/** How {@link SceneManager.loadScene} treats the scenes already loaded. */
export enum LoadSceneMode {
    /**
     * Unload everything else first. Objects marked
     * {@link EngineObject.DontDestroyOnLoad} move to the new scene instead of
     * being destroyed.
     */
    Single = "Single",
    /**
     * Keep what is loaded and add this scene alongside it.
     *
     * @remarks
     * The active scene does not change, matching Unity: new GameObjects keep
     * going to whichever scene was active, so loading a HUD over a lesson does
     * not silently redirect the lesson's own spawns.
     */
    Additive = "Additive",
}

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
     * Loads a scene, either replacing what is loaded or adding to it.
     *
     * @param sceneName — the name for the new scene.
     *
     * @param mode - whether to replace what is loaded or add to it.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.LoadScene(name, mode)`.
     */
    public static loadScene(
        sceneName: string,
        mode: LoadSceneMode = LoadSceneMode.Single,
    ): void {
        const previousScene = SceneManager._activeScene;

        if (mode === LoadSceneMode.Additive) {
            const added = SceneManager._createScene(sceneName);
            // Unity leaves the active scene alone on an additive load, so new
            // GameObjects keep going where the caller expects.
            SceneManager._fireEvent(SceneManager.onSceneLoaded, added);
            console.log(`[SceneManager] Scene '${sceneName}' loaded additively.`);
            return;
        }

        const previousScenes = [...SceneManager._loadedScenes];
        const survivors = SceneManager._collectPersistentRoots();

        // Announced before anything is torn down, so a listener can still read
        // the scene it is being told about.
        for (const scene of previousScenes) {
            SceneManager._fireEvent(SceneManager.onSceneUnloaded, scene);
        }

        const newScene = SceneManager._createScene(sceneName);
        SceneManager._activeScene = newScene;

        // Re-homed *before* the old scenes are destroyed: `Scene.destroy`
        // walks its roots, so a survivor still registered there would be
        // destroyed along with everything else — which is the bug that made
        // DontDestroyOnLoad a no-op.
        for (const go of survivors) {
            if (go.exists()) SceneManager.moveGameObjectToScene(go, newScene);
        }

        for (const scene of previousScenes) {
            scene.destroy();
            SceneManager._removeFromLoaded(scene);
        }

        SceneManager._fireEvent(SceneManager.onSceneLoaded, newScene);
        SceneManager._fireActiveChanged(previousScene, newScene);

        console.log(`[SceneManager] Scene '${sceneName}' loaded.`);
    }

    /**
     * Unloads one scene, destroying everything in it.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.UnloadSceneAsync`, minus the async —
     * there is no streaming here, so the work is done by the time this returns.
     *
     * Refuses to unload the last remaining scene: the engine always has an
     * active scene, and `loadScene` is how a scene is replaced.
     *
     * @param scene - the scene to unload.
     * @returns whether it was unloaded.
     */
    public static unloadScene(scene: Scene): boolean {
        if (!SceneManager._loadedScenes.includes(scene)) return false;
        if (SceneManager._loadedScenes.length <= 1) {
            console.warn("[SceneManager] Refusing to unload the only loaded scene.");
            return false;
        }

        const wasActive = SceneManager._activeScene === scene;

        SceneManager._fireEvent(SceneManager.onSceneUnloaded, scene);
        scene.destroy();
        SceneManager._removeFromLoaded(scene);

        // Something has to be active; the first remaining scene takes over.
        if (wasActive) {
            const next = SceneManager._loadedScenes[0];
            SceneManager._activeScene = next;
            SceneManager._fireActiveChanged(scene, next);
        }
        return true;
    }

    /**
     * Moves a root GameObject from its scene to another.
     *
     * @remarks
     * Equivalent to Unity's `SceneManager.MoveGameObjectToScene`. Only roots
     * can move: a child belongs to whatever scene its root is in, which is what
     * keeps a hierarchy from being split across two scenes.
     *
     * @param go - the GameObject to move.
     * @param scene - its new scene.
     * @returns whether it moved.
     */
    public static moveGameObjectToScene(go: GameObject, scene: Scene): boolean {
        if (!go.exists() || go.transform.parent !== null) return false;
        if (go.scene === scene) return true;

        go.scene._unregisterGameObject(go);
        (go as unknown as { _scene: Scene })._scene = scene;
        scene._registerGameObject(go);
        return true;
    }

    /** Root GameObjects marked DontDestroyOnLoad across every loaded scene. */
    private static _collectPersistentRoots(): GameObject[] {
        const out: GameObject[] = [];
        for (const scene of SceneManager._loadedScenes) {
            for (const go of scene.getRootGameObjects()) {
                if (go._isPersistent()) out.push(go);
            }
        }
        return out;
    }

    /**
     * Creates a new empty scene and makes it active.
     * Convenience wrapper around {@link loadScene}.
     *
     * @param sceneName — the name for the new scene.
     * @returns the newly created scene.
     *
     * @remarks
     * **Not** Unity's `SceneManager.CreateScene`, which adds a scene without
     * unloading anything. This replaces everything loaded, because that is what
     * its callers want — a scenario starting from a clean slate. Use
     * {@link loadScene} with {@link LoadSceneMode.Additive} to add one.
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

// @internal Expose to MemoryProfiler without circular imports.
(globalThis as any).__webengine_scene_manager__ = SceneManager;