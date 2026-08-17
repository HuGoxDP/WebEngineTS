import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Camera } from "../src/engine/core/components/Camera";
import { Color } from "../src/engine/core/math/Color";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "../src/engine/core/rendering/RenderBackend";
import type { Scene } from "../src/engine/core/Scene";

/**
 * A backend that draws nothing and records what it was asked to do.
 *
 * @remarks
 * That this can exist at all — no WebGL, no canvas context, no Three.js
 * renderer — is the property the seam is for.
 */
class FakeBackend implements RenderBackend {
    public readonly api = GraphicsAPI.WebGPU;
    public pixelRatio: number;
    public exposure: number = 1;
    public shadowsEnabled: boolean = true;
    public readonly stats: RenderBackendStats | null = null;

    public readonly options: RenderBackendOptions;
    public sizes: Array<[number, number]> = [];
    public frames: Array<{ scene: Scene; camera: Camera }> = [];
    public clearColors: Color[] = [];
    public clears: number = 0;
    public warmups: number = 0;
    public disposed: boolean = false;

    constructor(options: RenderBackendOptions) {
        this.options = options;
        this.pixelRatio = options.pixelRatio;
    }

    public setSize(width: number, height: number): void {
        this.sizes.push([width, height]);
    }

    public setClearColor(color: Color): void {
        this.clearColors.push(new Color(color.r, color.g, color.b, color.a));
    }

    public clear(): void { this.clears++; }

    public renderScene(scene: Scene, camera: Camera): void {
        this.frames.push({ scene, camera });
    }

    public warmup(): void { this.warmups++; }

    public dispose(): void { this.disposed = true; }
}

/** The smallest DOM the Application constructor and input plumbing touch. */
function installDomStubs(): () => void {
    const listeners = { addEventListener() {}, removeEventListener() {} };
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document };

    g.window = { ...listeners, devicePixelRatio: 2, innerWidth: 800, innerHeight: 600 };
    g.document = { ...listeners, pointerLockElement: null };

    return () => {
        g.window = saved.window;
        g.document = saved.document;
    };
}

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

/** The canvas the stubs above hand to the Application. */
function stubCanvas(): HTMLCanvasElement {
    return {
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement;
}

describe("RenderBackend — the seam", () => {
    let restoreDom: () => void;

    beforeEach(() => {
        restoreDom = installDomStubs();
    });

    afterEach(async () => {
        const Application = await loadApplication();
        Application.current?.dispose();
        Application.backendFactory = null;
        Application.powerPreference = GraphicsPowerPreference.HighPerformance;
        restoreDom();
    });

    async function makeApp(): Promise<{ app: InstanceType<Awaited<ReturnType<typeof loadApplication>>>; backend: FakeBackend }> {
        const Application = await loadApplication();
        let backend!: FakeBackend;
        Application.backendFactory = options => (backend = new FakeBackend(options));
        const app = new Application(stubCanvas());
        return { app, backend };
    }

    test("the factory decides what draws, and the Application never makes a context", async () => {
        const { app, backend } = await makeApp();

        expect(app.graphics).toBe(backend);
        expect(app.graphics.api).toBe(GraphicsAPI.WebGPU);
        expect(app._internalThreeRenderer).toBeNull();
    });

    test("construction options carry the canvas and the power preference", async () => {
        const Application = await loadApplication();
        Application.powerPreference = GraphicsPowerPreference.LowPower;

        const { backend } = await makeApp();

        expect(backend.options.powerPreference).toBe(GraphicsPowerPreference.LowPower);
        expect(backend.options.pixelRatio).toBe(2);
        expect(backend.options.antialias).toBe(true);
    });

    test("the initial resize reaches the backend", async () => {
        const { backend } = await makeApp();

        expect(backend.sizes).toContainEqual([800, 600]);
    });

    test("quality settings are delegated, and clamped on the way", async () => {
        const { app, backend } = await makeApp();

        app.exposure = -3;
        app.shadowsEnabled = false;
        app.pixelRatio = 9;

        expect(backend.exposure).toBe(0);
        expect(backend.shadowsEnabled).toBe(false);
        expect(backend.pixelRatio).toBe(3);
        expect(app.pixelRatio).toBe(3);
    });

    test("a frame is handed over as engine types", async () => {
        const { app, backend } = await makeApp();
        const camera = new GameObject("Cam").addComponent(Camera);

        // _render is private; driving it directly is the point of the test —
        // run() would need requestAnimationFrame and every other subsystem.
        (app as unknown as { _render(): void })._render();

        expect(backend.frames.length).toBe(1);
        expect(backend.frames[0].camera).toBe(camera);
        expect(backend.frames[0].scene).toBe(SceneManager.activeScene);
        camera.gameObject.destroy();
    });

    test("with no camera the backend is asked to clear, not to draw", async () => {
        const { app, backend } = await makeApp();

        (app as unknown as { _render(): void })._render();

        expect(backend.frames.length).toBe(0);
        expect(backend.clears).toBe(1);
        expect(backend.clearColors[backend.clearColors.length - 1].b).toBeCloseTo(0.13);
    });

    test("shader warmup goes through the backend", async () => {
        const { app, backend } = await makeApp();
        const camera = new GameObject("Cam").addComponent(Camera);

        app.warmupShaders();

        expect(backend.warmups).toBe(1);
        camera.gameObject.destroy();
    });

    test("disposing the Application disposes the backend", async () => {
        const { app, backend } = await makeApp();

        app.dispose();

        expect(backend.disposed).toBe(true);
    });
});
