/**
 * @internal
 * Registry of zero-import getter functions for the MemoryProfiler.
 *
 * Each engine subsystem registers a getter at module load time.
 * MemoryProfiler reads from this object without importing the
 * subsystem classes directly, avoiding circular imports.
 *
 * Example (at the bottom of Camera.ts):
 * ```ts
 * import { profilerHooks } from "../diagnostics/ProfilerHooks";
 * profilerHooks.cameraCount = () => Camera._activeCameras.length;
 * ```
 */
export const profilerHooks: {
    cameraCount?: () => number;
    lightCount?: () => number;
    animationPlayingCount?: () => number;
    audioSourceCount?: () => number;
    audioListenerCount?: () => number;
    rigidbodyCount?: () => number;
    colliderCount?: () => number;
    physicsContactCount?: () => number;
    componentCount?: () => number;
    shadowCasterCount?: () => number;
    particleSystemCount?: () => number;
    aliveParticleCount?: () => number;
    uiCanvasCount?: () => number;
    uiCanvasBytes?: () => number;
    uiTintCacheBytes?: () => number;
} = {};
