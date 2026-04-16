// path: src/engine/core/rendering/ShaderWarmup.ts

import * as THREE from "three";

/**
 * Pre-compiles all shader programs for materials currently in a scene.
 *
 * Calling `renderer.compile()` walks every mesh in the scene graph,
 * creates the corresponding WebGL shader programs, and compiles them
 * **without** producing visible output. This moves the GPU compilation
 * cost out of the first rendered frame and into a controlled setup phase.
 *
 * @remarks
 * Equivalent to Unity's `ShaderVariantCollection.WarmUp()`.
 *
 * @internal
 */
export class ShaderWarmup {

    /**
     * @internal
     * Triggers shader compilation for every material in the scene.
     *
     * @param renderer — the Three.js WebGLRenderer.
     * @param scene    — the Three.js scene containing the objects.
     * @param camera   — the camera whose projection matrix is used for compilation.
     */
    static warmup(
        renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera,
    ): void {
        renderer.compile(scene, camera);
    }
}
