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
     */
    @SerializedField({ type: FieldType.Mesh })
    public get sharedMesh(): Mesh | null {
        return this._sharedMesh;
    }

    public set sharedMesh(value: Mesh | null) {
        this._sharedMesh = value;
        
        // Drop the instance, so the next read of `mesh` clones the new shared one.
        if (this._meshInstance) {
            this._meshInstance = null;
        }
    }

    /**
     * A mesh this filter owns and may edit.
     * The first read clones {@link sharedMesh}.
     * Changes to it affect no other object.
     */
    public get mesh(): Mesh | null {
        // An instance already exists.
        if (this._meshInstance) {
            return this._meshInstance;
        }

        // No instance yet, but a shared mesh to clone from.
        if (this._sharedMesh) {
            this._meshInstance = this._sharedMesh.clone() as Mesh;
            return this._meshInstance;
        }

        // Nothing to return.
        return null;
    }

    public set mesh(value: Mesh | null) {
        if (value === null) {
            this._meshInstance = null;
            this._sharedMesh = null;
            return;
        }

        // Assigning through `mesh` stores an owned copy.
        this._meshInstance = value.clone() as Mesh;
        this._sharedMesh = null; // The shared mesh is no longer in play.
    }

    // === Methods ===

    /**
     * Whether this filter has a mesh at all.
     */
    public hasMesh(): boolean {
        return this._sharedMesh !== null || this._meshInstance !== null;
    }

    // === Lifecycle ===

    protected override onDestroy(): void {
        // Only the instance is ours to dispose; the shared mesh may have other users.
        if (this._meshInstance) {
            this._meshInstance.destroy();
            this._meshInstance = null;
        }
        
        this._sharedMesh = null;
        
        super.onDestroy();
    }
}
