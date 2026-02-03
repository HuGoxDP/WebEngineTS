import * as THREE from "three";
import { Component } from "./Component";
import { Vector3 } from "./math/Vector3";
import { Quaternion } from "./math/Quaternion";
import type { GameObject } from "./GameObject";
import { SceneManager } from "./SceneManager";

// Кешовані змінні для уникнення алокацій (Garbage Collection optimization)
const _tempThreeVec3 = new THREE.Vector3();
const _tempThreeQuat = new THREE.Quaternion();

/**
 * Основний компонент, який визначає позицію, поворот та масштаб об'єкта.
 */
export class Transform extends Component {

    /** * Внутрішній об'єкт Three.js.
     * @internal Використовується тільки для рендеру та розрахунку світових матриць.
     */
    public readonly object3D: THREE.Object3D;

    private _localPosition: Vector3 = Vector3.zero;
    private _localRotation: Quaternion = Quaternion.identity;
    private _localScale: Vector3 = Vector3.one;

    // --- Hierarchy Data ---
    private _parent: Transform | null = null;

    /** @internal Доступно для GameObject при знищенні */
    public _children: Transform[] = [];

    constructor(gameObject: GameObject) {
        super(gameObject);

        // Створюємо групу в Three.js
        this.object3D = new THREE.Group();
        this.object3D.matrixAutoUpdate = true; // Дозволяємо Three.js рахувати матриці

        // Прив'язка для Raycasting (зворотній зв'язок від Three.js до нашого рушія)
        this.object3D.userData = { gameObject: gameObject };
    }

    // ==========================================
    // I. HIERARCHY
    // ==========================================

    public get parent(): Transform | null {
        return this._parent;
    }

    public set parent(newParent: Transform | null) {
        if (this._parent === newParent) return;

        const wasRoot = (this._parent === null);
        const willBeRoot = (newParent === null);

        if (this._parent) {
            const index = this._parent._children.indexOf(this);
            if (index !== -1) {
                this._parent._children.splice(index, 1);
            }
        }

        this._parent = newParent;

        if (newParent) {
            newParent._children.push(this);
            newParent.object3D.add(this.object3D);
        } else {
            // Від'єднуємо від батька в Three.js
            this.object3D.removeFromParent();
        }

        if (wasRoot && !willBeRoot) {
            // Перестав бути кореневим -> Сцена припиняє його оновлювати напряму (це робить батько)
            SceneManager.activeScene._onGameObjectParentChanged(this.gameObject, false);
        } else if (!wasRoot && willBeRoot) {
            // Став кореневим -> Сцена додає його в свій список оновлення і в threeScene
            SceneManager.activeScene._onGameObjectParentChanged(this.gameObject, true);
        }

        // Оновлюємо матриці
        this.object3D.updateMatrixWorld(true);
    }

    public get childCount(): number {
        return this._children.length;
    }

    public getChild(index: number): Transform {
        return this._children[index];
    }

    // ==========================================
    // II. LOCAL TRANSFORMS (Master-Slave Sync)
    // ==========================================

    public get localPosition(): Vector3 {
        return this._localPosition;
    }

    public set localPosition(value: Vector3) {
        // 1. Update Master
        this._localPosition.copy(value);
        // 2. Sync Slave
        this.object3D.position.set(value.x, value.y, value.z);
    }

    public get localRotation(): Quaternion {
        return this._localRotation;
    }

    public set localRotation(value: Quaternion) {
        this._localRotation.copy(value);
        this.object3D.quaternion.set(value.x, value.y, value.z, value.w);
    }

    public get localScale(): Vector3 {
        return this._localScale;
    }

    public set localScale(value: Vector3) {
        this._localScale.copy(value);
        this.object3D.scale.set(value.x, value.y, value.z);
    }

    // ==========================================
    // III. WORLD TRANSFORMS
    // ==========================================

    public get position(): Vector3 {
        this.object3D.getWorldPosition(_tempThreeVec3);
        return new Vector3(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public set position(value: Vector3) {
        // Конвертуємо світові координати в локальні відносно батька
        const parent = this.object3D.parent;
        if (parent) {
            _tempThreeVec3.set(value.x, value.y, value.z);
            parent.worldToLocal(_tempThreeVec3);
            this.localPosition = new Vector3(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
        } else {
            this.localPosition = value;
        }
    }

    public get rotation(): Quaternion {
        this.object3D.getWorldQuaternion(_tempThreeQuat);
        return new Quaternion(_tempThreeQuat.x, _tempThreeQuat.y, _tempThreeQuat.z, _tempThreeQuat.w);
    }

    public set rotation(value: Quaternion) {
        const parent = this.object3D.parent;
        if (parent) {
            // Хак: тимчасово від'єднуємо, ставимо поворот, приєднуємо назад
            // Це надійніше, ніж ручна математика кватерніонів
            const oldParent = this.object3D.parent;
            this.object3D.removeFromParent();

            this.object3D.quaternion.set(value.x, value.y, value.z, value.w);

            oldParent!.add(this.object3D);

            // Забираємо результат назад у Master (локальний поворот змінився)
            this._localRotation.set(
                this.object3D.quaternion.x,
                this.object3D.quaternion.y,
                this.object3D.quaternion.z,
                this.object3D.quaternion.w
            );
        } else {
            this.localRotation = value;
        }
    }

    // ==========================================
    // IV. HELPER METHODS
    // ==========================================

    public translate(translation: Vector3): void {
        this.position = this.position.add(translation);
    }

    public lookAt(target: Vector3): void {
        // Використовуємо Three.js для розрахунку повороту
        this.object3D.lookAt(target.x, target.y, target.z);

        // Синхронізуємо назад у Master
        this._localRotation.set(
            this.object3D.quaternion.x,
            this.object3D.quaternion.y,
            this.object3D.quaternion.z,
            this.object3D.quaternion.w
        );
    }

    public get forward(): Vector3 {
        _tempThreeVec3.set(0, 0, 1).applyQuaternion(this.object3D.quaternion);
        return new Vector3(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get right(): Vector3 {
        _tempThreeVec3.set(1, 0, 0).applyQuaternion(this.object3D.quaternion);
        return new Vector3(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get up(): Vector3 {
        _tempThreeVec3.set(0, 1, 0).applyQuaternion(this.object3D.quaternion);
        return new Vector3(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    protected override onDestroy(): void {
        this.object3D.clear();
        this.object3D.removeFromParent();
    }
}