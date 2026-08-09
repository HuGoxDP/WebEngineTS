// path: src/engine/core/components/MeshRenderer.ts

import * as THREE from "three";
import { Renderer } from "./Renderer.ts";
import { MeshFilter } from "./MeshFilter.ts";
import { Serializable } from "../reflection/Decorators.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Renders a 3D mesh attached to the same {@link GameObject}.
 *
 * MeshRenderer reads geometry from a sibling {@link MeshFilter} component
 * and displays it using materials from the {@link Renderer} base class.
 *
 * **Typical setup:**
 * ```ts
 * const go = new GameObject("Cube");
 * const filter = go.addComponent(MeshFilter);
 * filter.sharedMesh = Mesh.createCube();
 *
 * const renderer = go.addComponent(MeshRenderer);
 * renderer.sharedMaterial = new StandardMaterial();
 * ```
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.MeshRenderer`.
 *
 * - Geometry comes from a sibling {@link MeshFilter} (shared or instanced mesh).
 * - Materials come from the {@link Renderer} base class (shared or instanced).
 * - The internal Three.js `Mesh` object is created in {@link onAwake} and
 *   managed entirely through the Renderer's `_setInternalRenderObject` API.
 * - Supports multi-material rendering (one material per sub-mesh group).
 */
@Serializable({ typeName: "MeshRenderer", category: "Rendering" })
export class MeshRenderer extends Renderer {

    // ==================== INTERNAL STATE ====================

    /**
     * The underlying Three.js mesh object.
     *
     * Created in {@link onAwake}, attached to Transform via
     * {@link Renderer._setInternalRenderObject}.
     *
     * @internal — never access outside the engine.
     */
    private _threeMesh: THREE.Mesh | null = null;

    /**
     * Cached reference to the sibling MeshFilter.
     * Looked up once in {@link onAwake} and cached for performance.
     * @internal
     */
    private _meshFilter: MeshFilter | null = null;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "MeshRenderer";
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Creates the internal Three.js mesh, locates the sibling MeshFilter,
     * syncs geometry and material, and registers the mesh with the Transform.
     */
    protected override onAwake(): void {
        // 1. Create the Three.js mesh
        this._threeMesh = new THREE.Mesh();

        // 2. Register with Transform (handles add to scene graph + shadow/visibility sync)
        this._setInternalRenderObject(this._threeMesh);

        // 3. Find sibling MeshFilter and sync geometry
        this._meshFilter = this.gameObject.getComponent(MeshFilter);
        this._syncGeometry();

        // 4. Sync materials to Three.js
        this._syncAllMaterials();
    }

    /**
     * @internal
     * Cleanup: disposes Three.js geometry reference (NOT the asset itself),
     * then delegates to Renderer base for material cleanup and scene detach.
     */
    protected override onDestroy(): void {
        this._meshFilter = null;
        this._threeMesh = null;

        // Renderer.onDestroy() handles:
        // - material instance destruction
        // - _removeInternalChild from Transform
        // - nulling _internalRenderObject
        super.onDestroy();
    }

    // ==================== MATERIAL SYNC (overrides Renderer virtuals) ====================

    /**
     * @internal
     * Pushes the active single material to the Three.js mesh.
     *
     * Called automatically by Renderer when `sharedMaterial` or `material` changes.
     */
    protected override _syncMaterialToThree(): void {
        if (this._threeMesh === null) return;

        const mat = this._getActiveMaterial();
        if (mat !== null) {
            this._threeMesh.material = mat._internalThreeMaterial;
        } else {
            // Fallback: white standard material (slightly friendlier than magenta for MVP)
            this._threeMesh.material = MeshRenderer._defaultMaterial;
        }
    }

    /**
     * @internal
     * Pushes all active materials to the Three.js mesh (multi-material support).
     *
     * Called automatically by Renderer when `sharedMaterials` or `materials` changes.
     */
    protected override _syncMaterialsToThree(): void {
        if (this._threeMesh === null) return;

        const mats = this._getActiveMaterials();
        if (mats.length > 1) {
            this._threeMesh.material = mats.map(m => m._internalThreeMaterial);
        } else if (mats.length === 1) {
            this._threeMesh.material = mats[0]._internalThreeMaterial;
        } else {
            this._threeMesh.material = MeshRenderer._defaultMaterial;
        }
    }

    // ==================== PUBLIC API ====================

    /**
     * Re-reads geometry from the sibling MeshFilter and updates the
     * Three.js mesh. Call this after changing the MeshFilter's mesh
     * at runtime.
     *
     * Also re-syncs materials (in case sub-mesh count changed).
     *
     * @remarks
     * In Unity, MeshRenderer automatically picks up MeshFilter changes.
     * In this engine, call `updateMesh()` explicitly after changing geometry.
     * A future event system may automate this.
     */
    public updateMesh(): void {
        if (this._threeMesh === null) return;

        // Re-find MeshFilter if we lost the reference
        if (this._meshFilter === null) {
            this._meshFilter = this.gameObject.getComponent(MeshFilter);
        }

        this._syncGeometry();
        this._syncAllMaterials();
    }

    /**
     * Forces a full re-sync of both geometry and materials.
     *
     * Useful after bulk changes to both MeshFilter and material assignments.
     */
    public forceUpdate(): void {
        this.updateMesh();
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * @internal
     * Reads the current mesh from MeshFilter and applies it to the Three.js mesh.
     */
    private _syncGeometry(): void {
        if (this._threeMesh === null) return;

        if (this._meshFilter === null || !this._meshFilter.hasMesh()) {
            // No geometry — clear
            return;
        }

        const mesh = this._meshFilter.sharedMesh;
        if (mesh === null) return;

        // Get the Three.js BufferGeometry from our engine Mesh (lazy-built)
        const geometry = mesh._internalGeometry;
        if (geometry === null) return;

        // Assign geometry (Three.js Mesh does NOT own the geometry — Mesh asset does)
        this._threeMesh.geometry = geometry;

        // Update local bounds from the mesh
        this._localBounds.copy(mesh.bounds);
    }

    /**
     * @internal
     * Determines whether to use single or multi-material sync based on
     * the current state of the material arrays.
     */
    private _syncAllMaterials(): void {
        if (this._sharedMaterials.length > 1 ||
            (this._materialInstances !== null && this._materialInstances.length > 1)) {
            this._syncMaterialsToThree();
        } else {
            this._syncMaterialToThree();
        }
    }

    // ==================== STATIC ====================

    /**
     * Default material used when no material is assigned.
     * White standard material — more useful for debugging than magenta.
     *
     * @internal
     */
    private static _defaultMaterial: THREE.Material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
    });
}