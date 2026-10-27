// tests/PlayerHost.test.ts
// ============================================================
// The host side of the sandboxed player (src/player/host/PlayerHost.ts), Phase 3 of the player-isolation plan.
//
// "Dirty" first: the frame runs arbitrary scenario code, so these tests are mostly about what the host must NOT
// do - send bytes to a frame that failed the origin or version check, act on a message from another window or
// after the handshake, believe a number or a string it was handed. Then the clean path: a valid handshake, the
// iframe's exact sandbox attributes (DW-3.5) and the full lifecycle. The "player" in these tests is a real
// MessageChannel port, so what crosses it is structured-cloned as in a browser.
// ============================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PlayerHost, PLAYER_PROTOCOL_VERSION, type PlayerCallbacks, type PlayerHostOptions } from "../src/player/host/index";
import { FakeContainer, FakeWindow, messageEvent } from "./_playerFakes";

const BASE = "https://platform.test/viewer/";
const FORBIDDEN_TOKENS = ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-forms"];

let hosts: PlayerHost[] = [];
let ports: MessagePort[] = [];

interface Rig {
    container: FakeContainer;
    host: PlayerHost;
    calls: { state: string[]; errors: { code: string; message: string }[]; fps: number[]; paused: boolean[]; progress: any[]; contextLost: number; results: any[] };
    /** What the "player" received over its port, once a handshake happened. */
    received: any[];
}

function rig(options: Partial<PlayerHostOptions> = {}): Rig {
    const container = new FakeContainer(BASE);
    const calls: Rig["calls"] = { state: [], errors: [], fps: [], paused: [], progress: [], contextLost: 0, results: [] };
    const callbacks: Partial<PlayerCallbacks> = {
        onState: s => calls.state.push(s),
        onError: e => calls.errors.push(e),
        onFps: v => calls.fps.push(v),
        onPaused: v => calls.paused.push(v),
        onProgress: p => calls.progress.push(p),
        onContextLost: () => { calls.contextLost++; },
        onResult: r => calls.results.push(r),
    };
    const host = new PlayerHost(container as unknown as HTMLElement, {
        playerUrl: "/player/player.html", engineUrl: "/engine/WebEngineTS.standalone.js", callbacks, ...options,
    });
    hosts.push(host);
    return { container, host, calls, received: [] };
}

const blobSource = () => ({ kind: "blob" as const, blob: new Blob(["zip bytes"]) });

/** The player's hello, from the current frame's own window unless told otherwise. */
function sayHello(r: Rig, over: { source?: unknown; origin?: string; data?: unknown } = {}): void {
    const data = "data" in over ? over.data : { v: 1, type: "hello", origin: "null" };
    r.container.window.dispatch("message", messageEvent("source" in over ? over.source : r.container.frame.contentWindow, data, over.origin ?? "null"));
}

/** The port the host transferred to the frame; the test plays the player on it. */
function playerPort(r: Rig): MessagePort {
    const port = r.container.frame.contentWindow!.posted.find(p => p.data?.type === "port")!.transfer[0] as MessagePort;
    ports.push(port);
    port.onmessage = event => r.received.push(event.data);
    return port;
}

/** Starts a load and completes the handshake; resolves once the host has sent `load`. */
async function startLoad(r: Rig, options: { diag?: boolean } = {}): Promise<{ port: MessagePort; loaded: Promise<void> }> {
    const loaded = r.host.load(blobSource(), { diag: options.diag ?? false });
    loaded.catch(() => undefined);
    sayHello(r);
    const port = playerPort(r);
    await vi.waitFor(() => expect(r.received.some(m => m.type === "load")).toBe(true));
    return { port, loaded };
}

async function running(r: Rig): Promise<MessagePort> {
    const { port, loaded } = await startLoad(r);
    port.postMessage({ v: 1, type: "running" });
    await loaded;
    return port;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => { hosts = []; ports = []; });
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    hosts.forEach(h => h.dispose());
    ports.forEach(p => p.close());
});

