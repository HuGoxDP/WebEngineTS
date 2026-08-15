import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Collider } from "./Collider";
import { Vector3 } from "../core/math/Vector3";
import { Serializable, SerializedField } from "../core/reflection/Decorators";
import { FieldType } from "../core/reflection/Types";
import type { GameObject } from "../core/GameObject";

/**
 * A capsule-shaped collider (cylinder with hemisphere caps).
 *
 * @remarks
 * Equivalent to Unity's `CapsuleCollider`.
 * The capsule is oriented along the Y axis by default.
 */
@Serializable({ typeName: "CapsuleCollider", category: "Physics" })
export class CapsuleCollider extends Collider {
    private _center: Vector3 = new Vector3(0, 0, 0);
    private _radius: number = 0.5;
    private _height: number = 2;

    /** @internal Invisible mesh for Three.js raycasting */
    private _shape: THREE.Mesh;

    constructor(gameObject: GameObject) {
        super(gameObject);

        const geometry = new THREE.CapsuleGeometry(0.5, 1, 8, 12);
        const material = new THREE.MeshBasicMaterial({ visible: false });

        this._shape = new THREE.Mesh(geometry, material);
        this._shape.userData = { collider: this };

        this.transform._internalObject3D.add(this._shape);
    }

    /** Local-space center of the capsule. */
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

    /** Radius of the capsule's hemisphere caps. */
    @SerializedField()
    public get radius(): number { return this._radius; }
    public set radius(value: number) {
        this._radius = value;
        this._rebuildThreeMesh();
        this._updateShapeTransform();
    }

    /**
     * Total height of the capsule (including caps).
     * Must be >= 2 * radius; clamped if smaller.
     */
    @SerializedField()
    public get height(): number { return this._height; }
    public set height(value: number) {
        this._height = Math.max(value, this._radius * 2);
        this._rebuildThreeMesh();
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
        // cannon-es Cylinder approximation for capsule:
        // Use a cylinder for the middle + compound shape with spheres on ends.
        // For simplicity, use a Cylinder with the correct dimensions.
        const cylinderHeight = this._height - this._radius * 2;
        return new CANNON.Cylinder(
            this._radius, this._radius,
            Math.max(cylinderHeight, 0.001) + this._radius * 2,
            12
        );
    }

    /** @internal */
    protected _updateShapeTransform(): void {
        if (this._cannonShape && this._cannonShape instanceof CANNON.Cylinder) {
            const body = this._getBody();
            if (body) {
                const idx = body.shapes.indexOf(this._cannonShape);
                if (idx >= 0) {
                    body.removeShape(this._cannonShape);
                }
                this._cannonShape = this._createCannonShape();
                body.addShape(this._cannonShape);
            }
        }
    }

    private _rebuildThreeMesh(): void {
        const cylinderHeight = Math.max(this._height - this._radius * 2, 0);
        this._shape.geometry.dispose();
        this._shape.geometry = new THREE.CapsuleGeometry(this._radius, cylinderHeight, 8, 12);
    }
}
