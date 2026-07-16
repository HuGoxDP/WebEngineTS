// path: src/engine/core/Application.ts

import * as THREE from "three";
import { SceneManager } from "./SceneManager.ts";
import { Time } from "./Time.ts";
import { EngineSettings } from "./EngineSettings.ts";
import { Camera } from "./components/Camera.ts";
import { Input } from "./Input.ts";
import { Scenario } from "./scenario";
import type { IScenarioLoadProgress } from "./scenario";
import { RenderSettings } from "./RenderSettings.ts";
import { CameraClearFlags } from "./components/Camera.ts";
import { Transform } from "./Transform.ts";
import { ShaderWarmup } from "./rendering/ShaderWarmup.ts";
import { Physics } from "../physics/Physics.ts";
import { Animation } from "./animation/Animation.ts";
import { AudioListener } from "./audio/AudioListener.ts";
import { AudioSource } from "./audio/AudioSource.ts";
import { Canvas } from "./ui/Canvas.ts";
import { EventSystem } from "./ui/EventSystem.ts";
import { ParticleSystem } from "./particles/ParticleSystem.ts";
import { LODGroup } from "./components/LODGroup.ts";
import { Gamepad } from "./input/Gamepad.ts";
import { Touch } from "./input/Touch.ts";
import { PluginManager } from "./plugins/PluginManager.ts";
import { PostProcessing } from "./postprocessing/PostProcessing.ts";

// Reusable THREE.Color to avoid per-frame allocation in _render().
const _clearColor = new THREE.Color();

/**
 * The main engine entry point and game loop.
 *
 * Application owns the Three.js WebGLRenderer, drives the update/render
 * cycle, and manages the canvas. It is a singleton - only one instance
 * may exist at a time.
 *
 * @remarks
 * Equivalent to Unity's `Application` + the internal PlayerLoop.
 *
 * **Update order per frame (Unity-compatible):**
 * 1. `FixedUpdate` - components then scenario (may run 0â€“N times)
 * 2. `Update` - components then scenario
 * 3. `LateUpdate` - components then scenario
 * 4. Render (find camera â†’ render scene)
 * 5. Input reset
 *
 * **Three.js isolation:**
 * The `THREE.WebGLRenderer` is an internal detail. It is never exposed
 * in any public API.
 *
 * **Scenario integration:**
 * Application provides convenience methods for loading and running
 * scenarios. The game loop automatically calls the scenario's
 * `_onFixedUpdate()`, `_onUpdate()`, and `_onLateUpdate()` each frame
 * while a scenario is active, matching ScenarioBehaviour's lifecycle.
 *
 * @example
 * ```ts
 * const app = new Application(document.getElementById("canvas") as HTMLCanvasElement);
 * app.run();
 *
 * // Load a scenario from a downloaded ZIP buffer
 * await app.loadScenarioFromBuffer(zipArrayBuffer);
 * // Scenario is now running...
 *
 * // Later, to stop:
 * app.unloadScenario();
 * ```
 */
export class Application {

    // ==================== STATIC ====================

    /** Singleton instance. */
    private static _instance: Application | null = null;

    /** Returns the current Application instance, or `null`. */
    public static get current(): Application | null {
        return Application._instance;
    }

    /** Engine version string. */
    public static readonly version: string = "0.1.0";

    /**
     * Whether the engine is currently running.
     *
     * @remarks Equivalent to Unity's `Application.isPlaying`.
     */
    public static get isPlaying(): boolean {
        return Application._instance?.isPlaying ?? false;
    }

    /** Target frame rate (informational - actual rate depends on browser). */
    public static get targetFrameRate(): number {
        return 60; // TODO: make configurable
    }

    // ==================== INSTANCE FIELDS ====================

    /** The HTML canvas we render into. */
    public readonly canvas: HTMLCanvasElement;

    /** Whether the game loop is active. */
    public isPlaying: boolean = false;

    /**
     * The underlying Three.js renderer.
     * @internal - never expose to engine users.
     */
    private readonly _threeRenderer: THREE.WebGLRenderer;

    /** Accumulator for fixed-timestep updates. */
    private _fixedUpdateAccumulator: number = 0;

    /** Timestamp of the last frame (in ms). */
    private _lastFrameTime: number = 0;

    /** First-render flag for one-time diagnostics. */
    private _firstRender: boolean = true;

