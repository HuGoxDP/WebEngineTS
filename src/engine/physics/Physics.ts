import * as THREE from "three";
import { Ray } from "../core/math/Ray";
import { RaycastHit } from "./RaycastHit";
import { Collider } from "./Collider";

/**
 * Глобальний клас фізики.
 */
export class Physics {
    private static _raycaster = new THREE.Raycaster();

    private static _colliders: Collider[] = [];

    /** @internal Викликається колайдером при створенні */
    public static _registerCollider(col: Collider) {
        this._colliders.push(col);
    }

    /** @internal Викликається колайдером при знищенні */
    public static _unregisterCollider(col: Collider) {
        const index = this._colliders.indexOf(col);
        if (index > -1) {
            this._colliders.splice(index, 1);
        }
    }

    /**
     * Випускає промінь у сцену та повертає true, якщо він влучив у будь-який об'єкт.
     * @param ray Промінь (початок і напрямок).
     * @param hitInfo (Опціонально) Об'єкт для запису результату влучання (аналог out parameter).
     * @param maxDistance Максимальна дистанція (за замовчуванням Infinity).
     */
    public static raycast(ray: Ray, hitInfo?: RaycastHit, maxDistance: number = Infinity): boolean {
        // 1. Налаштовуємо промінь
        this._raycaster.set(
            new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
            new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize()
        );
        this._raycaster.far = maxDistance;

        // 2. Збираємо ThreeJS об'єкти ТІЛЬКИ з активних колайдерів
        const shapes: THREE.Object3D[] = [];
        for (const col of this._colliders) {
            // Оптимізація: перевіряємо, чи колайдер взагалі увімкнений і активний
            if (col.enabled && col.gameObject.activeSelf) {
                shapes.push(col._getPhysicsShape());
            }
        }
        // 3. Raycast тільки по колайдерах
        const intersects = this._raycaster.intersectObjects(shapes, false);

        if (intersects.length > 0) {
            const hit = intersects[0];

            if (hitInfo) {
                hitInfo.distance = hit.distance;
                hitInfo.point.set(hit.point.x, hit.point.y, hit.point.z);

                if (hit.face) {
                    hitInfo.normal.set(hit.face.normal.x, hit.face.normal.y, hit.face.normal.z);
                }

                // Отримуємо Collider з userData (ми поклали його туди в BoxCollider)
                if (hit.object.userData && hit.object.userData.collider) {
                    const col = hit.object.userData.collider as Collider;
                    hitInfo.collider = col;
                    hitInfo.transform = col.transform;
                }
            }
            return true;
        }

        return false;
    }
}