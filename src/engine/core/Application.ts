// path: src/engine/core/Application.ts

import type * as THREE from "three";
import { SceneManager } from "./SceneManager.ts";
import { Time } from "./Time.ts";
import { EngineSettings } from "./EngineSettings.ts";
import { Camera } from "./components/Camera.ts";
import { Input } from "./Input.ts";
import { Scenario } from "./scenario";
import type { IScenarioLoadProgress } from "./scenario";
import type { StreamingAssetSourceOptions } from "./assets/StreamingAssetSource.ts";
import { Transform } from "./Transform.ts";
import { Physics } from "../physics/Physics.ts";
import { Animation } from "./animation/Animation.ts";
import { Animator } from "./animation/Animator.ts";
import { AudioListener } from "./audio/AudioListener.ts";
import { AudioSource } from "./audio/AudioSource.ts";
import { Canvas } from "./ui/Canvas.ts";
import { EventSystem } from "./ui/EventSystem.ts";
import { LayoutGroup } from "./ui/LayoutGroup.ts";
import { ContentSizeFitter } from "./ui/ContentSizeFitter.ts";
import { AspectRatioFitter } from "./ui/AspectRatioFitter.ts";
import { UITween } from "./ui/UITween.ts";
import { ScrollRect } from "./ui/ScrollRect.ts";
import { Selectable } from "./ui/Selectable.ts";
import { ParticleSystem } from "./particles/ParticleSystem.ts";
import { LODGroup } from "./components/LODGroup.ts";
import { Gamepad } from "./input/Gamepad.ts";
import { Touch } from "./input/Touch.ts";
import { PluginManager } from "./plugins/PluginManager.ts";
import { Profiler } from "./diagnostics/Profiler.ts";
import { Color } from "./math/Color.ts";
import { GraphicsPowerPreference } from "./rendering/RenderBackend.ts";
import { WebGLRenderBackend } from "./rendering/WebGLRenderBackend.ts";
import type { RenderBackend, RenderBackendOptions } from "./rendering/RenderBackend.ts";

export { GraphicsPowerPreference } from "./rendering/RenderBackend.ts";

/** Cleared to this when the scene has no camera, so a blank screen is legible. */
const _noCameraColor = new Color(0, 0, 0.13, 1);

