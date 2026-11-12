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
import { RenderTexture, RenderTextureFormat } from "../graphics/RenderTexture";

/** Reused so setting the clear colour allocates nothing per frame. */
const _clearColor = new THREE.Color();

/**
 * Reused for the same reason, one step earlier: `Camera.backgroundColor` is a
 * value type and hands back a copy, so reading it per frame allocated one.
 */
const _cameraBackground = new Color();

/** Reused for the render-surface size when applying a camera's viewport rect. */
const _backendSize = new THREE.Vector2();

// ==================== RENDER-TARGET PLAN ====================
// What a target render does, decided without touching GL, so it is unit-testable.

/**
 * What clearing a target render means, for one set of clear flags.
 *
 * @internal — engine-only.
 */
export interface TargetClearPlan {
    /** Clear colour. */
    readonly color: boolean;
    /** Clear depth. */
    readonly depth: boolean;
    /** Clear stencil. */
    readonly stencil: boolean;
    /** Draw the skybox instead of a colour (`RenderSettings._syncToThree` decides). */
    readonly skybox: boolean;
}

/**
 * Resolves a camera's clear flags into the clear a **target** render performs.
 *
 * @remarks
 * The screen path keeps the full clear it has always had; a target gets exactly
 * what the flags ask for, because `Nothing` on a target is Unity's layering
 * primitive (a second camera drawing on top of the first camera's image) and
 * clearing it anyway would make the flag a lie. Decision D6.
 *
 * `SolidColor` clears colour and depth, `Skybox` clears depth and lets the
 * skybox carry the background, `Depth` clears depth only, `Nothing` clears
 * nothing at all.
 *
 * @internal — engine-only. Pure, so a test needs no GL context.
 */
export function _clearPlan(flags: CameraClearFlags): TargetClearPlan {
    switch (flags) {
        case CameraClearFlags.SolidColor:
            return { color: true, depth: true, stencil: false, skybox: false };
        case CameraClearFlags.Skybox:
            return { color: false, depth: true, stencil: false, skybox: true };
        case CameraClearFlags.Depth:
            return { color: false, depth: true, stencil: false, skybox: false };
        case CameraClearFlags.Nothing:
            return { color: false, depth: false, stencil: false, skybox: false };
        default:
            return { color: true, depth: true, stencil: false, skybox: false };
    }
}

/**
 * A viewport rect resolved to pixels, and whether the scissor test is needed.
 *
 * @internal — engine-only.
 */
export interface TargetViewport {
    /** Left edge in pixels. */
    readonly x: number;
    /** Bottom edge in pixels (GL convention). */
    readonly y: number;
    /** Width in pixels. */
    readonly width: number;
    /** Height in pixels. */
    readonly height: number;
    /** Whether only this region may be touched. */
    readonly scissor: boolean;
}

/** A rect of zero area: nothing to draw, and nothing to enable the scissor for. */
const EMPTY_VIEWPORT: TargetViewport = { x: 0, y: 0, width: 0, height: 0, scissor: false };

/**
 * Applies a camera's normalized viewport rect to a target's pixel size.
 *
 * @remarks
 * The same rule the screen path uses, in the target's pixels instead of the
 * canvas's: a full-surface rect (the default) covers everything with the scissor
 * test off, and a sub-rect renders — and clears — that region only. Unity
 * applies a camera's `rect` to render targets the same way. Decision D6.
 *
 * @internal — engine-only. Pure, so a test needs no GL context.
 *
 * @param rect - the camera's normalized rect, Y-up.
 * @param width - the target's width in pixels.
 * @param height - the target's height in pixels.
 */
