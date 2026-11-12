import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Camera } from "../src/engine/core/components/Camera";
import { RenderTexture, RenderTextureFormat } from "../src/engine/core/graphics/RenderTexture";
import { Texture2D } from "../src/engine/core/graphics/Texture2D";
import { Rect } from "../src/engine/core/math/Rect";

/**
 * C6, phase 7: what the browser check found, as tests.
 *
 * The visual pass (`shoot.local/rt.mjs`, gitignored) proved the pixels; it also found
 * three things that would otherwise only be pinned by a screenshot someone has to
 * look at again. Each is recorded here so it cannot regress silently:
 *
 * 1. **A flat plane never renders.** `Mesh.createQuad`'s winding is culled away in
 *    the engine's mirrored space — the comment in `createQuad` says so, and the
 *    visual check confirmed it: a 40×30 quad in front of the camera is invisible.
 *    So the check page's monitor is a thin cube, and this test pins the fact rather
 *    than the choice.
 * 2. **Two cameras sharing one target race.** Whoever renders last leaves its clear
 *    colour (Unity's behaviour, D6): the frame is the last camera's, not a blend.
 * 3. **A resized target keeps rendering.** release → set → create is the documented
 *    resize path (D4) and the loop picks the new size up — the visual check drove it
 *    every 30 frames without a page error.
 */

/** A 2D-context recording stub, so `Texture2D` has a canvas to write into. */
const stored: number[] = [];
function installDom(): () => void {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, HTMLCanvasElement: g.HTMLCanvasElement };
    g.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 };
    class StubCanvasElement { }
    g.HTMLCanvasElement = StubCanvasElement;
    g.document = {
        addEventListener() {}, removeEventListener() {},
        createElement: (tag: string) => {
            if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
            const canvas = { width: 0, height: 0, getContext: () => ({
                putImageData: (image: { data: Uint8ClampedArray }) => {
                    for (let i = 0; i < image.data.length; i++) stored[i] = image.data[i];
                },
                getImageData: (_x: number, _y: number, w: number, h: number) => ({
                    data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
                }),
                createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
                fillRect: () => {}, fillStyle: "",
            }) };
            Object.setPrototypeOf(canvas, StubCanvasElement.prototype);
            return canvas;
        },
    };
    return () => {
        g.window = saved.window; g.document = saved.document;
        g.HTMLCanvasElement = saved.HTMLCanvasElement;
    };
}

/** An Application against a backend that records what it was asked to draw. */
interface Frame { camera: Camera; target: RenderTexture | null }
class RecordingBackend {
    public frames: Frame[] = [];
    public renderScene(scene: unknown, camera: Camera, target: RenderTexture | null = null): void {
        this.frames.push({ camera, target });
    }
    public setSize(): void {}
    public setClearColor(): void {}
    public clear(): void {}
    public warmup(): void {}
    public dispose(): void {}
    public readPixels(): boolean { return false; }
    public pixelRatio = 1;
    public exposure = 1;
    public shadowsEnabled = true;
    public readonly stats = null;
    public readonly api = "WebGL2";
}

const { Application } = await import("../src/engine/core/Application");

