import { ScriptableBehaviour, Vector3, Quaternion, Time } from "@engine";

/**
 * Компонент обертання об'єкта навколо своєї осі
 * Додає постійне обертання gameObject
 */
export class SelfRotation extends ScriptableBehaviour {
    /** Швидкість обертання в градусах на секунду по кожній осі */
    public rotationSpeed: Vector3 = Vector3.zero;

    onUpdate(): void {
        const deltaRotation = new Vector3(
            this.rotationSpeed.x * Time.deltaTime,
            this.rotationSpeed.y * Time.deltaTime,
            this.rotationSpeed.z * Time.deltaTime
        );

        // Отримуємо поточне обертання та додаємо до нього
        const currentRotation = this.gameObject.transform.rotation;
        
        // Створюємо delta обертання
        const deltaQuat = Quaternion.fromEuler(
            deltaRotation.x,
            deltaRotation.y,
            deltaRotation.z
        );

        // Множимо: новий rotation = delta * поточний
        this.gameObject.transform.rotation = deltaQuat.multiply(currentRotation);
    }
}