describe("DW-3.5: the iframe", () => {
    test("DW_3_5 sandbox and allow carry exactly the Phase 1 tokens", () => {
        const r = rig();
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);

        const frame = r.container.frame;
        expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-pointer-lock");
        expect(frame.getAttribute("allow")).toBe("autoplay");
    });

    test("DW_3_5 none of the forbidden sandbox tokens is present", () => {
        const r = rig();
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);

        const tokens = r.container.frame.getAttribute("sandbox")!.split(/\s+/);
        for (const forbidden of FORBIDDEN_TOKENS) expect(tokens).not.toContain(forbidden);
        expect(Object.keys(r.container.frame.attrs).sort()).toEqual(["allow", "sandbox"]);
    });

    test("the frame is appended to the container and points at the absolute player URL", () => {
        const r = rig();
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);

        expect(r.container.children).toEqual([r.container.frame]);
        expect(r.container.frame.src).toBe("https://platform.test/player/player.html");
    });
});

describe("construction", () => {
    test("a non-http(s) playerUrl is a TypeError, not a frame", () => {
        expect(() => rig({ playerUrl: "javascript:alert(1)" })).toThrow(TypeError);
        expect(() => rig({ engineUrl: "data:text/javascript,1" })).toThrow(TypeError);
        expect(() => rig({ transcoderPath: "file:///etc/" })).toThrow(TypeError);
    });

    test("PLAYER_PROTOCOL_VERSION is 1", () => {
        expect(PLAYER_PROTOCOL_VERSION).toBe(1);
    });
});

describe("DW-3.2: handshake, valid", () => {
    test("DW_3_2 a valid hello establishes the port and the load message arrives with absolute URLs", async () => {
        const r = rig();
        const { loaded, port } = await startLoad(r, { diag: true });

        const posted = r.container.frame.contentWindow!.posted;
        expect(posted).toHaveLength(1);
        expect(posted[0].data).toEqual({ v: 1, type: "port" });
        expect(posted[0].targetOrigin).toBe("*");
        expect(posted[0].transfer).toHaveLength(1);

        const load = r.received.find(m => m.type === "load");
        expect(load).toMatchObject({
            v: 1, type: "load", engineUrl: "https://platform.test/engine/WebEngineTS.standalone.js",
            transcoderPath: "https://platform.test/basis/", diag: true,
        });
        expect(load.source.kind).toBe("blob");
        expect(load.source.blob).toBeInstanceOf(Blob);
        expect(r.calls.state).toEqual(["handshake", "loading"]);

        port.postMessage({ v: 1, type: "running" });
        await loaded;
        expect(r.calls.state).toEqual(["handshake", "loading", "running"]);
    });

    test("a manifest source is forwarded as a URL", async () => {
        const r = rig({ transcoderPath: "https://cdn.test/basis/" });
        void r.host.load({ kind: "manifest", url: "https://cdn.test/s/scenario.json" }, { diag: false }).catch(() => undefined);
        sayHello(r);
        playerPort(r);
        await vi.waitFor(() => expect(r.received).toHaveLength(1));

        expect(r.received[0].source).toEqual({ kind: "manifest", url: "https://cdn.test/s/scenario.json" });
        expect(r.received[0].transcoderPath).toBe("https://cdn.test/basis/");
    });

    test("DW_3_2 a non-default expectedOrigin is honoured: matching hello passes", async () => {
        const r = rig({ expectedOrigin: "https://player.platform.test" });
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);
        sayHello(r, { origin: "https://player.platform.test", data: { v: 1, type: "hello", origin: "https://player.platform.test" } });

        expect(r.calls.errors).toEqual([]);
        expect(r.container.frame.contentWindow!.posted).toHaveLength(1);
    });

    test("DW_3_2 a non-default expectedOrigin is honoured: the default opaque origin is now refused", () => {
        const r = rig({ expectedOrigin: "https://player.platform.test" });
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);
        sayHello(r);

        expect(r.calls.errors.map(e => e.code)).toEqual(["origin"]);
        expect(r.container.frame.contentWindow!.posted).toEqual([]);
    });
});

