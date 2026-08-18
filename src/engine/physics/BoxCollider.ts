import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Collider } from "./Collider";
import { Vector3 } from "../core/math/Vector3";
import { Serializable, SerializedField } from "../core/reflection/Decorators";
import { FieldType } from "../core/reflection/Types";
import type { GameObject } from "../core/GameObject";

/**
 * A box-shaped collider.
 *
 * @remarks
 * Equivalent to Unity's `BoxCollider`.
 * The box is axis-aligned in local space, centered at {@link center}
 * with half-extents defined by {@link size}.
 */
@Serializable({ typeName: "BoxCollider", category: "Physics" })
export class BoxCollider extends Collider {
    private _center: Vector3 = new Vector3(0, 0, 0);
    private _size: Vector3 = new Vector3(1, 1, 1);

    /** @internal Invisible mesh for Three.js raycasting */
    private _shape: THREE.Mesh;

    constructor(gameObject: GameObject) {
        super(gameObject);

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ visible: false });

        this._shape = new THREE.Mesh(geometry, material);
        this._shape.userData = { collider: this };

        this.transform._internalObject3D.add(this._shape);
    }

    /** Local-space center of the box. */
    @SerializedField({ type: FieldType.Vector3 })
    public get center(): Vector3 { return this._center; }
    public set center(value: Vector3) {
        this._center.copy(value);
        this._shape.position.set(value.x, value.y, value.z);
        this._updateShapeTransform();
        // The Three.js proxy above is what raycasts hit; this is what the
        // simulation collides with. Both, or they disagree.
        this._syncShapeOffset();
    }

    /** Size of the box in local space (full extents, not half-extents). */
    @SerializedField({ type: FieldType.Vector3 })
    public get size(): Vector3 { return this._size; }
    public set size(value: Vector3) {
        this._size.copy(value);
        this._shape.scale.set(value.x, value.y, value.z);
        this._updateShapeTransform();
    }

    /** @internal The offset cannon adds the shape at — see {@link Collider._shapeCenter}. */
    protected override _shapeCenter(): Vector3 {
        return new Vector3(this._center.x, this._center.y, this._center.z);
    }

    /** @internal */
    public _getPhysicsShape(): THREE.Object3D {
        return this._shape;
    }

    /** @internal */
    public override _sqrDistanceToPoint(point: Vector3): number {
        // In the box's own frame the test is a clamp: the nearest point on the
        // box to `point` is `point` with each axis pulled inside the extents,
        // and what is left over is the distance. Rotation is handled by being
        // in local space at all, which is why this is exact for an oriented box
        // rather than an approximation by its AABB.
        const local = this._toLocalPoint(point, BoxCollider._tmp);
        const dx = Math.abs(local.x - this._center.x) - this._size.x / 2;
        const dy = Math.abs(local.y - this._center.y) - this._size.y / 2;
        const dz = Math.abs(local.z - this._center.z) - this._size.z / 2;

        const ox = dx > 0 ? dx : 0;
        const oy = dy > 0 ? dy : 0;
        const oz = dz > 0 ? dz : 0;
        return ox * ox + oy * oy + oz * oz;
    }

    /** Scratch for {@link _sqrDistanceToPoint}. */
    private static readonly _tmp = new Vector3();

    /** @internal */
    protected _createCannonShape(): CANNON.Shape {
        return new CANNON.Box(
            new CANNON.Vec3(this._size.x / 2, this._size.y / 2, this._size.z / 2)
        );
    }

    /** @internal */
    protected _updateShapeTransform(): void {
        if (this._cannonShape && this._cannonShape instanceof CANNON.Box) {
            this._cannonShape.halfExtents.set(
                this._size.x / 2, this._size.y / 2, this._size.z / 2
            );
            this._cannonShape.updateConvexPolyhedronRepresentation();
        }
    }
}
