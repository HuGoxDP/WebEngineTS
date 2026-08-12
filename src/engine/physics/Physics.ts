import * as THREE from "three";
import * as CANNON from "cannon-es";
import { profilerHooks } from "../core/diagnostics/ProfilerHooks";
import { LayerCollisionMatrix } from "./LayerCollisionMatrix";
import { Ray } from "../core/math/Ray";
import { Vector3 } from "../core/math/Vector3";
import { RaycastHit } from "./RaycastHit";
import { Collider } from "./Collider";
import { PhysicsWorld } from "./PhysicsWorld";
import { Collision, ContactPoint } from "./Collision";
import { ScriptableBehaviour } from "../core/ScriptableBehaviour";

/** Two colliders touching this step, and every contact point between them. */
interface ColliderPair {
    a: Collider;
    b: Collider;
    contacts: ContactPoint[];
    relativeVelocity: Vector3;
}

/**
 * Global physics interface providing raycasting, gravity control,
 * and overlap queries.
 *
 * @remarks
 * Equivalent to Unity's `Physics` static class.
 */
export class Physics {
    private static _raycaster = new THREE.Raycaster();
    private static _colliders: Collider[] = [];

    // Collision tracking for Enter/Stay/Exit events
    private static _activeCollisions = new Map<string, { a: Collider; b: Collider }>();

    /** This step's touching pairs, rebuilt in place so stepping allocates no map. */
    private static _framePairs = new Map<string, ColliderPair>();

    // ==================== GRAVITY ====================

    /** Global gravity vector (default: (0, -9.81, 0)). */
    public static get gravity(): Vector3 {
        return PhysicsWorld.instance.gravity;
    }

    public static set gravity(value: Vector3) {
        PhysicsWorld.instance.gravity = value;
    }

    // ==================== DEFAULT SURFACE ====================

    /**
     * Friction used where a contact involves a collider with no
     * {@link PhysicMaterial}. Defaults to `0.3`.
     *
     * @remarks
     * A collider carrying a material gets the pairing of the two materials in
     * contact; one without has nothing to pair, so it lands here. Set this to
     * give a scene a house surface rather than assigning the same material to
     * everything.
     */
    public static get defaultFriction(): number {
        return PhysicsWorld.instance.defaultFriction;
    }

    public static set defaultFriction(value: number) {
        PhysicsWorld.instance.defaultFriction = value;
    }

    /**
     * Bounciness used where a contact involves a collider with no
     * {@link PhysicMaterial}. Defaults to `0`.
     */
    public static get defaultBounciness(): number {
        return PhysicsWorld.instance.defaultBounciness;
    }

    public static set defaultBounciness(value: number) {
        PhysicsWorld.instance.defaultBounciness = value;
    }

    // ==================== REGISTRATION ====================

    /** @internal Called by Collider on enable. */
    public static _registerCollider(col: Collider): void {
        if (this._colliders.indexOf(col) === -1) {
            this._colliders.push(col);
        }
    }

    /** @internal Called by Collider on disable/destroy. */
    public static _unregisterCollider(col: Collider): void {
        const index = this._colliders.indexOf(col);
        if (index > -1) {
            this._colliders.splice(index, 1);
        }
    }


    // ==================== SIMULATION STEP ====================

    /**
     * @internal
     * Runs one physics simulation step:
     * 1. Sync kinematic transforms → cannon bodies
     * 2. Step the cannon-es world
     * 3. Sync cannon bodies → engine transforms (dynamic only)
     * 4. Dispatch collision callbacks
     */
    public static _step(dt: number): void {
        const pw = PhysicsWorld.instance;
        const rigidbodies = pw._rigidbodies;

        // 1. Sync kinematic bodies from transform
        for (const rb of rigidbodies) {
            if (rb.isKinematic && rb.isActiveAndEnabled) {
                rb._syncTransformToBody();
            }
        }

        // 2. Step physics world
        pw.step(dt);

        // 3. Sync dynamic bodies back to transforms
        for (const rb of rigidbodies) {
            if (!rb.isKinematic && rb.isActiveAndEnabled) {
                rb._syncBodyToTransform();
            }
        }

        // 4. Process collisions
        this._processCollisions();
    }

    // ==================== COLLISION DISPATCH ====================

