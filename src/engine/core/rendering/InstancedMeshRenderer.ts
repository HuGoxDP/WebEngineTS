// path: src/engine/core/rendering/InstancedMeshRenderer.ts

import * as THREE from "three";
import { Renderer } from "./Renderer.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import { Color } from "../math/Color.ts";
import { Matrix4x4 } from "../math/Matrix4x4.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CACHED TEMPORARIES ====================
// Module-level scratch objects reused across instance updates to avoid
// per-call allocation. Only touched synchronously inside instance setters.

const _tmpMat = new Matrix4x4();
const _tmp4 = new THREE.Matrix4();
const _tmpColor = new THREE.Color();

/**
 * Renders many copies of a single {@link Mesh} in one draw call via GPU
 * instancing.
 *
 * Where each {@link MeshRenderer} costs one draw call, an
 * `InstancedMeshRenderer` draws an arbitrary number of instances of the same
 * mesh + material with a single draw call, giving a large draw-call reduction
 * for scenes with many identical objects (grids, foliage, particles-as-meshes,
 * asteroid fields). Each instance has its own transform (and optional color).
 *
 * @remarks
 * Conceptually equivalent to Unity's GPU instancing / `Graphics.RenderMeshInstanced`,
 * surfaced as a component to fit the engine's component model. Internally backed
 * by a `THREE.InstancedMesh`, which is never exposed.
 *
 * The mesh geometry and material are shared across all instances; only the
 * per-instance transform (and optional per-instance color) differ. Standard
 * materials work with instancing without any extra configuration.
 *
 * **Frustum culling** is disabled for the batch (per-instance culling is not
 * automatic), so instances never disappear when the batch origin leaves the
 * view. For very large worlds, split into multiple spatially-local batches.
 *
 * @example
 * ```ts
 * const go = new GameObject("Asteroids");
 * const inst = go.addComponent(InstancedMeshRenderer);
 * inst.mesh = Mesh.createSphere(0.5, 16);
 * inst.sharedMaterial = new StandardMaterial();
 * inst.count = 1000;
 * for (let i = 0; i < 1000; i++) {
 *     inst.setInstanceTransform(i, positions[i], Quaternion.identity, Vector3.one);
 * }
 * ```
 */
export class InstancedMeshRenderer extends Renderer {

    // ==================== INTERNAL STATE ====================

    /**
     * The underlying Three.js instanced mesh. Created lazily once a mesh and a
     * non-zero instance count are known; recreated when capacity must grow.
     * @internal — never access outside the engine.
     */
    private _threeInstanced: THREE.InstancedMesh | null = null;

    /** Geometry source shared by every instance. @internal */
    private _mesh: Mesh | null = null;

    /** Number of active (rendered) instances. @internal */
    private _count: number = 0;

    /** Allocated instance slots (>= {@link _count}). @internal */
    private _capacity: number = 0;

    /** Whether any per-instance color has been assigned. @internal */
    private _hasColors: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "InstancedMeshRenderer";
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The mesh shared by every instance.
     *
     * Setting this (re)assigns the instanced geometry and updates local bounds.
     * All instances render this same geometry.
     */
    public get mesh(): Mesh | null {
        return this._mesh;
    }

    public set mesh(value: Mesh | null) {
        this._mesh = value;

        if (value !== null) {
            this._localBounds.copy(value.bounds);
            if (this._threeInstanced !== null) {
                this._threeInstanced.geometry = value._internalGeometry;
            } else if (this._count > 0) {
                this._rebuild(this._count);
            }
        }
    }

    /**
     * The number of active instances rendered.
     *
     * Growing this beyond the current {@link capacity} reallocates the batch
     * (existing instance transforms/colors are preserved). Newly exposed
     * instances start at the identity transform until assigned.
     */
    public get count(): number {
        return this._count;
    }

    public set count(value: number) {
        const n = Math.max(0, Math.floor(value));
        this._count = n;

        if (n > this._capacity && this._mesh !== null) {
            this._rebuild(n);
        } else if (this._threeInstanced !== null) {
            this._threeInstanced.count = n;
        }
    }

    /** The number of allocated instance slots (always >= {@link count}). */
    public get capacity(): number {
        return this._capacity;
    }

    // ==================== PUBLIC INSTANCE API ====================

    /**
     * Sets the transform of a single instance from position, rotation, and scale.
     *
     * If `index` is at or beyond the current {@link count}, the count is grown
     * to include it (reallocating capacity if needed).
     *
     * @param index — zero-based instance index.
     * @param position — instance position (in this GameObject's local space).
     * @param rotation — instance rotation.
     * @param scale — instance scale.
     */
    public setInstanceTransform(
        index: number,
        position: Vector3,
        rotation: Quaternion,
        scale: Vector3,
    ): void {
        Matrix4x4.TRS(position, rotation, scale, _tmpMat);
        this.setInstanceMatrix(index, _tmpMat);
    }

