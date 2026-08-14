import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Time } from "../src/engine/core/Time";
import { Input } from "../src/engine/core/Input";
import { KeyCode } from "../src/engine/core/KeyCode";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "../src/engine/core/rendering/RenderBackend";

/**
 * Scenario and component callbacks are user code and can throw. The next frame
 * is already scheduled by then, so the loop runs on — and used to run on with
 * `Time` stuck inside the fixed phase and `Input` never reset, for the rest of
 * the session. Audit part 4, F21.
 */

class FakeBackend implements RenderBackend {
    public readonly api = GraphicsAPI.WebGPU;
    public pixelRatio: number;
    public exposure: number = 1;
    public shadowsEnabled: boolean = true;
    public readonly stats: RenderBackendStats | null = null;

    constructor(options: RenderBackendOptions) { this.pixelRatio = options.pixelRatio; }

    public setSize(): void {}
    public setClearColor(): void {}
    public clear(): void {}
    public renderScene(): void {}
    public warmup(): void {}
    public dispose(): void {}
}

/** Window listeners the engine installed, so a test can deliver a real event. */
const windowListeners = new Map<string, (event: unknown) => void>();

/** The smallest DOM the Application constructor and input plumbing touch. */
function installDomStubs(): () => void {
    const listeners = { addEventListener() {}, removeEventListener() {} };
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame };

    windowListeners.clear();
    g.window = {
        addEventListener(type: string, handler: (event: unknown) => void) {
            windowListeners.set(type, handler);
        },
        removeEventListener(type: string) { windowListeners.delete(type); },
        devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    };
    g.document = { ...listeners, pointerLockElement: null };
    // The loop schedules the next frame before running anything, which is the
    // reason a throw does not stop it. Here it must schedule nothing.
    g.requestAnimationFrame = () => 0;

    return () => {
        g.window = saved.window;
        g.document = saved.document;
        g.requestAnimationFrame = saved.raf;
    };
}

function stubCanvas(): HTMLCanvasElement {
    return {
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement;
}

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

/** Where the throw happens, per test. */
let throwIn: "fixedUpdate" | "update" | "none" = "none";

class Saboteur extends ScriptableBehaviour {
    public fixedUpdate(): void {
        if (throwIn === "fixedUpdate") throw new Error("scenario code went wrong");
    }
    public update(): void {
        if (throwIn === "update") throw new Error("scenario code went wrong");
    }
}

describe("A frame a callback cut short", () => {
    let restoreDom: () => void;
    let app: { isPlaying: boolean; dispose(): void };

    beforeEach(async () => {
        restoreDom = installDomStubs();
        const Application = await loadApplication();
        Application.backendFactory = options => new FakeBackend(options);
        app = new Application(stubCanvas()) as unknown as typeof app;
        app.isPlaying = true;
        new GameObject("Saboteur").addComponent(Saboteur);
    });

    afterEach(async () => {
        throwIn = "none";
        const Application = await loadApplication();
        Application.current?.dispose();
        Application.backendFactory = null;
        Application.powerPreference = GraphicsPowerPreference.HighPerformance;
        restoreDom();
    });

    /**
     * Runs one frame with a 100 ms delta, so the fixed-step accumulator is
     * guaranteed to fire at least once.
     */
    function runFrame(): void {
        const internals = app as unknown as { _loop(): void; _lastFrameTime: number };
        internals._lastFrameTime = performance.now() - 100;
        internals._loop();
    }

    /** Runs one frame, expecting the saboteur's error to reach the caller. */
    function frameThatThrows(): void {
        expect(() => runFrame()).toThrow("scenario code went wrong");
    }

    /** A clean frame first: `fixedUpdate` only runs once `start` has. */
    function settle(): void {
        const was = throwIn;
        throwIn = "none";
        runFrame();
        throwIn = was;
    }

    test("leaves the fixed phase, so deltaTime is a frame again", () => {
        throwIn = "fixedUpdate";
        settle();

        frameThatThrows();

        expect(Time.deltaTime).not.toBe(Time.fixedDeltaTime);
    });

    test("still resets input, so a key is not held down forever", () => {
        throwIn = "update";
        settle();
        windowListeners.get("keydown")!({ code: KeyCode.Space, repeat: false });
        expect(Input.getKeyDown(KeyCode.Space)).toBe(true);

        frameThatThrows();

        // "Pressed this frame" must be false on the frame after the press, even
        // when that frame ended in an exception.
        expect(Input.getKeyDown(KeyCode.Space)).toBe(false);
        expect(Input.getKey(KeyCode.Space)).toBe(true);
    });

    test("the error still reaches the host", () => {
        throwIn = "update";
        settle();

        frameThatThrows();
    });

    test("and the frame after it is a normal one", () => {
        throwIn = "fixedUpdate";
        settle();
        frameThatThrows();

        throwIn = "none";
        expect(() => runFrame()).not.toThrow();
        expect(Time.deltaTime).not.toBe(Time.fixedDeltaTime);
    });
});
