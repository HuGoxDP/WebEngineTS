// path: src/engine/core/rendering/Renderer.ts

import * as THREE from "three";
import { Behaviour } from "../Behaviour.ts";
import { Material } from "../graphics/Material.ts";
import { Bounds } from "../math/Bounds.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CACHED THREE.JS OBJECTS ====================
// Module-level temporaries used by bounds computation.
// Avoids allocation per-call. Only touched inside _computeWorldBounds().

const _tBox3 = new THREE.Box3();

// ==================== ENUMS ====================

/**
 * Controls how an object casts shadows.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Rendering.ShadowCastingMode`.
 */
export enum ShadowCastingMode {
    /** The renderer does not cast shadows. */
    Off = 0,
    /** The renderer casts shadows normally. */
    On = 1,
    /** The renderer casts shadows from both sides of its geometry. */
    TwoSided = 2,
    /** The renderer is invisible, but still casts shadows. */
    ShadowsOnly = 3,
}

// ==================== RENDERER ====================

/**
 * Abstract base class for all renderer components.
 *
 * A Renderer makes a {@link GameObject} visible in the scene by managing
 * materials, bounds, shadow settings, and an internal Three.js object that
 * mirrors engine state.
 *
 * Subclasses must:
 * 1. Override {@link onAwake} to create their Three.js visual
 *    (e.g. `THREE.Mesh`, `THREE.Line`) and register it via
 *    {@link _setInternalRenderObject}.
 * 2. Override {@link _syncMaterialToThree} (and optionally
 *    {@link _syncMaterialsToThree}) to push material changes into
 *    the Three.js object.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Renderer`.
 *
 * **Material system:**
 * - `sharedMaterial` / `sharedMaterials` — references to shared asset materials.
 *    Editing these affects every object using the same material.
 * - `material` / `materials` — auto-cloned on first access (per-object copies).
 *    Editing these only affects this renderer.
 *
 * **Three.js isolation:**
 * - The internal Three.js object is never exposed in public API.
 * - Subclasses access it via the protected {@link _internalRenderObject} field
 *   and attach/detach it via {@link _setInternalRenderObject}.
 * - Shadow/visibility sync happens through internal helpers, not direct
 *   Three.js manipulation by callers.
 *
 * @example
 * ```ts
 * // Subclass usage (engine-internal):
 * class MeshRenderer extends Renderer {
 *     private _mesh!: THREE.Mesh;
 *
 *     protected override onAwake(): void {
 *         this._mesh = new THREE.Mesh();
 *         this._setInternalRenderObject(this._mesh);
 *     }
 *
 *     protected override _syncMaterialToThree(): void {
 *         const mat = this._getActiveMaterial();
 *         if (mat) this._mesh.material = mat._internalThreeMaterial;
 *     }
 * }
 * ```
 */
export abstract class Renderer extends Behaviour {

    // ==================== INTERNAL THREE.JS STATE ====================

    /**
     * The Three.js object this renderer manages (mesh, line, sprite, etc.).
     *
     * Set by subclasses via {@link _setInternalRenderObject}.
     * Automatically added as an internal child of the Transform when set,
     * and removed when set to `null` or on destroy.
     *
     * @internal — never access outside the engine.
     */
    protected _internalRenderObject: THREE.Object3D | null = null;

    // ==================== MATERIAL SYSTEM ====================

    /**
     * Shared materials array — the source of truth for multi-material support.
     * Index 0 is the "main" material accessed by `sharedMaterial`.
     *
     * @internal
     */
    protected _sharedMaterials: Material[] = [];

    /**
     * Per-instance material clones. `null` means no clones have been created yet.
     * Once any index is accessed via `material` / `materials`, the entire array
     * is cloned from `_sharedMaterials`.
     *
     * @internal
     */
    protected _materialInstances: Material[] | null = null;

    // ==================== SETTINGS ====================

    /** @internal */
    private _receiveShadows: boolean = true;

    /** @internal */
    private _shadowCastingMode: ShadowCastingMode = ShadowCastingMode.On;

    // ==================== BOUNDS ====================

    /**
     * Object-space bounding box. Subclasses update this when their
     * geometry changes (e.g. MeshRenderer updates it when the mesh changes).
     * @internal
     */
    protected _localBounds: Bounds = new Bounds();

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== INTERNAL RENDER OBJECT MANAGEMENT ====================