describe("DW-3.2: handshake, dirty", () => {
    test("DW_3_2 a hello from another window is ignored and nothing is sent", async () => {
        const r = rig();
        const loaded = r.host.load(blobSource(), { diag: false });
        loaded.catch(() => undefined);

        sayHello(r, { source: new FakeWindow() });
        sayHello(r, { source: null });
        sayHello(r, { source: {} });

        expect(r.calls.errors).toEqual([]);
        expect(r.container.frame.contentWindow!.posted).toEqual([]);
        expect(r.calls.state).toEqual(["handshake"]);

        sayHello(r); // the real one still works afterwards
        expect(r.container.frame.contentWindow!.posted).toHaveLength(1);
    });

    test("DW_3_2 a self-reported origin other than the expected one fails with 'origin' and sends no bytes", async () => {
        const r = rig();
        const loaded = r.host.load(blobSource(), { diag: false });
        sayHello(r, { data: { v: 1, type: "hello", origin: "https://platform.test" } });

        await expect(loaded).rejects.toThrow(/origin/);
        expect(r.calls.errors).toHaveLength(1);
        expect(r.calls.errors[0].code).toBe("origin");
        expect(r.container.frame?.contentWindow?.posted ?? []).toEqual([]);
        expect(r.container.children).toEqual([]);
    });

    test("DW_3_2 an event.origin the browser stamped as something else fails even if the player claims \"null\"", async () => {
        const r = rig();
        const loaded = r.host.load(blobSource(), { diag: false });
        sayHello(r, { origin: "https://evil.test" });

        await expect(loaded).rejects.toThrow(/origin/);
        expect(r.calls.errors[0].code).toBe("origin");
        expect(r.container.created[0].contentWindow!.posted).toEqual([]);
    });

    test("DW_3_2 a wrong protocol version fails with 'version' and sends no bytes", async () => {
        const r = rig();
        const loaded = r.host.load(blobSource(), { diag: false });
        sayHello(r, { data: { v: 2, type: "hello", origin: "null" } });

        await expect(loaded).rejects.toThrow(/version/);
        expect(r.calls.errors.map(e => e.code)).toEqual(["version"]);
        expect(r.container.created[0].contentWindow!.posted).toEqual([]);
        expect(r.container.children).toEqual([]);
    });

    test("DW_3_2 an unknown type or missing fields never completes the handshake", () => {
        const r = rig();
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);

        for (const data of [
            { v: 1, type: "banana", origin: "null" }, { v: 1, type: "hello" }, { v: 1, origin: "null" },
            { type: "hello", origin: "null" }, { v: "1", type: "hello", origin: "null" }, "hello", null, 42, [],
        ]) sayHello(r, { data });

        expect(r.calls.errors).toEqual([]);
        expect(r.container.frame.contentWindow!.posted).toEqual([]);
        expect(r.calls.state).toEqual(["handshake"]);
    });

    test("DW_3_2 a window message after the handshake is ignored, and the window is no longer listened to", async () => {
        const r = rig();
        await startLoad(r);
        expect(r.container.window.listenerCount("message")).toBe(0);

        sayHello(r); // a second hello, as a script inside the frame could post
        sayHello(r, { data: { v: 1, type: "error", message: "forged" } });
        sayHello(r, { data: { v: 1, type: "running" } });

        expect(r.container.frame.contentWindow!.posted).toHaveLength(1);
        expect(r.calls.errors).toEqual([]);
        expect(r.calls.state).toEqual(["handshake", "loading"]);
    });

    test("DW_3_2 a handshake that never happens times out after 10 s with 'handshake'", async () => {
        vi.useFakeTimers();
        const r = rig();
        const loaded = r.host.load(blobSource(), { diag: false });
        const settled = expect(loaded).rejects.toThrow(/handshake/);

        await vi.advanceTimersByTimeAsync(9_999);
        expect(r.calls.errors).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);

        await settled;
        expect(r.calls.errors.map(e => e.code)).toEqual(["handshake"]);
        expect(r.calls.state[r.calls.state.length - 1]).toBe("error");
        expect(r.container.children).toEqual([]);
        expect(r.container.window.listenerCount("message")).toBe(0);
    });

    test("handshakeTimeoutMs is honoured, and a nonsense value falls back to the default", async () => {
        vi.useFakeTimers();
        const quick = rig({ handshakeTimeoutMs: 50 });
        void quick.host.load(blobSource(), { diag: false }).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(50);
        expect(quick.calls.errors.map(e => e.code)).toEqual(["handshake"]);

        const nonsense = rig({ handshakeTimeoutMs: Number.NaN });
        void nonsense.host.load(blobSource(), { diag: false }).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(nonsense.calls.errors).toEqual([]);
    });
});

