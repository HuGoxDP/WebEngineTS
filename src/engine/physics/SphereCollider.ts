import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Collider } from "./Collider";
import { Vector3 } from "../core/math/Vector3";
import { Serializable, SerializedField } from "../core/reflection/Decorators";
import { FieldType } from "../core/reflection/Types";
import type { GameObject } from "../core/GameObject";

/**
 * A sphere-shaped collider.
 *
 * @remarks
 * Equivalent to Unity's `SphereCollider`.
 */
@Serializable({ typeName: "SphereCollider", category: "Physics" })
export class SphereCollider extends Collider {
    private _center: Vector3 = new Vector3(0, 0, 0);
    private _radius: number = 0.5;

    /** @internal Invisible mesh for Three.js raycasting */
    private _shape: THREE.Mesh;

    constructor(gameObject: GameObject) {
        super(gameObject);

        const geometry = new THREE.SphereGeometry(0.5, 16, 12);
        const material = new THREE.MeshBasicMaterial({ visible: false });

        this._shape = new THREE.Mesh(geometry, material);
        this._shape.userData = { collider: this };

        this.transform._internalObject3D.add(this._shape);
    }

    /** Local-space center of the sphere. */
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

    /** Radius of the sphere in local space. */
    @SerializedField()
    public get radius(): number { return this._radius; }
    public set radius(value: number) {
        this._radius = value;
        const d = value * 2;
        this._shape.scale.set(d, d, d);
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
    protected _createCannonShape(): CANNON.Shape {
        return new CANNON.Sphere(this._radius);
    }

    /** @internal */
    protected _updateShapeTransform(): void {
        if (this._cannonShape && this._cannonShape instanceof CANNON.Sphere) {
            this._cannonShape.radius = this._radius;
            this._cannonShape.updateBoundingSphereRadius();
        }
    }
}
