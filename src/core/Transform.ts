import * as THREE from "three";
import { Component } from "./Component";
import { Vector3 } from "./math/Vector3";
import { Quaternion } from "./math/Quaternion";
import type { GameObject } from "./GameObject";

/**
 * Основний компонент, який визначає позицію, поворот та масштаб об'єкта.
 * Також відповідає за ієрархію сцени (parent-child).
 * Є обгорткою над THREE.Object3D.
 */
export class Transform extends Component {

    /**
     * Внутрішній об'єкт Three.js.
     * Це "серце" трансформації. Всі зміни трансформу делегуються сюди.
     * @internal
     */
    public readonly object3D: THREE.Object3D;

    constructor(gameObject: GameObject) {
        super(gameObject);
        // Створюємо "порожній" Object3D (або Group) для репрезентації цього об'єкта в Three.js
        this.object3D = new THREE.Group();

        // Зв'язуємо Three.js об'єкт з нашим GameObject (корисно для Raycasting)
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
        if (value) {
            // Three.js .attach() автоматично перераховує локальні координати,
            // щоб зберегти об'єкт на тому ж місці у світі. Це аналог SetParent(t, true) в Unity.
            value.object3D.attach(this.object3D);
        } else {
            // Якщо null — відкріпляємо від батька (кидаємо в корінь сцени)
            //TODO Примітка: В реальному рушії тут треба атачити до Scene root.
            //TODO  Поки що просто remove, але в ідеалі: SceneManager.currentScene.add(this.object3D);
            this.object3D.removeFromParent();
            // Тимчасовий фікс для чистого Three.js: якщо немає сцени, об'єкт зникне.
            // TODO Припускаємо, що SceneManager обробить це пізніше.
        }
    }

    /**
     * Кількість дочірніх об'єктів.
     */
    public get childCount(): number {
        return this.object3D.children.length;
    }

    /**
     * Отримати дочірній елемент за індексом.
     */
    public getChild(index: number): Transform {
        const childObj = this.object3D.children[index];
        if (childObj && childObj.userData.gameObject) {
            return (childObj.userData.gameObject as GameObject).transform;
        }
        throw new Error(`Child at index ${index} is not a valid Game Object`);
    }

    /**
     * Пошук дочірнього об'єкта за іменем (глибокий пошук не реалізовано, як і в Unity transform.Find).
     */
    public find(name: string): Transform | null {
        const found = this.object3D.getObjectByName(name);
        if (found && found.userData.gameObject) {
            return (found.userData.gameObject as GameObject).transform;
        }
        return null;
    }

    /**
     * Глобальна позиція (World Space).
     */
    public get position(): Vector3 {
        // Ми повинні отримати світову позицію. Three.js зберігає локальну.
        // Треба обчислити світову.
        const worldPos = new THREE.Vector3();
        this.object3D.getWorldPosition(worldPos);
        return new Vector3(worldPos.x, worldPos.y, worldPos.z);
    }

    public set position(value: Vector3) {
        // Найскладніша частина: встановити світову позицію, змінивши локальну.
        // Якщо немає батька — все просто.
        if (!this.parent) {
            this.object3D.position.set(value.x, value.y, value.z);
        } else {
            // Якщо є батько, конвертуємо World -> Local
            // local = parentWorldInverse * world
            const parentWorld = new THREE.Vector3();
            this.object3D.parent!.getWorldPosition(parentWorld); // ! - бо перевірили parent

            // Ця математика може бути складною вручну, довіримося Three.js утилітам, якщо можливо,
            // або зробимо це "брудним" способом: від'єднати, перемістити, приєднати.
            // Але це повільно. Правильний шлях через матриці:

            // Створюємо вектор у світових координатах
            const targetWorld = new THREE.Vector3(value.x, value.y, value.z);
            // Конвертуємо у локальний простір батька
            this.object3D.parent!.worldToLocal(targetWorld);
            // Записуємо
            this.object3D.position.copy(targetWorld);
        }
    }

    /**
     * Локальна позиція (Local Space).
     */
    public get localPosition(): Vector3 {
        return new Vector3(this.object3D.position.x, this.object3D.position.y, this.object3D.position.z);
    }

    public set localPosition(value: Vector3) {
        this.object3D.position.set(value.x, value.y, value.z);
    }

    /**
     * Глобальний поворот (Quaternion).
     */
    public get rotation(): Quaternion {
        const worldQuat = new THREE.Quaternion();
        this.object3D.getWorldQuaternion(worldQuat);
        return new Quaternion(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);
    }

