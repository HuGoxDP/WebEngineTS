import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { PostEffect } from "./PostEffect";

/**
 * Global post-processing pipeline.
 *
 * @remarks
 * Unity-like API for screen-space effects (bloom, vignette, color grading).
 * Effects are applied per-frame in the order they were added.
 *
 * When {@link enabled} is `true`, `Application._render` delegates to
 * {@link _render} which runs an internal `EffectComposer`. When disabled
 * the engine falls back to the direct `renderer.render()` path.
 *
 * ```ts
 * import { PostProcessing, BloomEffect, VignetteEffect } from "WebEngineTS";
 *
 * PostProcessing.addEffect(new BloomEffect({ intensity: 1.2 }));
 * PostProcessing.addEffect(new VignetteEffect({ intensity: 0.6 }));
 * PostProcessing.enabled = true;
 * ```
 */
export class PostProcessing {

    private static _enabled: boolean = false;
    private static _effects: PostEffect[] = [];
    private static _passes: WeakMap<PostEffect, any> = new WeakMap();
    private static _composer: EffectComposer | null = null;
    private static _renderPass: RenderPass | null = null;
    private static _outputPass: OutputPass | null = null;
    private static _boundRenderer: THREE.WebGLRenderer | null = null;
    private static _boundScene: THREE.Scene | null = null;
    private static _boundCamera: THREE.Camera | null = null;
    private static _dirty: boolean = true;

    /** Whether post-processing is active this frame. */
    public static get enabled(): boolean { return PostProcessing._enabled; }
    public static set enabled(value: boolean) { PostProcessing._enabled = value; }

    /** All registered effects in render order. */
    public static get effects(): readonly PostEffect[] { return PostProcessing._effects; }

    /** Adds an effect to the end of the pipeline. */
    public static addEffect(effect: PostEffect): void {
        if (PostProcessing._effects.indexOf(effect) === -1) {
            PostProcessing._effects.push(effect);
            PostProcessing._dirty = true;
        }
    }

    /** Removes an effect. Returns true if the effect was present. */
    public static removeEffect(effect: PostEffect): boolean {
        const idx = PostProcessing._effects.indexOf(effect);
        if (idx === -1) return false;
        PostProcessing._effects.splice(idx, 1);
        const pass = PostProcessing._passes.get(effect);
        if (pass) effect._dispose(pass);
        PostProcessing._passes.delete(effect);
        PostProcessing._dirty = true;
        return true;
    }

    /** Removes all effects and disposes their GPU resources. */
    public static clear(): void {
        for (const e of PostProcessing._effects) {
            const pass = PostProcessing._passes.get(e);
            if (pass) e._dispose(pass);
            // Dropped from the map too, as `removeEffect` already does for one.
            // `_buildPipeline` reuses whatever it finds here, so a disposed pass
            // left behind is handed straight back to the effect that owned it if
            // it is ever added again — a pipeline built on freed GPU resources.
            PostProcessing._passes.delete(e);
        }
        PostProcessing._effects = [];
        PostProcessing._dirty = true;
    }

    /**
     * @internal
     * Renders through the post-processing pipeline.
     * Falls back to direct renderer.render() if the pipeline is empty.
     */
    public static _render(
        renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera,
    ): void {
        if (!PostProcessing._enabled || PostProcessing._effects.length === 0) {
            renderer.render(scene, camera);
            return;
        }

        const size = renderer.getSize(_tmpSize);
        const needsRebuild =
            PostProcessing._dirty
            || PostProcessing._boundRenderer !== renderer
            || PostProcessing._boundScene !== scene
            || PostProcessing._boundCamera !== camera;

        if (needsRebuild) {
            PostProcessing._buildPipeline(renderer, scene, camera, size.x, size.y);
        }

        // Sync parameters each frame
        for (const eff of PostProcessing._effects) {
            if (!eff.enabled) continue;
            const pass = PostProcessing._passes.get(eff);
            if (pass) eff._updatePass(pass);
        }

        PostProcessing._composer!.render();
    }

    /** @internal Called from Application when the canvas resizes. */
    public static _setSize(width: number, height: number): void {
        PostProcessing._composer?.setSize(width, height);
        for (const eff of PostProcessing._effects) {
            const pass = PostProcessing._passes.get(eff);
            if (pass) eff._resize(pass, width, height);
        }
    }

    /** @internal Full teardown on engine shutdown. */
    public static _reset(): void {
        PostProcessing.clear();
        PostProcessing._composer?.dispose?.();
        PostProcessing._composer = null;
        PostProcessing._renderPass = null;
        PostProcessing._outputPass = null;
        PostProcessing._boundRenderer = null;
        PostProcessing._boundScene = null;
        PostProcessing._boundCamera = null;
        PostProcessing._enabled = false;
        PostProcessing._dirty = true;
    }

    // ==================== PRIVATE ====================

    private static _buildPipeline(
        renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera,
        width: number,
        height: number,
    ): void {
        // Dispose any previous composer's owned passes we created.
        PostProcessing._composer?.dispose?.();

        const composer = new EffectComposer(renderer);
        composer.setSize(width, height);

        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        for (const eff of PostProcessing._effects) {
            if (!eff.enabled) continue;
            let pass = PostProcessing._passes.get(eff);
            if (!pass) {
                pass = eff._createPass(width, height);
                PostProcessing._passes.set(eff, pass);
            }
            composer.addPass(pass);
        }

        const outputPass = new OutputPass();
        composer.addPass(outputPass);

        PostProcessing._composer = composer;
        PostProcessing._renderPass = renderPass;
        PostProcessing._outputPass = outputPass;
        PostProcessing._boundRenderer = renderer;
        PostProcessing._boundScene = scene;
        PostProcessing._boundCamera = camera;
        PostProcessing._dirty = false;
    }

    private constructor() {}
}

const _tmpSize = new THREE.Vector2();
