import * as THREE from "three";
import { Component } from "./Component";
import { Vector3 } from "./math/Vector3";
import { Quaternion } from "./math/Quaternion";
import type { GameObject } from "./GameObject";
import { SceneManager } from "./SceneManager";

// Кешовані змінні для уникнення аллокацій (Garbage Collection optimization)
const _tempThreeVec3 = new THREE.Vector3();
const _tempThreeQuat = new THREE.Quaternion();
const _tempThreeEuler = new THREE.Euler();

/**
 * Основний компонент, який визначає позицію, поворот та масштаб об'єкта.
 * Також відповідає за ієрархію сцени (parent-child).
 * Є обгорткою над THREE.Object3D.
 */
export class Transform extends Component {

    /**
     * Внутрішній об'єкт Three.js.
     * @internal
     */
    public readonly object3D: THREE.Object3D;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.object3D = new THREE.Group();
        this.object3D.userData = { gameObject: gameObject };
    }

    /**
     * Батьківський Transform.
     * При зміні батька зберігається світова позиція, поворот і масштаб (World Space Stays).
     */
    public get parent(): Transform | null {
        if (this.object3D.parent && this.object3D.parent.userData.gameObject) {
            return (this.object3D.parent.userData.gameObject as GameObject).transform;
        }
        return null;
    }

    public set parent(value: Transform | null) {
        if (this.parent === value) return;

        const oldParent = this.parent;

        if (value) {
            value.object3D.attach(this.object3D);
        } else {
            SceneManager.activeScene.threeScene.add(this.object3D);
        }


        SceneManager.activeScene.onGameObjectParentChanged(this.gameObject, oldParent, value);
    }

    /**
     * Кількість дочірніх об'єктів.
     */
    public get childCount(): number {
        let count = 0;
        for (const child of this.object3D.children) {
            if (child.userData.gameObject) count++;
        }
        return count;
    }

    /**
     * Отримати дочірній елемент за індексом.
     */
    public getChild(index: number): Transform {
        let current = 0;
        for (const child of this.object3D.children) {
            if (child.userData.gameObject) {
                if (current === index) {
                    return (child.userData.gameObject as GameObject).transform;
                }
                current++;
            }
        }
        throw new Error(`Child at index ${index} not found or is not a GameObject`);
    }

    /**
     * Отримує світову позицію і записує її в переданий вектор.
     * ZERO-ALLOCATION метод.
     */
    public getPosition(out: Vector3): Vector3 {
        this.object3D.getWorldPosition(_tempThreeVec3);
        return out.set(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get position(): Vector3 {
        return this.getPosition(new Vector3());
    }

    public set position(value: Vector3) {
        _tempThreeVec3.set(value.x, value.y, value.z);

        if (!this.object3D.parent) {
            this.object3D.position.copy(_tempThreeVec3);
        } else {
            this.object3D.parent.worldToLocal(_tempThreeVec3);
            this.object3D.position.copy(_tempThreeVec3);
        }
    }

    public getLocalPosition(out: Vector3): Vector3 {
        return out.set(this.object3D.position.x, this.object3D.position.y, this.object3D.position.z);
    }

    public get localPosition(): Vector3 {
        return new Vector3(this.object3D.position.x, this.object3D.position.y, this.object3D.position.z);
    }

    public set localPosition(value: Vector3) {
        this.object3D.position.set(value.x, value.y, value.z);
    }

    public getRotation(out: Quaternion): Quaternion {
        this.object3D.getWorldQuaternion(_tempThreeQuat);
        return out.set(_tempThreeQuat.x, _tempThreeQuat.y, _tempThreeQuat.z, _tempThreeQuat.w);
    }

    public get rotation(): Quaternion {
        return this.getRotation(new Quaternion());
    }

    public set rotation(value: Quaternion) {
        _tempThreeQuat.set(value.x, value.y, value.z, value.w);

        if (!this.object3D.parent) {
            this.object3D.quaternion.copy(_tempThreeQuat);
        } else {
            const parentQuat = new THREE.Quaternion();
            this.object3D.parent.getWorldQuaternion(parentQuat);
            parentQuat.invert();
            parentQuat.multiply(_tempThreeQuat);
            this.object3D.quaternion.copy(parentQuat);
        }
    }

    public get localRotation(): Quaternion {
        return new Quaternion(
            this.object3D.quaternion.x,
            this.object3D.quaternion.y,
            this.object3D.quaternion.z,
            this.object3D.quaternion.w
        );
    }

    public set localRotation(value: Quaternion) {
        this.object3D.quaternion.set(value.x, value.y, value.z, value.w);
    }

    public get localScale(): Vector3 {
        return new Vector3(this.object3D.scale.x, this.object3D.scale.y, this.object3D.scale.z);
    }

    public set localScale(value: Vector3) {
        this.object3D.scale.set(value.x, value.y, value.z);
    }

    public get lossyScale(): Vector3 {
        this.object3D.getWorldScale(_tempThreeVec3);
        return new Vector3(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get eulerAngles(): Vector3 {
        _tempThreeEuler.setFromQuaternion(this.object3D.quaternion, 'YXZ');
        const rad2deg = 180 / Math.PI;
        return new Vector3(_tempThreeEuler.x * rad2deg, _tempThreeEuler.y * rad2deg, _tempThreeEuler.z * rad2deg);
    }

    public set eulerAngles(value: Vector3) {
        const deg2rad = Math.PI / 180;
        _tempThreeEuler.set(value.x * deg2rad, value.y * deg2rad, value.z * deg2rad, 'YXZ');
        this.object3D.quaternion.setFromEuler(_tempThreeEuler);
    }

    public getForward(out: Vector3): Vector3 {
        _tempThreeVec3.set(0, 0, 1).applyQuaternion(this.object3D.quaternion);
        return out.set(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get forward(): Vector3 { return this.getForward(new Vector3()); }

    public getRight(out: Vector3): Vector3 {
        _tempThreeVec3.set(1, 0, 0).applyQuaternion(this.object3D.quaternion);
        return out.set(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get right(): Vector3 { return this.getRight(new Vector3()); }

    public getUp(out: Vector3): Vector3 {
        _tempThreeVec3.set(0, 1, 0).applyQuaternion(this.object3D.quaternion);
        return out.set(_tempThreeVec3.x, _tempThreeVec3.y, _tempThreeVec3.z);
    }

    public get up(): Vector3 { return this.getUp(new Vector3()); }

    public translate(translation: Vector3): void {
        this.object3D.translateX(translation.x);
        this.object3D.translateY(translation.y);
        this.object3D.translateZ(translation.z);
    }

    public lookAt(target: Vector3): void {
        this.object3D.lookAt(target.x, target.y, target.z);
    }
}