// path: src/engine/core/EngineObject.ts

/**
 * EngineObject.ts
 * Base class for all engine objects (GameObject, Component, Assets).
 * Provides unique identification, lifecycle management, and object registry.
 *
 * @remarks
 * This is the equivalent of Unity's UnityEngine.Object class.
 * All engine objects that need to be referenced, found, or destroyed should inherit from this.
 */

// ==================== HIDE FLAGS ENUM ====================

/**
 * Bit mask that controls object visibility and persistence.
 * Similar to Unity's HideFlags.
 */
export enum HideFlags {
    /** Normal object, visible and saved. */
    None = 0,
    /** Not shown in hierarchy. */
    HideInHierarchy = 1 << 0,
    /** Not shown in inspector. */
    HideInInspector = 1 << 1,
    /** Not saved to scenes. */
    DontSaveInEditor = 1 << 2,
    /** Not editable in inspector. */
    NotEditable = 1 << 3,
    /** Not saved when building. */
    DontSaveInBuild = 1 << 4,
    /** Not unloaded by Resources.UnloadUnusedAssets. */
    DontUnloadUnusedAsset = 1 << 5,
    /** Combination: DontSaveInEditor | DontSaveInBuild */
    DontSave = (1 << 2) | (1 << 4),
    /** Combination: All hide flags */
    HideAndDontSave = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5)
}

/**
 * Constructor type for use with FindObjectOfType.
 */
export interface EngineObjectConstructor<T extends EngineObject = EngineObject> {
    new (...args: never[]): T;
    prototype: T;
}

export class EngineObject {
    // ==================== STATIC REGISTRY ====================

    /** Global instance ID counter */
    private static _nextInstanceID: number = 1;

    /**
     * Global registry of all living EngineObjects.
     * Uses Map for O(1) lookup by instanceID.
     */
    private static readonly _registry: Map<number, WeakRef<EngineObject>> = new Map();

    /** Objects marked as DontDestroyOnLoad */
    private static readonly _persistentObjects: Set<number> = new Set();

    /**
     * Objects awaiting a timed {@link Destroy}, with the game-time seconds each
     * has left. Driven from `Application._loop`, so the countdown obeys
     * `Time.timeScale` and stops with the loop.
     */
    private static readonly _pendingDestroys: { obj: EngineObject; remaining: number }[] = [];

    /**
     * Reused buffer of the entries due this frame. Collected before anything is
     * destroyed, because `onDestroy` runs user code that may schedule or cancel
     * further destructions — the same snapshot-before-dispatch the UI drivers use.
     */
    private static readonly _dueDestroys: { obj: EngineObject; remaining: number }[] = [];

    /** Cleanup interval for garbage collected objects */
    private static _cleanupScheduled: boolean = false;

    // ==================== INSTANCE FIELDS ====================

    /** Unique numeric instance ID (Unity-compatible) */
    private readonly _instanceID: number;

    /** Unique string identifier (for serialization/networking) */
    private readonly _uuid: string;

    /** Object name */
    private _name: string;

    /** Hide flags controlling visibility and persistence */
    private _hideFlags: HideFlags = HideFlags.None;

    /** Internal destruction flag */
    private _isDestroyed: boolean = false;

// ==================== CONSTRUCTOR ====================

    /**
     * Creates a new EngineObject.
     * @param name Optional name (defaults to class name)
     */
    constructor(name?: string) {
        // Assign unique IDs
        this._instanceID = EngineObject._nextInstanceID++;
        this._uuid = EngineObject._generateUUID();

        // Set name
        this._name = name ?? this.constructor.name;

        // Register in global registry
        EngineObject._registry.set(this._instanceID, new WeakRef(this));
        EngineObject._scheduleCleanup();
    }

    /**
     * Generates an RFC 4122 v4 UUID. Uses `crypto.randomUUID` when available,
     * otherwise builds the UUID from `crypto.getRandomValues`.
     *
     * `crypto.randomUUID` is restricted to secure contexts (HTTPS or
     * `localhost`); when the engine is served over plain HTTP from a LAN IP
     * the call throws `TypeError: crypto.randomUUID is not a function`.
     * `getRandomValues` has no such restriction, so it serves as the fallback.
     */
    private static _generateUUID(): string {
        if (typeof crypto !== "undefined" && typeof (crypto as Crypto).randomUUID === "function") {
            return crypto.randomUUID();
        }
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
        const h: string[] = new Array(16);
        for (let i = 0; i < 16; i++) h[i] = bytes[i].toString(16).padStart(2, "0");
        return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
    }

// ==================== PUBLIC PROPERTIES ====================

