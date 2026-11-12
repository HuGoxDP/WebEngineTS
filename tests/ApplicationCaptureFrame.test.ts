import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type { RenderBackend, RenderBackendOptions, RenderBackendStats } from "../src/engine/core/rendering/RenderBackend";

/**
 * `Application.captureFrame` is how the sandboxed player hands the host a still image. The contract that matters:
 * the scene is rendered ON DEMAND and copied in the same task (a WebGL drawing buffer is cleared once shown, so a
 * paused scenario would otherwise read back blank), the copy is downscaled with aspect kept and never upscaled, and
 * a canvas that cannot be read is a rejection, not a blank picture.
 */

const events: string[] = [];

class FakeBackend implements RenderBackend {
    public readonly api = GraphicsAPI.WebGPU;
    public pixelRatio: number;
    public exposure = 1;
    public shadowsEnabled = true;
    public readonly stats: RenderBackendStats | null = null;
    constructor(options: RenderBackendOptions) { this.pixelRatio = options.pixelRatio; }
    public setSize(): void {}
    public setClearColor(): void {}
    public clear(): void { events.push("render"); }
    public renderScene(): void { events.push("render"); }
    public readPixels(): boolean { return false; }
    public warmup(): void {}
    public dispose(): void {}
}

interface Scratch { width: number; height: number; fills: string[]; draws: { w: number; h: number }[]; images: unknown[]; toBlobArgs: { type?: string; quality?: number } }

function installDom(source: { width: number; height: number }) {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame };
    const scratch: Scratch[] = [];
    g.window = { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 };
    g.document = {
        addEventListener: () => {}, removeEventListener: () => {}, pointerLockElement: null,
        createElement: (tag: string) => {
            if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
            const record: Scratch = { width: 0, height: 0, fills: [], draws: [], images: [], toBlobArgs: {} };
            scratch.push(record);
            return {
                get width() { return record.width; }, set width(v: number) { record.width = v; },
                get height() { return record.height; }, set height(v: number) { record.height = v; },
                getContext: () => ({
                    set fillStyle(v: string) { record.fills.push(v); },
                    fillRect: () => {},
                    set imageSmoothingQuality(_v: string) {},
                    drawImage: (img: unknown, _x: number, _y: number, w: number, h: number) => { events.push("copy"); record.images.push(img); record.draws.push({ w, h }); },
                }),
                toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => { record.toBlobArgs = { type, quality }; cb(new Blob(["img"], { type })); },
            };
        },
    };
    g.requestAnimationFrame = () => 0;
    const canvas = {
        width: source.width, height: source.height,
        addEventListener: () => {}, removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: source.width, height: source.height }),
    } as unknown as HTMLCanvasElement;
    return { canvas, scratch, restore: () => { g.window = saved.window; g.document = saved.document; g.requestAnimationFrame = saved.raf; } };
}

let dom: ReturnType<typeof installDom>;
const makeApp = async (width = 3840, height = 2160) => {
    dom = installDom({ width, height });
    const { Application } = await import("../src/engine/core/Application");
    Application.backendFactory = options => new FakeBackend(options);
    return new Application(dom.canvas);
};

beforeEach(() => { events.length = 0; });
afterEach(async () => {
    const { Application } = await import("../src/engine/core/Application");
    Application.current?.dispose();
    Application.backendFactory = null;
    Application.powerPreference = GraphicsPowerPreference.HighPerformance;
    dom.restore();
});

// The first test pays for importing the whole engine; under a parallel full run that exceeds the 5 s default.
describe("Application.captureFrame", { timeout: 30_000 }, () => {
    test("renders on demand and copies in the same task, before the image is encoded; the loop need not be running", async () => {
        const app = await makeApp();
        expect(app.isPlaying).toBe(false);
        const blob = await app.captureFrame();

        expect(events[0]).toBe("render");
        expect(events.indexOf("copy")).toBeGreaterThan(events.indexOf("render"));
        expect(blob).toBeInstanceOf(Blob);
    });

    test("downscales to the default 1920 width with the aspect kept, as PNG", async () => {
        const app = await makeApp(3840, 2160);
        await app.captureFrame();
        const out = dom.scratch[0];
        expect([out.width, out.height]).toEqual([1920, 1080]);
        expect(out.draws[0]).toEqual({ w: 1920, h: 1080 });
        expect(out.toBlobArgs.type).toBe("image/png");
        expect(out.fills).toEqual([]);
    });

    test("never upscales a canvas narrower than maxWidth", async () => {
        const app = await makeApp(800, 600);
        await app.captureFrame({ maxWidth: 1920 });
        expect([dom.scratch[0].width, dom.scratch[0].height]).toEqual([800, 600]);
    });

    test("honours maxWidth, JPEG type and quality (clamped), and puts an opaque base under a JPEG", async () => {
        const app = await makeApp(1600, 900);
        await app.captureFrame({ maxWidth: 640, type: "image/jpeg", quality: 7 });
        const out = dom.scratch[0];
        expect([out.width, out.height]).toEqual([640, 360]);
        expect(out.toBlobArgs).toEqual({ type: "image/jpeg", quality: 1 });
        expect(out.fills).toEqual(["#000"]);
    });

    test("falls back to the defaults for a non-finite maxWidth or quality, and an unknown type means PNG", async () => {
        const app = await makeApp(3840, 2160);
        await app.captureFrame({ maxWidth: Number.NaN, quality: Number.NaN, type: "image/gif" as never });
        expect(dom.scratch[0].width).toBe(1920);
        expect(dom.scratch[0].toBlobArgs).toEqual({ type: "image/png", quality: 0.92 });
    });

    test("rejects, rather than returning a blank image, when the canvas has no size", async () => {
        const app = await makeApp(0, 0);
        await expect(app.captureFrame()).rejects.toThrow(/no size/);
        expect(events).toEqual([]);
    });

    test("composites the UI overlays after the 3D source, in back-to-front order, at the downscaled size", async () => {
        const { Canvas } = await import("../src/engine/core/ui/Canvas");
        const back = { name: "back" } as unknown as HTMLCanvasElement;
        const front = { name: "front" } as unknown as HTMLCanvasElement;
        vi.spyOn(Canvas, "_overlaySurfaces").mockReturnValue([back, front]);
        const app = await makeApp(3840, 2160);
        await app.captureFrame();

        const out = dom.scratch[0];
        expect(out.images).toEqual([dom.canvas, back, front]);
        expect(out.draws).toEqual([{ w: 1920, h: 1080 }, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }]);
        vi.restoreAllMocks();
    });

    test("rejects when the encoder yields nothing", async () => {
        const app = await makeApp();
        const g = globalThis as { document: { createElement: (t: string) => { toBlob: (cb: (b: null) => void) => void } } };
        const original = g.document.createElement;
        g.document.createElement = (tag: string) => ({ ...original(tag), toBlob: cb => cb(null) });
        await expect(app.captureFrame()).rejects.toThrow(/could not encode/);
    });
});