describe("DW-3.2: dirty values from the port", () => {
    test("DW_3_2 fps NaN is dropped, 1e9 clamps to 1000, -1 clamps to 0, non-numbers are dropped", async () => {
        const r = rig();
        const port = await running(r);

        for (const value of [Number.NaN, 1e9, -1, Infinity, "60", null, undefined, {}, 42.5]) port.postMessage({ v: 1, type: "fps", value });
        await vi.waitFor(() => expect(r.calls.fps).toHaveLength(3));
        await flush();

        expect(r.calls.fps).toEqual([1000, 0, 42.5]);
    });

    test("DW_3_2 a 10 000-character error message is capped at 500 and reaches onError as a load failure", async () => {
        const r = rig();
        const { port, loaded } = await startLoad(r);
        const settled = expect(loaded).rejects.toThrow();
        port.postMessage({ v: 1, type: "error", message: "x".repeat(10_000) });
        await settled;

        expect(r.calls.errors).toHaveLength(1);
        expect(r.calls.errors[0].code).toBe("load");
        expect(r.calls.errors[0].message).toHaveLength(500);
    });

    test("an error after running is 'runtime' and leaves the frame in place", async () => {
        const r = rig();
        const port = await running(r);
        port.postMessage({ v: 1, type: "error", message: "scenario threw" });
        await vi.waitFor(() => expect(r.calls.errors).toHaveLength(1));

        expect(r.calls.errors[0]).toEqual({ code: "runtime", message: "scenario threw" });
        expect(r.container.children).toHaveLength(1);
    });

    test("unknown types, wrong v, missing fields and non-objects are dropped, with one warning", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const r = rig();
        const port = await running(r);

        for (const data of [
            { v: 1, type: "banana" }, { v: 2, type: "running" }, { v: 1, type: "fps" }, { v: 1, type: "paused", value: "yes" },
            { v: 1, type: "progress", progress: 0.5 }, { v: 1, type: "error" }, { v: 1, type: "metrics", metrics: { avgFps: 1 } }, "running", 7, null,
        ]) port.postMessage(data);
        await flush();

        expect(r.calls.errors).toEqual([]);
        expect(r.calls.paused).toEqual([]);
        expect(r.calls.progress).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test("progress is clamped to 0..1 and its operation text capped", async () => {
        const r = rig();
        const { port } = await startLoad(r);
        port.postMessage({ v: 1, type: "progress", progress: 7, operation: "y".repeat(900), loadedBytes: -5, totalBytes: 10 });
        await vi.waitFor(() => expect(r.calls.progress).toHaveLength(1));

        expect(r.calls.progress[0].progress).toBe(1);
        expect(r.calls.progress[0].operation).toHaveLength(500);
        expect(r.calls.progress[0].loadedBytes).toBe(0);
        expect(r.calls.progress[0].totalBytes).toBe(10);
    });

    test("paused and context-lost reach their callbacks", async () => {
        const r = rig();
        const port = await running(r);
        port.postMessage({ v: 1, type: "paused", value: true });
        port.postMessage({ v: 1, type: "context-lost" });
        await vi.waitFor(() => expect(r.calls.contextLost).toBe(1));

        expect(r.calls.paused).toEqual([true]);
    });

    test("a callback that throws does not break the host", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const r = rig({ callbacks: { onFps: () => { throw new Error("app bug"); } } });
        const port = await running(r);
        port.postMessage({ v: 1, type: "fps", value: 30 });
        await vi.waitFor(() => expect(error).toHaveBeenCalled());

        expect(r.container.children).toHaveLength(1);
    });
});