    /**
     * The name of the object.
     */
    get name(): string {
        return this._name;
    }

    set name(value: string) {
        this._name = value;
    }

    /**
     * Controls object visibility and persistence behavior.
     */
    get hideFlags(): HideFlags {
        return this._hideFlags;
    }

    set hideFlags(value: HideFlags) {
        this._hideFlags = value;
    }

    // ==================== PUBLIC INSTANCE METHODS ====================

    /**
     * Returns the instance ID of the object.
     * This ID is unique during the lifetime of the application.
     *
     * @remarks
     * In Unity this returns an int. We maintain compatibility.
     */
    public getInstanceID(): number {
        return this._instanceID;
    }

    /**
     * Returns the UUID of the object.
     * Useful for serialization and networking scenarios.
     *
     * @remarks
     * This is an extension beyond Unity's API for web/distributed use cases.
     */
    public getUUID(): string {
        return this._uuid;
    }

    /**
     * The UUID of the object (property accessor).
     *
     * @remarks
     * Convenience property equivalent to {@link getUUID}.
     * Useful where property access is more natural (e.g., Map keys in Scene registry).
     */
    public get uuid(): string {
        return this._uuid;
    }

    /**
     * Checks if this object exists (has not been destroyed).
     *
     * @remarks
     * In Unity, this is achieved via implicit bool operator.
     * TypeScript cannot override operators, so we use a method.
     *
     * @example
     * if (myObject.exists()) {
     *     // Safe to use
     * }
     */
    public exists(): boolean {
        return !this._isDestroyed;
    }

    /**
     * Convenience method to destroy this object.
     *
     * @param delay Optional delay in seconds before destruction
     *
     * @remarks
     * This is a convenience extension. Unity only has static Destroy().
     * Equivalent to: EngineObject.Destroy(this, delay)
     */
    public destroy(delay: number = 0): void {
        EngineObject.Destroy(this, delay);
    }

    /**
     * Convenience method to immediately destroy this object.
     *
     * @remarks
     * Use with caution — in most cases prefer {@link destroy} which defers to end-of-frame.
     * Equivalent to: `EngineObject.DestroyImmediate(this)`
     *
     * @see {@link EngineObject.DestroyImmediate}
     */
    public destroyImmediate(): void {
        EngineObject.DestroyImmediate(this);
    }

    /**
     * Returns a string representation of the object.
     */
    public toString(): string {
        if (this._isDestroyed) {
            return `${this.constructor.name} (destroyed)`;
        }
        return `${this.constructor.name} (${this._name})`;
    }

    // ==================== PROTECTED METHODS ====================

    /**
     * Called when the object is being destroyed.
     * Override this to clean up resources.
     *
     * @remarks
     * Similar to Unity's OnDestroy callback.
     * Always call super.onDestroy() if you override this.
     */
    protected onDestroy(): void {
        // Override in subclasses for cleanup
    }

    // ==================== INTERNAL METHODS ====================

    /**
     * @internal
     * Immediately destroys the object without delay.
     * Called by the static Destroy methods.
     */
    public _destroyImmediate(): void {
        if (this._isDestroyed) return;

        // Call cleanup hook
        this.onDestroy();

        // Mark as destroyed
        this._isDestroyed = true;

        // Remove from registry
        EngineObject._registry.delete(this._instanceID);
        EngineObject._persistentObjects.delete(this._instanceID);
    }

    /**
     * @internal
     * Returns whether this object is marked as DontDestroyOnLoad.
     */
    public _isPersistent(): boolean {
        return EngineObject._persistentObjects.has(this._instanceID);
    }

    // ==================== STATIC METHODS ====================

    /**
     * Removes a GameObject, component, or asset.
     *
     * @param obj The object to destroy
     * @param delay Optional delay in seconds of **game time** (default: 0)
     *
     * @remarks
     * With no delay the object is destroyed after the current Update loop.
     *
     * A delay counts **game time**, as Unity's does: it is decremented by
     * `Time.deltaTime` once a frame, so `Time.timeScale = 0` postpones the
     * destruction instead of letting it happen behind a pause menu, half speed
     * takes twice as long, and nothing fires at all while the loop is stopped.
     * It was a `setTimeout` and did none of that.
     *
     * The delay is therefore resolved at frame granularity — an object asked to
     * die in 0.001s dies on the next frame, not 1 ms later.
     *
     * @example
     * EngineObject.Destroy(gameObject);
     * EngineObject.Destroy(component, 2.0); // Destroy after 2 seconds
     */

