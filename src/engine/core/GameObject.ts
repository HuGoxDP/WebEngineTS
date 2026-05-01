// path: src/engine/core/GameObject.ts

import { EngineObject } from "./EngineObject.ts";
import { SceneManager } from "./SceneManager.ts";
import { Transform } from "./Transform.ts";
import { Component } from "./Component.ts";
import { Behaviour } from "./Behaviour.ts";
import { ScriptableBehaviour } from "./ScriptableBehaviour.ts";
import { EngineSettings } from "./EngineSettings.ts";
import type { Scene } from "./Scene.ts";
import { Bounds } from "./math/Bounds.ts";
import { Vector3 } from "./math/Vector3.ts";
/**
 * The fundamental object in the engine — a container for {@link Component Components}.
 *
 * Every GameObject has a {@link Transform} (created automatically) and can hold
 * any number of additional Components that define its behaviour.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.GameObject`.
 *
 * - Components are added with {@link addComponent} and queried with
 *   {@link getComponent}, {@link getComponentInChildren}, etc.
 * - Activation state controls visibility and script execution:
 *   {@link setActive} changes local state, {@link activeInHierarchy} reflects
 *   whether the object is truly active considering parent hierarchy.
 * - Messaging methods ({@link sendMessage}, {@link broadcastMessage},
 *   {@link sendMessageUpwards}) invoke named methods on attached scripts.
 *
 * @example
 * ```ts
 * const player = new GameObject("Player");
 * player.tag = "Player";
 * const script = player.addComponent(PlayerController);
 * player.transform.position = new Vector3(0, 1, 0);
 * ```
 */
export class GameObject extends EngineObject {

    // ==================== PUBLIC FIELDS ====================

    /**
     * The {@link Transform} attached to this GameObject.
     * Every GameObject always has exactly one Transform, created automatically.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.transform`.
     * Cannot be removed or replaced.
     */
    public readonly transform: Transform;

    /**
     * The layer this GameObject belongs to.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.layer`.
     * Used for rendering, physics, and raycasting filtering.
     */
    public layer: number = EngineSettings.Layers.DEFAULT;

    /**
     * The tag of this GameObject.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.tag`.
     * Default is `"Untagged"`.
     */
    public tag: string = "Untagged";

    // ==================== PRIVATE FIELDS ====================

    /** Local active state (independent of parent hierarchy). */
    private _activeSelf: boolean = true;

    /** All components attached to this GameObject (excludes Transform). */
    private _components: Component[] = [];

    /** The scene this GameObject is registered with. */
    private _scene: Scene;

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a new GameObject and registers it with the active scene.
     *
     * @param name — the display name. Default: `"New GameObject"`.
     *
     * @remarks
     * The Transform is created automatically.
     * The GameObject is immediately registered with {@link SceneManager.activeScene}.
     */
    constructor(name: string = "New GameObject") {
        super(name);

        // Transform is created automatically — it is NOT added to _components
        // because it is an inseparable part of every GameObject.
        this.transform = new Transform(this);

        // Register with the active scene
        this._scene = SceneManager.activeScene;
        this._scene._registerGameObject(this);
    }

    // ==================== ACTIVATION STATE ====================

    /**
     * The local active state of this GameObject.
     *
     * `true` even if a parent is inactive — use {@link activeInHierarchy}
     * to check whether this object is truly active in the scene.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.activeSelf`.
     */
    public get activeSelf(): boolean {
        return this._activeSelf;
    }

    /**
     * Whether this GameObject is active in the scene, considering the
     * entire parent hierarchy.
     *
     * Returns `false` if this object OR any ancestor is inactive.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.activeInHierarchy`.
     *
     * The engine's update loops and {@link Behaviour.isActiveAndEnabled}
     * use this to determine if components should run.
     */
    public get activeInHierarchy(): boolean {
        if (!this._activeSelf) return false;

        let parentTransform = this.transform.parent;
        while (parentTransform !== null) {
            if (!parentTransform.gameObject._activeSelf) return false;
            parentTransform = parentTransform.parent;
        }
        return true;
    }

    /**
     * The {@link Scene} this GameObject belongs to.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.scene`.
     */
    public get scene(): Scene {
        return this._scene;
    }

