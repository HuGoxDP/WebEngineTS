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
    /**
     * The mesh this filter holds. One slot: after the first read of
     * {@link mesh} it holds the instance, and `sharedMesh` is its alias.
     */
    private _sharedMesh: Mesh | null = null;

    /** Whether this filter's {@link mesh} getter made {@link _sharedMesh}. */
    private _ownsShared = false;

    /**
     * The instance this filter owns, or null. Derived from the one slot;
     * kept as a member because tests probe it.
     */
    private get _meshInstance(): Mesh | null {
        return this._ownsShared ? this._sharedMesh : null;
    }

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
     * Unity: "Once `mesh` property is queried, link to the original shared
     * mesh is lost and MeshFilter.sharedMesh property becomes an alias to
     * `mesh`." So after the first read of {@link mesh} this returns the
     * instance — batching, saving and Instantiate all see the edit.
     *
     * **Setting** to this filter's own instance (`filter.sharedMesh = filter.mesh`)
     * takes the mesh over: the filter stops owning it and the engine never
     * auto-destroys it. A swap to a different mesh or to `null` releases the
     * held mesh; an instance this filter's getter made is destroyed once no
     * MeshFilter uses it any more.
     */
    @SerializedField({ type: FieldType.Mesh })
    public get sharedMesh(): Mesh | null {
        return this._sharedMesh;
    }

    public set sharedMesh(value: Mesh | null) {
        if (value !== null && value === this._sharedMesh && this._ownsShared) {
            // Disown (M0.2hr1): the user takes the instance over — the engine
            // never auto-destroys an assigned mesh. The renderer needs no change.
            this._ownsShared = false;
            value._autoDestroy = false;
            this._notifyRenderer();
            return;
        }
        this._store(value, false);
    }

    /**
     * A mesh this filter owns and may edit.
     * The first read clones the held mesh and stores the clone as the shared
     * mesh — Unity: "Once `mesh` property is queried, link to the original
     * shared mesh is lost and MeshFilter.sharedMesh property becomes an alias
     * to `mesh`." Changes to the instance affect no other object; every reader
     * of {@link sharedMesh} (renderer, batching, save, Instantiate) sees it.
     *
     * The engine frees the instance once no MeshFilter uses it any more —
     * unless it was taken over by `filter.sharedMesh = filter.mesh`.
     *
     * **Setting** stores the reference itself, like Unity's `MeshFilter.mesh`:
     * the mesh becomes the shared mesh, drawn as-is; instancing happens on the
     * first *read*. Assigning the held mesh back (`filter.mesh = filter.mesh`,
     * the Unity edit idiom) changes nothing — ownership stays as it is.
     * Replacing it with a different mesh or with `null` releases the held mesh.
     */
    public get mesh(): Mesh | null {
        // Already owns an instance.
        if (this._ownsShared) {
            return this._sharedMesh;
        }

        // A shared mesh to clone from: the clone becomes the shared mesh.
        if (this._sharedMesh) {
            const c = this._sharedMesh.clone();
            c._autoDestroy = true;
            this._store(c, true);
            return c;
        }

        // Nothing to return.
        return null;
    }

    public set mesh(value: Mesh | null) {
        if (value === this._sharedMesh) {
            // Self-assign (the Unity edit idiom): no change, ownership stays.
            return;
        }
        // Unity's setter stores the reference itself; instancing happens on the
        // first *read* through the getter, not here.
        this._store(value, false);
    }

    // === Methods ===

    /**
     * Whether this filter has a mesh at all.
     */
    public hasMesh(): boolean {
        return this._sharedMesh !== null;
    }

    /**
     * The mesh a renderer should draw: the one slot — the instance once the
     * getter ran, otherwise the shared mesh.
     * @internal
     */
    public _effectiveMesh(): Mesh | null {
        return this._sharedMesh;
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
     * Stores the mesh this filter holds, with the retain/release bookkeeping:
     * the new mesh gains a use, the dropped one loses one, and a getter-made
     * instance whose last use just ended is destroyed. Notifies the renderer
     * once.
     */
    private _store(value: Mesh | null, owned: boolean): void {
        if (value !== this._sharedMesh) {
            value?._retainByFilter();
            const old = this._sharedMesh;
            if (old !== null && old._releaseByFilter()) {
                old.destroy();
            }
        }
        this._sharedMesh = value;
        this._ownsShared = owned;
        this._notifyRenderer();
    }

    // === Lifecycle ===

    protected override onDestroy(): void {
        // Release the held mesh; a getter-made instance dies here only if this
        // was its last use. _store notifies: the renderer still sees this
        // filter, but it holds no mesh.
        this._store(null, false);
        super.onDestroy();
    }
}