    public static Destroy(obj: EngineObject | null | undefined, delay: number = 0): void {
        if (!obj || !obj.exists()) return;

        if (Number.isFinite(delay) && delay > 0) {
            EngineObject._pendingDestroys.push({ obj, remaining: delay });
        } else {
            // Queue for end of frame (simulated with microtask)
            queueMicrotask(() => {
                if (obj.exists()) {
                    obj._destroyImmediate();
                }
            });
        }
    }

    /**
     * @internal
     * Advances every pending timed {@link Destroy} by one frame of game time and
     * destroys whatever has run out. Called once per frame by `Application`,
     * after LateUpdate and before the drivers that read final state, so an
     * object never gets laid out or audio-synced on the frame it dies.
     *
     * @param deltaTime - scaled game seconds since the previous frame
     *                    (`Time.deltaTime`, so a paused game does not count down).
     */
    public static _updatePendingDestroys(deltaTime: number): void {
        const pending = EngineObject._pendingDestroys;
        if (pending.length === 0) return;

        const due = EngineObject._dueDestroys;
        due.length = 0;

        // Backwards, so removing an entry cannot skip the one after it.
        for (let i = pending.length - 1; i >= 0; i--) {
            const entry = pending[i];
            if (!entry.obj.exists()) {
                pending.splice(i, 1);
                continue;
            }
            entry.remaining -= deltaTime;
            if (entry.remaining <= 0) {
                due.push(entry);
                pending.splice(i, 1);
            }
        }

        for (let i = 0; i < due.length; i++) {
            const obj = due[i].obj;
            if (obj.exists()) obj._destroyImmediate();
        }
        due.length = 0;
    }

    /**
     * @internal
     * Drops every pending timed destroy. Called by `Application.dispose()` so a
     * countdown started in one Application cannot fire into the next one.
     */
    public static _clearPendingDestroys(): void {
        EngineObject._pendingDestroys.length = 0;
        EngineObject._dueDestroys.length = 0;
    }

    /**
     * Destroys the object immediately.
     * Use with caution - prefer Destroy() in most cases.
     *
     * @param obj The object to destroy
     *
     * @remarks
     * In Unity, this is mainly used in Editor scripts.
     * In runtime, you should almost always use Destroy() instead.
     */
    public static DestroyImmediate(obj: EngineObject | null | undefined): void {
        if (!obj || !obj.exists()) return;
        obj._destroyImmediate();
    }

    /**
     * Makes the object not be destroyed when loading a new Scene.
     *
     * @param obj The object to mark as persistent
     *
     * @remarks
     * Typically used for manager objects that should persist across scenes.
     *
     * @example
     * EngineObject.DontDestroyOnLoad(audioManager);
     */
    public static DontDestroyOnLoad(obj: EngineObject | null | undefined): void {
        if (!obj || !obj.exists()) return;

        // Only roots survive a load: SceneManager collects survivors by walking
        // each scene's root GameObjects. Recording the mark for a child would
        // make _isPersistent() report a survival that never happens, so refuse
        // it and say why — Unity refuses the same case, and also warns.
        const owner = EngineObject._rootCandidate(obj);
        if (owner !== null && owner.transform.parent !== null) {
            console.warn(
                `[EngineObject] DontDestroyOnLoad only works on root GameObjects. ` +
                `"${obj.name}" is a child of "${owner.transform.parent.gameObject.name}" ` +
                `and will still be destroyed on load. Detach it first, or mark its root.`
            );
            return;
        }

        EngineObject._persistentObjects.add(obj._instanceID);
    }

