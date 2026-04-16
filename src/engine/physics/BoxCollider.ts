import * as THREE from "three";
import { Collider } from "./Collider";
import { Vector3 } from "../core/math/Vector3";
import { GameObject } from "../core/GameObject";

export class BoxCollider extends Collider {
    private _center: Vector3 = new Vector3(0, 0, 0);
    private _size: Vector3 = new Vector3(1, 1, 1);

    /** @internal Invisible mesh for physics raycasting */
    private _shape: THREE.Mesh;

    constructor(gameObject: GameObject) {
        super(gameObject);

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ visible: false });

        this._shape = new THREE.Mesh(geometry, material);
        this._shape.userData = { collider: this };

        this.transform._internalObject3D.add(this._shape);
    }

    public get center(): Vector3 { return this._center; }
    public set center(value: Vector3) {
        this._center.copy(value);
        this._shape.position.set(value.x, value.y, value.z);
    }

    public get size(): Vector3 { return this._size; }
    public set size(value: Vector3) {
        this._size.copy(value);
        this._shape.scale.set(value.x, value.y, value.z);
    }

    /** @internal */
    public _getPhysicsShape(): THREE.Object3D {
        return this._shape;
    }
}