export function _targetViewport(
    rect: { x: number; y: number; width: number; height: number },
    width: number,
    height: number
): TargetViewport {
    if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return EMPTY_VIEWPORT;
    if (rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1) {
        return { x: 0, y: 0, width, height, scissor: false };
    }
    return {
        x: Math.round(rect.x * width),
        y: Math.round(rect.y * height),
        width: Math.round(rect.width * width),
        height: Math.round(rect.height * height),
        scissor: true
    };
}

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
    public renderScene(scene: Scene, camera: Camera, target: RenderTexture | null = null): void {
        const threeScene = scene._internalThreeScene;
        const threeCamera = camera._internalThreeCamera;
        if (!threeCamera) return;
        if (target === null) return this._renderToSurface(scene, camera, threeScene, threeCamera);
        return this._renderToTarget(scene, camera, target, threeScene, threeCamera);
    }

    /**
     * The screen path: unchanged, and the only thing that may change it is a
     * deliberate decision to change it. Byte-identical to `06aeaf5`.
     */
    private _renderToSurface(scene: Scene, camera: Camera, threeScene: THREE.Scene, threeCamera: THREE.Camera): void {
        // Honour the camera's normalized viewport rect (Unity's Camera.rect, Y-up).
        // A full-surface rect keeps the previous behaviour with scissor off; a
        // sub-rect renders — and clears — only that region.
        const vp = camera._internalViewport;
        this._renderer.getSize(_backendSize);
        if (vp.x === 0 && vp.y === 0 && vp.width === 1 && vp.height === 1) {
            this._renderer.setViewport(0, 0, _backendSize.x, _backendSize.y);
            this._renderer.setScissorTest(false);
        } else {
            const vx = vp.x * _backendSize.x;
            const vy = vp.y * _backendSize.y;
            const vw = vp.width * _backendSize.x;
            const vh = vp.height * _backendSize.y;
            this._renderer.setViewport(vx, vy, vw, vh);
            this._renderer.setScissor(vx, vy, vw, vh);
            this._renderer.setScissorTest(true);
        }

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

    /**
     * The target path (C6, decision D6): camera into target, whole image.
     *
     * @remarks
     * Every piece of GL state this changes is restored in the `finally`, so a
     * render into a target cannot disturb the frame that follows: the surface
     * target, `autoClear`, the viewport and the scissor test. A camera with a
     * zero-area viewport draws nothing and no GL error. Post-processing never
     * runs here — it is a screen pipeline bound to one camera, and alternating
     * cameras would rebuild it every frame.
     */
    private _renderToTarget(scene: Scene, camera: Camera, target: RenderTexture,
        threeScene: THREE.Scene, threeCamera: THREE.Camera): void {
        if (!target.exists()) {
            console.warn("[RenderBackend] renderScene into a destroyed RenderTexture; nothing was drawn.");
            return;
        }
        const three = target._internalThreeRenderTarget;
        const width = target._internalThreeRenderTarget.width;
        const height = target._internalThreeRenderTarget.height;

        // A camera with no pixels to draw into is not an error: it draws nothing.
        const viewport = _targetViewport(camera._internalViewport, width, height);
        if (viewport.width <= 0 || viewport.height <= 0) return;

        // Unity creates a target on the render that uses it (D3), and the
        // backend is the only thing that knows the allocation happened.
        target._markCreatedByBackend();

        this._renderer.setRenderTarget(three);
        // three's own auto-clear would clear with whatever clear colour the
        // screen path last set, which is not what the camera's flags asked for;
        // the explicit clear below is the one that counts.
        const autoClear = this._renderer.autoClear;
        this._renderer.autoClear = false;

        this._renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
        this._renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
        this._renderer.setScissorTest(viewport.scissor);

        try {
            const plan = _clearPlan(camera.clearFlags);
            RenderSettings._syncToThree(threeScene, plan.skybox);
            if (plan.color) this.setClearColor(camera.getBackgroundColor(_cameraBackground));
            this._renderer.clear(plan.color, plan.depth, plan.stencil);

            // A target is not tone-mapped and not post-processed: the screen pass
            // that shows it does the one tone mapping that applies (D7).
            this._renderer.render(threeScene, threeCamera);
        } finally {
            // The screen's own state, exactly as the surface path leaves it.
            this._renderer.setRenderTarget(null);
            this._renderer.autoClear = autoClear;
            this._renderer.getSize(_backendSize);
            this._renderer.setViewport(0, 0, _backendSize.x, _backendSize.y);
            this._renderer.setScissorTest(false);
        }
    }

    /** @inheritDoc */
    public readPixels(target: RenderTexture, x: number, y: number, width: number, height: number, out: Uint8Array): boolean {
        if (!target.exists()) return false;
        // A half-float target has no readable byte form here, and reading it as
        // bytes would hand back garbage. Decision D9: false, and the caller's
        // texture is left untouched.
        if (target.format === RenderTextureFormat.ARGBHalf) return false;
        const bytes = width * height * 4;
        if (out.length < bytes) return false;

        // `readRenderTargetPixels` reads the framebuffer as it stands, with the
        // first row at the bottom (GL convention). Everything the engine hands a
        // script is top-down, so the rows are flipped on the way out.
        this._renderer.readRenderTargetPixels(
            target._internalThreeRenderTarget, x, y, width, height, out);
        for (let row = 0; row < height >> 1; row++) {
            const top = row * width * 4;
            const bottom = (height - 1 - row) * width * 4;
            for (let byte = 0; byte < width * 4; byte++) {
                const from = bottom + byte;
                const to = top + byte;
                const pixel = out[from];
                out[from] = out[to];
                out[to] = pixel;
            }
        }
        return true;
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
