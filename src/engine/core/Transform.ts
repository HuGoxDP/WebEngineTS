// path: src/engine/core/Transform.ts

import * as THREE from "three";
import { Component } from "./Component.ts";
import { Vector3 } from "./math/Vector3.ts";
import { Quaternion } from "./math/Quaternion.ts";
import type { GameObject } from "./GameObject.ts";
import { SceneManager } from "./SceneManager.ts";
import { Bounds } from "./math/Bounds.ts";
import { Matrix4x4 } from "./math/Matrix4x4.ts";

// ==================== MODULE-LEVEL CACHE ====================
// Cached Three.js temporaries for zero-allocation internal math.
// These are NEVER exposed — used only inside this module.

const _tvec3A = new THREE.Vector3();
const _tquatA = new THREE.Quaternion();
const _tquatB = new THREE.Quaternion();
const _tBox3 = new THREE.Box3();
const _tVec3B = new THREE.Vector3();
const _tMat4 = new THREE.Matrix4();
const _tMat4B = new THREE.Matrix4();
/** Reserved for the coordinate conversions below, which must not clobber the others. */
const _tMat4C = new THREE.Matrix4();
const _tVec3C = new THREE.Vector3();
// Decomposition targets for the engine-space world matrix.
const _dPos = new THREE.Vector3();
const _dRot = new THREE.Quaternion();
const _dScale = new THREE.Vector3();
// Cached engine-math temporary for direction vector calculations
const _equatA = new Quaternion();

// ==================== DIRTY-FLAG TRANSFORM OPTIMIZATION ====================
// When enabled, setters mark transforms as dirty instead of immediately
// syncing to Three.js. All dirty transforms are flushed once before render.

/** Global toggle for dirty-flag transform optimization. */
let _dirtyTransformsEnabled = false;

/** Set of transforms that need syncing before render. */
const _dirtySet: Set<Transform> = new Set();

/**
 * The coordinate space a {@link Transform} operation is relative to.
 *
 * @remarks Equivalent to Unity's `Space`.
 */
export enum Space {
    /** Relative to the world axes. */
    World = 0,
    /** Relative to the Transform's own local axes. */
    Self = 1,
}

/**
 * Defines the position, rotation, and scale of a {@link GameObject}.
 *
 * Every GameObject has exactly one Transform, created automatically.
 * Transform forms a hierarchy — children inherit the parent's world transform.
 *
 * Hierarchy: {@link EngineObject} → {@link Component} → Transform
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Transform`.
 *
 * **Engine-first design:** All public properties use engine math types
 * ({@link Vector3}, {@link Quaternion}). Three.js is used internally for
 * world matrix calculations but is never exposed.
 *
 * **Value semantics for getters:** Getters like {@link localPosition},
 * {@link position}, etc. return **clones** — modifying the returned object
 * does NOT affect the Transform. Always use the setter to apply changes:
 * ```ts
 * // CORRECT:
 * const pos = transform.localPosition;
 * pos.x += 5;
 * transform.localPosition = pos;
 *
 * // WRONG (no effect):
 * transform.localPosition.x += 5;
 * ```
 */
export class Transform extends Component {

    // ==================== PRIVATE FIELDS ====================

    /**
     * The internal Three.js Object3D that mirrors this Transform.
     * Used for world matrix calculations and rendering.
     *
     * @internal — NEVER expose to engine users.
     */
    private readonly _object3D: THREE.Object3D;

    /**
     * Local position relative to parent.
     * Owned instance — NOT a shared static reference.
     */
    private readonly _localPosition: Vector3 = new Vector3(0, 0, 0);

    /**
     * Local rotation relative to parent.
     * Owned instance — NOT a shared static reference.
     */
    private readonly _localRotation: Quaternion = new Quaternion(0, 0, 0, 1);

    /**
     * Local scale relative to parent.
     * Owned instance — NOT a shared static reference.
     */
    private readonly _localScale: Vector3 = new Vector3(1, 1, 1);

    /** Parent Transform, or null if root-level. */
    private _parent: Transform | null = null;

    /**
     * Direct children of this Transform.
     *
     * Copy-on-write while lent: a walk that runs user code holds the array it
     * was given ({@link _lendChildren}), so a change made meanwhile goes to a
     * copy and the walk keeps seeing the list it started with. Every write
     * reaches the list through {@link _writableChildren}.
     */
    private _children: Transform[] = [];

