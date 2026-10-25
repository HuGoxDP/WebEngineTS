// tests/PlayerRuntime.test.ts
// ============================================================
// The player side (src/player/player/PlayerRuntime.ts): what it refuses to start under, whose port it accepts, what
// it does with a malformed `load`, and that it drives the engine in the order the design needs (diagnostics lock and
// engine URL before any scenario code runs). The window, the document and the engine are doubles; the port is a real
// MessageChannel. Phase 3 of the player-isolation plan, DW-3.2 (player half).
// ============================================================

import { afterEach, describe, expect, test, vi } from "vitest";
import { PLAYER_EXPECTED_ORIGIN, bootPlayer, type PlayerEngine } from "../src/player/player/PlayerRuntime";
import { FakeEventTarget, FakeWindow, messageEvent } from "./_playerFakes";

const ENGINE_URL = "https://platform.test/engine/WebEngineTS.standalone.js";
const BASIS_URL = "https://platform.test/basis/";

interface Timer { fn: () => void; ms: number }

function makeWindow(over: { origin?: string; topLevel?: boolean } = {}) {
    const parent = new FakeWindow();
    const win: any = new FakeEventTarget();
    win.parent = over.topLevel ? win : parent;
    win.opener = new FakeWindow();
    win.origin = over.origin ?? "null";
    win.postMessage = vi.fn();
    const consoleError = vi.fn();
    win.console = { error: consoleError };
    const timers = { intervals: [] as Timer[], timeouts: [] as Timer[] };
    win.setInterval = (fn: () => void, ms: number) => timers.intervals.push({ fn, ms });
    win.setTimeout = (fn: () => void, ms: number) => timers.timeouts.push({ fn, ms });

    const document: any = new FakeEventTarget();
    const canvases: any[] = [];
    document.body = { style: { cssText: "" }, children: [] as any[], append(el: any) { this.children.push(el); } };
    document.createElement = () => {
        const canvas: any = new FakeEventTarget();
        canvas.style = { cssText: "" };
        canvases.push(canvas);
        return canvas;
    };
    win.document = document;
    return { win, parent, timers, canvases, document, consoleError };
}

function makeEngine(options: { frameCount?: number } = {}) {
    const log: string[] = [];
    const state = { frameCount: options.frameCount ?? 0, timeScale: 1 };
    const profiler = {
        set diagnosticsAllowed(value: boolean) { log.push(`allowed=${value}`); },
        enableToggle: vi.fn(() => log.push("enableToggle")),
        showOverlay: vi.fn(() => log.push("showOverlay")),
        toggleOverlay: vi.fn(),
        snapshot: () => ({ renderer: { estimatedTextureVramBytes: 100, estimatedGeometryVramBytes: 20, estimatedRenderTargetVramBytes: 3 } }),
    };
    const scenario = { set engineModuleUrl(url: string | null) { log.push(`engineModuleUrl=${url}`); } };
    const texture = { set ktx2TranscoderPath(path: string) { log.push(`ktx2=${path}`); } };
    const load = vi.fn(async (_input: unknown, onProgress: (p: { progress: number; currentOperation: string }) => void) => {
        log.push("scenario-loading");
        onProgress({ progress: 0.5, currentOperation: "halfway" });
    });
    class Application {
        constructor(public canvas: unknown) { log.push("app"); }
        loadScenarioFromBuffer = load;
        loadScenarioFromManifest = load;
    }
    const engine = {
        Application, MemoryProfiler: profiler, Scenario: scenario, Texture2D: texture,
        AudioManager: { resume: vi.fn(async () => undefined) },
        BuildInfo: { version: "0.1.0-test", builtAt: "2026-10-25T00:00:00.000Z" },
        Time: {
            get frameCount() { return state.frameCount; },
            get timeScale() { return state.timeScale; },
            set timeScale(value: number) { state.timeScale = value; },
        },
    };
    return { engine: engine as unknown as PlayerEngine, log, state, profiler, load };
}

