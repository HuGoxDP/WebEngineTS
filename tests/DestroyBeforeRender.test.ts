import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "../src/engine/core/rendering/RenderBackend";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { EngineObject } from "../src/engine/core/EngineObject";

/**
 * A zero-delay `Destroy` must take effect after the current Update loop but
 * before the frame renders — Unity's rule, verbatim: "Actual object
 * destruction is always delayed until after the current Update loop, but
 * always happens before rendering."
 *
 * It rode a `queueMicrotask`, which inside the loop drains only after the whole
 * frame body — after LateUpdate, after the render and after the UI canvas
 * paint. So an object destroyed in `update` was laid out, audio-synced,
 * hit-tested by the event system and drawn one frame longer than it existed: a
 * bullet that left the world still appeared on the screen. A delayed destroy
 * already died at the right phase (Application's `7a-`), so the two disagreed
 * about when "end of frame" is.
 *
 * Probe that found it, on a running Application with a doomed sibling:
 * `["destroyer:update","victim:lateUpdate","loop:render","victim:onDestroy"]`.
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

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

describe("A zero-delay Destroy inside a running loop", () => {
    let restoreDom: () => void;

    beforeEach(() => { restoreDom = installDomStubs(); });

    afterEach(async () => {
        const Application = await loadApplication();
        Application.current?.dispose();
        Application.backendFactory = null;
        Application.powerPreference = GraphicsPowerPreference.HighPerformance;
        restoreDom();
        EngineObject._clearPendingDestroys();
    });

    test("destroys its object before the frame renders it", async () => {
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);

        const steps: string[] = [];
        const victim = new GameObject("Victim");

        class Doomed extends ScriptableBehaviour {
            public override lateUpdate(): void { steps.push("victim:lateUpdate"); }
            public override onDestroy(): void { steps.push("victim:onDestroy"); }
        }
        victim.addComponent(Doomed);

        class Destroyer extends ScriptableBehaviour {
            public override update(): void {
                steps.push("destroyer:update");
                EngineObject.Destroy(victim, 0);
            }
        }
        new GameObject("Destroyer").addComponent(Destroyer);

        // The render marker: the backend's `renderScene` is the render call, and
        // the doomed object is still in the scene that reaches it.
        const renderProto = Application.prototype as unknown as { _render(): void };
        const originalRender = renderProto._render;
        renderProto._render = function (this: unknown) {
            steps.push("loop:render");
            originalRender.call(this);
        };

        const app = new Application(stubCanvas()) as unknown as { isPlaying: boolean };
        app.isPlaying = true;

        try {
            const internals = app as unknown as { _loop(): void; _lastFrameTime: number };
            internals._lastFrameTime = performance.now() - 100;
            internals._loop();
            await Promise.resolve();
            await Promise.resolve();
        } finally {
            renderProto._render = originalRender;
        }

        expect(victim.exists()).toBe(false);
        // The finding, pinned: onDestroy ran before the render of that frame.
        expect(steps.indexOf("victim:onDestroy")).toBeGreaterThan(-1);
        expect(steps.indexOf("victim:onDestroy")).toBeLessThan(steps.indexOf("loop:render"));
        // And the doomed object was not drawn that frame: the sweep is between
        // LateUpdate and render, so `lateUpdate` of the victim still runs.
        expect(steps.indexOf("victim:lateUpdate")).toBeLessThan(steps.indexOf("loop:render"));
    });

    test("still destroys its object when no loop is running", async () => {
        // Every other caller — a load's `awake`, a host's dispose, a test — gets
        // its end-of-frame destroy from the microtask fallback rather than from
        // a frame that never comes.
        const go = new GameObject("NoLoop");
        EngineObject.Destroy(go, 0);

        expect(go.exists()).toBe(true);
        await Promise.resolve();

        expect(go.exists()).toBe(false);
    });

    test("a negative or non-finite delay is treated as zero", async () => {
        const negative = new GameObject("Negative");
        const infinite = new GameObject("Infinite");

        EngineObject.Destroy(negative, -1);
        EngineObject.Destroy(infinite, Number.POSITIVE_INFINITY);

        EngineObject._updatePendingDestroys(1 / 60);

        expect(negative.exists()).toBe(false);
        expect(infinite.exists()).toBe(false);
    });
});
