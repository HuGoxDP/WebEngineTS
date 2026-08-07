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
    }

    /** Size of the box in local space (full extents, not half-extents). */
    @SerializedField({ type: FieldType.Vector3 })
    public get size(): Vector3 { return this._size; }
    public set size(value: Vector3) {
        this._size.copy(value);
        this._shape.scale.set(value.x, value.y, value.z);
        this._updateShapeTransform();
    }

    /** @internal */
    public _getPhysicsShape(): THREE.Object3D {
        return this._shape;
    }

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