let openPorts: MessagePort[] = [];
afterEach(() => { openPorts.forEach(p => p.close()); openPorts = []; vi.restoreAllMocks(); });

const flush = () => new Promise(resolve => setTimeout(resolve, 25));

/** Boots a player and hands it a port, as the host does. `fromPlayer` collects what the player sends back. */
function startPlayer(options: { engine?: ReturnType<typeof makeEngine>; now?: () => number; importEngine?: (url: string) => Promise<PlayerEngine> } = {}) {
    const w = makeWindow();
    const e = options.engine ?? makeEngine();
    const importEngine = vi.fn(options.importEngine ?? (async () => e.engine));
    const result = bootPlayer({ window: w.win, importEngine, now: options.now });
    const channel = new MessageChannel();
    openPorts.push(channel.port1, channel.port2);
    const fromPlayer: any[] = [];
    channel.port1.onmessage = event => fromPlayer.push(event.data);
    const offerPort = (source: unknown = w.parent, data: unknown = { v: 1, type: "port" }, ports: unknown[] = [channel.port2]) =>
        w.win.dispatch("message", messageEvent(source, data, "null", ports));
    return { ...w, e, importEngine, result, channel, fromPlayer, offerPort };
}

const loadMessage = (over: Record<string, unknown> = {}) => ({
    v: 1, type: "load", source: { kind: "blob", blob: new Blob(["zip"]) }, engineUrl: ENGINE_URL, transcoderPath: BASIS_URL, diag: false, ...over,
});

async function runningPlayer(options: Parameters<typeof startPlayer>[0] & { diag?: boolean } = {}) {
    const p = startPlayer(options);
    p.offerPort();
    p.channel.port1.postMessage(loadMessage({ diag: options.diag ?? false }));
    await vi.waitFor(() => expect(p.fromPlayer.some(m => m.type === "running")).toBe(true));
    return p;
}

describe("DW-3.2: refusing to start", () => {
    test("DW_3_2 loaded top-level (parent === window) it refuses and says nothing", () => {
        const w = makeWindow({ topLevel: true });
        const importEngine = vi.fn();
        const result = bootPlayer({ window: w.win, importEngine });

        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toMatch(/top-level/);
        expect(w.win.listenerCount("message")).toBe(0);
        expect(w.parent.posted).toEqual([]);
        expect(importEngine).not.toHaveBeenCalled();
    });

    test("DW_3_2 a non-opaque origin refuses and says nothing", () => {
        for (const origin of ["https://platform.test", "http://127.0.0.1:8080", "", "NULL"]) {
            const w = makeWindow({ origin });
            const result = bootPlayer({ window: w.win, importEngine: vi.fn() });

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.reason).toContain(`"${origin}"`);
            expect(w.win.listenerCount("message")).toBe(0);
            expect(w.parent.posted).toEqual([]);
        }
    });

    test("the expected origin is one named constant: \"null\"", () => {
        expect(PLAYER_EXPECTED_ORIGIN).toBe("null");
    });
});