describe("load lifecycle", () => {
    test("DW_3_2 dispose() mid-load rejects the load, removes the frame, closes the port and reports 'disposed'", async () => {
        const r = rig();
        const { port, loaded } = await startLoad(r);
        const settled = expect(loaded).rejects.toThrow(/disposed/);

        r.host.dispose();
        await settled;

        expect(r.container.children).toEqual([]);
        expect(r.calls.state[r.calls.state.length - 1]).toBe("disposed");
        expect(r.calls.errors).toEqual([]);
        port.postMessage({ v: 1, type: "running" });
        await flush();
        expect(r.calls.state.filter(s => s === "running")).toEqual([]);
    });

    test("dispose() during the handshake rejects the load; dispose() twice is harmless", async () => {
        const r = rig();
        const loaded = r.host.load(blobSource(), { diag: false });
        const settled = expect(loaded).rejects.toThrow(/disposed/);
        r.host.dispose();
        r.host.dispose();
        await settled;

        expect(r.calls.state.filter(s => s === "disposed")).toHaveLength(1);
        expect(r.container.window.listenerCount("message")).toBe(0);
    });

    test("after dispose(), load() and restart() reject and no frame is created", async () => {
        const r = rig();
        r.host.dispose();

        await expect(r.host.load(blobSource(), { diag: false })).rejects.toThrow(/disposed/);
        await expect(r.host.restart()).rejects.toThrow();
        expect(r.container.created).toEqual([]);
    });

    test("a load that goes quiet fails with 'load' after loadTimeoutMs, and progress keeps it alive", async () => {
        vi.useFakeTimers();
        const r = rig({ loadTimeoutMs: 1000 });
        const loaded = r.host.load(blobSource(), { diag: false });
        const settled = expect(loaded).rejects.toThrow(/load/);
        sayHello(r);
        const port = playerPort(r);

        await vi.advanceTimersByTimeAsync(900);
        port.postMessage({ v: 1, type: "progress", progress: 0.5, operation: "decoding" });
        await vi.waitFor(() => expect(r.calls.progress).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(800);
        expect(r.calls.errors).toEqual([]);

        await vi.advanceTimersByTimeAsync(400);
        await settled;
        expect(r.calls.errors.map(e => e.code)).toEqual(["load"]);
        expect(r.container.children).toEqual([]);
    });

    test("a second load() replaces the first: the old frame goes, the old promise rejects", async () => {
        const r = rig();
        const first = r.host.load(blobSource(), { diag: false });
        const firstSettled = expect(first).rejects.toThrow(/superseded/);
        void r.host.load(blobSource(), { diag: false }).catch(() => undefined);
        await firstSettled;

        expect(r.container.created).toHaveLength(2);
        expect(r.container.children).toEqual([r.container.created[1]]);
    });

    test("restart() before load() rejects", async () => {
        await expect(rig().host.restart()).rejects.toThrow(/before load/);
    });

    test("restart() builds a NEW frame, removes the old one, and loads the same source again", async () => {
        const r = rig();
        const port = await running(r);
        const first = r.container.frame;

        const restarted = r.host.restart();
        restarted.catch(() => undefined);
        const second = r.container.frame;
        expect(second).not.toBe(first);
        expect(first.isConnected).toBe(false);
        expect(r.container.children).toEqual([second]);

        r.received.length = 0;
        sayHello(r);
        playerPort(r);
        await vi.waitFor(() => expect(r.received.some(m => m.type === "load")).toBe(true));
        expect(r.received[0].source.blob).toBeInstanceOf(Blob);
        expect(r.received[0].source.blob.size).toBe(9);
        port.postMessage({ v: 1, type: "fps", value: 99 }); // the old port is closed: nothing arrives from it
        await flush();
        expect(r.calls.fps).toEqual([]);
    });
});

describe("DW-1.3: result", () => {
    test("DW_1_3 a valid result from the player port reaches onResult, clamped", async () => {
        const r = rig();
        const port = await running(r);
        port.postMessage({ v: 1, type: "result", score: 0.5, completed: false });
        port.postMessage({ v: 1, type: "result", score: 9, completed: true });
        await vi.waitFor(() => expect(r.calls.results).toHaveLength(2));
        expect(r.calls.results).toEqual([{ score: 0.5, completed: false }, { score: 1, completed: true }]);
    });

    test("DW_1_3 malformed results (NaN score, bad completed, wrong version) never reach onResult", async () => {
        const r = rig();
        const port = await running(r);
        port.postMessage({ v: 1, type: "result", score: Number.NaN, completed: true });
        port.postMessage({ v: 1, type: "result", score: 1, completed: "yes" });
        port.postMessage({ v: 2, type: "result", score: 1, completed: true });
        port.postMessage({ v: 1, type: "result" });
        port.postMessage({ v: 1, type: "fps", value: 7 });
        await vi.waitFor(() => expect(r.calls.fps).toEqual([7]));
        expect(r.calls.results).toEqual([]);
    });

    test("DW_1_3 a result posted on the window, by the frame or by a foreign source, is ignored before and after the handshake", async () => {
        const r = rig();
        const result = { v: 1, type: "result", score: 1, completed: true };
        const loaded = r.host.load(blobSource(), { diag: false });
        loaded.catch(() => undefined);
        sayHello(r, { data: result });
        sayHello(r, { source: new FakeWindow(), data: result });
        sayHello(r);
        const port = playerPort(r);
        await vi.waitFor(() => expect(r.received.some(m => m.type === "load")).toBe(true));
        port.postMessage({ v: 1, type: "running" });
        await loaded;
        r.container.window.dispatch("message", messageEvent(r.container.frame.contentWindow, result));
        r.container.window.dispatch("message", messageEvent(new FakeWindow(), result));
        await flush();
        expect(r.calls.results).toEqual([]);
    });

    test("a result that arrives during loading is delivered", async () => {
        const r = rig();
        const { port, loaded } = await startLoad(r);
        loaded.catch(() => undefined);
        port.postMessage({ v: 1, type: "result", score: 0.25, completed: false });
        await vi.waitFor(() => expect(r.calls.results).toEqual([{ score: 0.25, completed: false }]));
    });

    test("a result after the player failed is ignored, and a throwing onResult is isolated", async () => {
        const r = rig();
        const port = await running(r);
        port.postMessage({ v: 1, type: "error", message: "scenario threw" });
        await vi.waitFor(() => expect(r.calls.errors).toHaveLength(1));
        port.postMessage({ v: 1, type: "result", score: 1, completed: true });
        await flush();
        expect(r.calls.results).toEqual([]);

        const t = rig({ callbacks: { onResult: () => { throw new Error("app bug"); }, onFps: v => t.calls.fps.push(v) } });
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const tport = await running(t);
        tport.postMessage({ v: 1, type: "result", score: 1, completed: true });
        tport.postMessage({ v: 1, type: "fps", value: 3 });
        await vi.waitFor(() => expect(t.calls.fps).toEqual([3]));
        expect(spy).toHaveBeenCalled();
    });
});

describe("commands and measure", () => {
    test("pause, resume and toggleDiagnostics send nothing before the scenario runs", async () => {
        const r = rig();
        const { loaded } = await startLoad(r);
        loaded.catch(() => undefined);
        r.received.length = 0;

        r.host.pause();
        r.host.resume();
        r.host.toggleDiagnostics();
        await flush();

        expect(r.received).toEqual([]);
    });

    test("pause, resume and toggleDiagnostics are sent once it runs", async () => {
        const r = rig();
        await running(r);
        r.received.length = 0;

        r.host.pause();
        r.host.resume();
        r.host.toggleDiagnostics();
        await vi.waitFor(() => expect(r.received).toHaveLength(3));

        expect(r.received.map(m => m.type)).toEqual(["pause", "resume", "toggle-diagnostics"]);
        expect(r.received.every(m => m.v === 1)).toBe(true);
    });

    test("measure() sends a clamped duration and resolves with the clamped metrics", async () => {
        const r = rig();
        const port = await running(r);
        r.received.length = 0;

        const result = r.host.measure(1000);
        await vi.waitFor(() => expect(r.received).toHaveLength(1));
        expect(r.received[0]).toEqual({ v: 1, type: "measure", seconds: 60 });

        port.postMessage({ v: 1, type: "metrics", metrics: { timeToFirstFrameMs: 120.5, avgFps: 5000, gpuMemoryBytes: 1024, consoleErrors: 2.9, engineBuild: "0.1.0 (now)" } });
        expect(await result).toEqual({ timeToFirstFrameMs: 120.5, avgFps: 1000, gpuMemoryBytes: 1024, consoleErrors: 2, engineBuild: "0.1.0 (now)" });
    });

    test("measure() clamps a too-short duration to 1 second", async () => {
        const r = rig();
        await running(r);
        r.received.length = 0;

        void r.host.measure(-3).catch(() => undefined);
        await vi.waitFor(() => expect(r.received).toHaveLength(1));
        expect(r.received[0].seconds).toBe(1);
    });

    test("measure() rejects NaN, a scenario that is not running, and a second concurrent measurement", async () => {
        const r = rig();
        await expect(r.host.measure(5)).rejects.toThrow(/running/);

        await running(r);
        await expect(r.host.measure(Number.NaN)).rejects.toThrow(RangeError);

        const first = r.host.measure(5);
        first.catch(() => undefined);
        await expect(r.host.measure(5)).rejects.toThrow(/already/);
    });

    test("a pending measure() rejects when the host is disposed", async () => {
        const r = rig();
        await running(r);
        const pending = r.host.measure(5);
        const settled = expect(pending).rejects.toThrow(/disposed/);
        r.host.dispose();
        await settled;
    });

    test("incomplete metrics never resolve a measurement", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const r = rig();
        const port = await running(r);

        const pending = r.host.measure(1);
        const settled = expect(pending).rejects.toThrow(/never reported/);
        port.postMessage({ v: 1, type: "metrics", metrics: { avgFps: 60 } });
        await new Promise(resolve => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(1000 + 15_000);
        await settled;
    });
});
