// path: src/engine/core/Scene.ts

import * as THREE from "three";
import { _executionOrderPasses } from "./reflection/Decorators.ts";
import type { GameObject } from "./GameObject.ts";
import type { Component } from "./Component.ts";

/**
 * A container for all {@link GameObject GameObjects} in a scene.
 *
 * The engine always has at least one active scene. GameObjects are
 * automatically registered with the active scene when created.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.SceneManagement.Scene`.
 *
 * Scenes own:
 * - A flat registry of all GameObjects (including nested children)
 * - A list of root-level GameObjects (those without a parent Transform)
 * - An internal Three.js Scene for rendering (hidden from users)
 *
 * @example
 * ```ts
 * const scene = SceneManager.activeScene;
 * const player = scene.findGameObject("Player");
 * const allEnemies = scene.findGameObjectsWithTag("Enemy");
 * ```
 */
export class Scene {

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The display name of this scene.
     *
     * @remarks
     * Equivalent to Unity's `Scene.name`.
     */
    public name: string;

    /**
     * The file path this scene was loaded from (if any).
     *
     * @remarks
     * Equivalent to Unity's `Scene.path`.
     * Empty string if the scene was created at runtime.
     */
    public path: string = "";

    /**
     * The build index of this scene in the scene list.
     * `-1` if the scene is not part of the build settings.
     *
     * @remarks
     * Equivalent to Unity's `Scene.buildIndex`.
     * Assigned by {@link SceneManager} when the scene is registered.
     */
    public buildIndex: number = -1;

    // ==================== PRIVATE FIELDS ====================

    /**
     * The internal Three.js scene used for rendering.
     * @internal — never exposed to engine users.
     */
    private readonly _threeScene: THREE.Scene;

    /**
     * Root-level GameObjects (those whose Transform has no parent).
     * Iterated by the update loops.
     */
    private _rootGameObjects: GameObject[] = [];

    /**
     * Flat registry of ALL GameObjects in this scene (including children).
     * Keyed by UUID for O(1) lookup.
     */
    private _registry: Map<string, GameObject> = new Map();

    /**
     * Whether this scene has been loaded and is valid.
     */
    private _isLoaded: boolean = true;

    // ==================== CONSTRUCTOR ====================

    constructor(name: string = "New Scene") {
        this.name = name;
        this._threeScene = new THREE.Scene();
    }

    // ==================== PUBLIC READ-ONLY PROPERTIES ====================

    /**
     * Whether this scene has been loaded successfully.
     *
     * @remarks
     * Equivalent to Unity's `Scene.isLoaded`.
     */
    public get isLoaded(): boolean {
        return this._isLoaded;
    }

    /**
     * The number of root-level GameObjects in this scene.
     *
     * @remarks
     * Equivalent to Unity's `Scene.rootCount`.
     */
    public get rootCount(): number {
        return this._rootGameObjects.length;
    }

    /**
     * The total number of GameObjects registered in this scene
     * (including nested children).
     */
    public get gameObjectCount(): number {
        return this._registry.size;
    }

    // ==================== INTERNAL THREE.JS ACCESSOR ====================

    /**
     * @internal
     * The underlying Three.js scene. Used only by internal engine systems
     * (Application renderer, Transform sync).
     *
     * **Never expose this to engine users.**
     */
    public get _internalThreeScene(): THREE.Scene {
        return this._threeScene;
    }

    // ==================== GAMEOBJECT REGISTRATION ====================

    /**
     * @internal
     * Registers a GameObject with this scene.
     * Called automatically by the GameObject constructor.
     *
     * @param go — the GameObject to register.
     */
    public _registerGameObject(go: GameObject): void {
        if (this._registry.has(go.uuid)) return;

        // 1. Add to flat registry
        this._registry.set(go.uuid, go);

        // 2. If parentless, it's a root object
        if (go.transform.parent === null) {
            this._rootGameObjects.push(go);
            // Sync: add to Three.js scene root
            this._threeScene.add(go.transform._internalObject3D);
        }
    }

    /**
     * @internal
     * Unregisters a GameObject from this scene.
     * Called when a GameObject is destroyed.
     *
     * @param go — the GameObject to unregister.
     */
    public _unregisterGameObject(go: GameObject): void {
        // 1. Remove from flat registry
        this._registry.delete(go.uuid);

        // 2. If it was a root, remove from root list
        const rootIndex = this._rootGameObjects.indexOf(go);
        if (rootIndex !== -1) {
            this._rootGameObjects.splice(rootIndex, 1);
        }

        // 3. Remove from Three.js scene (safe even if not a direct child)
        this._threeScene.remove(go.transform._internalObject3D);
    }

    /**
     * @internal
     * Called by Transform when a GameObject's parent changes,
     * to keep the root list and Three.js scene hierarchy in sync.
     *
     * @param go — the GameObject whose parent changed.
     * @param isRootNow — `true` if the GO is now parentless (root).
     */
    public _onGameObjectParentChanged(go: GameObject, isRootNow: boolean): void {
        if (isRootNow) {
            // Became a root → add to root list and Three.js scene
            if (!this._rootGameObjects.includes(go)) {
                this._rootGameObjects.push(go);
                this._threeScene.add(go.transform._internalObject3D);
            }
        } else {
            // Became a child → remove from root list
            // (Three.js auto-removes from old parent when added to new parent)
            const index = this._rootGameObjects.indexOf(go);
            if (index !== -1) {
                this._rootGameObjects.splice(index, 1);
            }
        }
    }

    // ==================== GAMEOBJECT SEARCH (UNITY STYLE) ====================

