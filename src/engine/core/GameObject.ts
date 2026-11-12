// path: src/engine/core/GameObject.ts

import { EngineObject } from "./EngineObject.ts";
import { SceneManager } from "./SceneManager.ts";
import { Transform } from "./Transform.ts";
import { Component } from "./Component.ts";
import { Behaviour } from "./Behaviour.ts";
import { ScriptableBehaviour } from "./ScriptableBehaviour.ts";
import { EngineSettings } from "./EngineSettings.ts";
import { getExecutionOrder } from "./reflection/Decorators.ts";
import { _beginUpdateWalk, _lastUpdateWalk } from "./_UpdateWalk.ts";
import { TypeRegistry } from "./reflection/TypeRegistry.ts";
import { Prefab } from "./serialization/Prefab.ts";
import { SceneSerializer } from "./serialization/SceneSerializer.ts";
import { AssetDatabase } from "./assets/AssetDatabase.ts";
import { PrefabDiff, type PrefabInstanceInfo } from "./serialization/PrefabOverride.ts";
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

    /**
     * The walk (`_beginUpdateWalk`) in which this object's own components last
     * ran. A walk that reaches the object again — because it was moved under a
     * parent the walk visits later — finds its own number here and does not
     * run them a second time.
     */
    private _ranInWalk: number = 0;

    /**
     * The last walk started before this object was created. A walk with a
     * higher number began after it existed; one at or below it did not, and
     * does not catch the object up — an object created during a pass starts
     * next frame.
     */
    private readonly _createdAfterWalk: number = _lastUpdateWalk();

    /**
     * @internal
     * What this object remembers about being the root of a prefab instance, or
     * null. Read and written by `Prefab` and `SceneSerializer`.
     *
     * **NEVER use in user-facing code.**
     */
    public _prefabInfo: PrefabInstanceInfo | null = null;

    /**
     * @internal
     * Which node of its prefab this object is, when it came from one. What lets
     * an instance be compared with, and rebuilt from, the prefab after the
     * prefab gains or loses siblings.
     *
     * **NEVER use in user-facing code.**
     */
    public _prefabNodeId: string | null = null;

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

    // ==================== PREFAB INSTANCE ====================

    /**
     * Whether this object is the root of an instance of a prefab.
     *
     * @remarks
     * Equivalent to the blue cube in Unity's Hierarchy. True from
     * {@link Prefab.instantiate} on, and true again after a scene is loaded,
     * for as long as nothing {@link unpackPrefab unpacks} it. Only the root
     * says so: the objects below it belong to the instance, and each knows
     * which node of the prefab it is ({@link prefabNodeId}).
     *
     * A prefab instance nested inside another is the root of its own
     * instance, so this is true for it as well.
     *
     * The link survives a copy (`EngineObject.Instantiate`) or a save only
     * when the prefab has an asset id — it was saved, or loaded through
     * `Resources` or `AssetDatabase`. A prefab made in code and never given
     * one has nothing to be named by, so its instance is copied and written
     * as a plain tree, and the copy reports false.
     */
    public get isPrefabInstance(): boolean {
        return this._prefabInfo !== null;
    }

    /**
     * The prefab this object is an instance of, or null.
     *
     * @remarks
     * Null for an object that is not an instance, and also for one whose prefab
     * is not loaded — the link is still there then ({@link isPrefabInstance}),
     * and the prefab is found once it is. A copy or a save keeps the link only
     * for a prefab that has an asset id (see {@link isPrefabInstance}); for any
     * other the copy has no prefab at all.
     */
    public get prefabSource(): Prefab | null {
        const info = this._prefabInfo;
        if (info === null) return null;

        // The prefab loaded under its id now, so a prefab file loaded again is
        // the one reported; the one it was built from otherwise.
        const found = info.guid !== null ? AssetDatabase.get(info.guid) : null;
        if (found instanceof Prefab) return found;
        return info.source instanceof Prefab ? info.source : null;
    }

    /**
     * The root of the prefab instance this object is part of: itself when it
     * is one, otherwise the nearest ancestor that is. Null outside any
     * instance.
     *
     * @remarks
     * Equivalent to Unity's `PrefabUtility.GetNearestPrefabInstanceRoot`. An
     * object added to an instance is under it and reports it too; whether it
     * is one of the prefab's own objects is `Prefab.getChanges`'s answer.
     */
    public get prefabInstanceRoot(): GameObject | null {
        for (let go: GameObject | null = this; go !== null; go = go.transform.parent?.gameObject ?? null) {
            if (go._prefabInfo !== null) return go;
        }
        return null;
    }

    /**
     * The root of the outermost prefab instance this object is part of,
     * crossing out of prefabs nested inside prefabs. Null outside any
     * instance.
     *
     * @remarks
     * Equivalent to Unity's `PrefabUtility.GetOutermostPrefabInstanceRoot`:
     * the instance the Hierarchy marks, and the only one that can be unpacked.
     * An instance merely added to another is its own outermost root.
     */
    public get outermostPrefabInstanceRoot(): GameObject | null {
        const nearest = this.prefabInstanceRoot;
        return nearest === null ? null : nearest._outermostEnclosingRoot();
    }

    /**
     * Whether this is the root of a prefab instance whose prefab is not
     * loaded.
     *
     * @remarks
     * Equivalent to Unity's "Missing Prefab". An instance saved as its prefab
     * plus changes is then a placeholder with nothing built under it, and stays
     * one until the scene is opened again with the prefab loaded; one saved in
     * full is complete, but cannot be compared with its prefab. A reference
     * into a placeholder's missing objects is lost if the scene is saved in
     * that state, which is why an editor shows this before it does.
     */
    public get isPrefabAssetMissing(): boolean {
        const info = this._prefabInfo;
        return info !== null && (info.raw !== null || this.prefabSource === null);
    }

    /**
     * Which node of its prefab this object is, or null for an object that did
     * not come from one.
     *
     * @remarks
     * The root of an instance has no node in the prefab it is an instance of —
     * it *is* that prefab — so its id is null at the top level of a scene.
     * When the instance is nested inside another prefab, its id is its node in
     * that outer prefab. It is never the prefab's own root id: the same prefab
     * nested twice would otherwise put two equal ids into one prefab.
     */
    public get prefabNodeId(): string | null {
        return this._prefabNodeId;
    }

    /**
     * Cuts this object loose from its prefab, leaving it and its children as
     * ordinary objects.
     *
     * @remarks
     * Equivalent to Unity's Unpack Prefab. Instances nested inside stay
     * instances unless `completely` — they are prefabs in their own right.
     *
     * Only an instance that is not itself part of another can be unpacked, as
     * in Unity: a prefab nested inside an instance is one of that instance's
     * nodes, and unpacking it alone would make the instance around it read as
     * one object removed and another added.
     *
     * @param completely - unpack the nested ones too.
     * @throws if this is a prefab nested inside another instance. The message
     *   names the instance to unpack instead.
     */
    public unpackPrefab(completely: boolean = false): void {
        if (this._isNestedInstanceRoot()) {
            const outermost = this._outermostEnclosingRoot();
            throw new Error(
                `[GameObject] "${this.name}" is part of the prefab instance "${outermost.name}" and ` +
                `cannot be unpacked on its own. Unpack "${outermost.name}" instead.`,
            );
        }
        if (this._prefabInfo === null && !completely) return;
        this._prefabInfo = null;

        const walk = (go: GameObject): void => {
            for (let i = 0; i < go.transform.childCount; i++) {
                const child = go.transform.getChild(i).gameObject;
                // Its id names it within the prefab being unpacked, which no
                // longer holds it.
                child._prefabNodeId = null;
                GameObject._clearComponentIds(child);
                if (child._prefabInfo !== null) {
                    // A nested instance owns the rest of its subtree's ids.
                    if (!completely) continue;
                    child._prefabInfo = null;
                }
                walk(child);
            }
        };
        this._prefabNodeId = null;
        GameObject._clearComponentIds(this);
        walk(this);
    }

    /**
     * Cuts every component of `go` loose from the prefab node it came from,
     * exactly where node ids are cut: an object that is no longer any
     * prefab's node has no components addressable within one either.
     *
     * @internal
     * Only the objects's own components — a caller that unwalks a subtree
     * clears one object at a time.
     */
    public static _clearComponentIds(go: GameObject): void {
        for (const component of go._components) component._prefabComponentId = null;
    }

    /** The nearest ancestor that is the root of a prefab instance, or null. */
    private _enclosingInstanceRoot(): GameObject | null {
        for (let t = this.transform.parent; t !== null; t = t.parent) {
            if (t.gameObject._prefabInfo !== null) return t.gameObject;
        }
        return null;
    }

    /**
     * Whether this is an instance root that is a node of the instance around
     * it — a prefab nested in a prefab — rather than an instance added to it.
     * When the enclosing prefab is not loaded, a node id is taken to mean the
     * former.
     */
    private _isNestedInstanceRoot(): boolean {
        if (this._prefabInfo === null || this._prefabNodeId === null) return false;
        const outer = this._enclosingInstanceRoot();
        if (outer === null) return false;

        const source = outer.prefabSource;
        if (source === null) return true;
        try {
            return PrefabDiff.hasNode(source._resolvedTree(), this._prefabNodeId);
        } catch {
            return true;
        }
    }

    /** The outermost instance this nested instance root is part of. */
    private _outermostEnclosingRoot(): GameObject {
        let current: GameObject = this;
        while (current._isNestedInstanceRoot()) current = current._enclosingInstanceRoot()!;
        return current;
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

        // 2. Awake anything that was waiting for this, then notify components
        // (triggers OnEnable/OnDisable transitions). Awake first and for the
        // whole object, as Unity does: a script's onEnable may look at a
        // sibling, and finding it half-built would be worse than the deferral.
        this._runDeferredAwakes();
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                component._onEnabledChanged();
            }
        }

        // 3. Propagate to children (their activeInHierarchy changes)
        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (GameObject._isLiveChild(transform, child)) child.gameObject._onParentActiveStateChanged();
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
        // Notify this GO's components, after waking whatever was deferred.
        this._runDeferredAwakes();
        for (const component of this._components) {
            if (component instanceof Behaviour) {
                component._onEnabledChanged();
            }
        }

        // Recurse to children (they inherit our active state)
        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (GameObject._isLiveChild(transform, child)) child.gameObject._onParentActiveStateChanged();
        }
    }

    /**
     * Runs `awake` on any script that was added while this object was inactive.
     *
     * @remarks
     * No-op unless the object is now active in the hierarchy, so deactivating
     * does not wake anything, and `_systemAwake` is idempotent, so a script
     * that has already woken is not woken again by a second activation.
     */
    private _runDeferredAwakes(): void {
        if (!this.activeInHierarchy) return;
        for (const component of this._components) {
            if (component instanceof ScriptableBehaviour) component._systemAwake();
        }
    }

    // ==================== COMPONENT SYSTEM ====================

    /**
     * Adds a new component of the given type to this GameObject.
     *
     * @typeParam T — component subclass to add.
     * @param type — the component class/constructor.
     * @returns the newly created component instance — or, for a type an object
     *          holds only once, the one it already has.
     * @throws if the object holds a type that allows one per object and `type`
     *         is a subclass of it that the held component is not.
     *
     * @remarks
     * Equivalent to Unity's `GameObject.AddComponent<T>()`.
     *
     * Lifecycle order:
     * 1. Constructor runs
     * 2. `Awake()` fires — `_systemAwake()` for user scripts,
     *    `_internalInitialize()` for built-in components
     * 3. `OnEnable()` fires (if active and enabled)
     *
     * **One per object.** A type that allows one per object
     * (`RectTransform`, `Transform`; Unity's `[DisallowMultipleComponent]`)
     * is never added twice: when the object already holds one, nothing is
     * added or woken, a warning names the object and the type, and the held
     * component is returned. Unity logs an error and returns `null` there;
     * this returns the component the caller can use, so
     * `addComponent(RectTransform)` on an object whose graphic already added
     * one edits the rect the graphic draws with. A component destroyed with
     * `destroyImmediate` no longer counts; one destroyed with `destroy` counts
     * until the frame ends, as in Unity.
     */
    public addComponent<T extends Component>(type: new (go: GameObject) => T): T {
        const held = this._heldSingleCopy(type);
        if (held !== null) return held;
        const component = this._attachComponent(type);
        this._wakeComponent(component);
        return component;
    }

    /**
     * For a type that allows one per object, the copy this object already
     * holds (after warning that none is added), else `null`.
     */
    private _heldSingleCopy<T extends Component>(type: new (go: GameObject) => T): T | null {
        const held = this._singleCopyOf(type);
        if (held === null) return null;

        const family = GameObject._singleCopyFamily(type)!;
        if (!(held instanceof type)) {
            throw new Error(
                `[GameObject.addComponent] "${this.name}" already has a ${held.constructor.name}, ` +
                `and an object holds one ${family.name}; a ${type.name} cannot be added beside it.`,
            );
        }
        console.warn(
            `[GameObject.addComponent] "${this.name}" already has a ${family.name}, and an object ` +
            `holds only one; nothing was added, the existing one is returned.`,
        );
        return held;
    }

    /**
     * The single copy of `type` this object holds, or `null`. Silent: the
     * lookup shared by {@link _heldSingleCopy} (which warns and refuses) and
     * {@link hasComponent}, which only wants to know.
     */
    private _singleCopyOf<T extends Component>(type: abstract new (...args: never[]) => T): T | null {
        const family = GameObject._singleCopyFamily(type);
        if (family === null) return null;

        // The Transform is never in the component list (GameObject's ctor), so
        // it is read from the object it is part of.
        if (family === Transform) return this.transform as unknown as T;

        for (const component of this._components) {
            if (component instanceof family && component.exists()) return component as T;
        }
        return null;
    }

    /**
     * The topmost class in `type`'s chain that allows one per object
     * ({@link Component._allowMultiple} `false`), or `null` if `type` allows
     * several. Every subclass of that class shares its one slot.
     */
    private static _singleCopyFamily(type: abstract new (...args: never[]) => Component): typeof Component | null {
        let family: typeof Component | null = null;
        let ctor = type as unknown as typeof Component;
        while (ctor !== Component && ctor._allowMultiple !== undefined) {
            if (ctor._allowMultiple === false) family = ctor;
            ctor = Object.getPrototypeOf(ctor) as typeof Component;
        }
        return family;
    }

    /**
     * @internal
     * Constructs a component and lists it, without starting its lifecycle.
     * {@link _wakeComponent} does the rest; {@link addComponent} is the two
     * together.
     *
     * Exists so a load can make every component of an object findable before
     * any of them wakes.
     *
     * **NEVER use in user-facing code.**
     */
    public _attachComponent<T extends Component>(type: new (go: GameObject) => T): T {
        const component = new type(this);
        this._components.push(component);
        return component;
    }

    /**
     * @internal
     * Runs the lifecycle {@link addComponent} gives a new component: `awake`,
     * then `onEnable` if the object is active and the component enabled.
     * {@link _initializeComponent} then {@link _awakeComponent}.
     *
     * **NEVER use in user-facing code.**
     */
    public _wakeComponent(component: Component): void {
        this._initializeComponent(component);
        this._awakeComponent(component);
    }

    /**
     * @internal
     * The part of a new component's wake that belongs to its construction: a
     * built-in Behaviour's `onAwake`, where Camera, Light and the renderers
     * create their backing Three.js objects. Runs whether or not the object is
     * active — every built-in assumes those objects exist from the moment it
     * is added, and its setters write into them. User scripts have nothing
     * here; their `awake` is {@link _awakeComponent}'s.
     *
     * A load runs this, then writes the saved fields, for every component of
     * the whole tree before any {@link _awakeComponent}.
     *
     * **NEVER use in user-facing code.**
     */
    public _initializeComponent(component: Component): void {
        if (!component.exists()) return;
        if (component instanceof Behaviour && !(component instanceof ScriptableBehaviour)) {
            component._internalInitialize();
        }
    }

    /**
     * @internal
     * The user-visible part of a new component's wake: a script's `awake`,
     * then `onEnable`, each only if the object is active in the hierarchy
     * (and, for `onEnable`, the component enabled).
     *
     * **NEVER use in user-facing code.**
     */
    public _awakeComponent(component: Component): void {
        if (!component.exists()) return;

        // A user script added to an inactive object waits: Unity's rule is "if
        // a GameObject is inactive during start startup, Awake is not called until
        // it is made active", so `awake` runs shortly before the first
        // `onEnable` rather than during an assemble-hidden-then-reveal build.
        if (component instanceof ScriptableBehaviour && this.activeInHierarchy) {
            component._systemAwake();
        }

        if (component instanceof Behaviour && this.activeInHierarchy && component.enabled) {
            component._onEnabledChanged();
        }
    }

    /**
     * @internal
     * Wakes this object and everything live below it in the order a load would:
     * this object's components in list order, then each live child in child
     * order, depth first. An object that is gone or inactive in the hierarchy is
     * skipped whole — it wakes on activation, as it always has.
     *
     * Called by `Application.enterPlayMode()` for every loaded scene, so a host
     * that switches in place gets the same callback order as one that reloads.
     *
     * **NEVER use in user-facing code.**
     */
    public _wakeForPlay(): void {
        if (!this.exists() || !this.activeSelf) return;

        // The list is copied: an `awake` may add or remove a component, and a
        // destroyed one is skipped the same way a load skips it.
        for (const component of [...this._components]) {
            if (!this.exists()) return;      // this object's own `awake` destroyed it
            if (!component.exists()) continue;
            this._awakeComponent(component);
        }

        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!GameObject._isLiveChild(transform, child)) continue;
            child.gameObject._wakeForPlay();
        }
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
     *
     * Destroying a component any other way — `component.destroyImmediate()`,
     * or `component.destroy()` once the frame ends — takes it out of this list
     * just the same. This is the form that reports whether the component was
     * there, and that logs an error thrown by its `onDestroy` instead of
     * rethrowing it.
     */
    public removeComponent(component: Component): boolean {
        if (component instanceof Transform) return false;
        if (!this._components.includes(component)) return false;

        // Run lifecycle (Disable + Destroy) first so subsystems can unhook.
        try {
            component._destroyImmediate();
        } catch (err) {
            console.error("[GameObject.removeComponent] error during destroy:", err);
        }
        this._detachComponent(component);
        return true;
    }

    /**
     * @internal
     * Takes a destroyed component out of the component list. Called by
     * {@link Component._destroyImmediate} once the component's `onDisable` and
     * `onDestroy` have run; does nothing for a component that is not listed, so
     * it is safe to reach twice and for the Transform, which never is.
     *
     * @remarks
     * Replaces the array instead of splicing it. A component may destroy itself
     * or a sibling from inside an `update` or a message handler, while the loop
     * that called it is still walking this list; shifting the elements under
     * that loop would skip the next component for the frame. A loop already
     * running finishes over the list it started with — a destroyed entry in it
     * does nothing, as each of those loops tests `exists()` — and the copy
     * happens once per removal, never per frame.
     */
    public _detachComponent(component: Component): void {
        const at = this._components.indexOf(component);
        if (at === -1) return;
        const remaining = this._components.slice();
        remaining.splice(at, 1);
        this._components = remaining;
    }

    /**
     * Whether this object holds a component of the given type.
     *
     * @param type — the component class/constructor.
     *
     * @remarks
     * The read {@link getComponent} cannot answer alone: it looks only at the
     * component list, and the Transform is never in it (GameObject's
     * constructor creates it as part of the object). So
     * `hasComponent(Transform)` is `true` for every live object, and
     * `hasComponent(RectTransform)` on an object whose graphic added one is
     * `true` — the two cases an editor's Add Component menu has to know.
     *
     * It answers what {@link addComponent} would do: for a type that allows one
     * per object it is the one it already holds, so a component destroyed with
     * `destroy` counts until the frame ends (the slot is still taken), exactly
     * as adding one more would be refused. For a type that allows several it is
     * the presence in the list, which is what `getComponent` sees.
     *
     * @example
     * RectTransform.allowsMultiple;            // false
     * go.hasComponent(RectTransform);          // true after the graphic added it
     */
    public hasComponent<T extends Component>(type: new (...args: never[]) => T): boolean {
        if (GameObject._singleCopyFamily(type) !== null) return this._singleCopyOf(type) !== null;
        for (const comp of this._components) {
            if (comp instanceof type) return true;
        }
        return false;
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
     * Every component on this GameObject except its Transform, in the order they
     * were added — which is the order they update in.
     *
     * @remarks
     * Unity spells this `GetComponents<Component>()`. `Component` is abstract here,
     * so it cannot be passed to {@link getComponents}; this is the way to list them
     * all. A copy: reordering it changes nothing, use {@link setComponentIndex}.
     */
    public getAllComponents(): Component[] {
        return [...this._components];
    }

    /**
     * Where a component sits among this GameObject's components (Transform not
     * counted), or -1 if it is not one of them.
     */
    public getComponentIndex(component: Component): number {
        return this._components.indexOf(component);
    }

    /**
     * Moves a component to `index` among this GameObject's components, clamped to
     * the list. Components update in this order, so it is also the order their
     * `update` runs in.
     *
     * @returns `false` if the component does not belong to this GameObject.
     *
     * @remarks
     * Unity offers this only to editor code (`ComponentUtility.MoveComponentUp` /
     * `MoveComponentDown`) — it is what the Inspector's "Move Up" / "Move Down"
     * call. The Transform is not in the list and always stays first.
     */
    public setComponentIndex(component: Component, index: number): boolean {
        const from = this._components.indexOf(component);
        if (from === -1) return false;

        const to = Math.max(0, Math.min(index, this._components.length - 1));
        if (to !== from) {
            this._components.splice(from, 1);
            this._components.splice(to, 0, component);
        }
        return true;
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
        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (GameObject._isLiveChild(transform, child)) child.gameObject.broadcastMessage(methodName, value);
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
     * Whether a child taken from a lent child list ({@link Transform._lendChildren})
     * is still a child of `parent` and still exists.
     *
     * @remarks
     * A walk that runs user code holds the list as it was when it began, and
     * what it runs may have destroyed a later sibling or moved one to another
     * parent in the meantime. A destroyed child must not run, and a moved one
     * belongs to the walk of its new parent, which would otherwise run it a
     * second time in the same frame.
     */
    private static _isLiveChild(parent: Transform, child: Transform): boolean {
        return child.parent === parent && child.gameObject.exists();
    }

    /**
     * @internal
     * Whether this object could still be owed a run in `walk`: it existed
     * before the walk began and its components have not run in it.
     */
    public _mayMissWalk(walk: number): boolean {
        return this._ranInWalk !== walk && this._createdAfterWalk < walk;
    }

    /**
     * @internal
     * Whether `walk`, now finished with its roots, must still run this object:
     * it existed before the walk, has not run in it, still exists and is
     * active in the hierarchy. Used by `Scene` for objects moved under a
     * parent the walk had already left.
     */
    public _missedWalk(walk: number): boolean {
        return this._mayMissWalk(walk) && this.exists() && this.activeInHierarchy;
    }

    /**
     * @internal
     * Runs the Update loop on this GameObject and its children.
     * Called by {@link Scene._update} for root objects.
     *
     * @param order - the execution order this pass runs, or `null` for all.
     * @param walk - the walk this call belongs to; children are passed the
     * same number. An object whose components already ran in it — one that
     * moved under a parent the walk visits later — does not run them again,
     * though its children are still visited. Omitted, the call is a walk of
     * its own.
     */
    public _systemUpdate(order: number | null = null, walk: number = _beginUpdateWalk()): void {
        if (!this._activeSelf) return;

        if (this._ranInWalk !== walk) {
            this._ranInWalk = walk;
            for (const component of this._components) {
                if (!(component instanceof ScriptableBehaviour)) continue;
                // `null` means "every order in one pass" — the default, and the only
                // path taken until a scenario declares an @ExecutionOrder.
                if (order !== null && getExecutionOrder(component) !== order) continue;
                component._systemUpdate();
            }
        }

        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (GameObject._isLiveChild(transform, child)) child.gameObject._systemUpdate(order, walk);
        }
    }

    /**
     * @internal
     * Runs the FixedUpdate loop on this GameObject and its children; `order` and
     * `walk` as in {@link _systemUpdate}.
     */
    public _systemFixedUpdate(order: number | null = null, walk: number = _beginUpdateWalk()): void {
        if (!this._activeSelf) return;

        if (this._ranInWalk !== walk) {
            this._ranInWalk = walk;
            for (const component of this._components) {
                if (!(component instanceof ScriptableBehaviour)) continue;
                // `null` means "every order in one pass" — the default, and the only
                // path taken until a scenario declares an @ExecutionOrder.
                if (order !== null && getExecutionOrder(component) !== order) continue;
                component._systemFixedUpdate();
            }
        }

        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (GameObject._isLiveChild(transform, child)) child.gameObject._systemFixedUpdate(order, walk);
        }
    }

    /**
     * @internal
     * Runs the LateUpdate loop on this GameObject and its children; `order` and
     * `walk` as in {@link _systemUpdate}.
     */
    public _systemLateUpdate(order: number | null = null, walk: number = _beginUpdateWalk()): void {
        if (!this._activeSelf) return;

        if (this._ranInWalk !== walk) {
            this._ranInWalk = walk;
            for (const component of this._components) {
                if (!(component instanceof ScriptableBehaviour)) continue;
                // `null` means "every order in one pass" — the default, and the only
                // path taken until a scenario declares an @ExecutionOrder.
                if (order !== null && getExecutionOrder(component) !== order) continue;
                component._systemLateUpdate();
            }
        }

        const transform = this.transform;
        const children = transform._lendChildren();
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (GameObject._isLiveChild(transform, child)) child.gameObject._systemLateUpdate(order, walk);
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
     *
     * A component whose `onDisable` or `onDestroy` throws is logged and does
     * not stop the rest, as in Unity: the other components, the children and the
     * Transform are destroyed all the same. Rethrowing instead would leave the
     * object half torn down, still registered with the scene.
     *
     * The debug hard stop (`ScriptableBehaviour.isolateCallbackErrors = false`)
     * keeps that order and rethrows the first such error — from a component or
     * from a child's destruction — once everything is destroyed. Later ones
     * are logged.
     */
    protected override onDestroy(): void {
        // 1. Destroy all components. Each takes itself out of the list as it
        // goes, so walk a copy — and walk again for any a sibling added from its
        // onDisable or onDestroy, so that none outlives its object.
        const hardStop = EngineObject._hardStopProbe();
        let first: { err: unknown } | undefined;
        const asked = new Set<Component>();
        for (let next = [...this._components]; next.length > 0; next = this._components.filter(c => !asked.has(c))) {
            for (const component of next) {
                asked.add(component);
                try {
                    component.destroyImmediate();
                } catch (err) {
                    if (hardStop && !first) first = { err };
                    else console.error(
                        `[GameObject] error while destroying ${component.constructor.name} on "${this.name}":`,
                        err,
                    );
                }
            }
        }
        this._components = [];

        // 2. Destroy children recursively
        // Copy array because destroyImmediate modifies it via Transform._children
        const children = [...this.transform._internalChildren];
        for (const child of children) {
            try {
                child.gameObject.destroyImmediate();
            } catch (err) {
                // Only the hard stop lets a child's error out; the rest of the
                // children and this object still have to be destroyed.
                if (hardStop && !first) first = { err };
                else console.error(`[GameObject] error while destroying child "${child.gameObject.name}" of "${this.name}":`, err);
            }
        }

        // 3. Unregister from scene
        this._scene._unregisterGameObject(this);

        // 4. Destroy Transform (clears Three.js objects)
        this.transform.destroyImmediate();

        if (first) throw first.err;
    }

    // ==================== CLONING ====================

    /**
     * @internal
     * Not implemented — see the error text.
     *
     * @remarks
     * `EngineObject.Instantiate` reaches this. The inherited implementation
     * built `new GameObject(name + " (Clone)")` and returned it: an object with
     * no components, no children and none of the transform, added to the scene
     * and invisible. Every caller of the most-used API in Unity got that
     * silently, so refusing is the honest answer until cloning is real.
     *
     * It works by round-tripping the hierarchy through the serializer, which is
     * what `Prefab.fromGameObject(go).instantiate()` does — name, active state,
     * transform, children, and every component carrying `@Serializable`.
     *
     * **What it does not copy, it names.** A component with no `@Serializable`
     * is skipped by the serializer, silently. That silence was the reason this
     * method used to refuse outright: a copy missing an `Animator` is worse than
     * no copy at all if nobody says so. It now says so — one warning listing the
     * types that were dropped — because a loss you are told about is not the
     * same defect as a loss you are not. The list shrinks to nothing as Stage 1
     * of `design/unity-parity-plan.md` decorates the rest.
     */
    protected override _clone(): EngineObject {
        const missing = GameObject._unserializableTypes(this);
        if (missing.length > 0) {
            const one = missing.length === 1;
            console.warn(
                `EngineObject.Instantiate("${this.name}"): copied without ` +
                `${missing.join(", ")} — ${one ? "that component carries" : "those components carry"} ` +
                `no @Serializable, so the serializer cannot reproduce ` +
                `${one ? "it" : "them"}. See design/unity-parity-plan.md.`,
            );
        }

        // Straight through the serializer rather than through a prefab: a copy
        // of a prefab instance is another instance of the same prefab, and a
        // prefab made on the way would make it an instance of *that* instead.
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(this), this.scene);
    }

    /**
     * The type names of components in this subtree the serializer cannot copy.
     *
     * @remarks
     * Reported rather than counted: "3 components were dropped" tells a caller
     * nothing they can act on, and `Animator, ParticleSystem` tells them exactly
     * what their copy is missing.
     */
    private static _unserializableTypes(root: GameObject): string[] {
        const found: string[] = [];

        const walk = (go: GameObject): void => {
            for (const comp of go._components) {
                if (comp instanceof Transform) continue;
                if (TypeRegistry.getTypeName(comp)) continue;
                const name = comp.constructor.name;
                if (!found.includes(name)) found.push(name);
            }
            for (let i = 0; i < go.transform.childCount; i++) {
                walk(go.transform.getChild(i).gameObject);
            }
        };

        walk(root);
        return found;
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

// Deserializing a scene has to build GameObjects, and the serializer must not
// import this module to do it — that import is what made the dependency circular.
// Installed from here because this module is the one that reaches the serializer,
// so it is always evaluated first; see `SceneSerializer._createGameObject`.
SceneSerializer._createGameObject = (name: string) => new GameObject(name);