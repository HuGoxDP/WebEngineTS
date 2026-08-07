import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Behaviour } from "../core/Behaviour";
import { Physics } from "./Physics";
import { Rigidbody } from "./Rigidbody";
import { PhysicsWorld } from "./PhysicsWorld";
import type { PhysicMaterial } from "./PhysicMaterial";
import { Serializable, SerializedField } from "../core/reflection/Decorators";
import { FieldType } from "../core/reflection/Types";
import type { GameObject } from "../core/GameObject";
import { Vector3 } from "../core/math/Vector3";

/**
 * Base class for all collider components.
 *
 * @remarks
 * Equivalent to Unity's `Collider`.
 * A collider defines the shape used for physics collision detection.
 * If the GameObject also has a {@link Rigidbody}, the collider shape is
 * added to that body. Otherwise, a static body is created automatically.
 */
export abstract class Collider extends Behaviour {
    private _isTrigger: boolean = false;
    private _material: PhysicMaterial | null = null;

    /**
     * @internal
     * The cannon-es shape for this collider.
     * Created by subclasses in their `onAwake` override.
     */
    protected _cannonShape: CANNON.Shape | null = null;

    /**
     * @internal
     * If no Rigidbody is on the same GameObject, the collider creates
     * its own static body. This reference holds that implicit body.
     */
    private _implicitBody: CANNON.Body | null = null;

    /**
     * @internal
     * The Three.js invisible mesh used for visual-layer raycasting.
     * Created by subclasses.
     */
    protected _threeMesh: THREE.Mesh | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== PROPERTIES ====================

    /**
     * When enabled, this collider acts as a trigger and does not participate
     * in physical collisions. Trigger events are sent instead of collision events.
     */
    @SerializedField()
    public get isTrigger(): boolean { return this._isTrigger; }
    public set isTrigger(value: boolean) {
        this._isTrigger = value;
        if (this._cannonShape) {
            this._cannonShape.collisionResponse = !value;
        }
    }

    /** The physics material applied to this collider. */
    public get sharedMaterial(): PhysicMaterial | null { return this._material; }
    public set sharedMaterial(value: PhysicMaterial | null) {
        this._material = value;
        if (this._cannonShape) {
            this._cannonShape.material = value ? value._cannonMaterial : null;
        }
    }

    // ==================== ABSTRACT ====================

    /** @internal Returns the Three.js mesh used for visual-layer raycasting. */
    public abstract _getPhysicsShape(): THREE.Object3D;

    /** @internal Creates the cannon-es shape. Called during onAwake. */
    protected abstract _createCannonShape(): CANNON.Shape;

    /** @internal Updates the cannon-es shape when center/size changes. */
    protected abstract _updateShapeTransform(): void;

    // ==================== LIFECYCLE ====================

    protected override onEnable(): void {
        Physics._registerCollider(this);
        this._attachShape();
    }

    protected override onDisable(): void {
        Physics._unregisterCollider(this);
        this._detachShape();
    }

    protected override onDestroy(): void {
        Physics._unregisterCollider(this);
        this._detachShape();
    }

    // ==================== INTERNAL ====================

    /** @internal Returns the cannon-es body this collider is attached to. */
    public _getBody(): CANNON.Body | null {
        const rb = this.gameObject.getComponent(Rigidbody);
        return rb ? rb._body : this._implicitBody;
    }

    /**
     * @internal
     * Attaches the cannon-es shape to either the sibling Rigidbody's body
     * or an implicit static body.
     */
    private _attachShape(): void {
        if (!this._cannonShape) {
            this._cannonShape = this._createCannonShape();
            this._cannonShape.collisionResponse = !this._isTrigger;
            if (this._material) {
                this._cannonShape.material = this._material._cannonMaterial;
            }
        }

        const rb = this.gameObject.getComponent(Rigidbody);
        if (rb) {
            rb._body.addShape(this._cannonShape);
        } else {
            // Create an implicit static body
            this._implicitBody = new CANNON.Body({
                mass: 0,
                type: CANNON.Body.STATIC,
            });
            this._implicitBody.userData = { collider: this };

            const pos = this.transform.position;
            const rot = this.transform.rotation;
            this._implicitBody.position.set(pos.x, pos.y, pos.z);
            this._implicitBody.quaternion.set(rot.x, rot.y, rot.z, rot.w);

            this._implicitBody.addShape(this._cannonShape);
            PhysicsWorld.instance.world.addBody(this._implicitBody);
        }
    }

    private _detachShape(): void {
        if (this._implicitBody) {
            PhysicsWorld.instance.world.removeBody(this._implicitBody);
            this._implicitBody = null;
        }

        if (this._cannonShape) {
            const rb = this.gameObject.getComponent(Rigidbody);
            if (rb) {
                const idx = rb._body.shapes.indexOf(this._cannonShape);
                if (idx >= 0) {
                    rb._body.removeShape(this._cannonShape);
                }
            }
            this._cannonShape = null;
        }
    }
}
