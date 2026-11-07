// path: src/engine/core/Scene.ts

import * as THREE from "three";
import { _executionOrderPasses } from "./reflection/Decorators.ts";
import { _beginUpdateWalk, _movedInWalk, _recordMovesFor } from "./_UpdateWalk.ts";
import type { GameObject } from "./GameObject.ts";
import type { Component } from "./Component.ts";

/** Which per-frame callback a walk runs. */
type UpdatePass = 0 | 1 | 2;
const PASS_FIXED_UPDATE = 0;
const PASS_UPDATE = 1;
const PASS_LATE_UPDATE = 2;

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
     * @internal
     * Mirrors the engine's left-handed world (X right, Y up, **Z forward**) into
     * Three.js' right-handed one, so a scene authored against Unity's axes renders
     * the same way Unity renders it rather than horizontally flipped.
     *
     * Every root GameObject hangs from here, so `matrixWorld` for any renderable
     * has a negative determinant — which Three.js detects per object
     * (`renderBufferDirect`: `frontFaceCW = object.matrixWorld.determinant() < 0`)
     * and compensates for by flipping the winding. Front faces stay front, so no
     * geometry, index order or normal has to change.
     *
     * The consequence to remember: **Three.js world space is now the mirror of
     * engine world space.** Anything reading a world position, rotation or matrix
     * back out of an `Object3D` must undo it — see `Transform`'s
     * `_fromThreeWorld*` helpers. Cameras cancel it with a matching scale so their
     * view matrix stays proper, which Three.js requires for culling.
     */
    private readonly _contentRoot: THREE.Group;

    /**
     * Root-level GameObjects (those whose Transform has no parent).
     * Iterated by the update loops.
     *
     * Copy-on-write while lent, like `Transform`'s child list: an update loop
     * holds the array it was given ({@link _lendRoots}), so a root destroyed,
     * reparented, reordered or added meanwhile changes a copy and the loop
     * keeps seeing the list it started with. Every write reaches the list
     * through {@link _writableRoots}.
     */
    private _rootGameObjects: GameObject[] = [];

    /** Whether {@link _rootGameObjects} has been handed to a loop that may still be running. */
    private _rootsLent: boolean = false;

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
        this._contentRoot = new THREE.Group();
        this._contentRoot.name = "__engineContentRoot";
        this._contentRoot.scale.set(1, 1, -1);
        this._threeScene.add(this._contentRoot);
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
            this._writableRoots().push(go);
            // Sync: add to Three.js scene root
            this._contentRoot.add(go.transform._internalObject3D);
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
            this._writableRoots().splice(rootIndex, 1);
        }

        // 3. Remove from Three.js scene (safe even if not a direct child)
        this._contentRoot.remove(go.transform._internalObject3D);
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
                this._writableRoots().push(go);
                this._contentRoot.add(go.transform._internalObject3D);
            }
        } else {
            // Became a child → remove from root list
            // (Three.js auto-removes from old parent when added to new parent)
            const index = this._rootGameObjects.indexOf(go);
            if (index !== -1) {
                this._writableRoots().splice(index, 1);
            }
        }
    }

    /**
     * @internal
     * Where a root GameObject sits among the scene's roots, or -1 if it is not one.
     * Backs `Transform.getSiblingIndex` for objects without a parent.
     */
    public _rootIndexOf(go: GameObject): number {
        return this._rootGameObjects.indexOf(go);
    }

    /**
     * @internal
     * Moves a root GameObject to `index` among the scene's roots, clamped to the
     * list. Backs `Transform.setSiblingIndex` for objects without a parent.
     */
    public _moveRoot(go: GameObject, index: number): void {
        const from = this._rootGameObjects.indexOf(go);
        if (from === -1) return;
        const to = Math.max(0, Math.min(index, this._rootGameObjects.length - 1));
        if (to === from) return;
        const roots = this._writableRoots();
        roots.splice(from, 1);
        roots.splice(to, 0, go);
    }

    /** The root list to change: the current one, or a copy if an update loop still holds it. */
    private _writableRoots(): GameObject[] {
        if (this._rootsLent) {
            this._rootGameObjects = this._rootGameObjects.slice();
            this._rootsLent = false;
        }
        return this._rootGameObjects;
    }

    /**
     * The root list, for an update loop that runs user code and so may see a
     * root destroyed, reparented, reordered, moved to another scene or created
     * before it finishes.
     *
     * Nothing is copied here: the array is marked as lent, and the first change
     * made afterwards writes to a copy (see {@link _writableRoots}). A frame in
     * which no root changes therefore allocates nothing. Entries may have
     * changed since the list was taken, so the loop tests each with
     * {@link _isLiveRoot}; a root created during the loop joins the next one,
     * as a child created during its parent's walk does.
     */
    private _lendRoots(): readonly GameObject[] {
        this._rootsLent = true;
        return this._rootGameObjects;
    }

    /**
     * Whether a root taken from a lent list is still a live root of this scene.
     * One destroyed meanwhile must not run; one that became a child, or moved
     * to another scene, belongs to the walk of its new parent or scene.
     */
    private _isLiveRoot(go: GameObject): boolean {
        return go.exists() && go.scene === this && go.transform.parent === null;
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
     * Equivalent to Unity's `Object.FindObjectOfType<T>(bool includeInactive)`:
     * components on GameObjects that are not `activeInHierarchy` are skipped
     * unless asked for. A disabled component on an active object is still
     * found — the filter is the object's activity, not the component's
     * `enabled`.
     *
     * @param type — the component constructor to search for.
     * @param includeInactive — also search inactive GameObjects. Default `false`.
     */
    public findObjectOfType<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false,
    ): T | null {
        for (const go of this._registry.values()) {
            if (!includeInactive && !go.activeInHierarchy) continue;
            const comp = go.getComponent(type);
            if (comp) return comp;
        }
        return null;
    }

    /**
     * Finds all Components of the specified type in the entire scene.
     *
     * @remarks
     * Equivalent to Unity's `Object.FindObjectsOfType<T>(bool includeInactive)`.
     * Components on GameObjects that are not `activeInHierarchy` are skipped
     * unless asked for; a disabled component on an active object is still
     * returned.
     *
     * @param type — the component constructor to search for.
     * @param includeInactive — also search inactive GameObjects. Default `false`.
     */
    public findObjectsOfType<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false,
    ): T[] {
        const results: T[] = [];
        for (const go of this._registry.values()) {
            if (!includeInactive && !go.activeInHierarchy) continue;
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
        this._runPass(PASS_FIXED_UPDATE);
    }

    /**
     * @internal
     * Runs Update on all active root GameObjects (and their children recursively).
     * Called by Application once per frame.
     *
     * Each walk of the hierarchy — one per execution order — is numbered, so
     * an object that already ran and is then moved under a root or parent
     * visited later in the same walk does not run a second time, and one moved
     * before its turn under a parent already walked is caught up at the end
     * of the walk (see {@link _walk}).
     */
    public _update(): void {
        this._runPass(PASS_UPDATE);
    }

    /**
     * @internal
     * Runs LateUpdate on all active root GameObjects (and their children recursively).
     * Called by Application once per frame, after Update.
     */
    public _lateUpdate(): void {
        this._runPass(PASS_LATE_UPDATE);
    }

    /** One per-frame pass: a single walk, or one walk per execution order. */
    private _runPass(pass: UpdatePass): void {
        const passes = _executionOrderPasses();

        // One pass is the default: no class has declared an @ExecutionOrder, so
        // every component belongs to the same group and none has to be checked.
        if (passes.length === 1) {
            this._walk(pass, null);
            return;
        }

        // Otherwise the hierarchy is walked once per order, ascending. Within an
        // order the walk is unchanged, so hierarchy order still decides.
        for (let p = 0; p < passes.length; p++) this._walk(pass, passes[p]);
    }

    /**
     * Walks the hierarchy once for `pass` and `order`, then catches up the
     * objects the walk missed.
     *
     * @remarks
     * The walk reaches objects through their parents, so one moved — before
     * its turn — under a parent the walk had already left, or made a root
     * after the root list was taken, is never reached. Unity's update does not
     * follow the hierarchy: a behaviour that existed when the pass began runs
     * in it once wherever it was moved. While the walk is open,
     * `Transform.setParent` records every moved object that has not run yet;
     * after the roots, each one that is still unrun, alive, in this scene and
     * active in the hierarchy is run with its subtree, under the same walk
     * number, so nothing runs twice. An object created during the walk is
     * never caught up — it starts next frame, as before.
     *
     * Nothing is allocated: the record is one shared array that grows only
     * when something is reparented mid-walk, and is emptied back to where
     * this walk found it.
     */
    private _walk(pass: UpdatePass, order: number | null): void {
        const roots = this._lendRoots();
        const walk = _beginUpdateWalk();
        const outer = _recordMovesFor(walk);
        const firstMoved = _movedInWalk.length;
        try {
            for (let i = 0; i < roots.length; i++) {
                const go = roots[i];
                if (go.activeSelf && this._isLiveRoot(go)) Scene._runObject(go, pass, order, walk);
            }
            // Catching up can move more objects; they are appended and caught up too.
            for (let i = firstMoved; i < _movedInWalk.length; i++) {
                const go = _movedInWalk[i];
                if (go.scene === this && go._missedWalk(walk)) Scene._runObject(go, pass, order, walk);
            }
        } finally {
            _movedInWalk.length = firstMoved;
            _recordMovesFor(outer);
        }
    }

    private static _runObject(go: GameObject, pass: UpdatePass, order: number | null, walk: number): void {
        switch (pass) {
            case PASS_FIXED_UPDATE: go._systemFixedUpdate(order, walk); break;
            case PASS_UPDATE: go._systemUpdate(order, walk); break;
            case PASS_LATE_UPDATE: go._systemLateUpdate(order, walk); break;
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
        this._rootsLent = false;
        this._registry.clear();
        // Clears the content, not the mirror root itself — the scene keeps its
        // handedness conversion across an unload.
        this._contentRoot.clear();
        this._isLoaded = false;
    }
}