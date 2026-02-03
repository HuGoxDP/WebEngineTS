// scenarios/SolarSystem/scripts/MoonOrbit.ts

import * as Engine from "@engine";

/**
 * Компонент орбіти Місяця навколо планети.
 * Місяць обертається навколо планети, яка в свою чергу обертається навколо Сонця.
 */
export class MoonOrbit extends Engine.ScriptableBehaviour {

    /** Об'єкт-батько (планета) навколо якого обертається */
    public parentPlanet: Engine.GameObject | null = null;

    /** Радіус орбіти навколо планети */
    public orbitRadius: number = 2.5;

    /** Швидкість орбіти (радіани на секунду) */
    public orbitSpeed: number = 3.0;

    /** Поточний кут орбіти */
    private _angle: number = 0;

    public override start(): void {
        this._angle = Math.random() * Math.PI * 2;
    }

    public override update(): void {
        if (!this.parentPlanet) return;

        this._angle += this.orbitSpeed * Engine.Time.deltaTime;

        // Отримуємо позицію батьківської планети
        const parentPos = this.parentPlanet.transform.position;

        // Обчислюємо позицію Місяця відносно планети
        const x = Math.cos(this._angle) * this.orbitRadius;
        const z = Math.sin(this._angle) * this.orbitRadius;

        this.transform.position = new Engine.Vector3(
            parentPos.x + x,
            parentPos.y,
            parentPos.z + z
        );
    }
}