    public set rotation(value: Quaternion) {
        if (!this.parent) {
            this.object3D.quaternion.set(value.x, value.y, value.z, value.w);
        } else {
            // Аналогічно позиції, треба обернути SetWorldQuaternion
            // Three.js не має прямого сеттера world quaternion, треба через матриці або трюки.
            // Найпростіший спосіб:
            const q = new THREE.Quaternion(value.x, value.y, value.z, value.w);
            // q * inverse(parentWorldQ)
            const parentQ = new THREE.Quaternion();
            this.object3D.parent!.getWorldQuaternion(parentQ);
            // local = parent_inverse * world
            parentQ.invert();
            parentQ.multiply(q);
            this.object3D.quaternion.copy(parentQ);
        }
    }

    /**
     * Локальний поворот (Quaternion).
     */
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

    /**
     * Кути Ейлера (в градусах), аналог inspector rotation.
     * Працює з локальним поворотом.
     */
    public get eulerAngles(): Vector3 {
        // Three.js використовує радіани, Unity - градуси.
        const euler = new THREE.Euler().setFromQuaternion(this.object3D.quaternion, 'YXZ'); // Unity order default usually ZXY or YXZ? Unity is ZXY internally but UI handles it. Standard Three is XYZ.
        // Use default order
        const rad2deg = 180 / Math.PI;
        return new Vector3(euler.x * rad2deg, euler.y * rad2deg, euler.z * rad2deg);
    }

    public set eulerAngles(value: Vector3) {
        const deg2rad = Math.PI / 180;
        const euler = new THREE.Euler(value.x * deg2rad, value.y * deg2rad, value.z * deg2rad, 'YXZ');
        this.object3D.quaternion.setFromEuler(euler);
    }

    public get localScale(): Vector3 {
        return new Vector3(this.object3D.scale.x, this.object3D.scale.y, this.object3D.scale.z);
    }

    public set localScale(value: Vector3) {
        this.object3D.scale.set(value.x, value.y, value.z);
    }

    /**
     * Наближений глобальний масштаб (LossyScale).
     * Read-only, тому що scale не завжди можна коректно розрахувати через skewed matrices.
     */
    public get lossyScale(): Vector3 {
        const worldScale = new THREE.Vector3();
        this.object3D.getWorldScale(worldScale);
        return new Vector3(worldScale.x, worldScale.y, worldScale.z);
    }

    public get forward(): Vector3 {
        const v = new THREE.Vector3(0, 0, 1);
        // Unity forward is +Z? No, Unity +Z is Forward. Three.js +Z is out of screen (Back).
        // Standard Three.js: +Z is towards viewer (Back), -Z is Forward.
        // Standard Unity: +Z is Forward.
        // ADAPTER FIX: Якщо ми хочемо Unity-style coordinate system, треба враховувати це.
        // Але зазвичай в Three.js проектах Forward це (0,0,1) або (0,0,-1).
        // Unity: Forward = (0, 0, 1). ThreeJS Default Camera looks down -Z.
        // Приймемо конвенцію Unity для API: Forward повертає те, куди "дивиться" вісь Z об'єкта.
        v.applyQuaternion(this.object3D.quaternion);
        return new Vector3(v.x, v.y, v.z);
    }

    public get right(): Vector3 {
        const v = new THREE.Vector3(1, 0, 0);
        v.applyQuaternion(this.object3D.quaternion);
        return new Vector3(v.x, v.y, v.z);
    }

    public get up(): Vector3 {
        const v = new THREE.Vector3(0, 1, 0);
        v.applyQuaternion(this.object3D.quaternion);
        return new Vector3(v.x, v.y, v.z);
    }

    /**
     * Переміщує об'єкт.
     * @param translation Вектор зміщення.
     * @param space Простір (World або Self). Поки що реалізуємо як World/Local змішування.
     */
    public translate(translation: Vector3): void {
        // Проста реалізація: translate in local space
        this.object3D.translateX(translation.x);
        this.object3D.translateY(translation.y);
        this.object3D.translateZ(translation.z);
    }

    /**
     * Повертає об'єкт, щоб він дивився на ціль.
     * @param target Позиція цілі (World Space).
     */
    public lookAt(target: Vector3): void {
        // Three.js lookAt працює у World Space, але змінює Local Rotation
        // Важливо: Three.js lookAt очікує, що об'єкт "дивиться" -Z, а Unity +Z.
        // Тут можливий конфлікт осей. Зазвичай доводиться додавати батька-контейнер або крутити меш.
        // Використаємо стандартний three.js метод поки що.
        this.object3D.lookAt(target.x, target.y, target.z);
    }
}