    /**
     * Sets the full transform matrix of a single instance.
     *
     * @param index — zero-based instance index.
     * @param matrix — the instance's local transform matrix.
     */
    public setInstanceMatrix(index: number, matrix: Matrix4x4): void {
        if (index < 0) return;
        this._ensureInstance(index);
        if (this._threeInstanced === null) return;

        _tmp4.fromArray(matrix.elements as unknown as number[]);
        this._threeInstanced.setMatrixAt(index, _tmp4);
        this._threeInstanced.instanceMatrix.needsUpdate = true;
    }

    /**
     * Reads back the transform matrix of a single instance.
     *
     * @param index — zero-based instance index.
     * @param out — optional matrix to write into (avoids allocation).
     * @returns the instance matrix (identity if the batch is not built).
     */
    public getInstanceMatrix(index: number, out?: Matrix4x4): Matrix4x4 {
        const result = out ?? new Matrix4x4();
        if (this._threeInstanced === null || index < 0 || index >= this._capacity) {
            return result;
        }
        this._threeInstanced.getMatrixAt(index, _tmp4);
        result._copyFromThree(_tmp4);
        return result;
    }

    /**
     * Sets a per-instance tint color.
     *
     * The color modulates the material's base color for this instance only.
     * The first call allocates the per-instance color buffer.
     *
     * **Alpha is ignored.** The per-instance buffer is RGB, so transparency has
     * to come from the shared material; passing a `Color` with `a < 1` changes
     * nothing about how the instance is blended.
     *
     * @param index — zero-based instance index.
     * @param color — the instance color.
     */
    public setInstanceColor(index: number, color: Color): void {
        if (index < 0) return;
        this._ensureInstance(index);
        if (this._threeInstanced === null) return;

        _tmpColor.setRGB(color.r, color.g, color.b);
        this._threeInstanced.setColorAt(index, _tmpColor);
        this._hasColors = true;
        if (this._threeInstanced.instanceColor !== null) {
            this._threeInstanced.instanceColor.needsUpdate = true;
        }
    }

    /**
     * Flushes pending per-instance matrix/color changes to the GPU.
     *
     * Individual setters already flag their buffers for upload, so calling this
     * is only needed if you mutate instance data through other means. It is a
     * cheap no-op when nothing changed.
     */
    public apply(): void {
        if (this._threeInstanced === null) return;
        this._threeInstanced.instanceMatrix.needsUpdate = true;
        if (this._threeInstanced.instanceColor !== null) {
            this._threeInstanced.instanceColor.needsUpdate = true;
        }
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Cleanup: disposes the instanced buffers (owned by the InstancedMesh, not
     * the shared Mesh asset), then delegates to the Renderer base for material
     * cleanup and scene-graph detachment.
     */
    protected override onDestroy(): void {
        if (this._threeInstanced !== null) {
            // Disposes instanceMatrix / instanceColor buffers; geometry and
            // material are shared assets and are NOT disposed here.
            this._threeInstanced.dispose();
            this._threeInstanced = null;
        }
        this._mesh = null;
        super.onDestroy();
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * @internal
     * Ensures the batch exists and has capacity for `index`, growing (by
     * doubling) if necessary, and that `count` includes the index.
     */
    private _ensureInstance(index: number): void {
        if (this._mesh === null) return;

        if (index >= this._count) {
            this._count = index + 1;
        }
        if (this._threeInstanced === null || this._count > this._capacity) {
            this._rebuild(this._count);
        } else {
            this._threeInstanced.count = this._count;
        }
    }

    /**
     * @internal
     * (Re)creates the internal InstancedMesh with capacity for at least
     * `required` instances, preserving existing instance matrices and colors,
     * and registers it with the Transform via the Renderer base.
     */
    private _rebuild(required: number): void {
        if (this._mesh === null) return;

        const newCapacity = Math.max(required, this._capacity === 0 ? required : this._capacity * 2);
        const geometry = this._mesh._internalGeometry;
        const material = this._getActiveMaterial()?._internalThreeMaterial
            ?? InstancedMeshRenderer._defaultMaterial;

        const next = new THREE.InstancedMesh(geometry, material, newCapacity);
        next.frustumCulled = false;
        next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        next.count = this._count;

        const prev = this._threeInstanced;
        if (prev !== null) {
            // Carry over existing per-instance matrices (and colors, if any).
            const carry = Math.min(this._capacity, newCapacity);
            for (let i = 0; i < carry; i++) {
                prev.getMatrixAt(i, _tmp4);
                next.setMatrixAt(i, _tmp4);
            }
            next.instanceMatrix.needsUpdate = true;

            if (this._hasColors && prev.instanceColor !== null) {
                for (let i = 0; i < carry; i++) {
                    prev.getColorAt(i, _tmpColor);
                    next.setColorAt(i, _tmpColor);
                }
                if (next.instanceColor !== null) next.instanceColor.needsUpdate = true;
            }

            prev.dispose();
        }

        this._threeInstanced = next;
        this._capacity = newCapacity;

        // Attach to the Transform's scene graph and sync shadow/visibility.
        this._setInternalRenderObject(next);
    }

    // ==================== STATIC ====================

    /**
     * Fallback material used until a material is assigned.
     * @internal
     */
    private static _defaultMaterial: THREE.Material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
    });
}
