import type { Color } from "../math/Color";
import type { Scene } from "../Scene";
import type { Camera } from "../components/Camera";

/**
 * GPU power-preference hint applied when the graphics context is created.
 *
 * On dual-GPU laptops this influences whether the browser uses the integrated
 * or the discrete GPU. Must be set on {@link Application.powerPreference} before
 * the Application is constructed — the backend reads it once, at construction.
 *
 * @remarks Maps to the standard WebGL/WebGPU `powerPreference` context attribute.
 */
export enum GraphicsPowerPreference {
    /** Let the browser / operating system decide. */
    Default = "default",
    /** Prefer the discrete / high-performance GPU. */
    HighPerformance = "high-performance",
    /** Prefer the integrated / low-power GPU. */
    LowPower = "low-power",
}

/** Which graphics API a {@link RenderBackend} draws through. */
export enum GraphicsAPI {
    /** WebGL 2, via Three.js' WebGLRenderer. The default. */
    WebGL2 = "WebGL2",
    /** WebGPU. Not implemented yet — see roadmap P1.6. */
    WebGPU = "WebGPU",
}

/**
 * What the GPU did last frame, and what it is holding.
 *
 * @remarks
 * Deliberately a plain engine-typed record rather than the backend's own
 * counters, so diagnostics do not have to know which API produced them.
 */
export interface RenderBackendStats {
    /** Draw calls submitted last frame. */
    readonly drawCalls: number;
    /** Triangles submitted last frame. */
    readonly triangles: number;
    /** Geometries currently resident on the GPU. */
    readonly geometries: number;
    /** Textures currently resident on the GPU. */
    readonly textures: number;
    /** Compiled shader programs currently held. */
    readonly programs: number;
}

/** What a {@link RenderBackend} is constructed with. */
export interface RenderBackendOptions {
    /** The canvas the backend draws into. */
    readonly canvas: HTMLCanvasElement;
    /** Whether to request multisampling. */
    readonly antialias: boolean;
    /** Which GPU to ask the browser for. */
    readonly powerPreference: GraphicsPowerPreference;
    /** Initial device pixel ratio. */
    readonly pixelRatio: number;
}

/**
 * The seam between the engine and the graphics API it draws through.
 *
 * @remarks
 * Everything below this interface is one API's business; everything above it
 * is the engine's. `Application` owns a backend and never names Three.js
 * itself — which is what makes a second backend (WebGPU, roadmap P1.6) an
 * addition rather than a rewrite of the loop.
 *
 * The interface is deliberately **frame-level, not draw-level**: it takes a
 * {@link Scene} and a {@link Camera} and is asked to produce a frame. A
 * draw-level seam (submit mesh, bind material) would be a second renderer
 * written in engine types, and the engine would then be maintaining two.
 *
 * Install one before constructing the Application:
 *
 * ```ts
 * Application.backendFactory = options => new MyBackend(options);
 * const app = new Application(canvas);
 * ```
 *
 * A backend that cannot honour a setting should ignore it rather than throw —
 * `exposure` on a backend without tone mapping is a no-op, not an error.
 */
export interface RenderBackend {

    /** Which API this backend draws through. */
    readonly api: GraphicsAPI;

    /** Device pixel ratio the backend renders at. */
    pixelRatio: number;

    /** Global tone-mapping exposure multiplier. */
    exposure: number;

    /** Whether shadow maps are rendered. */
    shadowsEnabled: boolean;

    /** GPU counters, or null when the backend does not track them. */
    readonly stats: RenderBackendStats | null;

    /**
     * Resizes the drawing surface.
     *
     * @param width - CSS pixels.
     * @param height - CSS pixels.
     */
    setSize(width: number, height: number): void;

    /**
     * Sets the colour the surface is cleared to.
     *
     * @param color - the clear colour; its alpha is the clear alpha.
     */
    setClearColor(color: Color): void;

    /** Clears the surface to the clear colour without drawing anything. */
    clear(): void;

    /**
     * Draws one frame.
     *
     * @param scene - the scene to draw.
     * @param camera - the camera to draw it from.
     */
    renderScene(scene: Scene, camera: Camera): void;

    /**
     * Pre-compiles the shaders a scene needs.
     *
     * @remarks
     * Moves the compilation stall out of the first rendered frame. A backend
     * with no ahead-of-time compilation step may do nothing.
     *
     * @param scene - the scene to compile for.
     * @param camera - the camera it will be drawn from.
     */
    warmup(scene: Scene, camera: Camera): void;

    /** Releases the graphics context and everything the backend holds. */
    dispose(): void;
}