    /** Whether {@link _children} has been handed to a walk that may still be running. */
    private _childrenLent: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);

        this._object3D = new THREE.Group();
        this._object3D.matrixAutoUpdate = true;

        // Back-reference for raycasting: Three.js object → engine GameObject
        this._object3D.userData = { gameObject };
    }

    // ==================== DIRTY-FLAG SYSTEM ====================

    /** Whether this transform has pending changes not yet synced to Three.js. */
    private _dirty = false;

    /**
     * @internal
     * Enable or disable dirty-flag transform batching.
     * When enabled, setters mark transforms dirty instead of syncing immediately.
     * When disabled, clears the dirty set and reverts to immediate sync behavior.
     */
    public static _setDirtyTransformsEnabled(enabled: boolean): void {
        _dirtyTransformsEnabled = enabled;
        if (!enabled) _dirtySet.clear();
    }

    /**
     * Whether dirty-flag transform batching is currently on.
     *
     * Read-only: the switch itself is engine-internal
     * ({@link _setDirtyTransformsEnabled}), but what it holds is worth reading
     * back. A host that toggles it per run — a benchmark configuration, a
     * profiling session — can then record the engine's own state rather than
     * the value it passed in, so a toggle that failed to take shows up instead
     * of being taken on trust.
     */
    public static get dirtyTransformsEnabled(): boolean {
        return _dirtyTransformsEnabled;
    }

    /**
     * @internal
     * Flushes all dirty transforms to Three.js. Called once before render.
     */
    public static _syncAllDirty(): void {
        for (const t of _dirtySet) {
            t._syncToThree();
        }
        _dirtySet.clear();
    }

    /**
     * Copies all local TRS to the Three.js Object3D at once.
     * @internal
     */
    private _syncToThree(): void {
        this._localPosition._copyToThree(this._object3D.position);
        this._localRotation._copyToThree(this._object3D.quaternion);
        this._localScale._copyToThree(this._object3D.scale);
        this._dirty = false;
    }

    /**
     * @internal
     * Ensures the backing object's world matrix reflects the current local TRS
     * and ancestor chain. Local edits only mark the transform dirty and the world
     * matrix is recomputed at render, so coordinate conversions call this to stay
     * correct between frames and before the first render (e.g. in tests).
     */
    /**
     * @internal
     * Brings `_internalObject3D.matrixWorld` up to date, flushing any pending
     * local change first.
     *
     * Public to the engine because a component that reads `matrixWorld` directly —
     * `LineRenderer`, comparing it to decide whether its ribbon still faces the
     * camera — would otherwise have to read a world property just for the side
     * effect, and every one of those allocates.
     */
    public _ensureWorldMatrix(): void {
        if (this._dirty) this._syncToThree();
        this._object3D.updateWorldMatrix(true, false);
    }

    /**
     * @internal
     * The object's world matrix **in engine space**, undoing the scene's
     * handedness mirror (`Scene._contentRoot`, scale `(1, 1, −1)`).
     *
     * Three's `matrixWorld` is `S · M` where `S = diag(1, 1, −1)`; left-multiplying
     * by `S` again recovers `M`, because `S` is its own inverse. That product is a
     * *proper* matrix, which matters: decomposing a reflected matrix makes Three
     * park the negative sign on X arbitrarily, so `lossyScale` and world rotation
     * would both come out wrong if read from `matrixWorld` directly.
     *
     * In column-major storage the left-multiply is just negating the third row —
     * elements 2, 6, 10 and 14.
     */
    public _engineWorldMatrix(out: THREE.Matrix4): THREE.Matrix4 {
        this._ensureWorldMatrix();
        const e = out.copy(this._object3D.matrixWorld).elements;
        e[2] = -e[2]; e[6] = -e[6]; e[10] = -e[10]; e[14] = -e[14];
        return out;
    }

    /** Marks this transform as needing sync before next render. */
    private _markDirty(): void {
        if (!this._dirty) {
            this._dirty = true;
            _dirtySet.add(this);
        }
    }

    // ==================== INTERNAL THREE.JS ACCESSORS ====================

    /**
     * @internal
     * The underlying Three.js Object3D.
     *
     * Used by internal engine systems only:
     * - {@link Scene} — for scene hierarchy management
     * - {@link GameObject} — for visibility sync
     * - Renderer components — for attaching render objects
     *
     * **NEVER use in user-facing code.**
     */
    public get _internalObject3D(): THREE.Object3D {
        return this._object3D;
    }

    /**
     * @internal
     * Adds a Three.js object as a child of this Transform's internal Object3D.
     *
     * Used by renderer components (Camera, Light, MeshRenderer, etc.)
     * to attach their Three.js render objects to the transform hierarchy.
     *
     * @param obj — the Three.js object to add.
     */
    public _addInternalChild(obj: THREE.Object3D): void {
        this._object3D.add(obj);
    }

    /**
     * @internal
     * Removes a Three.js object from this Transform's internal Object3D.
     *
     * @param obj — the Three.js object to remove.
     */
    public _removeInternalChild(obj: THREE.Object3D): void {
        this._object3D.remove(obj);
    }

    /**
     * @internal
     * Computes the world-space AABB of this Transform and ALL descendants.
     * Uses Three.js `Box3.setFromObject()` which recursively traverses
     * the scene graph, transforms each geometry's bounding box through
     * its `matrixWorld`, and produces a combined world-space AABB.
     * This correctly handles arbitrarily nested transforms, internal
     * scales from GLTF models, rotations, and offset pivots.
     * @returns world-space Bounds enclosing the entire hierarchy.
     */
    public _computeHierarchyBounds(): Bounds {
        // `updateWorldMatrix(true, ...)` walks *up* first. `updateMatrixWorld`
        // does not — it reads `parent.matrixWorld` as it finds it, so an ancestor
        // that moved this frame would place these bounds at the old pose, or at
        // the origin before the first render.
        this._object3D.updateWorldMatrix(true, true);
        _tBox3.setFromObject(this._object3D);

        if (_tBox3.isEmpty()) {
            return new Bounds();
        }

        _tBox3.getCenter(_tVec3B);
        // Three world space is the mirror of engine world space (Scene._contentRoot),
        // so the centre crosses back. Size is unsigned and needs no flip.
        const center = new Vector3(_tVec3B.x, _tVec3B.y, -_tVec3B.z);

        _tBox3.getSize(_tVec3B);
        const size = new Vector3(_tVec3B.x, _tVec3B.y, _tVec3B.z);

        return new Bounds(center, size);
    }

    // ==================== I. HIERARCHY ====================

    /**
     * The parent Transform, or `null` if this is a root-level Transform.
     *
     * Setting the parent moves this Transform into the new parent's child list
     * and updates the Three.js hierarchy accordingly. **The world position,
     * rotation and scale are preserved** — the local values are recomputed
     * against the new parent so the object does not appear to move.
     *
     * @remarks
     * Equivalent to Unity's `Transform.parent`, which preserves world position
     * for the same reason. Use {@link setParent} with `worldPositionStays:
     * false` to keep the local values instead and let the object move with its
     * new parent.
     */
    public get parent(): Transform | null {
        return this._parent;
    }

    public set parent(newParent: Transform | null) {
        this.setParent(newParent, true);
    }

    /**
     * Sets the parent Transform with control over world position preservation.
     *
     * @param newParent — the new parent, or `null` to make root-level.
     * @param worldPositionStays — if `true`, the world position/rotation/scale
     *        are preserved by adjusting local values. Default: `true`.
     *
     * @remarks
     * Equivalent to Unity's `Transform.SetParent(parent, worldPositionStays)`.
     */
    public setParent(
        newParent: Transform | null,
        worldPositionStays: boolean = true
    ): void {
        if (this._parent === newParent) return;
        if (this._dirty) this._syncToThree();

        // Capture world state before reparenting (if preserving)
        let worldPos: Vector3 | null = null;
        let worldRot: Quaternion | null = null;
        let worldScl: Vector3 | null = null;

        if (worldPositionStays) {
            worldPos = this.position;
            worldRot = this.rotation;
            worldScl = this.lossyScale;
        }

        // --- Detach from old parent ---
        const wasRoot = (this._parent === null);

        if (this._parent) {
            const index = this._parent._children.indexOf(this);
            if (index !== -1) {
                this._parent._writableChildren().splice(index, 1);
            }
        }

        // --- Attach to new parent ---
        this._parent = newParent;
        const willBeRoot = (newParent === null);

        if (newParent) {
            newParent._writableChildren().push(this);
            newParent._object3D.add(this._object3D);
        } else {
            this._object3D.removeFromParent();
        }

        // --- Notify scene about root status change ---
        if (wasRoot && !willBeRoot) {
            SceneManager.activeScene._onGameObjectParentChanged(this.gameObject, false);
        } else if (!wasRoot && willBeRoot) {
            SceneManager.activeScene._onGameObjectParentChanged(this.gameObject, true);
        }

        // --- Restore world transform if requested ---
        if (worldPositionStays && worldPos && worldRot && worldScl) {
            this.position = worldPos;
            this.rotation = worldRot;
            // Note: setting world scale precisely is complex due to
            // non-uniform parent scaling. We approximate by dividing.
            if (newParent) {
                const parentScale = newParent.lossyScale;
                this._localScale.set(
                    parentScale.x !== 0 ? worldScl.x / parentScale.x : worldScl.x,
                    parentScale.y !== 0 ? worldScl.y / parentScale.y : worldScl.y,
                    parentScale.z !== 0 ? worldScl.z / parentScale.z : worldScl.z
                );
                this._localScale._copyToThree(this._object3D.scale);
            } else {
                this._localScale.copy(worldScl);
                this._localScale._copyToThree(this._object3D.scale);
            }
        }

        // Ensure matrices are up to date, ancestors included — reparenting is
        // exactly when the chain above this object has just changed.
        this._object3D.updateWorldMatrix(true, true);

        Transform._hierarchyEpoch++;
    }

    /** Bumped by every re-parent. See {@link _hierarchyVersion}. */
    private static _hierarchyEpoch: number = 0;

    /**
     * @internal
     * A counter that changes whenever anything is re-parented.
     *
     * @remarks
     * Anything caching a walk *up* the hierarchy — which masks clip an element,
     * which groups fade it, which Canvas it belongs to — is only valid while the
     * hierarchy is. A node moving several levels up changes the ancestry of
     * everything beneath it while touching none of their own parent links, so
     * nothing local to those elements can notice.
     *
     * A counter rather than a notification, so that any number of subsystems can
     * compare against it without core knowing they exist.
     *
     * **NEVER use in user-facing code.**
     */
    public static get _hierarchyVersion(): number {
        return Transform._hierarchyEpoch;
    }

    /**
     * The number of direct children.
     *
     * @remarks
     * Equivalent to Unity's `Transform.childCount`.
     */
    public get childCount(): number {
        return this._children.length;
    }

    /**
     * Returns the child Transform at the specified index.
     *
     * @param index — zero-based index.
     * @throws {RangeError} if the index is out of bounds.
     *
     * @remarks
     * Equivalent to Unity's `Transform.GetChild(index)`.
     */
    public getChild(index: number): Transform {
        if (index < 0 || index >= this._children.length) {
            throw new RangeError(
                `Transform.getChild: index ${index} out of range [0, ${this._children.length})`
            );
        }
        return this._children[index];
    }

    /**
     * Where this Transform sits among its siblings — among the scene's root
     * objects if it has no parent.
     *
     * @remarks
     * Equivalent to Unity's `Transform.GetSiblingIndex()`. This is the order
     * `getChild` walks, the order the hierarchy lists children in, the order
     * layout groups arrange them in, and the order a scene is saved in.
     */
    public getSiblingIndex(): number {
        if (this._parent) return this._parent._children.indexOf(this);
        return this.gameObject.scene._rootIndexOf(this.gameObject);
    }

    /**
     * Moves this Transform to `index` among its siblings.
     *
     * @param index — the new position. Values past either end are clamped to it.
     *
     * @remarks
     * Equivalent to Unity's `Transform.SetSiblingIndex(index)`. Only the order
     * changes: no object moves in space. The Three.js mirror is not reordered —
     * its child order has no effect on what is drawn.
     */
    public setSiblingIndex(index: number): void {
        if (this._parent) {
            const siblings = this._parent._children;
            const from = siblings.indexOf(this);
            const to = Math.max(0, Math.min(index, siblings.length - 1));
            if (from === -1 || to === from) return;
            const writable = this._parent._writableChildren();
            writable.splice(from, 1);
            writable.splice(to, 0, this);
        } else {
            this.gameObject.scene._moveRoot(this.gameObject, index);
        }

        // Anything that cached an answer about the hierarchy — a layout group's
        // arrangement, a canvas's draw order — is now out of date.
        Transform._hierarchyEpoch++;
    }

    /** Moves this Transform to the front of its siblings. Unity's `SetAsFirstSibling()`. */
    public setAsFirstSibling(): void {
        this.setSiblingIndex(0);
    }

    /** Moves this Transform to the back of its siblings. Unity's `SetAsLastSibling()`. */
    public setAsLastSibling(): void {
        this.setSiblingIndex(Number.MAX_SAFE_INTEGER);
    }

    /**
     * The topmost Transform in this hierarchy (may be `this` if root).
     *
     * @remarks
     * Equivalent to Unity's `Transform.root`.
     */
    public get root(): Transform {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: Transform = this;
        while (current._parent !== null) {
            current = current._parent;
        }
        return current;
    }

    /**
     * Returns `true` if this Transform is a child (at any depth)
     * of the specified parent.
     *
     * @param parent — the potential ancestor to check.
     *
     * @remarks
     * Equivalent to Unity's `Transform.IsChildOf(parent)`.
     * Note: returns `true` if `parent === this`.
     */
    public isChildOf(parent: Transform): boolean {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: Transform | null = this;
        while (current !== null) {
            if (current === parent) return true;
            current = current._parent;
        }
        return false;
    }

    /**
     * Finds a child Transform by name or path.
     *
     * @param name — a child name or `/`-separated path (e.g., `"Body/Head"`).
     * @returns the found Transform, or `null`.
     *
     * @remarks
     * Equivalent to Unity's `Transform.Find(name)`.
     * Only searches direct children for single names, or walks the path.
     */
    public find(name: string): Transform | null {
        const parts = name.split("/");
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: Transform = this;

        for (const part of parts) {
            let found = false;
            for (const child of current._children) {
                if (child.gameObject.name === part) {
                    current = child;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }

        return current === this ? null : current;
    }

    /**
     * Detaches all children, making them root-level.
     *
     * @remarks
     * Equivalent to Unity's `Transform.DetachChildren()`.
     */
    public detachChildren(): void {
        // Iterate in reverse because setParent modifies _children
        for (let i = this._children.length - 1; i >= 0; i--) {
            this._children[i].setParent(null, true);
        }
    }

    /**
     * @internal
     * Direct access to children array. Used by GameObject.onDestroy.
     *
     * @remarks
     * A live view: it changes under the caller if a child comes or goes. Use
     * {@link _lendChildren} to walk it while running code that might do that.
     */
    public get _internalChildren(): readonly Transform[] {
        return this._children;
    }

    /**
     * @internal
     * The child list, for a walk that runs user code — `update`, `onDisable`, a
     * message handler — and so may see a child destroyed, moved or added
     * before it finishes.
     *
     * @remarks
     * Nothing is copied here: the array is marked as lent, and the first change
     * made to the list afterwards writes to a copy instead, leaving the walk
     * its own list to finish over. A frame in which nothing changes therefore
     * allocates nothing, and one that does pays a single copy, only where a
     * walk had been. Entries of a lent list may have been destroyed or moved
     * since it was taken, so a walk tests each before using it.
     */
    public _lendChildren(): readonly Transform[] {
        this._childrenLent = true;
        return this._children;
    }

    /** The child list to change: the current one, or a copy if a walk still holds it. */
    private _writableChildren(): Transform[] {
        if (this._childrenLent) {
            this._children = this._children.slice();
            this._childrenLent = false;
        }
        return this._children;
    }

    // ==================== II. LOCAL TRANSFORMS ====================

    /**
     * Position relative to the parent Transform.
     *
     * Returns a **clone** — modify the returned value and assign it back:
     * ```ts
     * const pos = transform.localPosition;
     * pos.y += 1;
     * transform.localPosition = pos;
     * ```
     *
     * @remarks
     * Equivalent to Unity's `Transform.localPosition`.
     */
    public get localPosition(): Vector3 {
        return this._localPosition.clone();
    }

    public set localPosition(value: Vector3) {
        this._localPosition.copy(value);
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localPosition._copyToThree(this._object3D.position);
        }
    }

    /**
     * Rotation relative to the parent Transform (as a quaternion).
     *
     * Returns a **clone**.
     *
     * @remarks
     * Equivalent to Unity's `Transform.localRotation`.
     */
    public get localRotation(): Quaternion {
        return this._localRotation.clone();
    }

    public set localRotation(value: Quaternion) {
        this._localRotation.copy(value);
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localRotation._copyToThree(this._object3D.quaternion);
        }
    }

    /**
     * Scale relative to the parent Transform.
     *
     * Returns a **clone**.
     *
     * @remarks
     * Equivalent to Unity's `Transform.localScale`.
     */
    public get localScale(): Vector3 {
        return this._localScale.clone();
    }

    public set localScale(value: Vector3) {
        this._localScale.copy(value);
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localScale._copyToThree(this._object3D.scale);
        }
    }

    /**
     * Local rotation as Euler angles (in degrees).
     *
     * Returns a **clone**.
     *
     * @remarks
     * Equivalent to Unity's `Transform.localEulerAngles`.
     */
    public get localEulerAngles(): Vector3 {
        return this._localRotation.eulerAngles;
    }

    public set localEulerAngles(value: Vector3) {
        this.localRotation = Quaternion.euler(value.x, value.y, value.z);
    }

    // ==================== III. WORLD TRANSFORMS ====================

    /**
     * World position of the Transform.
     *
     * Returns a **clone**. The getter queries the Three.js world matrix.
     *
     * @remarks
     * Equivalent to Unity's `Transform.position`.
     */
    public get position(): Vector3 {
        const e = this._engineWorldMatrix(_tMat4).elements;
        return new Vector3(e[12], e[13], e[14]);
    }

    public set position(value: Vector3) {
        if (this._parent) {
            // localPos = inverse(parent engine world) · worldPos
            _tMat4.copy(this._parent._engineWorldMatrix(_tMat4B)).invert();
            _tvec3A.set(value.x, value.y, value.z).applyMatrix4(_tMat4);
            this._localPosition.set(_tvec3A.x, _tvec3A.y, _tvec3A.z);
        } else {
            this._localPosition.copy(value);
        }
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localPosition._copyToThree(this._object3D.position);
        }
    }

    /**
     * World rotation of the Transform (as a quaternion).
     *
     * Returns a **clone**.
     *
     * @remarks
     * Equivalent to Unity's `Transform.rotation`.
     */
    public get rotation(): Quaternion {
        this._engineWorldMatrix(_tMat4).decompose(_dPos, _dRot, _dScale);
        return new Quaternion(_dRot.x, _dRot.y, _dRot.z, _dRot.w);
    }

    public set rotation(value: Quaternion) {
        if (this._parent) {
            // localRotation = inverse(parentWorldRotation) * worldRotation
            this._parent._engineWorldMatrix(_tMat4).decompose(_dPos, _tquatA, _dScale);
            _tquatA.invert(); // _tquatA = parentWorldRot⁻¹
            value._copyToThree(_tquatB);
            _tquatA.multiply(_tquatB); // _tquatA = parentWorldRot⁻¹ * targetWorldRot
            this._localRotation.set(_tquatA.x, _tquatA.y, _tquatA.z, _tquatA.w);
        } else {
            this._localRotation.copy(value);
        }
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localRotation._copyToThree(this._object3D.quaternion);
        }
    }

    /**
     * World rotation as Euler angles (in degrees).
     *
     * Returns a **clone**.
     *
     * @remarks
     * Equivalent to Unity's `Transform.eulerAngles`.
     */
    public get eulerAngles(): Vector3 {
        return this.rotation.eulerAngles;
    }

    public set eulerAngles(value: Vector3) {
        this.rotation = Quaternion.euler(value.x, value.y, value.z);
    }

    /**
     * The approximate world scale of the Transform (read-only).
     *
     * @remarks
     * Equivalent to Unity's `Transform.lossyScale`.
     * Extracted from the world matrix. May not be perfectly accurate
     * with non-uniform parent scaling or shear.
     */
    public get lossyScale(): Vector3 {
        this._engineWorldMatrix(_tMat4).decompose(_dPos, _dRot, _dScale);
        return new Vector3(_dScale.x, _dScale.y, _dScale.z);
    }

    // ==================== IV. DIRECTION VECTORS ====================

    /**
     * The forward direction in world space (positive Z in Unity convention).
     *
     * @remarks
     * Equivalent to Unity's `Transform.forward`.
     * Computed from the **world** rotation applied to `(0, 0, 1)`.
     *
     * Unity docs: "The blue axis of the transform in world space."
     */
    public get forward(): Vector3 {
        // Must use WORLD rotation, not local — a child with identity
        // localRotation still inherits its parent's orientation.
        this._engineWorldMatrix(_tMat4).decompose(_dPos, _dRot, _dScale);
        return new Vector3(0, 0, 1).applyQuaternion(
            _equatA.set(_dRot.x, _dRot.y, _dRot.z, _dRot.w)
        );
    }

    /**
     * Sets the world rotation so the forward (blue, +Z) axis points along `value`.
     *
     * @remarks Equivalent to Unity's `Transform.forward` setter
     * (`rotation = Quaternion.LookRotation(value)`).
     */
    public set forward(value: Vector3) {
        this.rotation = Quaternion.lookRotation(value);
    }

    /**
     * The right direction in world space (positive X).
     *
     * @remarks
     * Equivalent to Unity's `Transform.right`.
     */
    public get right(): Vector3 {
        this._engineWorldMatrix(_tMat4).decompose(_dPos, _dRot, _dScale);
        return new Vector3(1, 0, 0).applyQuaternion(
            _equatA.set(_dRot.x, _dRot.y, _dRot.z, _dRot.w)
        );
    }

    /**
     * Sets the world rotation so the right (red, +X) axis points along `value`.
     *
     * @remarks Equivalent to Unity's `Transform.right` setter
     * (`rotation = Quaternion.FromToRotation(Vector3.right, value)`).
     */
    public set right(value: Vector3) {
        this.rotation = Quaternion.fromToRotation(Vector3.right, value);
    }

    /**
     * The upward direction in world space (positive Y).
     *
     * @remarks
     * Equivalent to Unity's `Transform.up`.
     */
    public get up(): Vector3 {
        this._engineWorldMatrix(_tMat4).decompose(_dPos, _dRot, _dScale);
        return new Vector3(0, 1, 0).applyQuaternion(
            _equatA.set(_dRot.x, _dRot.y, _dRot.z, _dRot.w)
        );
    }

    /**
     * Sets the world rotation so the up (green, +Y) axis points along `value`.
     *
     * @remarks Equivalent to Unity's `Transform.up` setter
     * (`rotation = Quaternion.FromToRotation(Vector3.up, value)`).
     */
    public set up(value: Vector3) {
        this.rotation = Quaternion.fromToRotation(Vector3.up, value);
    }

    // ==================== V. TRANSFORM METHODS ====================

    /**
     * Moves the Transform by `translation`.
     *
     * @param translation — the offset to apply.
     * @param relativeTo — {@link Space.World} (default) adds the offset along the
     *        world axes; {@link Space.Self} first rotates it by the Transform's own
     *        orientation (ignoring scale), i.e. moves along its local axes.
     *
     * @remarks
     * Equivalent to Unity's `Transform.Translate(translation, relativeTo)`.
     */
    public translate(translation: Vector3, relativeTo: Space = Space.World): void {
        if (this._dirty) this._syncToThree();
        const offset = relativeTo === Space.Self
            ? this.transformDirection(translation)
            : translation;
        this._object3D.getWorldPosition(_tvec3A);
        _tvec3A.x += offset.x;
        _tvec3A.y += offset.y;
        _tvec3A.z += offset.z;

        // Convert back to local
        if (this._parent) {
            this._parent._object3D.worldToLocal(_tvec3A);
        }

        this._localPosition.set(_tvec3A.x, _tvec3A.y, _tvec3A.z);
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localPosition._copyToThree(this._object3D.position);
        }
    }

    /**
     * Rotates the Transform by the given Euler angles (in degrees).
     *
     * @param eulers — rotation angles in degrees (x = pitch, y = yaw, z = roll).
     * @param relativeTo — {@link Space.Self} (default) rotates around the
     *        Transform's own axes; {@link Space.World} rotates around the world axes.
     *
     * @remarks Equivalent to Unity's `Transform.Rotate(eulers, relativeTo)`.
     */
    public rotate(eulers: Vector3, relativeTo: Space = Space.Self): void {
        const delta = Quaternion.euler(eulers.x, eulers.y, eulers.z);
        if (relativeTo === Space.World) {
            // World: newWorldRot = delta * currentWorldRot.
            this.rotation = Quaternion.multiply(delta, this.rotation);
            return;
        }
        // Self: newLocalRot = currentLocalRot * delta.
        const newRot = Quaternion.multiply(this._localRotation, delta, _equatA);
        this._localRotation.copy(newRot);
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localRotation._copyToThree(this._object3D.quaternion);
        }
    }

    /**
     * Rotates the Transform around a world-space `point` and `axis` by `angle`
     * degrees, updating both its position and orientation.
     *
     * @param point — the world-space pivot to rotate around.
     * @param axis — the world-space axis to rotate about (need not be normalized).
     * @param angle — rotation angle in degrees.
     *
     * @remarks Equivalent to Unity's `Transform.RotateAround(point, axis, angle)`.
     */
    public rotateAround(point: Vector3, axis: Vector3, angle: number): void {
        const q = Quaternion.angleAxis(angle, axis);
        const pos = this.position;
        const offset = new Vector3(pos.x - point.x, pos.y - point.y, pos.z - point.z);
        offset.applyQuaternion(q);
        this.position = new Vector3(point.x + offset.x, point.y + offset.y, point.z + offset.z);
        this.rotation = Quaternion.multiply(q, this.rotation);
    }

    /**
     * Rotates the Transform so its forward vector points at `target`.
     *
     * @param target — the world-space point to look at.
     * @param worldUp — the upward direction (default: `Vector3.up`).
     *
     * @remarks
     * Equivalent to Unity's `Transform.LookAt(target)`.
     */
    public lookAt(target: Vector3, worldUp: Vector3 = Vector3.up): void {
        // Engine math, not `Object3D.lookAt`: Three aims an object's **−Z** at the
        // target, where Unity aims its **+Z**. That disagreement used to be hidden
        // by the camera's old `rotateY(π)`; for anything else it meant `forward`
        // pointed away from what was just looked at.
        const pos = this.position;
        const dir = new Vector3(target.x - pos.x, target.y - pos.y, target.z - pos.z);
        if (dir.magnitude() < 1e-6) return;

        this.rotation = Quaternion.lookRotation(dir, worldUp);
    }

    /**
     * Sets both position and rotation in a single operation.
     *
     * More efficient than setting them separately since it
     * only updates the Three.js state once.
     *
     * @param position — the new world position.
     * @param rotation — the new world rotation.
     *
     * @remarks
     * Equivalent to Unity's `Transform.SetPositionAndRotation(pos, rot)`.
     */
    public setPositionAndRotation(position: Vector3, rotation: Quaternion): void {
        // Set world position → local
        if (this._parent) {
            position._copyToThree(_tvec3A);
            this._parent._object3D.worldToLocal(_tvec3A);
            this._localPosition.set(_tvec3A.x, _tvec3A.y, _tvec3A.z);
        } else {
            this._localPosition.copy(position);
        }

        // Set world rotation → local
        if (this._parent) {
            this._parent._object3D.getWorldQuaternion(_tquatA);
            _tquatA.invert();
            rotation._copyToThree(_tquatB);
            _tquatA.multiply(_tquatB);
            this._localRotation.set(_tquatA.x, _tquatA.y, _tquatA.z, _tquatA.w);
        } else {
            this._localRotation.copy(rotation);
        }

        // Sync to Three.js
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localPosition._copyToThree(this._object3D.position);
            this._localRotation._copyToThree(this._object3D.quaternion);
        }
    }

    // ==================== VI. COORDINATE CONVERSION ====================
    //
    // Every method here works in **engine** world space, the space `position`,
    // `rotation` and `lossyScale` speak. That is not the space the backing
    // `Object3D` is in: the scene's handedness mirror (`Scene._contentRoot`)
    // sits above it, so `matrixWorld` is the Z-mirrored image of engine world
    // space. Going through `_engineWorldMatrix` undoes it.
    //
    // Reaching for `localToWorld`/`worldToLocal`/`getWorldQuaternion` directly
    // is what these did before, and it made them disagree with `position` on
    // the Z axis for every object in a scene — `inverseTransformPoint(position)`
    // answered `(0, 0, -2z)` rather than the origin. The round trip still
    // closed, which is why the tests missed it.

    /**
     * Transforms a point from local space to world space.
     *
     * @param localPoint — point in this Transform's local space.
     * @returns the point in world space.
     *
     * @remarks
     * Equivalent to Unity's `Transform.TransformPoint(point)`.
     */
    public transformPoint(localPoint: Vector3): Vector3 {
        this._engineWorldMatrix(_tMat4C);
        _tvec3A.set(localPoint.x, localPoint.y, localPoint.z).applyMatrix4(_tMat4C);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
    }

    /**
     * Transforms a point from world space to local space.
     *
     * @param worldPoint — point in world space.
     * @returns the point in this Transform's local space.
     *
     * @remarks
     * Equivalent to Unity's `Transform.InverseTransformPoint(point)`.
     */
    public inverseTransformPoint(worldPoint: Vector3): Vector3 {
        this._engineWorldMatrix(_tMat4C).invert();
        _tvec3A.set(worldPoint.x, worldPoint.y, worldPoint.z).applyMatrix4(_tMat4C);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
    }

    /**
     * Transforms a vector from local space to world space.
     *
     * Applies rotation **and scale** but not position, so the result may have a
     * different length than `localVector`. Use it for offsets and sizes; use
     * {@link transformDirection} for directions that must keep unit length and
     * {@link transformPoint} for positions.
     *
     * @param localVector — vector in this Transform's local space.
     * @returns the vector in world space.
     *
     * @remarks Equivalent to Unity's `Transform.TransformVector(vector)`.
     */
    public transformVector(localVector: Vector3): Vector3 {
        // World rotation + scale without translation: the difference of two points
        // (the vector, and the origin) taken through the same world matrix.
        this._engineWorldMatrix(_tMat4C);
        _tvec3A.set(localVector.x, localVector.y, localVector.z).applyMatrix4(_tMat4C);
        _tVec3C.set(0, 0, 0).applyMatrix4(_tMat4C);
        return new Vector3(_tvec3A.x - _tVec3C.x, _tvec3A.y - _tVec3C.y, _tvec3A.z - _tVec3C.z);
    }

    /**
     * Transforms a vector from world space to local space.
     *
     * Inverse of {@link transformVector}: undoes rotation and scale but not
     * position, so the result may have a different length than `worldVector`.
     *
     * @param worldVector — vector in world space.
     * @returns the vector in this Transform's local space.
     *
     * @remarks Equivalent to Unity's `Transform.InverseTransformVector(vector)`.
     */
    public inverseTransformVector(worldVector: Vector3): Vector3 {
        // The inverse world matrix applied to the vector and to the origin; the
        // difference drops the translation the same way transformVector does.
        this._engineWorldMatrix(_tMat4C).invert();
        _tvec3A.set(worldVector.x, worldVector.y, worldVector.z).applyMatrix4(_tMat4C);
        _tVec3C.set(0, 0, 0).applyMatrix4(_tMat4C);
        return new Vector3(_tvec3A.x - _tVec3C.x, _tvec3A.y - _tVec3C.y, _tvec3A.z - _tVec3C.z);
    }

    /**
     * Transforms a direction from local space to world space.
     *
     * Unlike {@link transformPoint}, this ignores the Transform's position —
     * only rotation and scale are applied.
     *
     * @param localDirection — direction in local space.
     * @returns the direction in world space.
     *
     * @remarks
     * Equivalent to Unity's `Transform.TransformDirection(dir)`.
     */
    public transformDirection(localDirection: Vector3): Vector3 {
        // Decomposed rather than taken from `getWorldQuaternion`: that reads the
        // mirrored matrix, whose reflection Three parks as a negative scale on X.
        // The engine matrix is proper, so its rotation is the real one.
        this._engineWorldMatrix(_tMat4C).decompose(_tVec3C, _tquatA, _tvec3A);
        _tVec3B.set(localDirection.x, localDirection.y, localDirection.z).applyQuaternion(_tquatA);
        return new Vector3(_tVec3B.x, _tVec3B.y, _tVec3B.z);
    }

    /**
     * Transforms a direction from world space to local space.
     *
     * @param worldDirection — direction in world space.
     * @returns the direction in local space.
     *
     * @remarks
     * Equivalent to Unity's `Transform.InverseTransformDirection(dir)`.
     */
    public inverseTransformDirection(worldDirection: Vector3): Vector3 {
        this._engineWorldMatrix(_tMat4C).decompose(_tVec3C, _tquatA, _tvec3A);
        _tquatA.invert();
        _tVec3B.set(worldDirection.x, worldDirection.y, worldDirection.z).applyQuaternion(_tquatA);
        return new Vector3(_tVec3B.x, _tVec3B.y, _tVec3B.z);
    }

    /**
     * The matrix that transforms a point from local space to world space.
     *
     * @remarks Equivalent to Unity's `Transform.localToWorldMatrix`.
     */
    public get localToWorldMatrix(): Matrix4x4 {
        const result = new Matrix4x4();
        const src = this._engineWorldMatrix(_tMat4C).elements;
        for (let i = 0; i < 16; i++) result.elements[i] = src[i];
        return result;
    }

    /**
     * The matrix that transforms a point from world space to local space.
     *
     * @remarks Equivalent to Unity's `Transform.worldToLocalMatrix`.
     */
    public get worldToLocalMatrix(): Matrix4x4 {
        const result = new Matrix4x4();
        const src = this._engineWorldMatrix(_tMat4C).invert().elements;
        for (let i = 0; i < 16; i++) result.elements[i] = src[i];
        return result;
    }

    // ==================== VII. LIFECYCLE ====================

    /**
     * @internal
     * Leaves the parent's child list and cleans up Three.js objects on
     * destruction.
     *
     * @remarks
     * Leaving the list is what makes a destroyed child gone from the
     * hierarchy, as it is in Unity: `childCount`, `getChild`, sibling indices
     * and the serializer all walk it, and a dead entry there was saved back
     * into the scene as an object with no components.
     */
    protected override onDestroy(): void {
        _dirtySet.delete(this);
        if (this._parent !== null) {
            const at = this._parent._children.indexOf(this);
            if (at !== -1) this._parent._writableChildren().splice(at, 1);
            Transform._hierarchyEpoch++;
        }
        this._object3D.clear();
        this._object3D.removeFromParent();
    }
}