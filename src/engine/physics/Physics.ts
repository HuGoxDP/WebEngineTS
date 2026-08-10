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

    // ==================== GRAVITY ====================

    /** Global gravity vector (default: (0, -9.81, 0)). */
    public static get gravity(): Vector3 {
        return PhysicsWorld.instance.gravity;
    }

    public static set gravity(value: Vector3) {
        PhysicsWorld.instance.gravity = value;
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
        const currentPairs = new Set<string>();

        for (const contact of world.contacts) {
            const bodyA = contact.bi;
            const bodyB = contact.bj;

            const colA = this._findColliderForBody(bodyA);
            const colB = this._findColliderForBody(bodyB);
            if (!colA || !colB) continue;

            const key = this._pairKey(colA, colB);
            currentPairs.add(key);

            const contacts = this._extractContacts(contact);
            const relVel = new Vector3(
                bodyA.velocity.x - bodyB.velocity.x,
                bodyA.velocity.y - bodyB.velocity.y,
                bodyA.velocity.z - bodyB.velocity.z,
            );

            if (!this._activeCollisions.has(key)) {
                // New collision → Enter
                this._activeCollisions.set(key, { a: colA, b: colB });

                if (colA.isTrigger || colB.isTrigger) {
                    colA.gameObject.sendMessage("onTriggerEnter", colB);
                    colB.gameObject.sendMessage("onTriggerEnter", colA);
                } else {
                    const collisionA = new Collision(colB, relVel, contacts);
                    const collisionB = new Collision(colA, Vector3.scale(relVel, -1), contacts);
                    colA.gameObject.sendMessage("onCollisionEnter", collisionA);
                    colB.gameObject.sendMessage("onCollisionEnter", collisionB);
                }
            } else {
                // Ongoing collision → Stay
                if (colA.isTrigger || colB.isTrigger) {
                    colA.gameObject.sendMessage("onTriggerStay", colB);
                    colB.gameObject.sendMessage("onTriggerStay", colA);
                } else {
                    const collisionA = new Collision(colB, relVel, contacts);
                    const collisionB = new Collision(colA, Vector3.scale(relVel, -1), contacts);
                    colA.gameObject.sendMessage("onCollisionStay", collisionA);
                    colB.gameObject.sendMessage("onCollisionStay", collisionB);
                }
            }
        }

        // Check for ended collisions → Exit
        for (const [key, pair] of this._activeCollisions) {
            if (!currentPairs.has(key)) {
                this._activeCollisions.delete(key);

                if (pair.a.isTrigger || pair.b.isTrigger) {
                    pair.a.gameObject.sendMessage("onTriggerExit", pair.b);
                    pair.b.gameObject.sendMessage("onTriggerExit", pair.a);
                } else {
                    const emptyCollisionA = new Collision(pair.b, Vector3.zero, []);
                    const emptyCollisionB = new Collision(pair.a, Vector3.zero, []);
                    pair.a.gameObject.sendMessage("onCollisionExit", emptyCollisionA);
                    pair.b.gameObject.sendMessage("onCollisionExit", emptyCollisionB);
                }
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

    private static _extractContacts(contact: CANNON.ContactEquation): ContactPoint[] {
        const points: ContactPoint[] = [];
        const p = contact.ri;
        const n = contact.ni;
        const worldPoint = new Vector3(
            contact.bi.position.x + p.x,
            contact.bi.position.y + p.y,
            contact.bi.position.z + p.z,
        );
        const normal = new Vector3(n.x, n.y, n.z);
        points.push(new ContactPoint(worldPoint, normal));
        return points;
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

    public static _reset(): void {
        this._colliders.length = 0;
        this._activeCollisions.clear();
        PhysicsWorld._reset();
    }
}

profilerHooks.colliderCount = () => (Physics as any)._colliders.length;
profilerHooks.rigidbodyCount = () => (PhysicsWorld as any)._instance?._rigidbodies?.length ?? 0;
profilerHooks.physicsContactCount = () => (Physics as any)._activeCollisions.size;

// The matrix lives apart from Physics so it can be read without pulling the
// world in; this is the one edge back, registered at module load.
LayerCollisionMatrix._setChangeHandler(() => Physics._refreshLayerFilters());
