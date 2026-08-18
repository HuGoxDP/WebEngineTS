/**
 * EngineSettings.ts
 * Engine-wide configuration.
 * Constants for time, physics, rendering and layers.
 */
export const EngineSettings = {
    /**
     * Time and game-loop settings.
     */
    Time: {
        /**
         * The fixed timestep physics and `FixedUpdate` run at.
         * 50 Hz = 0.02s
         */
        FIXED_TIMESTEP: 1 / 50,

        /**
         * Frame delta ceiling. Without it, one slow frame asks for more fixed
         * steps than fit in the next, which asks for more still — the spiral of
         * death. Time slows down instead.
         */
        MAX_DELTA_TIME: 0.1,
    },
    /**
     * Physics settings.
     */
    Physics: {
        /**
         * Global gravity, on the Y axis.
         */
        GRAVITY: -9.81,

        /**
         * Solver iterations. More is more accurate and slower.
         */
        DEFAULT_SOLVER_ITERATIONS: 6,
    },
    /**
     * Math constants.
     */
    Math: {
        /**
         * Tolerance for floating-point comparisons.
         */
        EPSILON: 0.00001,
    },
    /**
     * Built-in layers.
     * Used for raycasting, rendering and collision filtering.
     */
    Layers: {
        DEFAULT: 0,
        TRANSPARENT_FX: 1,
        IGNORE_RAYCAST: 2,
        WATER: 4,
        UI: 5,
    },
    /**
     * Built-in object tags.
     */
    Tags: {
        UNTAGGED: "Untagged",
        PLAYER: "Player",
        MAIN_CAMERA: "MainCamera",
    },
    /**
     * Defaults applied to new objects.
     */
    Defaults: {
        GAME_OBJECT_NAME: "New GameObject",
    }
} as const; // `as const` makes every field readonly, so nothing can change a
           // setting at runtime by accident.