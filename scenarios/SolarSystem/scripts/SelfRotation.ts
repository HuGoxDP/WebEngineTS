// scenarios/SolarSystem/scripts/SelfRotation.ts

import * as Engine from "@engine";

/**
 * Компонент обертання об'єкта навколо своєї осі.
 * Додає постійне обертання до GameObject.
 */
export class SelfRotation extends Engine.ScriptableBehaviour {

    /** Швидкість обертання в градусах на секунду по кожній осі */
    public rotationSpeed: Engine.Vector3 = Engine.Vector3.zero;

    public override update(): void {
        const dt = Engine.Time.deltaTime;

        const deltaRotation = new Engine.Vector3(
            this.rotationSpeed.x * dt,
            this.rotationSpeed.y * dt,
            this.rotationSpeed.z * dt
        );

        // Створюємо delta кватерніон
        const deltaQuat = Engine.Quaternion.fromEuler(
            deltaRotation.x,
            deltaRotation.y,
            deltaRotation.z
        );

        // Множимо: новий rotation = delta * поточний
        const currentRotation = this.transform.rotation;
        this.transform.rotation = deltaQuat.multiply(currentRotation);
    }
}