describe("DW-3.2: the handshake, player side", () => {
    test("DW_3_2 a valid boot posts hello to the parent with targetOrigin * and the self-reported origin", () => {
        const p = startPlayer();

        expect(p.result).toEqual({ ok: true });
        expect(p.parent.posted).toEqual([{ data: { v: 1, type: "hello", origin: "null" }, targetOrigin: "*", transfer: [] }]);
        expect(p.win.listenerCount("message")).toBe(1);
    });

    test("DW_3_2 a port offered by the opener (or any window but the parent) is ignored", async () => {
        const p = startPlayer();

        p.offerPort(p.win.opener);
        p.offerPort(new FakeWindow());
        p.offerPort(p.win);
        p.offerPort(null);
        p.channel.port1.postMessage(loadMessage());
        await flush();

        expect(p.importEngine).not.toHaveBeenCalled();
        expect(p.fromPlayer).toEqual([]);
        expect(p.win.listenerCount("message")).toBe(1);
    });

    test("DW_3_2 a port message with the wrong version, wrong type, or not exactly one port is ignored", async () => {
        const p = startPlayer();

        p.offerPort(p.parent, { v: 2, type: "port" });
        p.offerPort(p.parent, { v: 1, type: "load" });
        p.offerPort(p.parent, "port");
        p.offerPort(p.parent, null);
        p.offerPort(p.parent, { v: 1, type: "port" }, []);
        p.offerPort(p.parent, { v: 1, type: "port" }, [p.channel.port2, new MessageChannel().port2]);
        p.channel.port1.postMessage(loadMessage());
        await flush();

        expect(p.importEngine).not.toHaveBeenCalled();
        expect(p.win.listenerCount("message")).toBe(1);
    });

    test("DW_3_2 the first valid port wins and the window is not listened to again", async () => {
        const p = startPlayer();
        p.offerPort();
        expect(p.win.listenerCount("message")).toBe(0);

        const second = new MessageChannel();
        openPorts.push(second.port1, second.port2);
        const fromSecond: any[] = [];
        second.port1.onmessage = event => fromSecond.push(event.data);
        p.win.dispatch("message", messageEvent(p.parent, { v: 1, type: "port" }, "null", [second.port2]));
        second.port1.postMessage(loadMessage());
        await flush();

        expect(p.importEngine).not.toHaveBeenCalled();
        expect(fromSecond).toEqual([]);
    });

    test("DW_3_2 a valid port accepts a valid load", async () => {
        const p = await runningPlayer();

        expect(p.importEngine).toHaveBeenCalledWith(ENGINE_URL);
        expect(p.fromPlayer.map(m => m.type)).toEqual(["progress", "running"]);
        expect(p.fromPlayer[0]).toEqual({ v: 1, type: "progress", progress: 0.5, operation: "halfway" });
    });
});

describe("DW-3.2: malformed messages on the port", () => {
    test("DW_3_2 a non-Blob blob source is answered with an error and never reaches the engine", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const p = startPlayer();
        p.offerPort();
        p.channel.port1.postMessage(loadMessage({ source: { kind: "blob", blob: "I am a string" } }));
        await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(1));

        expect(p.fromPlayer[0]).toMatchObject({ v: 1, type: "error" });
        expect(p.fromPlayer[0].message).toMatch(/malformed load/);
        expect(p.importEngine).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
    });

    test("DW_3_2 a load with a bad engine URL, bad transcoder path, bad diag or a missing source is answered with an error", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const bad = [
            { engineUrl: "javascript:alert(1)" }, { engineUrl: "/relative.js" }, { transcoderPath: "data:," }, { diag: "true" },
            { source: undefined }, { source: { kind: "manifest", url: "blob:https://x/1" } },
        ];
        for (const over of bad) {
            const p = startPlayer();
            p.offerPort();
            p.channel.port1.postMessage(loadMessage(over));
            await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(1));

            expect(p.fromPlayer[0].type).toBe("error");
            expect(p.importEngine).not.toHaveBeenCalled();
        }
    });

    test("unknown types, wrong versions and garbage are dropped without an answer", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const p = startPlayer();
        p.offerPort();
        for (const data of [{ v: 1, type: "eval", code: "1" }, { v: 2, type: "pause" }, { type: "pause" }, "pause", null, 7, { v: 1, type: "measure" }]) p.channel.port1.postMessage(data);
        await flush();

        expect(p.fromPlayer).toEqual([]);
    });

    test("a second load is refused: a restart uses a fresh frame", async () => {
        const p = await runningPlayer();
        p.fromPlayer.length = 0;
        p.channel.port1.postMessage(loadMessage());
        await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(1));

        expect(p.fromPlayer[0].type).toBe("error");
        expect(p.importEngine).toHaveBeenCalledTimes(1);
    });

    test("a failing load reports a capped error message", async () => {
        const p = startPlayer({ importEngine: async () => { throw new Error("x".repeat(2000)); } });
        p.offerPort();
        p.channel.port1.postMessage(loadMessage());
        await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(1));

        expect(p.fromPlayer[0].type).toBe("error");
        expect(p.fromPlayer[0].message).toHaveLength(500);
    });
});

