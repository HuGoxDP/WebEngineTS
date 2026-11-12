import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "../src/engine/core/rendering/RenderBackend";

/**
 * G5: `Time.timeScale` survived `Application.dispose()` and the next scenario.
 *
 * `Time` is static state — the scale, the deltas, the frame count — and
 * `Time._reset()` had no caller, so a host that reuses one page realm (opens a
 * viewer, the student pauses or slows the scenario, closes it, opens another)
 * started the next scenario with the old scale: everything frozen at timeScale 0
 * or running at half speed, with no sign of why. The platform never saw it (it
 * runs every scenario in a fresh player frame); any host that does not, did.
 * `Application.dispose()` now calls `Time._reset()` beside the other module
 * resets (`AudioManager._reset`, the pending destroys, the texture releases).
 */

class FakeBackend implements RenderBackend {
    public readonly api = GraphicsAPI.WebGPU;
    public pixelRatio: number;
    public exposure = 1;
    public shadowsEnabled = true;
    public readonly stats: RenderBackendStats | null = null;
    constructor(options: RenderBackendOptions) { this.pixelRatio = options.pixelRatio; }
    public setSize(): void {}
    public setClearColor(): void {}
    public clear(): void {}
    public renderScene(): void {}
    public readPixels(): boolean { return false; }
    public warmup(): void {}
    public dispose(): void {}
}

function installDomStubs(): () => void {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame };
    g.window = {
        addEventListener() {}, removeEventListener() {},
        devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    };
    g.document = { addEventListener() {}, removeEventListener() {}, pointerLockElement: null };
    g.requestAnimationFrame = () => 0;
    return () => {
        g.window = saved.window;
        g.document = saved.document;
        g.requestAnimationFrame = saved.raf;
    };
}

function stubCanvas(): HTMLCanvasElement {
    return {
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement;
}

async function loadTime() {
    return (await import("../src/engine/core/Time")).Time;
}

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

let restoreDom: () => void;

beforeEach(() => { restoreDom = installDomStubs(); });

afterEach(async () => {
    const Application = await loadApplication();
    Application.current?.dispose();
    Application.backendFactory = null;
    Application.powerPreference = GraphicsPowerPreference.HighPerformance;
    restoreDom();
});

describe("Time after disposing an Application", () => {
    test("a paused scenario's timeScale does not reach the next one", async () => {
        const Time = await loadTime();
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);
        const app = new Application(stubCanvas()) as unknown as {
            isPlaying: boolean;
            dispose(): void;
        };
        app.isPlaying = true;

        // The visitor pauses (or slows) the scenario.
        Time.timeScale = 0;
        expect(Time.timeScale).toBe(0);

        // They leave. The page — this host — stays.
        app.dispose();

        expect(Time.timeScale).toBe(1);
        expect(Time.frameCount).toBe(0);
        expect(Time.deltaTime).toBe(0);
    });

    test("a slowed scenario's scale and a used frame count do not carry over", async () => {
        const Time = await loadTime();
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);
        const app = new Application(stubCanvas()) as unknown as {
            isPlaying: boolean;
            dispose(): void;
        };
        app.isPlaying = true;

        Time.timeScale = 0.25;
        const internals = app as unknown as { _lastFrameTime: number; _loop(): void };
        internals._lastFrameTime = performance.now() - 16;
        internals._loop();
        expect(Time.frameCount).toBeGreaterThan(0);
        expect(Time.timeScale).toBe(0.25);

        app.dispose();

        expect(Time.timeScale).toBe(1);
        expect(Time.frameCount).toBe(0);
    });
});