    /**
     * @internal
     * Registers (or unregisters) the Three.js visual for this renderer.
     *
     * When a non-null object is set, it is:
     * 1. Stored as `_internalRenderObject`.
     * 2. Added as an internal child of this GameObject's Transform
     *    (via `transform._addInternalChild`).
     * 3. Synced with current shadow/visibility settings.
     *
     * When `null` is set, the previous object is removed from the Transform.
     *
     * **Call this from `onAwake()` in subclasses.**
     *
     * @param obj — the Three.js object to attach, or `null` to detach.
     */
    protected _setInternalRenderObject(obj: THREE.Object3D | null): void {
        // Detach previous
        if (this._internalRenderObject !== null) {
            this.gameObject.transform._removeInternalChild(this._internalRenderObject);
        }

        this._internalRenderObject = obj;

        // Attach new
        if (obj !== null) {
            this.gameObject.transform._addInternalChild(obj);
            this._syncShadowSettings();
            this._syncVisibility();
        }
    }

    // ==================== SINGLE-MATERIAL ACCESSORS ====================
    // These are convenience shortcuts for index 0 of the materials array,
    // matching Unity's Renderer.sharedMaterial / Renderer.material.

    /**
     * The shared material of this renderer.
     *
     * Modifying this material affects all objects that share it.
     * Setting this replaces index 0 of {@link sharedMaterials} and
     * destroys any per-instance clone.
     *
     * @remarks Equivalent to Unity's `Renderer.sharedMaterial`.
     */
    public get sharedMaterial(): Material | null {
        return this._sharedMaterials.length > 0 ? this._sharedMaterials[0] : null;
    }

    public set sharedMaterial(value: Material | null) {
        // Destroy instance clone at index 0 if it exists
        this._destroyInstanceAt(0);

        if (value !== null) {
            if (this._sharedMaterials.length === 0) {
                this._sharedMaterials.push(value);
            } else {
                this._sharedMaterials[0] = value;
            }
        } else {
            if (this._sharedMaterials.length > 0) {
                this._sharedMaterials[0] = null!;
            }
        }

        this._syncMaterialToThree();
    }

    /**
     * The per-instance material of this renderer.
     *
     * **Getting** this property auto-clones the shared material on first access
     * (Unity-style instancing). Modifying the returned material only affects
     * this specific renderer.
     *
     * **Setting** this property creates a clone of the provided material
     * and assigns it as the per-instance material at index 0.
     *
     * @remarks
     * Equivalent to Unity's `Renderer.material`.
     *
     * ⚠️ Each access that triggers a clone allocates a new Material.
     * Use `sharedMaterial` when you don't need per-instance edits.
     */
    public get material(): Material | null {
        // If we already have an instance clone, return it
        if (this._materialInstances !== null &&
            this._materialInstances.length > 0 &&
            this._materialInstances[0] != null) {
            return this._materialInstances[0];
        }

        // Auto-clone from shared
        const shared = this.sharedMaterial;
        if (shared === null) return null;

        this._ensureMaterialInstances();
        this._materialInstances![0] = shared.clone();
        this._syncMaterialToThree();

        return this._materialInstances![0];
    }

    public set material(value: Material | null) {
        // Destroy old instance at index 0
        this._destroyInstanceAt(0);

        if (value !== null) {
            this._ensureMaterialInstances();
            this._materialInstances![0] = value.clone();
        } else if (this._materialInstances !== null && this._materialInstances.length > 0) {
            this._materialInstances[0] = null!;
        }

        this._syncMaterialToThree();
    }

    // ==================== MULTI-MATERIAL ACCESSORS ====================

    /**
     * All shared materials on this renderer.
     *
     * Returns a **readonly** view of the internal array. Mutations to elements
     * won't propagate — use the setter to replace the entire array.
     *
     * @remarks Equivalent to Unity's `Renderer.sharedMaterials`.
     */
    public get sharedMaterials(): readonly Material[] {
        return this._sharedMaterials;
    }

    public set sharedMaterials(value: Material[]) {
        // Destroy all existing instance clones
        this._destroyAllInstances();

        this._sharedMaterials = [...value];
        this._syncMaterialsToThree();
    }

    /**
     * All per-instance materials on this renderer.
     *
     * **Getting** auto-clones the entire shared materials array on first access.
     * Subsequent accesses return the same clones until replaced.
     *
     * **Setting** replaces the instances with clones of the provided materials.
     *
     * @remarks Equivalent to Unity's `Renderer.materials`.
     */
    public get materials(): Material[] {
        // If instances already exist and are fully populated, return copy
        if (this._materialInstances !== null &&
            this._materialInstances.length === this._sharedMaterials.length &&
            this._materialInstances.every(m => m != null)) {
            return [...this._materialInstances];
        }

        // Auto-clone all shared materials
        this._ensureMaterialInstances();
        for (let i = 0; i < this._sharedMaterials.length; i++) {
            if (this._materialInstances![i] == null && this._sharedMaterials[i] != null) {
                this._materialInstances![i] = this._sharedMaterials[i].clone();
            }
        }

        this._syncMaterialsToThree();
        return [...this._materialInstances!];
    }

