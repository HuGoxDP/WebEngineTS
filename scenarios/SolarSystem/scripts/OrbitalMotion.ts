// scenarios/SolarSystem/scripts/OrbitalMotion.ts

import * as Engine from "@engine";

/**
 * Компонент орбітального руху.
 * Обертає об'єкт навколо центральної точки по еліптичній орбіті.
 */
export class OrbitalMotion extends Engine.ScriptableBehaviour {

    /** Відстань від центру орбіти */
    public orbitRadius: number = 10;

    /** Швидкість орбітального руху (радіани на секунду) */
    public orbitSpeed: number = 0.5;

    /** Центральна точка навколо якої обертається об'єкт */
    public centerPosition: Engine.Vector3 = Engine.Vector3.zero;

    /** Початковий кут на орбіті (в радіанах) */
    public startAngle: number = 0;

    /** Поточний кут орбіти */
    private _angle: number = 0;

    public override start(): void {
        this._angle = this.startAngle;
    }

    public override update(): void {
        this._angle += this.orbitSpeed * Engine.Time.deltaTime;

        // Обчислюємо позицію на орбіті (коло в XZ площині)
        const x = Math.cos(this._angle) * this.orbitRadius;
        const z = Math.sin(this._angle) * this.orbitRadius;

        this.transform.position = new Engine.Vector3(
            this.centerPosition.x + x,
            this.centerPosition.y,
            this.centerPosition.z + z
        );
    }
}