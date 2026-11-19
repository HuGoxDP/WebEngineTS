import { Component } from "../Component.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Holds the mesh a GameObject renders.
 * Mirrors Unity's `MeshFilter`.
 * 
 * MeshFilter carries the geometry; `MeshRenderer` draws it.
 */
@Serializable({ typeName: "MeshFilter", category: "Rendering" })
export class MeshFilter extends Component {
    /** The shared mesh — a reference, never copied. */
    private _sharedMesh: Mesh | null = null;

    /** This filter's own copy, made on the first write through {@link mesh}. */
    private _meshInstance: Mesh | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "MeshFilter";
    }

    // === Properties ===

    /**
     * The shared mesh.
     * Do not modify it in place: every object using it sees the change.
     * Use {@link mesh} to edit, which clones first.
     *
     * **Setting** to this filter's own instance (`filter.sharedMesh = filter.mesh`)
     * keeps the mesh alive — the filter stops owning it instead of destroying it.
     * A swap to a different mesh or to `null` still destroys the owned instance.
     */
    @SerializedField({ type: FieldType.Mesh })
    public get sharedMesh(): Mesh | null {
        return this._sharedMesh;
    }

    public set sharedMesh(value: Mesh | null) {
        if (value !== null && value === this._meshInstance) {
            // Self-assign: the filter stops owning the instance instead of
            // destroying it — Unity never auto-destroys an assigned mesh.
            this._sharedMesh = value;
            this._meshInstance = null;
        } else {
            this._destroyInstance();
            this._sharedMesh = value;
        }
        this._notifyRenderer();
    }

    /**
     * A mesh this filter owns and may edit.
     * The first read clones {@link sharedMesh}.
     * Changes to it affect no other object.
     *
     * **Setting** stores the reference itself, like Unity's `MeshFilter.mesh`:
     * the mesh becomes the shared mesh, drawn as-is; instancing happens on the
     * first *read*. Assigning the instance back (`filter.mesh = filter.mesh`,
     * the Unity edit idiom) keeps it — no re-clone, nothing destroyed. Replacing
     * it with a different mesh or with `null` destroys the instance this filter
     * owned.
     */
    public get mesh(): Mesh | null {
        // An instance already exists.
        if (this._meshInstance) {
            return this._meshInstance;
        }

        // No instance yet, but a shared mesh to clone from.
        if (this._sharedMesh) {
            this._meshInstance = this._sharedMesh.clone() as Mesh;
            // The renderer must now draw the instance instead of the shared mesh.
            this._notifyRenderer();
            return this._meshInstance;
        }

        // Nothing to return.
        return null;
    }

    public set mesh(value: Mesh | null) {
        if (value !== null && value === this._meshInstance) {
            // Self-assign (the Unity edit idiom): keep the instance; the getter
            // already returns it, no re-clone, nothing to destroy.
        } else {
            this._destroyInstance();
            // Unity's setter stores the reference itself; instancing happens on the
            // first *read* through the getter, not here.
            this._sharedMesh = value;
        }
        this._notifyRenderer();
    }

    // === Methods ===

    /**
     * Whether this filter has a mesh at all.
     */
    public hasMesh(): boolean {
        return this._sharedMesh !== null || this._meshInstance !== null;
    }

    /**
     * The mesh a renderer should draw: the instance once one exists, otherwise
     * the shared mesh.
     * @internal
     */
    public _effectiveMesh(): Mesh | null {
        return this._meshInstance ?? this._sharedMesh;
    }

    /**
     * @internal
     * Finds the renderer to notify when the held mesh changes. Installed by
     * the MeshRenderer module at load (the hook convention for would-be
     * circular imports); null while that module has not been evaluated.
     */
    public static _findRenderer: ((filter: MeshFilter) => { updateMesh(): void } | null) | null = null;

    /**
     * @internal
     * Pushes a geometry re-sync to the sibling renderer, if one exists.
     */
    private _notifyRenderer(): void {
        MeshFilter._findRenderer?.(this)?.updateMesh();
    }

    /**
     * @internal
     * Destroys the instance this filter owns. The shared mesh may have other
     * users and is never destroyed here.
     */
    private _destroyInstance(): void {
        if (this._meshInstance === null) return;
        this._meshInstance.destroy();
        this._meshInstance = null;
    }

    // === Lifecycle ===

    protected override onDestroy(): void {
        // Only the instance is ours to dispose; the shared mesh may have other users.
        this._destroyInstance();
        this._sharedMesh = null;
        // Undraw now: the renderer still sees this filter, but it holds no mesh.
        this._notifyRenderer();
        super.onDestroy();
    }
}
