import { ScriptableBehaviour, Vector3, Time } from "@engine";

/**
 * Компонент орбітального руху
 * Обертає об'єкт навколо центральної точки по колу
 */
export class OrbitalMotion extends ScriptableBehaviour {
    /** Відстань від центру орбіти */
    public orbitDistance: number = 10;
    
    /** Швидкість орбітального руху (радіани на секунду) */
    public orbitSpeed: number = 0.5;
    
    /** Центральна точка навколо якої обертається об'єкт */
    public centerPosition: Vector3 = Vector3.zero;
    
    /** Поточний кут орбіти */
    private angle: number = 0;

    onUpdate(): void {
        this.angle += this.orbitSpeed * Time.deltaTime;

        // Обчислюємо позицію на орбіті (коло в XZ площині)
        const x = Math.cos(this.angle) * this.orbitDistance;
        const z = Math.sin(this.angle) * this.orbitDistance;

        this.gameObject.transform.position = new Vector3(
            this.centerPosition.x + x,
            this.centerPosition.y,
            this.centerPosition.z + z
        );
    }
}
