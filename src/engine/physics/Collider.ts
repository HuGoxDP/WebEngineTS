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
        if (value) {
            // Without a registered pairing the solver ignores this material
            // entirely and uses the world default instead.
            PhysicsWorld.instance._registerMaterial(value);
        }
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

    /**
     * @internal
     * Squared distance from a world-space point to this collider's surface,
     * or `0` when the point is inside it.
     *
     * @remarks
     * The primitive every shape query is built from: a sphere overlaps a
     * collider exactly when this is at most the sphere's radius squared. Each
     * shape answers for itself, so adding a collider type means implementing
     * one method rather than extending a switch in `Physics`.
     *
     * Squared, because every caller compares against a squared radius and the
     * square root would be thrown away.
     *
     * **Scale is ignored**, deliberately: the cannon shapes are built from the
     * collider's own `size`/`radius` and take no notice of the Transform's
     * scale either. A query that disagreed with the simulation would be worse
     * than one that shares its limitation.
     */
    public abstract _sqrDistanceToPoint(point: Vector3): number;

    /** Reused conjugate rotation — see {@link _toLocalPoint}. */
    private static readonly _invRot = { x: 0, y: 0, z: 0, w: 1 };

    /**
     * Brings a world-space point into this collider's local space.
     *
     * @param point - the world-space point.
     * @param out - destination, to keep the query allocation-free.
     * @returns `out`.
     */
    protected _toLocalPoint(point: Vector3, out: Vector3): Vector3 {
        const t = this.transform;
        const p = t.position;
        const q = t.rotation;

        const inv = Collider._invRot;
        inv.x = -q.x; inv.y = -q.y; inv.z = -q.z; inv.w = q.w;

        out.set(point.x - p.x, point.y - p.y, point.z - p.z);
        return out.applyQuaternion(inv);
    }

    /**
     * @internal
     * This collider's local offset from the GameObject's origin.
     *
     * @remarks
     * Subclasses with a `center` override this; the base is the origin. It
     * exists so the offset reaches **cannon**: a shape is added to a body with
     * a per-shape offset, and without one a `center` moved only the Three.js
     * proxy that raycasts hit — the ray and the simulation then disagreed about
     * where the collider was.
     *
     * Returns a fresh vector: handing out the field would let a caller move the
     * collider by writing to something that only looks like a copy.
     */
    protected _shapeCenter(): Vector3 {
        return new Vector3(0, 0, 0);
    }

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
                PhysicsWorld.instance._registerMaterial(this._material);
                this._cannonShape.material = this._material._cannonMaterial;
            }
        }

        const center = this._shapeCenter();
        const offset = new CANNON.Vec3(center.x, center.y, center.z);

        const rb = this.gameObject.getComponent(Rigidbody);
        if (rb) {
            rb._body.addShape(this._cannonShape, offset);
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

            this._implicitBody.addShape(this._cannonShape, offset);
            this._applyLayerFilter();
            PhysicsWorld.instance.world.addBody(this._implicitBody);
        }
    }

    /**
     * @internal
     * Re-applies {@link _shapeCenter} to the body already holding this shape.
     *
     * @remarks
     * A subclass calls this when its `center` changes. The offset is stored on
     * the *body*, alongside the shape, so it cannot be updated through the shape
     * — and the derived quantities that depend on it (bounding radius, inertia)
     * have to be recomputed, exactly as `addShape` does.
     */
    protected _syncShapeOffset(): void {
        const body = this._getBody();
        if (!body || !this._cannonShape) return;

        const index = body.shapes.indexOf(this._cannonShape);
        if (index < 0) return;

        const center = this._shapeCenter();
        body.shapeOffsets[index].set(center.x, center.y, center.z);
        body.updateBoundingRadius();
        body.updateMassProperties();
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