    public set materials(value: Material[]) {
        this._destroyAllInstances();

        this._materialInstances = value.map(m => m.clone());
        this._syncMaterialsToThree();
    }

    // ==================== BOUNDS ====================

    /**
     * The world-space axis-aligned bounding box of this renderer.
     *
     * Computed by transforming {@link localBounds} by the GameObject's
     * world matrix. Allocates a new {@link Bounds} — cache the result
     * if calling frequently.
     *
     * @remarks Equivalent to Unity's `Renderer.bounds`.
     */
    public get bounds(): Bounds {
        return this._computeWorldBounds();
    }

    /**
     * The object-space bounding box.
     *
     * Returns a **clone** to prevent external mutation.
     * Use the setter to update.
     *
     * @remarks Equivalent to Unity's `Renderer.localBounds`.
     */
    public get localBounds(): Bounds {
        return this._localBounds.clone();
    }

    public set localBounds(value: Bounds) {
        this._localBounds.copy(value);
    }

    // ==================== VISIBILITY ====================

    /**
     * Whether this renderer is currently visible.
     *
     * True only when the component is enabled AND the GameObject is
     * active in the hierarchy.
     *
     * @remarks Equivalent to Unity's `Renderer.isVisible`.
     */
    public get isVisible(): boolean {
        return this.enabled && this.gameObject.activeInHierarchy;
    }

    // ==================== SHADOW SETTINGS ====================

    /**
     * Whether this renderer receives shadows cast by other objects.
     *
     * @remarks Equivalent to Unity's `Renderer.receiveShadows`.
     */
    @SerializedField()
    public get receiveShadows(): boolean {
        return this._receiveShadows;
    }

    public set receiveShadows(value: boolean) {
        if (this._receiveShadows === value) return;
        this._receiveShadows = value;
        this._syncShadowSettings();
    }

    /**
     * How this renderer casts shadows.
     *
     * @remarks Equivalent to Unity's `Renderer.shadowCastingMode`.
     */
    @SerializedField({ type: FieldType.Enum })
    public get shadowCastingMode(): ShadowCastingMode {
        return this._shadowCastingMode;
    }

    public set shadowCastingMode(value: ShadowCastingMode) {
        if (this._shadowCastingMode === value) return;
        this._shadowCastingMode = value;
        this._syncShadowSettings();
    }

    // ==================== HELPERS FOR SUBCLASSES ====================

    /**
     * Returns the active material at index 0: the per-instance clone if it
     * exists, otherwise the shared material.
     *
     * This does **not** auto-clone — it just reports what's currently active.
     * Use this inside `_syncMaterialToThree()` implementations.
     *
     * @internal
     */
    protected _getActiveMaterial(): Material | null {
        if (this._materialInstances !== null &&
            this._materialInstances.length > 0 &&
            this._materialInstances[0] != null) {
            return this._materialInstances[0];
        }
        return this._sharedMaterials.length > 0 ? this._sharedMaterials[0] : null;
    }

    /**
     * Returns the active materials array: per-instance clones if they exist,
     * otherwise the shared materials.
     *
     * This does **not** auto-clone. Use this inside
     * `_syncMaterialsToThree()` implementations.
     *
     * @internal
     */
    protected _getActiveMaterials(): readonly Material[] {
        if (this._materialInstances !== null && this._materialInstances.length > 0) {
            return this._materialInstances;
        }
        return this._sharedMaterials;
    }

    // ==================== VIRTUAL SYNC HOOKS ====================
    // Subclasses override these to push material changes into their
    // specific Three.js object type (Mesh, Line, etc.).

    /**
     * @internal
     * Syncs the single (index-0) material to the Three.js render object.
     *
     * Default implementation assigns `_getActiveMaterial()._internalThreeMaterial`
     * to the Three.js object if it's a `THREE.Mesh`. Subclasses should override
     * for non-mesh render objects (lines, sprites, etc.).
     *
     * Called automatically when `sharedMaterial` or `material` changes.
     */
    protected _syncMaterialToThree(): void {
        const obj = this._internalRenderObject;
        if (obj === null) return;

        const mat = this._getActiveMaterial();

        if (obj instanceof THREE.Mesh) {
            if (mat !== null) {
                obj.material = mat._internalThreeMaterial;
            } else {
                obj.material = Renderer._errorMaterial;
            }
        }
    }