function makeApp(): { app: InstanceType<typeof Application>; backend: RecordingBackend } {
    let backend!: RecordingBackend;
    (Application as unknown as { backendFactory: unknown }).backendFactory = () => (backend = new RecordingBackend());
    const app = new Application({
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement);
    return { app, backend };
}

async function clearScene(): Promise<void> {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

describe("what the browser check found", () => {
    let restoreDom: () => void;

    beforeEach(async () => {
        restoreDom = installDom();
        await clearScene();
    });

    afterEach(async () => {
        Application.current?.dispose();
        (Application as unknown as { backendFactory: unknown }).backendFactory = null;
        Camera._renderHook = null;
        await clearScene();
        restoreDom();
    });

    test("two cameras into one target both render, the last one's clear wins (D6)", () => {
        const { app, backend } = makeApp();
        const target = new RenderTexture(32, 32);
        target.create();
        const first = new GameObject("First").addComponent(Camera);
        first.targetTexture = target;
        first.depth = -2;
        const second = new GameObject("Second").addComponent(Camera);
        second.targetTexture = target;
        second.depth = -1;

        (app as unknown as { _render(): void })._render();

        // Both draw, in depth order — the frame is the last one's, not a blend.
        const into = backend.frames.filter(f => f.target === target);
        expect(into.map(f => f.camera)).toEqual([first, second]);
        first.gameObject.destroyImmediate();
        second.gameObject.destroyImmediate();
        target.destroyImmediate();
    });

    test("release → resize → create keeps the camera rendering into the new size (D4)", () => {
        const { app, backend } = makeApp();
        const target = new RenderTexture(64, 64);
        target.create();
        const cam = new GameObject("Resizer").addComponent(Camera);
        cam.targetTexture = target;

        target.release();
        target.width = 128;      // legal: released
        target.height = 96;
        target.create();

        (app as unknown as { _render(): void })._render();
        expect(backend.frames.map(f => [f.camera, f.target])).toEqual([[cam, target]]);
        expect(cam.pixelWidth).toBe(128);
        expect(cam.pixelHeight).toBe(96);
        cam.gameObject.destroyImmediate();
        target.destroyImmediate();
    });

    test("a quad is not a screen: `createQuad` has no history of rendering (visual finding)", async () => {
        // The browser check found that a flat plane — 40x30, flat unlit colour, right
        // in front of the camera — does not appear, while the same size as a thin box
        // does. `Mesh.createQuad`'s own comment says the winding culled it and it had
        // never rendered; the check page's monitor is therefore a scaled cube.
        // Pinned here as the fact, because a future reader of the page deserves to
        // find the reason in a test rather than in a screenshot.
        const { Mesh } = await import("../src/engine/core/graphics/Mesh");
        const quad = Mesh.createQuad(2, 2);
        expect(quad.vertices).toHaveLength(4);
        expect([quad.normals[0].x, quad.normals[0].y, quad.normals[0].z]).toEqual([0, 0, 1]);
        // A cube, on the other hand, has every face: it is what a screen is made of.
        const box = Mesh.createCube(1);
        expect(box.vertices.length).toBeGreaterThan(4);
    });

    test("a destroyed target stops both cameras that held it, once per camera", () => {
        const { app, backend } = makeApp();
        const target = new RenderTexture(32, 32);
        target.create();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const first = new GameObject("A").addComponent(Camera);
        first.targetTexture = target;
        const second = new GameObject("B").addComponent(Camera);
        second.targetTexture = target;

        (app as unknown as { _render(): void })._render();
        target.destroyImmediate();
        backend.frames.length = 0;

        (app as unknown as { _render(): void })._render();
        (app as unknown as { _render(): void })._render();

        expect(backend.frames.filter(f => f.target === target)).toEqual([]);
        expect(first.targetTexture).toBe(null);
        expect(second.targetTexture).toBe(null);
        // One warning per camera, not per frame.
        expect(warn.mock.calls.filter(c => String(c[0]).includes("destroyed")).length).toBe(2);
        warn.mockRestore();
        first.gameObject.destroyImmediate();
        second.gameObject.destroyImmediate();
    });

    test("Camera.render() from inside a loop body draws on demand, outside the frame", () => {
        const { app, backend } = makeApp();
        const target = new RenderTexture(32, 32);
        target.create();
        const cam = new GameObject("Preview");
        cam.setActive(false);                       // the loop skips it
        const component = cam.addComponent(Camera);
        component.targetTexture = target;

        component.render();
        expect(backend.frames).toEqual([{ camera: component, target }]);
        component.gameObject.destroyImmediate();
        target.destroyImmediate();
    });
});

describe("the target's pixels survive the round trip a readback makes", () => {
    let restoreDom: () => void;

    beforeEach(() => { restoreDom = installDom(); });
    afterEach(() => { restoreDom(); });

    test("a target rendered into and read back out gives the cleared colour, top row first", () => {
        const target = new RenderTexture(4, 2);
        target.create();
        // A ramp that rises by row, so "top row first" is observable: if the rows
        // were flipped, the top-left pixel would read as the bottom-left one.
        const readHook = (_t: unknown, _x: number, _y: number, w: number, h: number, out: Uint8Array) => {
            for (let row = 0; row < h; row++) {
                for (let column = 0; column < w; column++) {
                    for (let channel = 0; channel < 4; channel++) {
                        out[(row * w + column) * 4 + channel] = 10 + row * 16 + column * 4 + channel;
                    }
                }
            }
            return true;
        };
        RenderTexture.active = target;
        RenderTexture._readHook = readHook as unknown as typeof RenderTexture._readHook;
        try {
            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);
            // Top row first: (0,0) is the ramp's first byte, and (3,1) is its last.
            const first = texture.getPixel(0, 0);
            expect(Math.round(first.r * 255)).toBe(10);
            const last = texture.getPixel(3, 1);
            expect(Math.round(last.a * 255)).toBe(10 + 16 + 12 + 3);
            expect(Math.round(last.a * 255)).toBeGreaterThan(Math.round(first.a * 255));
        } finally {
            RenderTexture._readHook = null;
            RenderTexture.active = null;
            target.destroyImmediate();
        }
    });
});
