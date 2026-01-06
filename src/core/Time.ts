export class Time {
    // Час між кадрами (змінюється залежно від FPS)
    static deltaTime: number = 0;

    // Фіксований час для фізики (константа, наприклад 0.02s)
    static fixedDeltaTime: number = 1 / 50;

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