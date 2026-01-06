import * as THREE from 'three';
import { Component } from '../Component';
import { Vector3 } from '../math/Vector3';
import { Quaternion } from '../math/Quaternion';
import { serializable } from '../decorators/Serializable';
import type { Entity } from '../Entity';

// ==========================================
// 🔹 SCRATCH VARIABLES (Оптимізація пам'яті)
// ==========================================

const _tempVec3 = new THREE.Vector3();
const _target = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();

/**
 * Transform component.
 * Керує позицією, обертанням та масштабом, а також ієрархією об'єктів.
 * Це єдиний компонент, який напряму володіє THREE.Object3D.
 */
export class Transform extends Component {
    public _object3D: THREE.Object3D;

    private _parent: Transform | null = null;
    private _children: Transform[] = [];

    constructor(entity: Entity) {
        super(entity);
        this._object3D = new THREE.Object3D();
        this._object3D.userData = { entityId: entity.uuid };
        // Порядок обертання як в Unity
        this._object3D.rotation.order = 'YXZ';
    }
    // ==========================================
    // 🔹 AUTO-SERIALIZATION
    // ==========================================

    @serializable
    get localPosition(): Vector3 {
        return new Vector3(this._object3D.position.x, this._object3D.position.y, this._object3D.position.z);
    }

    set localPosition(value: Vector3) {
        this._object3D.position.set(value.x, value.y, value.z);
    }

    @serializable
    get localRotation(): Quaternion {
        const q = this._object3D.quaternion;
        return new Quaternion(q.x, q.y, q.z, q.w);
    }

    set localRotation(value: Quaternion) {
        this._object3D.quaternion.set(value.x, value.y, value.z, value.w);
    }

    @serializable
    get localScale(): Vector3 {
        return new Vector3(this._object3D.scale.x, this._object3D.scale.y, this._object3D.scale.z);
    }

    set localScale(value: Vector3) {
        this._object3D.scale.set(value.x, value.y, value.z);
    }

    /**
     * Спеціальне поле для збереження батька.
     * Ми зберігаємо не сам об'єкт (це циклічне посилання), а його UUID.
     */
    @serializable
    get parentUUID(): string | null {
        return this._parent ? this._parent.entity.uuid : null;
    }

    set parentUUID(value: string | null) {
        // Тут ми нічого не робимо, відновлення зв'язків батько-дитина
        // має відбуватися на рівні Scene після завантаження всіх об'єктів.
    }

    // ==========================================
    // 🔹 WORLD POSITIONS (Get/Set з конвертацією)
    // ==========================================

    get position(): Vector3 {
        this._object3D.getWorldPosition(_worldPos);
        return new Vector3(_worldPos.x, _worldPos.y, _worldPos.z);
    }

    set position(value: Vector3) {
        if (!this._parent) {
            this._object3D.position.set(value.x, value.y, value.z);
        } else {
            // Конвертуємо світову позицію в локальну відносно батька
            _tempVec3.set(value.x, value.y, value.z);
            this._parent._object3D.worldToLocal(_tempVec3);
            this._object3D.position.copy(_tempVec3);
        }
    }

    get rotation(): Quaternion {
        this._object3D.getWorldQuaternion(_worldQuat);
        return new Quaternion(_worldQuat.x, _worldQuat.y, _worldQuat.z, _worldQuat.w);
    }

    // ==========================================
    // 🔹 HIERARCHY
    // ==========================================

    public setParent(parent: Transform | null, keepWorldPosition: boolean = true): void {
        if (this._parent === parent) return;

        if (keepWorldPosition) {
            this._object3D.getWorldPosition(_worldPos);
            this._object3D.getWorldQuaternion(_worldQuat);
            this._object3D.getWorldScale(_worldScale);
        }

        // Від'єднання від старого
        if (this._parent) {
            const index = this._parent._children.indexOf(this);
            if (index !== -1) this._parent._children.splice(index, 1);
            this._parent._object3D.remove(this._object3D);
        }

        this._parent = parent;

        // Приєднання до нового
        if (this._parent) {
            this._parent._children.push(this);
            this._parent._object3D.add(this._object3D);
        }

        // Відновлення позиції
        if (keepWorldPosition) {
            if (this._parent) {
                this._parent._object3D.worldToLocal(_worldPos);
                this._object3D.position.copy(_worldPos);
                // Обертання та масштаб складніші, тут спрощено:
                this._object3D.quaternion.copy(_worldQuat).premultiply(this._parent._object3D.quaternion.clone().invert());
            } else {
                this._object3D.position.copy(_worldPos);
                this._object3D.quaternion.copy(_worldQuat);
                this._object3D.scale.copy(_worldScale);
            }
            this._object3D.updateMatrixWorld(true);
        }
    }

    get parent(): Transform | null { return this._parent; }
    get childCount(): number { return this._children.length; }
    getChild(index: number): Transform | null { return this._children[index] || null; }

    // ==========================================
    // 🔹 MOVEMENT & UTILS
    // ==========================================

    get forward(): Vector3 {
        _tempVec3.set(0, 0, 1).applyQuaternion(this._object3D.quaternion);
        return new Vector3(_tempVec3.x, _tempVec3.y, _tempVec3.z).normalize();
    }

    get right(): Vector3 {
        _tempVec3.set(1, 0, 0).applyQuaternion(this._object3D.quaternion);
        return new Vector3(_tempVec3.x, _tempVec3.y, _tempVec3.z).normalize();
    }

    get up(): Vector3 {
        _tempVec3.set(0, 1, 0).applyQuaternion(this._object3D.quaternion);
        return new Vector3(_tempVec3.x, _tempVec3.y, _tempVec3.z).normalize();
    }

    translate(translation: Vector3): void {
        this._object3D.position.x += translation.x;
        this._object3D.position.y += translation.y;
        this._object3D.position.z += translation.z;
    }

    lookAt(target: Vector3): void {
        _target.set(target.x, target.y, target.z);
        this._object3D.lookAt(_target);
    }

    rotate(axis: Vector3, angleDegrees: number): void {
        _tempVec3.set(axis.x, axis.y, axis.z);
        this._object3D.rotateOnAxis(_tempVec3, angleDegrees * (Math.PI / 180));
    }
}