    /**
     * @internal
     * Syncs all materials to the Three.js render object (multi-material support).
     *
     * Default implementation assigns a material array to a `THREE.Mesh`.
     * Subclasses should override for non-mesh render objects.
     *
     * Called automatically when `sharedMaterials` or `materials` changes.
     */
    protected _syncMaterialsToThree(): void {
        const obj = this._internalRenderObject;
        if (obj === null) return;

        const mats = this._getActiveMaterials();

        if (obj instanceof THREE.Mesh) {
            if (mats.length > 1) {
                obj.material = mats.map(m => m._internalThreeMaterial);
            } else if (mats.length === 1) {
                obj.material = mats[0]._internalThreeMaterial;
            } else {
                obj.material = Renderer._errorMaterial;
            }
        }
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Syncs visibility to the Three.js object when this component becomes active.
     *
     * Called by the engine via {@link Behaviour._onEnabledChanged}.
     */
    protected override onEnable(): void {
        this._syncVisibility();
    }

    /**
     * @internal
     * Syncs visibility to the Three.js object when this component becomes inactive.
     */
    protected override onDisable(): void {
        this._syncVisibility();
    }

    /**
     * @internal
     * Cleanup: destroys per-instance material clones, detaches the Three.js
     * object from the Transform, and releases references.
     */
    protected override onDestroy(): void {
        // Destroy all per-instance material clones
        this._destroyAllInstances();

        // Clear shared material references (don't destroy — they're shared assets)
        this._sharedMaterials.length = 0;

        // Detach from Transform's internal scene graph
        if (this._internalRenderObject !== null) {
            this.gameObject.transform._removeInternalChild(this._internalRenderObject);
            this._internalRenderObject = null;
        }
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * @internal Pushes current shadow settings to the Three.js object.
     */
    private _syncShadowSettings(): void {
        const obj = this._internalRenderObject;
        if (obj === null) return;

        obj.castShadow = this._shadowCastingMode !== ShadowCastingMode.Off;
        obj.receiveShadow = this._receiveShadows;
    }

    /**
     * @internal Pushes current visibility to the Three.js object.
     */
    private _syncVisibility(): void {
        const obj = this._internalRenderObject;
        if (obj === null) return;

        obj.visible = this.isVisible;
    }

    /**
     * @internal Ensures the instances array exists and matches the shared array length.
     */
    private _ensureMaterialInstances(): void {
        if (this._materialInstances === null) {
            this._materialInstances = new Array<Material>(this._sharedMaterials.length).fill(null!);
        } else if (this._materialInstances.length < this._sharedMaterials.length) {
            while (this._materialInstances.length < this._sharedMaterials.length) {
                this._materialInstances.push(null!);
            }
        }
    }

    /**
     * @internal Destroys the per-instance clone at a specific index (if it exists).
     */
    private _destroyInstanceAt(index: number): void {
        if (this._materialInstances === null) return;
        if (index < 0 || index >= this._materialInstances.length) return;

        if (this._materialInstances[index] != null) {
            this._materialInstances[index].destroy();
            this._materialInstances[index] = null!;
        }

        // If all slots are null, discard the array entirely
        if (this._materialInstances.every(m => m == null)) {
            this._materialInstances = null;
        }
    }

    /**
     * @internal Destroys all per-instance material clones and nulls the array.
     */
    private _destroyAllInstances(): void {
        if (this._materialInstances === null) return;

        for (let i = 0; i < this._materialInstances.length; i++) {
            if (this._materialInstances[i] != null) {
                this._materialInstances[i].destroy();
            }
        }
        this._materialInstances = null;
    }

    /**
     * @internal
     * Computes the world-space AABB by transforming localBounds through
     * the Three.js world matrix.
     *
     * Uses module-level cached Three.js objects to minimize allocations.
     * The returned Bounds is a fresh allocation (safe for the caller to keep).
     */
    private _computeWorldBounds(): Bounds {
        if (this._localBounds.isEmpty()) return new Bounds();

        // Copy engine Bounds → cached THREE.Box3 via adapter
        this._localBounds._copyToThreeBox3(_tBox3);

        // Transform by world matrix
        const obj = this._internalRenderObject;
        if (obj !== null) {
            obj.updateMatrixWorld(true);
            _tBox3.applyMatrix4(obj.matrixWorld);
        }

        // Convert back to engine Bounds via adapter
        const result = new Bounds();
        result._copyFromThreeBox3(_tBox3);
        return result;
    }

    // ==================== STATIC ====================

    /**
     * Shared fallback material (magenta) used when no material is assigned.
     * Matches Unity's pink "missing material" appearance.
     *
     * @internal
     */
    private static _errorMaterial: THREE.Material = new THREE.MeshBasicMaterial({
        color: 0xFF00FF,
    });
}