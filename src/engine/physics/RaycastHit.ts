import { Vector3 } from "../core/math/Vector3";
import { Transform } from "../core/Transform";
import { GameObject } from "../core/GameObject";
import { Collider } from "./Collider";

export class RaycastHit {
    /** Точка влучання у світових координатах */
    public point: Vector3 = new Vector3();

    /** Нормаль поверхні в точці влучання */
    public normal: Vector3 = new Vector3();

    /** Відстань від початку променя до точки влучання */
    public distance: number = 0;

    /** Transform об'єкта, в який влучили */
    public transform: Transform | null = null;

    public collider: Collider | null = null;

    /** Скорочений доступ до GameObject */
    public get gameObject(): GameObject | null {
        return this.transform ? this.transform.gameObject : null;
    }

    /**
     * Очищає дані (для перевикористання об'єкта)
     */
    public clear(): void {
        this.point.set(0, 0, 0);
        this.normal.set(0, 0, 0);
        this.distance = 0;
        this.transform = null;
        this.collider = null;
    }
}