    /**
     * Returns a copy of all root-level GameObjects in this scene.
     *
     * @remarks
     * Equivalent to Unity's `Scene.GetRootGameObjects()`.
     */
    public getRootGameObjects(): GameObject[] {
        return [...this._rootGameObjects];
    }

    /**
     * Finds a GameObject by name. Returns the first match or `null`.
     *
     * @remarks
     * Equivalent to `GameObject.Find(name)` scoped to this scene.
     * Searches all GameObjects (including children), not just roots.
     *
     * @param name — the name to search for.
     */
    public findGameObject(name: string): GameObject | null {
        for (const go of this._registry.values()) {
            if (go.name === name) return go;
        }
        return null;
    }

    /**
     * Finds all GameObjects with the specified tag.
     *
     * @remarks
     * Equivalent to `GameObject.FindGameObjectsWithTag(tag)` scoped to this scene.
     *
     * @param tag — the tag to search for.
     */
    public findGameObjectsWithTag(tag: string): GameObject[] {
        const results: GameObject[] = [];
        for (const go of this._registry.values()) {
            if (go.tag === tag) results.push(go);
        }
        return results;
    }

    /**
     * Finds the first Component of the specified type in the entire scene.
     *
     * @remarks
     * Equivalent to Unity's `Object.FindObjectOfType<T>()`.
     *
     * @param type — the component constructor to search for.
     */
    public findObjectOfType<T extends Component>(
        type: new (...args: never[]) => T
    ): T | null {
        for (const go of this._registry.values()) {
            const comp = go.getComponent(type);
            if (comp) return comp;
        }
        return null;
    }

    /**
     * Finds all Components of the specified type in the entire scene.
     *
     * @remarks
     * Equivalent to Unity's `Object.FindObjectsOfType<T>()`.
     *
     * @param type — the component constructor to search for.
     */
    public findObjectsOfType<T extends Component>(
        type: new (...args: never[]) => T
    ): T[] {
        const results: T[] = [];
        for (const go of this._registry.values()) {
            const comps = go.getComponents(type);
            results.push(...comps);
        }
        return results;
    }

    // ==================== UPDATE LOOPS ====================

    /**
     * @internal
     * Runs FixedUpdate on all active root GameObjects (and their children recursively).
     * Called by Application at a fixed timestep.
     */
    public _fixedUpdate(): void {
        const passes = _executionOrderPasses();

        // One pass is the default: no class has declared an @ExecutionOrder, so
        // every component belongs to the same group and none has to be checked.
        if (passes.length === 1) {
            for (let i = 0; i < this._rootGameObjects.length; i++) {
                const go = this._rootGameObjects[i];
                if (go.activeSelf) go._systemFixedUpdate(null);
            }
            return;
        }

        // Otherwise the hierarchy is walked once per order, ascending. Within an
        // order the walk is unchanged, so hierarchy order still decides.
        for (let p = 0; p < passes.length; p++) {
            for (let i = 0; i < this._rootGameObjects.length; i++) {
                const go = this._rootGameObjects[i];
                if (go.activeSelf) go._systemFixedUpdate(passes[p]);
            }
        }
    }

    /**
     * @internal
     * Runs Update on all active root GameObjects (and their children recursively).
     * Called by Application once per frame.
     */
    public _update(): void {
        const passes = _executionOrderPasses();

        // One pass is the default: no class has declared an @ExecutionOrder, so
        // every component belongs to the same group and none has to be checked.
        if (passes.length === 1) {
            for (let i = 0; i < this._rootGameObjects.length; i++) {
                const go = this._rootGameObjects[i];
                if (go.activeSelf) go._systemUpdate(null);
            }
            return;
        }

        // Otherwise the hierarchy is walked once per order, ascending. Within an
        // order the walk is unchanged, so hierarchy order still decides.
        for (let p = 0; p < passes.length; p++) {
            for (let i = 0; i < this._rootGameObjects.length; i++) {
                const go = this._rootGameObjects[i];
                if (go.activeSelf) go._systemUpdate(passes[p]);
            }
        }
    }

    /**
     * @internal
     * Runs LateUpdate on all active root GameObjects (and their children recursively).
     * Called by Application once per frame, after Update.
     */
    public _lateUpdate(): void {
        const passes = _executionOrderPasses();

        // One pass is the default: no class has declared an @ExecutionOrder, so
        // every component belongs to the same group and none has to be checked.
        if (passes.length === 1) {
            for (let i = 0; i < this._rootGameObjects.length; i++) {
                const go = this._rootGameObjects[i];
                if (go.activeSelf) go._systemLateUpdate(null);
            }
            return;
        }

        // Otherwise the hierarchy is walked once per order, ascending. Within an
        // order the walk is unchanged, so hierarchy order still decides.
        for (let p = 0; p < passes.length; p++) {
            for (let i = 0; i < this._rootGameObjects.length; i++) {
                const go = this._rootGameObjects[i];
                if (go.activeSelf) go._systemLateUpdate(passes[p]);
            }
        }
    }

    // ==================== DESTRUCTION ====================

    /**
     * Destroys this scene and all GameObjects within it.
     *
     * After calling this method the scene is no longer valid
     * ({@link isLoaded} becomes `false`).
     *
     * @remarks
     * Called by {@link SceneManager.loadScene} when replacing the active scene.
     */
    public destroy(): void {
        // Copy the array because destroyImmediate modifies it via _unregisterGameObject
        const roots = [...this._rootGameObjects];
        for (const go of roots) {
            go.destroyImmediate();
        }

        this._rootGameObjects = [];
        this._registry.clear();
        this._threeScene.clear();
        this._isLoaded = false;
    }
}