import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "../src/engine/core/rendering/RenderBackend";

/**
 * `Input._dispose` and `Touch._teardown` both document themselves as being
 * called when the Application shuts down, and nothing called either. A host
 * that opens a scenario, disposes and opens another — which the platform does
 * every time a student leaves a page — accumulated a full set of keyboard,
 * mouse and touch listeners per visit. Audit part 10, F62.
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

/** Counts listeners by target and type, so add/remove can be compared. */
function installDomStubs() {
    const counts = new Map<string, number>();
    const bump = (target: string, type: string, by: number) => {
        const key = `${target}:${type}`;
        counts.set(key, (counts.get(key) ?? 0) + by);
    };

    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame };

    g.window = {
        addEventListener: (t: string) => bump("window", t, 1),
        removeEventListener: (t: string) => bump("window", t, -1),
        devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    };
    g.document = {
        addEventListener: (t: string) => bump("document", t, 1),
        removeEventListener: (t: string) => bump("document", t, -1),
        pointerLockElement: null,
    };
    g.requestAnimationFrame = () => 0;

    const canvas = {
        addEventListener: (t: string) => bump("canvas", t, 1),
        removeEventListener: (t: string) => bump("canvas", t, -1),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement;

    return {
        canvas,
        counts,
        /** Every listener type still attached, i.e. added more often than removed. */
        leaked: () => [...counts.entries()].filter(([, n]) => n > 0).map(([k]) => k),
        restore: () => {
            g.window = saved.window;
            g.document = saved.document;
            g.requestAnimationFrame = saved.raf;
        },
    };
}

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

let dom: ReturnType<typeof installDomStubs>;

beforeEach(() => { dom = installDomStubs(); });

afterEach(async () => {
    const Application = await loadApplication();
    Application.current?.dispose();
    Application.backendFactory = null;
    Application.powerPreference = GraphicsPowerPreference.HighPerformance;
    dom.restore();
});

describe("Disposing an Application", () => {
    test("leaves no listener attached", async () => {
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);
        const app = new Application(dom.canvas);

        app.dispose();

        expect(dom.leaked()).toEqual([]);
    });

    test("removes the touch listeners it attached to the canvas", async () => {
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);
        const app = new Application(dom.canvas);
        expect(dom.counts.get("canvas:touchstart")).toBe(1);

        app.dispose();

        expect(dom.counts.get("canvas:touchstart")).toBe(0);
        expect(dom.counts.get("canvas:touchmove")).toBe(0);
        expect(dom.counts.get("canvas:touchend")).toBe(0);
        expect(dom.counts.get("canvas:touchcancel")).toBe(0);
    });

    test("removes the keyboard and focus listeners", async () => {
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);
        const app = new Application(dom.canvas);

        app.dispose();

        expect(dom.counts.get("window:keydown")).toBe(0);
        expect(dom.counts.get("window:blur")).toBe(0);
        expect(dom.counts.get("document:visibilitychange")).toBe(0);
    });

    test("opening and closing repeatedly does not accumulate", async () => {
        // The platform's actual usage: a viewer created and destroyed per visit.
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);

        for (let i = 0; i < 5; i++) {
            const app = new Application(dom.canvas);
            app.dispose();
        }

        expect(dom.leaked()).toEqual([]);
    });
});