    /** Bound resize handler (stored so we can remove it on dispose). */
    private readonly _resizeHandler: () => void;

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a new Application bound to the given canvas.
     *
     * @param canvas - the HTML canvas element to render into.
     */
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        // Create the Three.js renderer
        this._threeRenderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: "high-performance",
        });
        this._threeRenderer.setPixelRatio(window.devicePixelRatio);

        // Color management — sRGB output for correct gamma
        this._threeRenderer.outputColorSpace = THREE.SRGBColorSpace;

        // Tone mapping — compress HDR to LDR with natural look.
        // ACESFilmic gives film-like contrast and smooth highlight rolloff,
        // making emissive materials glow naturally without bloom post-processing.
        this._threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        this._threeRenderer.toneMappingExposure = 1.0;

        // Enable shadow maps
        this._threeRenderer.shadowMap.enabled = true;
        this._threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Init input
        Input._init(this.canvas);
        Touch._init(this.canvas);

        // Resize to fill window
        this._resizeHandler = () => this._resize();
        this._resize();
        window.addEventListener("resize", this._resizeHandler);

        // Register as singleton
        Application._instance = this;

        // Expose to diagnostics (MemoryProfiler) without circular imports
        (globalThis as any).__webengine_application__ = this;
    }

    // ==================== PUBLIC: GAME LOOP ====================

    /**
     * Starts the game loop.
     *
     * The loop runs at the browser's refresh rate (typically 60 fps)
     * via `requestAnimationFrame`.
     */
    public run(): void {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this._firstRender = true;
        this._lastFrameTime = performance.now();
        console.log("[Application] Engine started.");
        this._loop();
    }

    /**
     * Stops the game loop after the current frame completes.
     */
    public stop(): void {
        this.isPlaying = false;
    }

    // ==================== PUBLIC: SCENARIO ====================

    /**
     * Loads and runs a scenario from a raw ArrayBuffer (ZIP contents).
     *
     * This is the primary integration point for Angular hosts:
     * 1. If a scenario is already running, it is unloaded first.
     * 2. The ZIP is parsed in memory, manifest validated.
     * 3. A Scene is created and the entry point is executed.
     * 4. If the game loop isn't running yet, it is started automatically.
     *
     * @param data - the ZIP file as an ArrayBuffer.
     * @param onProgress - optional callback for loading progress updates.
     * @returns the loaded and running Scenario instance.
     *
     * @example
     * ```ts
     * // Angular component
     * const data = await this.http.get(url, { responseType: 'arraybuffer' }).toPromise();
     * const scenario = await this.app.loadScenarioFromBuffer(data);
     * ```
     */
    public async loadScenarioFromBuffer(
        data: ArrayBuffer,
        onProgress?: (progress: IScenarioLoadProgress) => void
    ): Promise<Scenario> {
        // Unload any existing scenario
        this.unloadScenario();

        const scenario = new Scenario();

        if (onProgress) {
            scenario.onProgress(onProgress);
        }

        await scenario.loadFromData(data);
        await scenario.run();

        // Auto-start engine if not already running
        if (!this.isPlaying) {
            this.run();
        }

        return scenario;
    }

    /**
     * Downloads and runs a scenario from a URL.
     *
     * Convenience wrapper: fetches the ZIP, then delegates to
     * {@link loadScenarioFromBuffer}.
     *
     * @param url - URL to the ZIP archive.
     * @param onProgress - optional callback for loading progress updates.
     * @returns the loaded and running Scenario instance.
     */
    public async loadScenarioFromUrl(
        url: string,
        onProgress?: (progress: IScenarioLoadProgress) => void
    ): Promise<Scenario> {
        // Unload any existing scenario
        this.unloadScenario();

        const scenario = new Scenario();

        if (onProgress) {
            scenario.onProgress(onProgress);
        }

        await scenario.loadFromUrl(url);
        await scenario.run();

        // Auto-start engine if not already running
        if (!this.isPlaying) {
            this.run();
        }

        return scenario;
    }

    /**
     * Unloads the currently running scenario (if any).
     *
     * Calls `Scenario.unload()` which handles the full cleanup chain:
     * entry point teardown â†’ Scene destruction â†’ asset disposal.
     *
     * The game loop continues running after unload - the canvas will
     * show a dark screen until a new scenario is loaded.
     */
    public unloadScenario(): void {
        const current = Scenario.current;
        if (current) {
            current.unload();
        }
    }

    // ==================== PUBLIC: CLEANUP ====================

    /**
     * Fully disposes the Application instance.
     *
     * Unloads any active scenario, stops the game loop, disposes the
     * Three.js renderer, and removes event listeners.
     *
     * Call this when the Angular component hosting the canvas is destroyed.
     */
    public dispose(): void {
        // Unload scenario first
        this.unloadScenario();

        // Stop the game loop
        this.stop();

        // Remove event listeners
        window.removeEventListener("resize", this._resizeHandler);

        // Dispose the Three.js renderer (releases WebGL context)
        this._threeRenderer.dispose();

        // Clear singleton
        if (Application._instance === this) {
            Application._instance = null;
            (globalThis as any).__webengine_application__ = null;
        }

        console.log("[Application] Disposed.");
    }

    // ==================== RENDERING QUALITY ====================

    /**
     * Global exposure multiplier for tone mapping.
     *
     * Higher values brighten the entire scene; lower values darken it.
     * Only effective when tone mapping is enabled (default: ACES Filmic).
     *
     * @remarks
     * Equivalent to Unity's post-processing Exposure override.
     *
     * @default 1.0
     */
    public get exposure(): number {
        return this._threeRenderer.toneMappingExposure;
    }

    public set exposure(value: number) {
        this._threeRenderer.toneMappingExposure = Math.max(0, value);
    }

    /**
     * Whether shadow mapping is enabled globally.
     *
     * @remarks Equivalent to Unity's `QualitySettings.shadows`.
     *
     * @default true
     */
    public get shadowsEnabled(): boolean {
        return this._threeRenderer.shadowMap.enabled;
    }

    public set shadowsEnabled(value: boolean) {
        this._threeRenderer.shadowMap.enabled = value;
    }

    /**
     * The device pixel ratio used for rendering.
     *
     * Set to `1` for performance, or `window.devicePixelRatio` for
     * crisp rendering on high-DPI screens.
     *
     * @remarks Equivalent to Unity's `QualitySettings.resolutionScalingFixedDPIFactor`.
     */
    public get pixelRatio(): number {
        return this._threeRenderer.getPixelRatio();
    }

    public set pixelRatio(value: number) {
        this._threeRenderer.setPixelRatio(Math.max(0.5, Math.min(3, value)));
        this._resize();
    }

    // ==================== INTERNAL ACCESSOR ====================

    /**
     * @internal
     * The underlying Three.js WebGLRenderer, for engine subsystems only.
     */
    public get _internalThreeRenderer(): THREE.WebGLRenderer {
        return this._threeRenderer;
    }

    // ==================== GAME LOOP (PRIVATE) ====================

    /**
     * @internal
     * The main game loop - called once per animation frame.
     *
     * **Update order (Unity-compatible):**
     * 1. FixedUpdate - components, then scenario (0â€“N times)
     * 2. Update - components, then scenario
     * 3. LateUpdate - components, then scenario
     * 4. Render
     * 5. Input reset
     */
    private _loop = (): void => {
        if (!this.isPlaying) return;
        requestAnimationFrame(this._loop);

        // 1. Compute delta time
        const now = performance.now();
        let frameDelta = (now - this._lastFrameTime) / 1000;
        this._lastFrameTime = now;

        // Clamp to prevent spiral-of-death after tab-away
        if (frameDelta > EngineSettings.Time.MAX_DELTA_TIME) {
            frameDelta = EngineSettings.Time.MAX_DELTA_TIME;
        }

        // 2. Update engine time
        Time._update(frameDelta);

        // 2a. Poll gamepads (once per frame, before any Update sees input)
        Gamepad._update();

        // 3. Get active scene and scenario
        const scene = SceneManager.activeScene;
        const scenario = Scenario.current;
        const scenarioRunning = scenario?.isRunning ?? false;

        // 4. Fixed updates (physics timestep) - components then scenario then physics
        this._fixedUpdateAccumulator += frameDelta;
        while (this._fixedUpdateAccumulator >= EngineSettings.Time.FIXED_TIMESTEP) {
            PluginManager._onFixedUpdate(EngineSettings.Time.FIXED_TIMESTEP);
            scene._fixedUpdate();
            if (scenarioRunning) {
                scenario!._onFixedUpdate();
            }
            Physics._step(EngineSettings.Time.FIXED_TIMESTEP);
            this._fixedUpdateAccumulator -= EngineSettings.Time.FIXED_TIMESTEP;
        }

        // 5. Per-frame updates - plugins, components, then scenario
        PluginManager._onUpdate(frameDelta);
        scene._update();
        if (scenarioRunning) {
            scenario!._onUpdate();
        }

        // 6. Animation mixer updates (after Update, before LateUpdate)
        Animation._updateAll();

        // 6a. Particle system simulation (after Update, before LateUpdate)
        ParticleSystem._updateAll();

        // 7. Late updates - components, scenario, then plugins
        scene._lateUpdate();
        if (scenarioRunning) {
            scenario!._onLateUpdate();
        }
        PluginManager._onLateUpdate(frameDelta);

        // 7a. Audio spatial sync (after LateUpdate — uses final world positions)
        AudioListener._updateAll();
        AudioSource._updateAll();

        // 7b. UI event processing (before UI render so button states are up-to-date)
        EventSystem._update();

        // 7c. Level-of-detail selection (uses final world transforms + Camera.main)
        LODGroup._updateAll();

        // 7. Render
        this._render();

        // 8. UI Canvas render (overlay, after 3D scene)
        Canvas._renderAll();

        // 9. Reset per-frame input state
        Input._resetFrame();
        Touch._postUpdate();
    };

    // ==================== RENDERING (PRIVATE) ====================

    /**
     * @internal
     * Renders the active scene using the main camera.
     *
     * Uses {@link Camera.main} to find the camera - no Three.js scene
     * traversal needed.
     */
    private _render(): void {
        const scene = SceneManager.activeScene;
        const threeScene = scene._internalThreeScene;

        // Flush any dirty transforms before matrix recomputation
        Transform._syncAllDirty();

        // Ensure all world matrices are up-to-date
        threeScene.updateMatrixWorld(true);

        // Find the main camera via the engine Camera registry
        const mainCamera = Camera.main;

        if (mainCamera !== null) {
            const threeCamera = mainCamera._internalThreeCamera;

            if (threeCamera !== null) {
                // Sync render settings (skybox, fog) to Three.js
                const useSkybox = mainCamera.clearFlags === CameraClearFlags.Skybox;
                RenderSettings._syncToThree(threeScene, useSkybox);
                // If not using skybox, apply camera background color
                if (!useSkybox) {
                    const bg = mainCamera.backgroundColor;
                    _clearColor.setRGB(bg.r, bg.g, bg.b);
                    this._threeRenderer.setClearColor(_clearColor, bg.a);
                }

                if (PostProcessing.enabled) {
                    PostProcessing._render(this._threeRenderer, threeScene, threeCamera);
                } else {
                    this._threeRenderer.render(threeScene, threeCamera);
                }
            }
        } else {
            // No camera - render dark blue so the user knows the engine is alive
            if (this._firstRender) {
                console.warn(
                    "[Application] No camera found. Add a Camera component to a GameObject."
                );
                this._firstRender = false;
            }
            this._threeRenderer.setClearColor(0x000022);
            this._threeRenderer.clear();
        }

        if (this._firstRender) {
            this._firstRender = false;
        }
    }

    // ==================== SHADER WARMUP ====================

    /**
     * Pre-compiles all shaders for the active scene.
     *
     * Call after scene construction (`awake`) but before the first frame
     * renders. Moves GPU shader compilation cost into a controlled phase,
     * eliminating first-frame stalls.
     *
     * @remarks
     * Equivalent to Unity's `ShaderVariantCollection.WarmUp()`.
     */
    public warmupShaders(): void {
        const scene = SceneManager.activeScene;
        const threeScene = scene._internalThreeScene;
        const mainCamera = Camera.main;
        if (!mainCamera) return;

        const threeCamera = mainCamera._internalThreeCamera;
        if (!threeCamera) return;

        Transform._syncAllDirty();
        threeScene.updateMatrixWorld(true);
        ShaderWarmup.warmup(this._threeRenderer, threeScene, threeCamera);
    }

    // ==================== RESIZE (PRIVATE) ====================

    /**
     * @internal
     * Handles canvas resize - updates renderer size and camera aspect ratios.
     */
    private _resize(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this._threeRenderer.setSize(width, height);
        PostProcessing._setSize(width, height);

        // Update aspect ratio on all active cameras
        const aspect = width / height;
        for (const cam of Camera.allCameras) {
            cam.aspect = aspect;
        }
    }
}