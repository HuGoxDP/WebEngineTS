import { EngineSettings } from "./EngineSettings";

export class Time {
    // Час між кадрами (змінюється залежно від FPS)
    static deltaTime: number = 0;

    // Використовуємо константу з налаштувань
    static fixedDeltaTime: number = EngineSettings.Time.FIXED_TIMESTEP;

    static time: number = 0;
    static frameCount: number = 0;
    static timeScale: number = 1.0;

    /**
     * Оновлює таймер. Викликається рушієм.
     * @internal
     */
    static _update(dt: number) {
        Time.deltaTime = dt * Time.timeScale;
        Time.time += Time.deltaTime;
        Time.frameCount++;
    }
}