    private static _processCollisions(): void {
        const world = PhysicsWorld.instance.world;
        const pairs = Physics._framePairs;
        pairs.clear();

        // One cannon contact *equation* is one contact point, so a box resting
        // flat on the floor produces four for a single pair. Grouping them
        // first is what makes each pair dispatch exactly once per step, with
        // all of its contact points — before this, the second equation of a
        // pair fired Stay in the same step as Enter, and every Collision
        // carried a single point no matter how many there were.
        for (const contact of world.contacts) {
            const first = this._findColliderForBody(contact.bi);
            const second = this._findColliderForBody(contact.bj);
            if (!first || !second || first === second) continue;

            // Canonical orientation, so relativeVelocity keeps its sign from
            // one step to the next rather than flipping with contact order.
            const flip = first.getInstanceID() > second.getInstanceID();
            const colA = flip ? second : first;
            const colB = flip ? first : second;
            const bodyA = flip ? contact.bj : contact.bi;
            const bodyB = flip ? contact.bi : contact.bj;

            const key = this._pairKey(colA, colB);
            let pair = pairs.get(key);
            if (!pair) {
                pair = {
                    a: colA,
                    b: colB,
                    contacts: [],
                    relativeVelocity: new Vector3(
                        bodyA.velocity.x - bodyB.velocity.x,
                        bodyA.velocity.y - bodyB.velocity.y,
                        bodyA.velocity.z - bodyB.velocity.z,
                    ),
                };
                pairs.set(key, pair);
            }
            this._appendContact(contact, pair.contacts);
        }

        for (const [key, pair] of pairs) {
            const entering = !this._activeCollisions.has(key);
            if (entering) this._activeCollisions.set(key, { a: pair.a, b: pair.b });

            if (pair.a.isTrigger || pair.b.isTrigger) {
                const event = entering ? "onTriggerEnter" : "onTriggerStay";
                this._dispatch(pair.a, event, pair.b);
                this._dispatch(pair.b, event, pair.a);
            } else {
                const event = entering ? "onCollisionEnter" : "onCollisionStay";
                this._dispatch(pair.a, event, new Collision(pair.b, pair.relativeVelocity, pair.contacts));
                this._dispatch(pair.b, event,
                    new Collision(pair.a, Vector3.scale(pair.relativeVelocity, -1), pair.contacts));
            }
        }

        // Pairs that were touching and no longer are → Exit.
        for (const [key, pair] of this._activeCollisions) {
            if (pairs.has(key)) continue;
            this._activeCollisions.delete(key);

            if (pair.a.isTrigger || pair.b.isTrigger) {
                this._dispatch(pair.a, "onTriggerExit", pair.b);
                this._dispatch(pair.b, "onTriggerExit", pair.a);
            } else {
                // Unity reports no contact points on exit: there are none left.
                this._dispatch(pair.a, "onCollisionExit", new Collision(pair.b, Vector3.zero, []));
                this._dispatch(pair.b, "onCollisionExit", new Collision(pair.a, Vector3.zero, []));
            }
        }
    }

    /**
     * Delivers one collision event to a collider's scripts.
     *
     * @remarks
     * Not `sendMessage`: that calls every `ScriptableBehaviour` whether or not
     * it is enabled, which is right for a broadcast and wrong for a physics
     * callback — Unity does not deliver these to a disabled behaviour or an
     * inactive GameObject. A destroyed receiver is skipped too, which is what
     * makes the Exit that follows a `destroy()` safe: the *other* object still
     * hears that the collision ended.
     */
    private static _dispatch(target: Collider, event: string, argument: unknown): void {
        if (!target.exists()) return;

        const go = target.gameObject;
        if (!go.exists() || !go.activeInHierarchy) return;

        for (const script of go.getComponents(ScriptableBehaviour)) {
            if (!script.enabled) continue;
            const method = (script as unknown as Record<string, unknown>)[event];
            if (typeof method !== "function") continue;
            try {
                (method as (value: unknown) => void).call(script, argument);
            } catch (err) {
                console.error(`[Physics] ${event} on '${go.name}' threw:`, err);
            }
        }
    }

    private static _findColliderForBody(body: CANNON.Body): Collider | null {
        // Check userData for direct reference (set by Collider or Rigidbody)
        if (body.userData?.collider) return body.userData.collider as Collider;
        if (body.userData?.rigidbody) {
            // Rigidbody stores itself in userData; find first collider on the same GameObject
            const rb = body.userData.rigidbody as { gameObject: { getComponent: (type: abstract new (...args: never[]) => Collider) => Collider | null } };
            return rb.gameObject.getComponent(Collider);
        }
        return null;
    }

