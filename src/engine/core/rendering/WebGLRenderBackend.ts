import * as THREE from "three";
import { RenderSettings } from "../RenderSettings";
import { CameraClearFlags } from "../components/Camera";
import { PostProcessing } from "../postprocessing/PostProcessing";
import { ShaderWarmup } from "./ShaderWarmup";
import {
    GraphicsAPI, GraphicsPowerPreference,
} from "./RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "./RenderBackend";
import { Color } from "../math/Color";
import type { Scene } from "../Scene";
import type { Camera } from "../components/Camera";

/** Reused so setting the clear colour allocates nothing per frame. */
const _clearColor = new THREE.Color();

/**
 * Reused for the same reason, one step earlier: `Camera.backgroundColor` is a
 * value type and hands back a copy, so reading it per frame allocated one.
 */
const _cameraBackground = new Color();

/**
 * The WebGL 2 backend, over Three.js' `WebGLRenderer`.
 *
 * @remarks
 * The default backend, and the only one that ships today. It owns everything
 * WebGL-specific that `Application` used to do inline: context creation, colour
 * management, tone mapping, shadow maps, the post-processing branch and shader
 * warmup. `Application` now asks for a frame and does not know what draws it.
 *
 * Three.js appears throughout this file and nowhere in its public signatures —
 * the class satisfies {@link RenderBackend}, which is engine-typed.
 */
export class WebGLRenderBackend implements RenderBackend {

    private readonly _renderer: THREE.WebGLRenderer;
    private readonly _stats: {
        drawCalls: number; triangles: number;
        geometries: number; textures: number; programs: number;
    } = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };

    constructor(options: RenderBackendOptions) {
        this._renderer = new THREE.WebGLRenderer({
            canvas: options.canvas,
            antialias: options.antialias,
            powerPreference: WebGLRenderBackend._toWebGLPowerPreference(options.powerPreference),
        });
        this._renderer.setPixelRatio(options.pixelRatio);

        // Color management — sRGB output for correct gamma.
        this._renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Tone mapping — compress HDR to LDR with a natural look. ACESFilmic
        // gives film-like contrast and smooth highlight rolloff, making
        // emissive materials glow without bloom post-processing.
        this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this._renderer.toneMappingExposure = 1.0;

        this._renderer.shadowMap.enabled = true;
        this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    /** @inheritDoc */
    public get api(): GraphicsAPI { return GraphicsAPI.WebGL2; }

    /** @inheritDoc */
    public get pixelRatio(): number { return this._renderer.getPixelRatio(); }

    public set pixelRatio(value: number) { this._renderer.setPixelRatio(value); }

    /** @inheritDoc */
    public get exposure(): number { return this._renderer.toneMappingExposure; }

    public set exposure(value: number) { this._renderer.toneMappingExposure = value; }

    /** @inheritDoc */
    public get shadowsEnabled(): boolean { return this._renderer.shadowMap.enabled; }

    public set shadowsEnabled(value: boolean) { this._renderer.shadowMap.enabled = value; }

    /** @inheritDoc */
    public get stats(): RenderBackendStats {
        const info = this._renderer.info;
        this._stats.drawCalls = info.render.calls;
        this._stats.triangles = info.render.triangles;
        this._stats.geometries = info.memory.geometries;
        this._stats.textures = info.memory.textures;
        this._stats.programs = info.programs?.length ?? 0;
        return this._stats;
    }

    /** @inheritDoc */
    public setSize(width: number, height: number): void {
        this._renderer.setSize(width, height);
        PostProcessing._setSize(width, height);
    }

    /** @inheritDoc */
    public setClearColor(color: Color): void {
        _clearColor.setRGB(color.r, color.g, color.b);
        this._renderer.setClearColor(_clearColor, color.a);
    }

    /** @inheritDoc */
    public clear(): void {
        this._renderer.clear();
    }

    /** @inheritDoc */
    public renderScene(scene: Scene, camera: Camera): void {
        const threeScene = scene._internalThreeScene;
        const threeCamera = camera._internalThreeCamera;
        if (!threeCamera) return;

        // Skybox and fog are scene-wide render settings, and which of them
        // applies depends on the camera's clear flags — so they are resolved
        // here, per frame, rather than when either one is assigned.
        const useSkybox = camera.clearFlags === CameraClearFlags.Skybox;
        RenderSettings._syncToThree(threeScene, useSkybox);
        if (!useSkybox) this.setClearColor(camera.getBackgroundColor(_cameraBackground));

        if (PostProcessing.enabled) {
            PostProcessing._render(this._renderer, threeScene, threeCamera);
        } else {
            this._renderer.render(threeScene, threeCamera);
        }
    }

    /** @inheritDoc */
    public warmup(scene: Scene, camera: Camera): void {
        const threeCamera = camera._internalThreeCamera;
        if (!threeCamera) return;
        ShaderWarmup.warmup(this._renderer, scene._internalThreeScene, threeCamera);
    }

    /** @inheritDoc */
    public dispose(): void {
        this._renderer.dispose();
    }

    /**
     * @internal
     * The underlying Three.js renderer, for engine subsystems that genuinely
     * need it — the KTX2 transcoder's capability detection and the memory
     * profiler's WebGL queries. Not part of {@link RenderBackend}: a subsystem
     * that reaches for this is one that still assumes WebGL.
     */
    public get _internalThreeRenderer(): THREE.WebGLRenderer {
        return this._renderer;
    }

    /** Maps the engine power-preference enum to the WebGL context attribute. */
    private static _toWebGLPowerPreference(p: GraphicsPowerPreference): WebGLPowerPreference {
        switch (p) {
            case GraphicsPowerPreference.LowPower: return "low-power";
            case GraphicsPowerPreference.Default: return "default";
            default: return "high-performance";
        }
    }
}