    /**
     * Activates or deactivates this GameObject.
     *
     * When deactivated:
     * - The object and all children become invisible
     * - All scripts stop receiving Update calls
     * - {@link Behaviour.onDisable} is called on affected components
     *
     * @param value — `true` to activate, `false` to deactivate.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.SetActive(value)`.
     */
    public setActive(value: boolean): void {
        if (this._activeSelf === value) return;

        this._activeSelf = value;

        // 1. Sync visibility in Three.js (master → slave)
        // In Unity, SetActive(false) hides the entire object and children
        this.transform._internalObject3D.visible = value;

        // 2. Notify components (triggers OnEnable/OnDisable transitions)
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                component._onEnabledChanged();
            }
        }

        // 3. Propagate to children (their activeInHierarchy changes)
        for (let i = 0; i < this.transform.childCount; i++) {
            const child = this.transform.getChild(i);
            child.gameObject._onParentActiveStateChanged();
        }
    }

    /**
     * @internal
     * Called when a parent's active state changes, propagating down
     * the hierarchy so that all descendant Behaviours can re-evaluate
     * their {@link Behaviour.isActiveAndEnabled} state.
     *
     * This matches Unity's behaviour: toggling a parent's active state
     * fires OnEnable/OnDisable on all descendant Behaviours.
     */
    public _onParentActiveStateChanged(): void {
        // Notify this GO's components
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                component._onEnabledChanged();
            }
        }

        // Recurse to children (they inherit our active state)
        for (let i = 0; i < this.transform.childCount; i++) {
            const child = this.transform.getChild(i);
            child.gameObject._onParentActiveStateChanged();
        }
    }

    // ==================== COMPONENT SYSTEM ====================

    /**
     * Adds a new component of the given type to this GameObject.
     *
     * @typeParam T — component subclass to add.
     * @param type — the component class/constructor.
     * @returns the newly created component instance.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.AddComponent<T>()`.
     *
     * Lifecycle order:
     * 1. Constructor runs
     * 2. `Awake()` fires — `_systemAwake()` for user scripts,
     *    `_internalInitialize()` for built-in components
     * 3. `OnEnable()` fires (if active and enabled)
     */
    public addComponent<T extends Component>(type: new (go: GameObject) => T): T {
        const component = new type(this);
        this._components.push(component);

        // Lifecycle: Awake
        // - ScriptableBehaviour (user scripts) → _systemAwake() → public awake()
        // - Built-in Behaviours (Camera, Light, etc.) → _internalInitialize() → protected onAwake()
        if (component instanceof ScriptableBehaviour) {
            component._systemAwake();
        } else if (component instanceof Behaviour) {
            component._internalInitialize();
        }

        // Lifecycle: OnEnable (if the GO is active in hierarchy and component is enabled)
        if (component instanceof Behaviour && this.activeInHierarchy && component.enabled) {
            component._onEnabledChanged();
        }

        return component;
    }

    /**
     * Removes a component from this GameObject and runs its destroy lifecycle.
     *
     * @param component — the exact component instance to remove.
     * @returns `true` if the component was removed, `false` if not found or
     *          the component was a Transform (Transforms are an inseparable
     *          part of every GameObject).
     *
     * @remarks
     * Equivalent to Unity's `Destroy(component)`. Cleans up Three.js side
     * effects (e.g. lights, mesh visuals) via the component's
     * `_destroyImmediate` lifecycle hook.
     */
    public removeComponent(component: Component): boolean {
        if (component instanceof Transform) return false;
        const idx = this._components.indexOf(component);
        if (idx === -1) return false;

        // Run lifecycle (Disable + Destroy) first so subsystems can unhook.
        try {
            component._destroyImmediate();
        } catch (err) {
            console.error("[GameObject.removeComponent] error during destroy:", err);
        }
        this._components.splice(idx, 1);
        return true;
    }

    /**
     * Returns the first component of the given type, or `null`.
     *
     * @typeParam T — component subclass to search for.
     * @param type — the component class/constructor.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.GetComponent<T>()`.
     * Supports inheritance — searching for `Renderer` finds `MeshRenderer`.
     */
    public getComponent<T extends Component>(type: new (...args: never[]) => T): T | null {
        for (const comp of this._components) {
            if (comp instanceof type) {
                return comp;
            }
        }
        return null;
    }

    /**
     * Returns all components of the given type.
     *
     * @typeParam T — component subclass to search for.
     * @param type — the component class/constructor.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.GetComponents<T>()`.
     */
    public getComponents<T extends Component>(type: new (...args: never[]) => T): T[] {
        const results: T[] = [];
        for (const comp of this._components) {
            if (comp instanceof type) {
                results.push(comp);
            }
        }
        return results;
    }

    /**
     * Returns the first component of the given type found in this GameObject
     * or any of its children (depth-first search).
     *
     * @typeParam T — component subclass to search for.
     * @param type — the component class/constructor.
     * @param includeInactive — if `true`, also searches inactive GameObjects. Default `false`.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.GetComponentInChildren<T>()`.
     */
    public getComponentInChildren<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T | null {
        // Check self first
        if (includeInactive || this._activeSelf) {
            const found = this.getComponent(type);
            if (found) return found;
        }

        // Depth-first search children
        for (let i = 0; i < this.transform.childCount; i++) {
            const childGO = this.transform.getChild(i).gameObject;
            if (!includeInactive && !childGO._activeSelf) continue;

            const found = childGO.getComponentInChildren(type, includeInactive);
            if (found) return found;
        }

        return null;
    }

    /**
     * Returns all components of the given type found in this GameObject
     * and its children (depth-first search).
     *
     * @typeParam T — component subclass to search for.
     * @param type — the component class/constructor.
     * @param includeInactive — if `true`, also searches inactive GameObjects. Default `false`.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.GetComponentsInChildren<T>()`.
     */
    public getComponentsInChildren<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T[] {
        const results: T[] = [];
        this._collectComponentsInChildren(type, includeInactive, results);
        return results;
    }

    /**
     * Returns the first component of the given type found in any
     * parent GameObject (walking upward).
     *
     * @typeParam T — component subclass to search for.
     * @param type — the component class/constructor.
     * @param includeInactive — if `true`, also searches inactive GameObjects. Default `false`.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.GetComponentInParent<T>()`.
     * Starts from `this` and walks up through parents.
     */
    public getComponentInParent<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T | null {
        // Check self first
        if (includeInactive || this._activeSelf) {
            const found = this.getComponent(type);
            if (found) return found;
        }

        // Walk up the parent chain
        let parentTransform = this.transform.parent;
        while (parentTransform !== null) {
            const parentGO = parentTransform.gameObject;
            if (includeInactive || parentGO._activeSelf) {
                const found = parentGO.getComponent(type);
                if (found) return found;
            }
            parentTransform = parentTransform.parent;
        }

        return null;
    }

    /**
     * Returns all components of the given type found in this
     * GameObject and all parent GameObjects (walking upward).
     *
     * @typeParam T — component subclass to search for.
     * @param type — the component class/constructor.
     * @param includeInactive — if `true`, also searches inactive GameObjects. Default `false`.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.GetComponentsInParent<T>()`.
     */
    public getComponentsInParent<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T[] {
        const results: T[] = [];

        // Check self
        if (includeInactive || this._activeSelf) {
            for (const comp of this._components) {
                if (comp instanceof type) results.push(comp);
            }
        }

        // Walk up the parent chain
        let parentTransform = this.transform.parent;
        while (parentTransform !== null) {
            const parentGO = parentTransform.gameObject;
            if (includeInactive || parentGO._activeSelf) {
                for (const comp of parentGO._components) {
                    if (comp instanceof type) results.push(comp);
                }
            }
            parentTransform = parentTransform.parent;
        }

        return results;
    }

    // ==================== TAG COMPARISON ====================

    /**
     * Checks whether this GameObject has the specified tag.
     *
     * @param tag — the tag string to compare against.
     * @returns `true` if the tags match.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.CompareTag(tag)`.
     * Preferred over `gameObject.tag === "..."` for clarity and future
     * extensibility (e.g., tag validation).
     */
    public compareTag(tag: string): boolean {
        return this.tag === tag;
    }

    // ==================== MESSAGING ====================

    /**
     * Calls the named method on every {@link ScriptableBehaviour} attached
     * to this GameObject.
     *
     * @param methodName — the method name to invoke.
     * @param value — optional argument to pass.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.SendMessage(methodName)`.
     * Silently skips components that don't define the method.
     */
    public sendMessage(methodName: string, value?: unknown): void {
        for (const comp of this._components) {
            if (comp instanceof ScriptableBehaviour) {
                const method = (comp as unknown as Record<string, unknown>)[methodName];
                if (typeof method === "function") {
                    try {
                        (method as (v?: unknown) => void).call(comp, value);
                    } catch (err) {
                        console.error(
                            `[GameObject] SendMessage error on '${this.name}' ` +
                            `calling '${methodName}':`, err
                        );
                    }
                }
            }
        }
    }

    /**
     * Calls the named method on every {@link ScriptableBehaviour} in this
     * GameObject **and all of its children** (recursive).
     *
     * @param methodName — the method name to invoke.
     * @param value — optional argument to pass.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.BroadcastMessage(methodName)`.
     */
    public broadcastMessage(methodName: string, value?: unknown): void {
        // Self
        this.sendMessage(methodName, value);

        // Children (recursive)
        for (let i = 0; i < this.transform.childCount; i++) {
            this.transform.getChild(i).gameObject.broadcastMessage(methodName, value);
        }
    }

    /**
     * Calls the named method on every {@link ScriptableBehaviour} in this
     * GameObject **and all of its parents** (upward).
     *
     * @param methodName — the method name to invoke.
     * @param value — optional argument to pass.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.SendMessageUpwards(methodName)`.
     */
    public sendMessageUpwards(methodName: string, value?: unknown): void {
        // Self
        this.sendMessage(methodName, value);

        // Walk up parents
        let parentTransform = this.transform.parent;
        while (parentTransform !== null) {
            parentTransform.gameObject.sendMessage(methodName, value);
            parentTransform = parentTransform.parent;
        }
    }

    // ==================== UPDATE LOOPS ====================

    /**
     * @internal
     * Runs the Update loop on this GameObject and its children.
     * Called by {@link Scene._update} for root objects.
     */
    public _systemUpdate(): void {
        if (!this._activeSelf) return;

        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) {
                component._systemUpdate();
            }
        }

        const count = this.transform.childCount;
        for (let i = 0; i < count; i++) {
            this.transform.getChild(i).gameObject._systemUpdate();
        }
    }

    /**
     * @internal
     * Runs the FixedUpdate loop on this GameObject and its children.
     */
    public _systemFixedUpdate(): void {
        if (!this._activeSelf) return;

        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) {
                component._systemFixedUpdate();
            }
        }

        const count = this.transform.childCount;
        for (let i = 0; i < count; i++) {
            this.transform.getChild(i).gameObject._systemFixedUpdate();
        }
    }

    /**
     * @internal
     * Runs the LateUpdate loop on this GameObject and its children.
     */
    public _systemLateUpdate(): void {
        if (!this._activeSelf) return;

        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) {
                component._systemLateUpdate();
            }
        }

        const count = this.transform.childCount;
        for (let i = 0; i < count; i++) {
            this.transform.getChild(i).gameObject._systemLateUpdate();
        }
    }

    // ==================== DESTRUCTION ====================

    /**
     * @internal
     * Destroys this GameObject, its components, and all children.
     *
     * Order:
     * 1. Destroy all attached components (fires OnDisable → OnDestroy)
     * 2. Destroy all children recursively
     * 3. Unregister from scene
     * 4. Destroy the Transform (removes from Three.js hierarchy)
     */
    protected override onDestroy(): void {
        // 1. Destroy all components
        for (const component of this._components) {
            component.destroyImmediate();
        }
        this._components = [];

        // 2. Destroy children recursively
        // Copy array because destroyImmediate modifies it via Transform._children
        const children = [...this.transform._internalChildren];
        for (const child of children) {
            child.gameObject.destroyImmediate();
        }

        // 3. Unregister from scene
        this._scene._unregisterGameObject(this);

        // 4. Destroy Transform (clears Three.js objects)
        this.transform.destroyImmediate();
    }

    // ==================== STATIC CONVENIENCE METHODS ====================

    /**
     * Finds a GameObject by name in the active scene.
     *
     * @param name — the name to search for.
     * @returns the first match, or `null`.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.Find(name)`.
     *
     * **Performance warning:** Searches all objects. Cache the result.
     */
    public static Find(name: string): GameObject | null {
        return SceneManager.activeScene.findGameObject(name);
    }

    /**
     * Finds all GameObjects with the specified tag in the active scene.
     *
     * @param tag — the tag to search for.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.FindGameObjectsWithTag(tag)`.
     */
    public static FindGameObjectsWithTag(tag: string): GameObject[] {
        return SceneManager.activeScene.findGameObjectsWithTag(tag);
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Recursive helper for {@link getComponentsInChildren}.
     */
    private _collectComponentsInChildren<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean,
        results: T[]
    ): void {
        // Collect from self
        if (includeInactive || this._activeSelf) {
            for (const comp of this._components) {
                if (comp instanceof type) {
                    results.push(comp);
                }
            }
        }

        // Recurse children
        for (let i = 0; i < this.transform.childCount; i++) {
            const childGO = this.transform.getChild(i).gameObject;
            if (includeInactive || childGO._activeSelf) {
                childGO._collectComponentsInChildren(type, includeInactive, results);
            }
        }
    }

    // ==================== BOUNDS & NORMALIZATION ====================
    /**
     * Computes the world-space axis-aligned bounding box of this
     * GameObject and ALL its descendants (children, grandchildren, etc.).
     * Accounts for all transforms in the hierarchy — position, rotation,
     * scale, including internal scales baked into imported GLTF models.
     * @returns a Bounds in world-space enclosing every mesh in the hierarchy.
     */
    public getWorldBounds(): Bounds {
            return this.transform._computeHierarchyBounds();
    }

    /**
      * Scales this GameObject uniformly so its largest dimension
      * equals `targetSize` in world units.
      */
    public normalizeToSize(targetSize: number): void {
        // Reset scale to (1,1,1) so measurement reflects original model
        this.transform.localScale = new Vector3(1, 1, 1);

        const bounds = this.getWorldBounds();
        const size = bounds.size;
        const maxDimension = Math.max(size.x, size.y, size.z);

        if (maxDimension < 0.0001) {
            console.warn(`[GameObject] normalizeToSize: "${this.name}" has zero bounds`);
            return;
        }

        const scale = targetSize / maxDimension;
        this.transform.localScale = new Vector3(scale, scale, scale);
    }
}