    private static _pairKey(a: Collider, b: Collider): string {
        const idA = a.getInstanceID();
        const idB = b.getInstanceID();
        return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
    }

    /** Appends the one contact point a cannon contact equation describes. */
    private static _appendContact(contact: CANNON.ContactEquation, out: ContactPoint[]): void {
        const p = contact.ri;
        const n = contact.ni;
        out.push(new ContactPoint(
            new Vector3(
                contact.bi.position.x + p.x,
                contact.bi.position.y + p.y,
                contact.bi.position.z + p.z,
            ),
            new Vector3(n.x, n.y, n.z),
        ));
    }

    // ==================== RAYCASTING ====================

    /**
     * Casts a ray and returns true if it hits any collider.
     * @param ray Ray origin and direction.
     * @param hitInfo Optional object to receive hit details.
     * @param maxDistance Maximum ray distance (default: Infinity).
     */
    public static raycast(ray: Ray, hitInfo?: RaycastHit, maxDistance: number = Infinity): boolean {
        // Use Three.js raycaster for visual-layer raycasting
        this._raycaster.set(
            new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
            new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize()
        );
        this._raycaster.far = maxDistance;

        const shapes: THREE.Object3D[] = [];
        for (const col of this._colliders) {
            if (col.enabled && col.gameObject.activeSelf) {
                shapes.push(col._getPhysicsShape());
            }
        }

        const intersects = this._raycaster.intersectObjects(shapes, false);

        if (intersects.length > 0) {
            const hit = intersects[0];

            if (hitInfo) {
                hitInfo.distance = hit.distance;
                hitInfo.point.set(hit.point.x, hit.point.y, hit.point.z);

                if (hit.face) {
                    hitInfo.normal.set(hit.face.normal.x, hit.face.normal.y, hit.face.normal.z);
                }

                if (hit.object.userData?.collider) {
                    const col = hit.object.userData.collider as Collider;
                    hitInfo.collider = col;
                    hitInfo.transform = col.transform;
                }
            }
            return true;
        }

        return false;
    }

    /**
     * Returns all colliders within a sphere.
     * @param position Center of the sphere in world space.
     * @param radius Radius of the sphere.
     * @returns Array of colliders overlapping the sphere.
     */
    public static overlapSphere(position: Vector3, radius: number): Collider[] {
        const results: Collider[] = [];
        const rSq = radius * radius;

        for (const col of this._colliders) {
            if (!col.enabled || !col.gameObject.activeSelf) continue;

            const colPos = col.transform.position;
            const dx = colPos.x - position.x;
            const dy = colPos.y - position.y;
            const dz = colPos.z - position.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq <= rSq) {
                results.push(col);
            }
        }

        return results;
    }

    /** @internal Clears all registrations (e.g., on scene change). */
    /**
     * @internal
     * Re-applies the layer collision matrix to every registered collider.
     * Called when the matrix changes, so an edit reaches bodies that already
     * exist rather than only new ones.
     */
    public static _refreshLayerFilters(): void {
        for (const collider of (Physics as any)._colliders as Collider[]) {
            collider._applyLayerFilter();
        }
    }

    /**
     * @internal
     * Drops every collider, every touching pair, and the world itself.
     *
     * @remarks
     * The pairs have to go with the world: left behind, they are still
     * "active", so the first step after a scene load reports Exit for
     * collisions belonging to a scene that no longer exists.
     */
    public static _reset(): void {
        this._colliders.length = 0;
        this._activeCollisions.clear();
        this._framePairs.clear();
        PhysicsWorld._reset();
    }
}

profilerHooks.colliderCount = () => (Physics as any)._colliders.length;
profilerHooks.rigidbodyCount = () => (PhysicsWorld as any)._instance?._rigidbodies?.length ?? 0;
profilerHooks.physicsContactCount = () => (Physics as any)._activeCollisions.size;

// The matrix lives apart from Physics so it can be read without pulling the
// world in; this is the one edge back, registered at module load.
LayerCollisionMatrix._setChangeHandler(() => Physics._refreshLayerFilters());
