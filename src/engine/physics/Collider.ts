import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Behaviour } from "../core/Behaviour";
import { Physics } from "./Physics";
import { Rigidbody } from "./Rigidbody";
import { PhysicsWorld } from "./PhysicsWorld";
import { LayerCollisionMatrix } from "./LayerCollisionMatrix";
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
     * Moves this collider's shape onto whichever body now owns it.
     *
     * @remarks
     * Called when a {@link Rigidbody} appears on a GameObject that already had
     * colliders: each one drops the static body it made for itself and joins
     * the new dynamic one.
     */
    public _reattach(): void {
        if (!this.isActiveAndEnabled) return;
        this._detachShape();
        this._attachShape();
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
            this._applyLayerFilter();
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
            this._applyLayerFilter();
            PhysicsWorld.instance.world.addBody(this._implicitBody);
        }
    }

    /**
     * @internal
     * Writes this collider's layer into its body's broad-phase filter.
     *
     * @remarks
     * The body's *group* is the bit for its own layer; its *mask* is the set of
     * layers that layer collides with. cannon-es then rejects a pair before
     * building a contact for it, which is the point of a layer matrix — an
     * ignored pair should cost nothing, not cost a discarded contact.
     *
     * A collider sharing a Rigidbody writes onto that shared body: several
     * colliders on one object are one physical body, so the last one to attach
     * decides. Unity has the same limitation, for the same reason.
     */
    public _applyLayerFilter(): void {
        const body = this._implicitBody
            ?? this.gameObject.getComponent(Rigidbody)?._body
            ?? null;
        if (!body) return;

        const layer = this.gameObject.layer;
        body.collisionFilterGroup = 1 << layer;
        body.collisionFilterMask = LayerCollisionMatrix.maskFor(layer);
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

// Colliders that already exist when a Rigidbody is enabled move onto its body.
// Installed from here because this module already imports Rigidbody; the
// reverse import would make the two circular.
Rigidbody._onEnabled = (gameObject) => {
    // Collider is abstract and getComponents wants a constructible type; it
    // only ever uses it for an instanceof check, so the cast is safe.
    const colliderType = Collider as unknown as new (...args: never[]) => Collider;
    for (const collider of gameObject.getComponents(colliderType)) {
        collider._reattach();
    }
};
