/**
 * Simulation space for particle position updates.
 */
export enum ParticleSimulationSpace {
    /** Particles move with the GameObject. */
    Local = "Local",
    /** Particles keep their world position when the GameObject moves. */
    World = "World",
}

/**
 * How particles are rendered on screen.
 */
export enum ParticleRenderMode {
    /** Particles always face the camera (default). */
    Billboard = "Billboard",
    /** Particles stretch along their velocity direction. */
    StretchedBillboard = "StretchedBillboard",
}

/**
 * Emitter shape type.
 */
export enum ParticleShapeType {
    /** Emit from a point at the origin. */
    Point = "Point",
    /** Emit from inside / surface of a sphere. */
    Sphere = "Sphere",
    /** Emit in a cone around the +Y axis. */
    Cone = "Cone",
    /** Emit from inside an axis-aligned box. */
    Box = "Box",
}

/**
 * Gradient interpolation mode.
 */
export enum GradientMode {
    /** Smooth interpolation between keys. */
    Blend = "Blend",
    /** Step between keys (no interpolation). */
    Fixed = "Fixed",
}