describe("driving the engine", () => {
    test("diag false: the diagnostics lock is set, and the engine URL and transcoder path are set, BEFORE any scenario code runs", async () => {
        const p = await runningPlayer({ diag: false });

        expect(p.e.log).toEqual([
            "allowed=false", "ktx2=" + BASIS_URL, `engineModuleUrl=${ENGINE_URL}`, "app", "scenario-loading",
        ]);
        expect(p.e.profiler.enableToggle).not.toHaveBeenCalled();
        expect(p.e.profiler.showOverlay).not.toHaveBeenCalled();
    });

    test("diag true: the lock is NOT closed and the overlay is enabled after the load", async () => {
        const p = await runningPlayer({ diag: true });

        expect(p.e.log).not.toContain("allowed=false");
        expect(p.e.log.slice(-2)).toEqual(["enableToggle", "showOverlay"]);
    });

    test("a Blob source is read into an ArrayBuffer for loadScenarioFromBuffer; a manifest goes by URL", async () => {
        const blobbed = await runningPlayer();
        expect(blobbed.e.load.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
        expect((blobbed.e.load.mock.calls[0][0] as ArrayBuffer).byteLength).toBe(3);

        const streamed = startPlayer();
        streamed.offerPort();
        streamed.channel.port1.postMessage(loadMessage({ source: { kind: "manifest", url: "https://cdn.test/s/scenario.json" } }));
        await vi.waitFor(() => expect(streamed.fromPlayer.some(m => m.type === "running")).toBe(true));
        expect(streamed.e.load.mock.calls[0][0]).toBe("https://cdn.test/s/scenario.json");
    });

    test("the canvas goes into the body and a lost WebGL context is reported", async () => {
        const p = await runningPlayer();
        expect(p.document.body.children).toEqual(p.canvases);

        p.canvases[0].dispatch("webglcontextlost", {});
        await vi.waitFor(() => expect(p.fromPlayer.some(m => m.type === "context-lost")).toBe(true));
    });

    test("pause saves and zeroes Time.timeScale, resume restores it, each reported once", async () => {
        const p = await runningPlayer();
        p.e.state.timeScale = 0.5;
        p.fromPlayer.length = 0;

        p.channel.port1.postMessage({ v: 1, type: "pause" });
        p.channel.port1.postMessage({ v: 1, type: "pause" });
        await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(1));
        expect(p.e.state.timeScale).toBe(0);
        expect(p.fromPlayer).toEqual([{ v: 1, type: "paused", value: true }]);

        p.channel.port1.postMessage({ v: 1, type: "resume" });
        await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(2));
        expect(p.e.state.timeScale).toBe(0.5);
        expect(p.fromPlayer[1]).toEqual({ v: 1, type: "paused", value: false });
    });

    test("pause before the scenario runs is ignored", async () => {
        const p = startPlayer();
        p.offerPort();
        p.channel.port1.postMessage({ v: 1, type: "pause" });
        await flush();

        expect(p.e.state.timeScale).toBe(1);
        expect(p.fromPlayer).toEqual([]);
    });

    test("toggle-diagnostics toggles the overlay only if diagnostics were requested", async () => {
        const off = await runningPlayer({ diag: false });
        off.channel.port1.postMessage({ v: 1, type: "toggle-diagnostics" });
        await flush();
        expect(off.e.profiler.toggleOverlay).not.toHaveBeenCalled();

        const on = await runningPlayer({ diag: true });
        on.channel.port1.postMessage({ v: 1, type: "toggle-diagnostics" });
        await vi.waitFor(() => expect(on.e.profiler.toggleOverlay).toHaveBeenCalledTimes(1));
    });

    test("the first pointer or key event in the frame resumes audio, once", async () => {
        const p = await runningPlayer();
        expect(p.document.listenerCount("pointerdown")).toBe(1);

        p.document.dispatch("pointerdown", {});
        p.document.dispatch("keydown", {});
        p.document.dispatch("pointerdown", {});

        expect(p.e.engine.AudioManager.resume).toHaveBeenCalledTimes(1);
        expect(p.document.listenerCount("pointerdown")).toBe(0);
        expect(p.document.listenerCount("keydown")).toBe(0);
    });

    test("the fps timer reports frames per second from the engine's frame counter", async () => {
        let now = 1000;
        const p = await runningPlayer({ now: () => now });
        p.fromPlayer.length = 0;
        const tick = p.timers.intervals[0];
        expect(tick.ms).toBe(500);

        p.e.state.frameCount += 30;
        now += 500;
        tick.fn();
        await vi.waitFor(() => expect(p.fromPlayer).toHaveLength(1));

        expect(p.fromPlayer[0]).toEqual({ v: 1, type: "fps", value: 60 });
    });

    test("measure reports frames, first-frame time, memory, errors and the engine build", async () => {
        let now = 100;
        const p = await runningPlayer({ now: () => now });
        const tick = p.timers.intervals[0];
        p.win.console.error("scenario complained");
        p.fromPlayer.length = 0;

        now = 350;
        p.e.state.frameCount += 1;
        tick.fn(); // first frame seen at t = 350
        p.fromPlayer.length = 0;

        p.channel.port1.postMessage({ v: 1, type: "measure", seconds: 2 });
        await vi.waitFor(() => expect(p.timers.timeouts).toHaveLength(1));
        expect(p.timers.timeouts[0].ms).toBe(2000);
        now += 2000;
        p.e.state.frameCount += 120;
        p.timers.timeouts[0].fn();
        await vi.waitFor(() => expect(p.fromPlayer.some(m => m.type === "metrics")).toBe(true));

        const { metrics } = p.fromPlayer.find(m => m.type === "metrics");
        expect(metrics).toEqual({
            timeToFirstFrameMs: 250, avgFps: 60, gpuMemoryBytes: 123, consoleErrors: 1,
            engineBuild: "0.1.0-test (2026-10-25T00:00:00.000Z)",
        });
    });

    test("measure while another is running, or before the scenario runs, is ignored", async () => {
        const early = startPlayer();
        early.offerPort();
        early.channel.port1.postMessage({ v: 1, type: "measure", seconds: 1 });
        await flush();
        expect(early.timers.timeouts).toEqual([]);

        const p = await runningPlayer();
        p.channel.port1.postMessage({ v: 1, type: "measure", seconds: 1 });
        p.channel.port1.postMessage({ v: 1, type: "measure", seconds: 1 });
        await vi.waitFor(() => expect(p.timers.timeouts).toHaveLength(1));
        await flush();
        expect(p.timers.timeouts).toHaveLength(1);
    });

    test("console.error is counted and still forwarded; the first uncaught errors after running are reported, later ones only counted", async () => {
        const p = await runningPlayer();
        p.win.console.error("kept");
        expect(p.consoleError).toHaveBeenCalledWith("kept");
        p.fromPlayer.length = 0;

        for (let i = 0; i < 6; i++) p.win.dispatch("error", { message: `boom ${i}` });
        p.win.dispatch("unhandledrejection", { reason: new Error("nope") });
        await flush();

        expect(p.fromPlayer.filter(m => m.type === "error")).toHaveLength(3);
        expect(p.fromPlayer[0]).toEqual({ v: 1, type: "error", message: "boom 0" });
    });

    test("an uncaught error before the scenario runs is not reported as a runtime error", async () => {
        const p = startPlayer();
        p.offerPort();
        p.win.dispatch("error", { message: "early" });
        await flush();

        expect(p.fromPlayer).toEqual([]);
    });
});
