import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Camera } from "../src/engine/core/components/Camera";
import { RenderTexture } from "../src/engine/core/graphics/RenderTexture";
import { Vector3 } from "../src/engine/core/math/Vector3";
import type { Scene } from "../src/engine/core/Scene";

/**
 * C6, phase 3 (DW-3.1..DW-3.6): cameras with a target in the frame, and
 * `Camera.render()` on demand.
 *
 * Everything here runs against a backend that records what it was asked to draw
 * — no WebGL, no canvas context — so the frame *order* is what is being pinned:
 * which camera draws, into which target, before what. The GL work of a target
 * render is phase 2's business and is pinned by its own file.
 *
 * The invariant that matters most is the first test: with no target anywhere,
 * the loop's frames are exactly what they were before C6.
 */

interface Frame { camera: Camera; target: RenderTexture | null }

/** A backend that records frames and clears, and draws nothing. */
class RecordingBackend {
    public frames: Frame[] = [];
    public clears = 0;
    public renderScene(scene: Scene, camera: Camera, target: RenderTexture | null = null): void {
        this.frames.push({ camera, target });
    }
    public setSize(): void {}
    public setClearColor(): void {}
    public clear(): void { this.clears++; }
    public warmup(): void {}
    public dispose(): void {}
    public readPixels(): boolean { return false; }
    public pixelRatio = 1;
    public exposure = 1;
    public shadowsEnabled = true;
    public readonly stats = null;
    public readonly api = "WebGL2" as unknown as { toString(): string } & { toString(): string };
}

function installDomStubs(width = 800, height = 600): () => void {
    const listeners = { addEventListener() {}, removeEventListener() {} };
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document };
    g.window = { ...listeners, devicePixelRatio: 1, innerWidth: width, innerHeight: height };
    g.document = { ...listeners, pointerLockElement: null };
    return () => { g.window = saved.window; g.document = saved.document; };
}

let Application: typeof import("../src/engine/core/Application").Application;

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

/**
 * Empties the active scene immediately.
 *
 * @remarks
 * `destroy()` queues the end-of-frame callback, so a camera from a previous test
 * would still be registered while the next one ran and its frame would land in
 * the recording. Immediate destruction is what makes each test's frame list its
 * own.
 */
