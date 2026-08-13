// path: src/engine/core/Transform.ts

import * as THREE from "three";
import { Component } from "./Component.ts";
import { Vector3 } from "./math/Vector3.ts";
import { Quaternion } from "./math/Quaternion.ts";
import type { GameObject } from "./GameObject.ts";
import { SceneManager } from "./SceneManager.ts";
import { Bounds } from "./math/Bounds.ts";

// ==================== MODULE-LEVEL CACHE ====================
// Cached Three.js temporaries for zero-allocation internal math.
// These are NEVER exposed — used only inside this module.

const _tvec3A = new THREE.Vector3();
const _tquatA = new THREE.Quaternion();
const _tquatB = new THREE.Quaternion();
const _tBox3 = new THREE.Box3();
const _tVec3B = new THREE.Vector3();
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

    /** Direct children of this Transform. */
    private _children: Transform[] = [];

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
        this._object3D.updateMatrixWorld(true);
        _tBox3.setFromObject(this._object3D);

        if (_tBox3.isEmpty()) {
            return new Bounds();
        }

        _tBox3.getCenter(_tVec3B);
        const center = new Vector3(_tVec3B.x, _tVec3B.y, _tVec3B.z);

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
                this._parent._children.splice(index, 1);
            }
        }

        // --- Attach to new parent ---
        this._parent = newParent;
        const willBeRoot = (newParent === null);

        if (newParent) {
            newParent._children.push(this);
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

        // Ensure matrices are up to date
        this._object3D.updateMatrixWorld(true);
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
     */
    public get _internalChildren(): readonly Transform[] {
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
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldPosition(_tvec3A);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
    }

    public set position(value: Vector3) {
        if (this._parent) {
            // Convert world position to local: localPos = parent.worldToLocal(worldPos)
            value._copyToThree(_tvec3A);
            this._parent._object3D.worldToLocal(_tvec3A);
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
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldQuaternion(_tquatA);
        return new Quaternion(_tquatA.x, _tquatA.y, _tquatA.z, _tquatA.w);
    }

    public set rotation(value: Quaternion) {
        if (this._parent) {
            // localRotation = inverse(parentWorldRotation) * worldRotation
            this._parent._object3D.getWorldQuaternion(_tquatA);
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
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldScale(_tvec3A);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
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
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldQuaternion(_tquatA);
        return new Vector3(0, 0, 1).applyQuaternion(
            _equatA.set(_tquatA.x, _tquatA.y, _tquatA.z, _tquatA.w)
        );
    }

    /**
     * The right direction in world space (positive X).
     *
     * @remarks
     * Equivalent to Unity's `Transform.right`.
     */
    public get right(): Vector3 {
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldQuaternion(_tquatA);
        return new Vector3(1, 0, 0).applyQuaternion(
            _equatA.set(_tquatA.x, _tquatA.y, _tquatA.z, _tquatA.w)
        );
    }

    /**
     * The upward direction in world space (positive Y).
     *
     * @remarks
     * Equivalent to Unity's `Transform.up`.
     */
    public get up(): Vector3 {
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldQuaternion(_tquatA);
        return new Vector3(0, 1, 0).applyQuaternion(
            _equatA.set(_tquatA.x, _tquatA.y, _tquatA.z, _tquatA.w)
        );
    }

    // ==================== V. TRANSFORM METHODS ====================

    /**
     * Moves the Transform by `translation` in world space.
     *
     * @param translation — the world-space offset to apply.
     *
     * @remarks
     * Equivalent to Unity's `Transform.Translate(translation, Space.World)`.
     *
     * @todo Support `Space` parameter (Self vs World).
     */
    public translate(translation: Vector3): void {
        // Get current world position into cache (avoids allocation)
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldPosition(_tvec3A);
        _tvec3A.x += translation.x;
        _tvec3A.y += translation.y;
        _tvec3A.z += translation.z;

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
     *
     * @remarks
     * Equivalent to Unity's `Transform.Rotate(eulers, Space.Self)`.
     * Applies rotation in local space relative to current rotation.
     *
     * @todo Support `Space` parameter and axis-angle overload.
     */
    public rotate(eulers: Vector3): void {
        const delta = Quaternion.euler(eulers.x, eulers.y, eulers.z);
        // Apply in local space: newLocalRot = currentLocalRot * delta
        const newRot = Quaternion.multiply(this._localRotation, delta, _equatA);
        this._localRotation.copy(newRot);
        if (_dirtyTransformsEnabled) {
            this._markDirty();
        } else {
            this._localRotation._copyToThree(this._object3D.quaternion);
        }
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
    public lookAt(target: Vector3, worldUp?: Vector3): void {
        if (this._dirty) this._syncToThree();
        // Use Three.js lookAt for robust implementation
        target._copyToThree(_tvec3A);
        this._object3D.lookAt(_tvec3A);

        if (worldUp) {
            // Three.js lookAt uses Y-up. If custom up is provided,
            // we'd need more complex math. For now, rely on Three.js default.
            // TODO: Support custom worldUp properly.
        }

        // Sync back from Three.js to engine state
        this._localRotation._copyFromThree(this._object3D.quaternion);
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
        if (this._dirty) this._syncToThree();
        localPoint._copyToThree(_tvec3A);
        this._object3D.localToWorld(_tvec3A);
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
        if (this._dirty) this._syncToThree();
        worldPoint._copyToThree(_tvec3A);
        this._object3D.worldToLocal(_tvec3A);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
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
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldQuaternion(_tquatA);
        _tvec3A.set(localDirection.x, localDirection.y, localDirection.z);
        _tvec3A.applyQuaternion(_tquatA);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
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
        if (this._dirty) this._syncToThree();
        this._object3D.getWorldQuaternion(_tquatA);
        _tquatA.invert();
        _tvec3A.set(worldDirection.x, worldDirection.y, worldDirection.z);
        _tvec3A.applyQuaternion(_tquatA);
        return new Vector3(_tvec3A.x, _tvec3A.y, _tvec3A.z);
    }

    // ==================== VII. LIFECYCLE ====================

    /**
     * @internal
     * Cleans up Three.js objects on destruction.
     */
    protected override onDestroy(): void {
        _dirtySet.delete(this);
        this._object3D.clear();
        this._object3D.removeFromParent();
    }
}