    /**
     * The GameObject whose root-ness decides persistence, or null when the
     * object is not part of a scene hierarchy at all (an asset, say).
     *
     * Duck-typed rather than imported: `GameObject` and `Component` both import
     * `EngineObject`, so naming either here would close a cycle. The shape is
     * stable — a GameObject has a `transform`, a Component has a `gameObject`.
     */
    private static _rootCandidate(
        obj: EngineObject,
    ): { name: string; transform: { parent: { gameObject: { name: string } } | null } } | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
        const any = obj as any;
        if (any.transform?.parent !== undefined) return any;
        if (any.gameObject?.transform?.parent !== undefined) return any.gameObject;
        return null;
    }

    /**
     * Returns the first active loaded object of the specified type.
     *
     * @param type The class/constructor to search for
     * @returns The first found object, or null if none exists
     *
     * @remarks
     * This searches all registered EngineObjects.
     * For better performance with many objects, consider caching references.
     *
     * @example
     * const camera = EngineObject.FindObjectOfType(Camera);
     */
    public static FindObjectOfType<T extends EngineObject>(
        type: EngineObjectConstructor<T>
    ): T | null {
        for (const [, weakRef] of EngineObject._registry) {
            const obj = weakRef.deref();
            if (obj && obj.exists() && obj instanceof type) {
                return obj as T;
            }
        }
        return null;
    }

    /**
     * Returns every registered object of the given type that has not been
     * destroyed.
     *
     * @param type The class/constructor to search for
     * @returns Array of found objects (empty if none)
     *
     * @remarks
     * **Includes objects on inactive GameObjects**, unlike Unity's
     * `Object.FindObjectsOfType`, which excludes them. Only destruction is
     * filtered here, not activity — an earlier version of this comment said
     * "active" and meant "not destroyed", which promised a filter that does
     * not exist. Check `activeInHierarchy` yourself if you need Unity's set.
     *
     * Searches every registered EngineObject, assets included, so it is also
     * how the diagnostics subsystem enumerates textures and meshes. Can be slow
     * with many objects — use sparingly.
     *
     * @example
     * const allLights = EngineObject.FindObjectsOfType(Light);
     */
    public static FindObjectsOfType<T extends EngineObject>(
        type: EngineObjectConstructor<T>
    ): T[] {
        const results: T[] = [];

        for (const [, weakRef] of EngineObject._registry) {
            const obj = weakRef.deref();
            if (obj && obj.exists() && obj instanceof type) {
                results.push(obj as T);
            }
        }

        return results;
    }

    /**
     * Creates a clone of the object.
     *
     * @param original The object to clone
     * @returns A new instance that is a copy of the original
     *
     * @remarks
     * Basic implementation - subclasses should override _clone() for proper deep cloning.
     * For GameObjects, this will clone all components and children.
     *
     * @example
     * const clone = EngineObject.Instantiate(prefab);
     */
    public static Instantiate<T extends EngineObject>(original: T): T {
        if (!original || !original.exists()) {
            throw new Error('EngineObject.Instantiate: original is null or destroyed');
        }

        return original._clone() as T;
    }

    /**
     * Creates a clone of the object with a new name.
     *
     * @param original The object to clone
     * @param name Name for the cloned object
     */
    public static InstantiateWithName<T extends EngineObject>(original: T, name: string): T {
        const clone = EngineObject.Instantiate(original);
        clone.name = name;
        return clone;
    }

    // ==================== PROTECTED CLONE METHOD ====================

    /**
     * Creates a clone of this object.
     * Override in subclasses for proper deep cloning behavior.
     *
     * @remarks
     * Base implementation creates a new instance with the same name.
     * Subclasses (GameObject, Component) should override for full cloning.
     */
    protected _clone(): EngineObject {
        const clone = new (this.constructor as new (name?: string) => EngineObject)(
            this._name + ' (Clone)'
        );
        clone._hideFlags = this._hideFlags;
        return clone;
    }

    // ==================== PRIVATE STATIC METHODS ====================

    /**
     * Schedules cleanup of garbage-collected objects from the registry.
     */
    private static _scheduleCleanup(): void {
        if (EngineObject._cleanupScheduled) return;
        EngineObject._cleanupScheduled = true;

        // Run cleanup periodically
        setTimeout(() => {
            EngineObject._cleanupRegistry();
            EngineObject._cleanupScheduled = false;
        }, 10000); // Every 10 seconds
    }

    /**
     * Removes garbage-collected objects from the registry.
     */
    private static _cleanupRegistry(): void {
        const toRemove: number[] = [];

        for (const [id, weakRef] of EngineObject._registry) {
            if (!weakRef.deref()) {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            EngineObject._registry.delete(id);
            EngineObject._persistentObjects.delete(id);
        }
    }

    // ==================== STATIC UTILITY METHODS ====================

    /**
     * Returns the total number of registered EngineObjects.
     * Useful for debugging and profiling.
     */
    public static getObjectCount(): number {
        return EngineObject._registry.size;
    }

    /**
     * Returns an object by its instance ID.
     *
     * @param instanceID The instance ID to look up
     * @returns The object, or null if not found or destroyed
     */
    public static getObjectByInstanceID(instanceID: number): EngineObject | null {
        const weakRef = EngineObject._registry.get(instanceID);
        if (!weakRef) return null;

        const obj = weakRef.deref();
        if (!obj || !obj.exists()) return null;

        return obj;
    }
}