async function clearScene(): Promise<void> {
    const { SceneManager } = await import("../src/engine/core/SceneManager");
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

/** An Application with the recording backend installed, and its recorded frames. */
async function makeApp(): Promise<{ app: InstanceType<typeof Application>; backend: RecordingBackend }> {
    Application = await loadApplication();
    let backend!: RecordingBackend;
    (Application as unknown as { backendFactory: unknown }).backendFactory = () => (backend = new RecordingBackend());
    const app = new Application({
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement);
    return { app, backend };
}

/** Advances one loop tick the way the loop does: transforms, then the render. */
function frame(app: InstanceType<typeof Application>): void {
    (app as unknown as { _render(): void })._render();
}

const camerasOf = (frames: Frame[]) => frames.map(f => f.camera?.gameObject.name ?? null);

describe("the frame order with targets (D5)", () => {
    let restoreDom: () => void;

    beforeEach(async () => { restoreDom = installDomStubs(); await clearScene(); });
    afterEach(async () => {
        Application.current?.dispose();
        (Application as unknown as { backendFactory: unknown }).backendFactory = null;
        Camera._renderHook = null;
        restoreDom();
        vi.restoreAllMocks();
    });

    test("DW-3.1 a scene with the main camera only draws exactly one frame, target null", async () => {
        const { app, backend } = await makeApp();
        const main = new GameObject("Main").addComponent(Camera);
        main.gameObject.tag = "MainCamera";

        frame(app);

        expect(backend.frames).toHaveLength(1);
        expect(backend.frames[0].camera).toBe(main);
        expect(backend.frames[0].target).toBe(null);
        main.gameObject.destroyImmediate();
    });

    test("DW-3.2 targets first in ascending depth, then the screen camera", async () => {
        const { app, backend } = await makeApp();
        const main = new GameObject("Main").addComponent(Camera);
        main.gameObject.tag = "MainCamera";
        const a = new GameObject("A").addComponent(Camera);
        a.depth = 5;
        const b = new GameObject("B").addComponent(Camera);
        b.depth = -1;
        const t1 = new RenderTexture(64, 64); t1.create();
        const t2 = new RenderTexture(32, 32); t2.create();
        a.targetTexture = t1;
        b.targetTexture = t2;

        frame(app);
        frame(app);

        expect(backend.frames.map(f => [f.camera, f.target])).toEqual([
            [b, t2], [a, t1], [main, null],
            [b, t2], [a, t1], [main, null],
        ]);
        a.gameObject.destroyImmediate(); b.gameObject.destroyImmediate(); main.gameObject.destroyImmediate();
    });

    test("DW-3.3 a main camera with a target yields the surface to the next untargeted one", async () => {
        const { app, backend } = await makeApp();
        const main = new GameObject("Main").addComponent(Camera);
        main.gameObject.tag = "MainCamera";
        const second = new GameObject("Second").addComponent(Camera);
        const t = new RenderTexture(64, 64); t.create();
        main.targetTexture = t;

        frame(app);
        expect(backend.frames.map(f => [f.camera, f.target])).toEqual([[main, t], [second, null]]);

        // With no untargeted camera at all the surface gets the no-camera clear.
        second.gameObject.destroyImmediate();
        backend.frames.length = 0;
        backend.clears = 0;
        frame(app);
        expect(backend.frames).toEqual([{ camera: main, target: t }]);
        expect(backend.clears).toBe(1);
        main.gameObject.destroyImmediate();
    });

    test("a disabled camera with a target is skipped by the loop", async () => {
        const { app, backend } = await makeApp();
        const main = new GameObject("Main").addComponent(Camera);
        main.gameObject.tag = "MainCamera";
        const off = new GameObject("Off").addComponent(Camera);
        off.targetTexture = new RenderTexture(16, 16);
        off.enabled = false;

        frame(app);
        expect(camerasOf(backend.frames)).toEqual(["Main"]);
        main.gameObject.destroyImmediate(); off.gameObject.destroyImmediate();
    });
});

describe("a target drives the camera's pixels (D5)", () => {
    let restoreDom: () => void;

    beforeEach(async () => { restoreDom = installDomStubs(800, 600); await clearScene(); });
    afterEach(async () => {
        Application.current?.dispose();
        (Application as unknown as { backendFactory: unknown }).backendFactory = null;
        Camera._renderHook = null;
        await clearScene();
        restoreDom();
    });

    test("DW-3.4 pixelWidth/Height and aspect follow the target, not the window", async () => {
        const { app } = await makeApp();
        const cam = new GameObject("Cam").addComponent(Camera);

        cam.targetTexture = new RenderTexture(200, 100);
        expect(cam.pixelWidth).toBe(200);
        expect(cam.pixelHeight).toBe(100);
        expect(cam.aspect).toBe(2);

        // A window resize must not overwrite the aspect the target derived.
        const resize = (app as unknown as { _resize(): void })._resize;
        resize.call(app);
        expect(cam.pixelWidth).toBe(200);
        expect(cam.aspect).toBe(2);

        // Clearing the target falls back to the surface: 800×600, aspect 4/3.
        cam.targetTexture = null;
        (app as unknown as { _resize(): void })._resize();
        expect(cam.pixelWidth).toBe(800);
        expect(cam.pixelHeight).toBe(600);
        expect(cam.aspect).toBeCloseTo(800 / 600);

        // A point on the camera axis lands in the middle of the viewport.
        cam.targetTexture = new RenderTexture(200, 100);
        const point = cam.worldToScreenPoint(new Vector3(0, 0, -10));
        expect(point.x).toBe(100);
        expect(point.y).toBe(50);
        cam.gameObject.destroyImmediate();
    });

    test("a target resized while released re-derives the aspect", async () => {
        await makeApp();
        const cam = new GameObject("Cam").addComponent(Camera);
        const target = new RenderTexture(64, 64);
        cam.targetTexture = target;
        expect(cam.aspect).toBe(1);

        target.release();
        target.width = 128;   // legal: released
        target.height = 64;
        cam.targetTexture = target;
        expect(cam.pixelWidth).toBe(128);
        expect(cam.aspect).toBe(2);
        cam.gameObject.destroyImmediate();
    });
});

describe("Camera.render() on demand (D12, D13)", () => {
    let restoreDom: () => void;

    beforeEach(async () => { restoreDom = installDomStubs(); await clearScene(); });
    afterEach(async () => {
        Application.current?.dispose();
        (Application as unknown as { backendFactory: unknown }).backendFactory = null;
        Camera._renderHook = null;
        await clearScene();
        restoreDom();
    });

    test("DW-3.5 a disabled camera with a target renders outside the loop, exactly once", async () => {
        const { app, backend } = await makeApp();
        const cam = new GameObject("Preview").addComponent(Camera);
        const target = new RenderTexture(48, 48); target.create();
        cam.targetTexture = target;
        cam.enabled = false;

        // The loop skips it (disabled); the on-demand call does not.
        frame(app);
        expect(backend.frames).toHaveLength(0);

        cam.render();
        expect(backend.frames).toEqual([{ camera: cam, target }]);

        // …and after dispose the hook is gone: a warning, no frame.
        backend.frames.length = 0;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        app.dispose();
        cam.render();
        expect(backend.frames).toHaveLength(0);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
        cam.gameObject.destroyImmediate();
    });

    test("render() on a camera with no Three.js camera yet warns once and draws nothing", async () => {
        const { backend } = await makeApp();
        // A built-in wakes its `onAwake` the moment it is added — even on an
        // inactive object (`GameObject._initializeComponent`) — so the only way a
        // Camera has no Three.js camera is the load path: attached, not yet
        // initialized. `_attachComponent` is exactly that, and it is the shape the
        // guard protects: drawing through a camera that does not exist yet would
        // silently do nothing in the backend instead of saying so.
        const never = new GameObject("Never");
        const cam = never._attachComponent(Camera);

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        cam.render();
        cam.render();
        expect(backend.frames).toHaveLength(0);
        expect(warn.mock.calls.length).toBe(2);
        expect(String(warn.mock.calls[0][0])).toContain("before it woke");
        warn.mockRestore();
        never.destroyImmediate();
    });
});

describe("a destroyed target is dropped by the camera (D3, DW-3.6)", () => {
    let restoreDom: () => void;

    beforeEach(async () => { restoreDom = installDomStubs(); await clearScene(); });
    afterEach(async () => {
        Application.current?.dispose();
        (Application as unknown as { backendFactory: unknown }).backendFactory = null;
        Camera._renderHook = null;
        await clearScene();
        restoreDom();
    });

    test("DW-3.6 after the target is destroyed the camera renders nothing, warns once, and reads null", async () => {
        const { app, backend } = await makeApp();
        const cam = new GameObject("Monitor").addComponent(Camera);
        const target = new RenderTexture(32, 32); target.create();
        cam.targetTexture = target;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        frame(app);
        expect(backend.frames).toEqual([{ camera: cam, target }]);

        target.destroyImmediate();
        backend.frames.length = 0;

        frame(app); frame(app);
        expect(camerasOf(backend.frames)).toEqual([]);
        expect(cam.targetTexture).toBe(null);
        // The screen path: this camera now draws the surface (it is the only one).
        expect(backend.frames.length).toBe(0);

        // One warning for the whole span, not one per read.
        expect(warn.mock.calls.filter(c => String(c[0]).includes("destroyed")).length).toBe(1);
        warn.mockRestore();
        cam.gameObject.destroyImmediate();
    });
});