/**
 * The main engine entry point and game loop.
 *
 * Application owns a {@link RenderBackend}, drives the update/render cycle,
 * and manages the canvas. It is a singleton - only one instance may exist at
 * a time.
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
 * Application names no Three.js type in its own logic. Everything
 * API-specific lives behind {@link RenderBackend};
 * {@link Application.backendFactory} chooses the implementation.
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
     * GPU power-preference hint for the WebGL context. Set this **before**
     * constructing the {@link Application} — the renderer reads it once, at
     * construction, and it cannot change afterwards.
     *
     * Useful for benchmarking the integrated vs. discrete GPU on dual-GPU
     * laptops. The browser/OS may still override the hint (see the OS graphics
     * settings for the browser).
     *
     * @default GraphicsPowerPreference.HighPerformance
     *
     * @example
     * ```ts
     * Application.powerPreference = GraphicsPowerPreference.LowPower; // integrated GPU
     * const app = new Application(canvas);
     * ```
     */
    public static powerPreference: GraphicsPowerPreference = GraphicsPowerPreference.HighPerformance;

    /**
     * Builds the {@link RenderBackend} the Application draws through. Set it
     * **before** constructing the Application; null uses the WebGL 2 backend.
     *
     * @remarks
     * The seam a second graphics API is added through — a WebGPU backend is an
     * implementation of {@link RenderBackend}, not a change to the loop. It is
     * a static rather than a constructor argument so that hosts which only ever
     * see `new Application(canvas)` (every scenario, the platform viewer) do
     * not have to thread it through.
     *
     * @example
     * ```ts
     * Application.backendFactory = options => new MyWebGPUBackend(options);
     * const app = new Application(canvas);
     * ```
     */
    public static backendFactory: ((options: RenderBackendOptions) => RenderBackend) | null = null;

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

    /**
     * Main-thread (CPU) time in milliseconds spent processing the last frame —
     * updates, rendering, UI, and input. This is the *busy* portion of the
     * frame and excludes the idle wait until the next display refresh, so it
     * distinguishes CPU-bound work from a frame rate capped by VSync.
     *
     * @remarks
     * Browsers do not expose OS-level CPU usage; this measured frame time is the
     * meaningful main-thread load metric. `0` until the loop has run once.
     */
    public get cpuFrameTime(): number {
        return Profiler.frameCpuMs;
    }

    /**
     * Main-thread (CPU) time in ms of the very first rendered frame after the
     * loop started. With shader warmup this is a clean frame; without it, this
     * is where the shader-compilation stall appears. `0` until the first frame.
     */
    public get firstFrameCpuTime(): number {
        return Profiler.firstFrameCpuMs;
    }

    /** Main-thread (CPU) ms spent in the FixedUpdate phase last frame. */
    public get fixedUpdateTime(): number {
        return Profiler.phases.fixedUpdate;
    }

    /** Main-thread (CPU) ms spent in the Update phase last frame (incl. animation, particles). */
    public get updateTime(): number {
        return Profiler.phases.update;
    }

    /** Main-thread (CPU) ms spent in the LateUpdate phase last frame (incl. audio, events, LOD). */
    public get lateUpdateTime(): number {
        return Profiler.phases.lateUpdate;
    }

    /** Main-thread (CPU) ms spent rendering last frame (3D scene + UI canvas). */
    public get renderTime(): number {
        return Profiler.phases.render;
    }

    // ==================== INSTANCE FIELDS ====================

    /** The HTML canvas we render into. */
    public readonly canvas: HTMLCanvasElement;

    /** Whether the game loop is active. */
    public isPlaying: boolean = false;

    /**
     * When `true`, {@link loadScenarioFromBuffer} / {@link loadScenarioFromUrl}
     * pre-compile all shaders (via {@link warmupShaders}) during loading, before
     * the loop's first render — so the shader-compilation stall is paid in the
     * (tolerated) load phase instead of on the first interactive frame. Set it
     * before loading a scenario. Default `false`.
     */
    public warmupShadersOnLoad: boolean = false;

    /** The graphics backend this Application draws through. */
    private readonly _backend: RenderBackend;

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

        const options: RenderBackendOptions = {
            canvas: this.canvas,
            antialias: true,
            powerPreference: Application.powerPreference,
            pixelRatio: window.devicePixelRatio,
        };
        this._backend = Application.backendFactory
            ? Application.backendFactory(options)
            : new WebGLRenderBackend(options);

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
        Profiler._reset();
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

    /**
     * Shared tail of the scenario loaders: optionally warm up shaders (so the
     * compile stall is paid during loading, before the first render), then start
     * the loop if it is not already running.
     */
    private _autoStartAfterLoad(): void {
        if (this.warmupShadersOnLoad) this.warmupShaders();
        if (!this.isPlaying) this.run();
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

        // Warm up shaders during load (if requested), then start the loop.
        this._autoStartAfterLoad();

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

        // Warm up shaders during load (if requested), then start the loop.
        this._autoStartAfterLoad();

        return scenario;
    }

    /**
     * Downloads and runs a scenario from a streaming manifest.
     *
     * @remarks
     * The manifest-driven alternative to {@link loadScenarioFromUrl}: scripts
     * and assets are fetched individually from the URLs a `scenario.json`
     * lists, rather than unpacked from one archive. Scenario code is unaffected
     * — the same `Resources` calls resolve against the manifest instead of the
     * ZIP — so a scenario can be published either way without being rebuilt.
     *
     * @param url - URL of the manifest document (`scenario.json`).
     * @param onProgress - optional callback for loading progress updates.
     * @param options - base URL override and fetch implementation.
     * @returns the loaded and running Scenario instance.
     *
     * @example
     * ```ts
     * const scenario = await app.loadScenarioFromManifest(
     *     "https://cdn.example.org/scenarios/solar/scenario.json",
     * );
     * ```
     */
    public async loadScenarioFromManifest(
        url: string,
        onProgress?: (progress: IScenarioLoadProgress) => void,
        options?: StreamingAssetSourceOptions,
    ): Promise<Scenario> {
        // Unload any existing scenario
        this.unloadScenario();

        const scenario = new Scenario();

        if (onProgress) {
            scenario.onProgress(onProgress);
        }

        await scenario.loadFromManifestUrl(url, options);
        await scenario.run();

        // Warm up shaders during load (if requested), then start the loop.
        this._autoStartAfterLoad();

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

        // Release the graphics context
        this._backend.dispose();

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
        return this._backend.exposure;
    }

    public set exposure(value: number) {
        this._backend.exposure = Math.max(0, value);
    }

    /**
     * Whether shadow mapping is enabled globally.
     *
     * @remarks Equivalent to Unity's `QualitySettings.shadows`.
     *
     * @default true
     */
    public get shadowsEnabled(): boolean {
        return this._backend.shadowsEnabled;
    }

    public set shadowsEnabled(value: boolean) {
        this._backend.shadowsEnabled = value;
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
        return this._backend.pixelRatio;
    }

    public set pixelRatio(value: number) {
        this._backend.pixelRatio = Math.max(0.5, Math.min(3, value));
        this._resize();
    }

    // ==================== INTERNAL ACCESSOR ====================

    /**
     * The graphics backend this Application draws through.
     *
     * @remarks
     * Engine-typed: it reports the API in use and the GPU counters without
     * naming the library underneath. Hosts read it for diagnostics; to *choose*
     * one, set {@link Application.backendFactory} before construction.
     */
    public get graphics(): RenderBackend {
        return this._backend;
    }

    /**
     * @internal
     * The underlying Three.js renderer, or null when the active backend is not
     * the WebGL one. For the two subsystems that still assume WebGL: the KTX2
     * transcoder's capability detection and the memory profiler's GL queries.
     */
    public get _internalThreeRenderer(): THREE.WebGLRenderer | null {
        return this._backend instanceof WebGLRenderBackend
            ? this._backend._internalThreeRenderer
            : null;
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

        // Roll the marker profiler to a new frame (no-op unless Profiler.enabled).
        Profiler._beginFrame();

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
        const tFixedStart = performance.now();
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

        const tUpdateStart = performance.now();
        const fixedUpdateMs = tUpdateStart - tFixedStart;

        // 5. Per-frame updates - plugins, components, then scenario
        PluginManager._onUpdate(frameDelta);
        scene._update();
        if (scenarioRunning) {
            scenario!._onUpdate();
        }

        // 6. Animation mixer updates (after Update, before LateUpdate)
        // State machines first: a transition decided this frame is the one
        // the mixer then plays, rather than landing a frame late.
        Animator._updateAll();
        Animation._updateAll();

        // 6a. Particle system simulation (after Update, before LateUpdate)
        ParticleSystem._updateAll();

        const tLateStart = performance.now();
        const updateMs = tLateStart - tUpdateStart;

        // 7. Late updates - components, scenario, then plugins
        scene._lateUpdate();
        if (scenarioRunning) {
            scenario!._onLateUpdate();
        }
        PluginManager._onLateUpdate(frameDelta);

        // 7a. Audio spatial sync (after LateUpdate — uses final world positions)
        AudioListener._updateAll();
        AudioSource._updateAll();

        // 7b. UI layout — groups arrange their children, then fitters resize to
        // the result. Ahead of input so a click hit-tests the positions that
        // will actually be drawn this frame.
        // Tweens first: a tweened size or position must be laid out and drawn on
        // the same frame it changed, not one behind.
        UITween._updateAll();

        LayoutGroup._updateAll();
        ContentSizeFitter._updateAll();

        // Aspect ratios are resolved last of the three: they constrain one axis
        // against the other, so they need both to have settled first.
        AspectRatioFitter._updateAll();

        // Scroll views move content once its size is settled, so inertia and
        // spring-back cannot fight a layout pass that has not run yet.
        ScrollRect._updateAll();

        // Where each canvas sits on the render surface — for a world-space one,
        // this frame's projection. Ahead of the event pass so a click hit-tests
        // the position the paint pass is about to use.
        Canvas._updateTransforms();

        // 7c. UI event processing (before UI render so button states are up-to-date)
        EventSystem._update();

        // 7c-bis. Control transitions, after the states they read have settled.
        Selectable._updateAll();

        // 7d. Level-of-detail selection (uses final world transforms + Camera.main)
        LODGroup._updateAll();

        const tRenderStart = performance.now();
        const lateUpdateMs = tRenderStart - tLateStart;

        // 7. Render
        this._render();

        // 8. UI Canvas render (overlay, after 3D scene)
        Canvas._renderAll();

        // 8a. Tell the scenario a frame reached the screen. It uses the first
        //     one to start loading whatever was deferred past first paint —
        //     the decision lives there, so the loop needs no scenario state.
        if (scenarioRunning) {
            scenario!._onFrameRendered();
        }

        const renderMs = performance.now() - tRenderStart;

        // 9. Reset per-frame input state
        Input._resetFrame();
        Touch._postUpdate();

        // 10. Report this frame's main-thread cost and phase split to the
        // profiler — the single source of timing data for diagnostics.
        Profiler._recordFrame(
            performance.now() - now,
            fixedUpdateMs, updateMs, lateUpdateMs, renderMs,
        );
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

        // Flush any dirty transforms before matrix recomputation
        Transform._syncAllDirty();

        // Ensure all world matrices are up-to-date
        scene._internalThreeScene.updateMatrixWorld(true);

        // Find the main camera via the engine Camera registry
        const mainCamera = Camera.main;

        if (mainCamera !== null) {
            this._backend.renderScene(scene, mainCamera);
        } else {
            // No camera - render dark blue so the user knows the engine is alive
            if (this._firstRender) {
                console.warn(
                    "[Application] No camera found. Add a Camera component to a GameObject."
                );
            }
            this._backend.setClearColor(_noCameraColor);
            this._backend.clear();
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
        const mainCamera = Camera.main;
        if (!mainCamera) return;

        Transform._syncAllDirty();
        scene._internalThreeScene.updateMatrixWorld(true);
        this._backend.warmup(scene, mainCamera);
    }

    // ==================== RESIZE (PRIVATE) ====================

    /**
     * @internal
     * Handles canvas resize - updates renderer size and camera aspect ratios.
     */
    private _resize(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this._backend.setSize(width, height);

        // Update aspect ratio on all active cameras
        const aspect = width / height;
        for (const cam of Camera.allCameras) {
            cam.aspect = aspect;
        }
    }
}