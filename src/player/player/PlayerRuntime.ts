// src/player/player/PlayerRuntime.ts
// ============================================================
// The PLAYER: the page inside the sandboxed frame that imports the engine, runs
// the scenario and reports to the host. Written over an injected `window`-like
// and an injected engine importer, so every refusal path is testable without a
// browser; entry.ts binds the real globals.
//
// The player imports the engine at run time with `import(engineUrl)` and holds
// only its TYPE (`typeof import(...)`, erased at build): the player bundle
// contains no engine code. That is also why `Scenario.engineModuleUrl` exists -
// the scenario's `from "WebEngineTS"` must resolve to this same instance.
//
// What it refuses, and why:
//   - top-level (`parent === window`): nobody to talk to, and a real origin;
//   - any origin but PLAYER_EXPECTED_ORIGIN: the sandbox is the whole point.
//     A page that opens this file directly gets a real origin and must not run
//     scenario code (the CSP `sandbox` directive normally prevents that; this is
//     the second wall);
//   - a port from anything but `parent`, a second port, a second load;
//   - any message that does not parse (protocol.ts).
//
// Keyboard: with the frame focused the host page never sees a key, so Space (no modifier, not a repeat, not in an
// editable element) toggles pause here and reports `paused` over the port - the same message the host's own
// pause/resume produces. It is not swallowed: the engine's Input still sees it.
// ============================================================

import {
    PLAYER_PROTOCOL_VERSION,
    MAX_TEXT_LENGTH,
    parseHostMessage,
    type HostMessage,
    type PlayerLoadSource,
    type PlayerMessage,
    type PlayerMetrics,
} from "../protocol";

type EngineModule = typeof import("../../engine/index");

/** The slice of the engine the player drives; a test double implements just this. */
export type PlayerEngine = Pick<EngineModule, "Application" | "Time" | "MemoryProfiler" | "Texture2D" | "Scenario" | "AudioManager" | "BuildInfo">;

/**
 * The origin the player insists on, a single named constant.
 *
 * Variant C (the player on its own real origin) changes this to that origin, together with the frame URL, the
 * player CSP (dropping `sandbox`) and the host's `expectedOrigin`, and nothing else.
 */
export const PLAYER_EXPECTED_ORIGIN = "null";

/** How often the player reports its frame rate. */
const FPS_INTERVAL_MS = 500;
/** Runtime errors reported to the host; later ones are only counted. */
const MAX_REPORTED_RUNTIME_ERRORS = 3;

export interface PlayerEnv {
    /** The frame's window (or a test double with the same surface). */
    window: Window & typeof globalThis;
    /** `import(url)`; injected so the player never statically depends on the engine. */
    importEngine(url: string): Promise<PlayerEngine>;
    now?(): number;
}

export type BootResult = { ok: true } | { ok: false; reason: string };

const errorText = (error: unknown): string =>
    (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, MAX_TEXT_LENGTH);

/** True where Space belongs to the element: form fields (any `input` type) and contenteditable content. */
function isEditable(target: EventTarget | null): boolean {
    const element = target as Partial<HTMLElement> | null;
    return !!element && (/^(input|textarea|select)$/i.test(element.tagName ?? "") || element.isContentEditable === true);
}

/** Starts the player, or says why it refused. A refusal sends nothing to anyone. */
export function bootPlayer(env: PlayerEnv): BootResult {
    const win = env.window;
    if (win.parent === win) return { ok: false, reason: "the player was opened as a top-level page; it only runs inside the host's frame." };
    if (win.origin !== PLAYER_EXPECTED_ORIGIN) {
        return { ok: false, reason: `the player's origin is "${win.origin}", not "${PLAYER_EXPECTED_ORIGIN}"; refusing to run scenario code outside the sandbox.` };
    }

    const session = new PlayerSession(env);
    const onWindowMessage = (event: MessageEvent): void => {
        // Only the embedding window may hand over the port: not an opener, a sibling, or the frame itself.
        if (event.source !== win.parent) return;
        const data = event.data as { v?: unknown; type?: unknown } | null;
        if (typeof data !== "object" || data === null || data.v !== PLAYER_PROTOCOL_VERSION || data.type !== "port") return;
        if (event.ports.length !== 1) return;
        // The first valid port wins; the window is not listened to again.
        win.removeEventListener("message", onWindowMessage);
        session.attach(event.ports[0]);
    };
    win.addEventListener("message", onWindowMessage);
    session.watchErrors();
    win.parent.postMessage({ v: PLAYER_PROTOCOL_VERSION, type: "hello", origin: win.origin }, "*");
    return { ok: true };
}

class PlayerSession {
    private _port: MessagePort | null = null;
    private _loaded = false;
    private _engine: PlayerEngine | null = null;
    private _running = false;
    private _paused = false;
    private _savedTimeScale = 1;
    private _diag = false;
    private _measuring = false;
    private _consoleErrors = 0;
    private _reportedRuntimeErrors = 0;
    private _loadStartedAt = 0;
    private _firstFrameAt: number | null = null;
    private readonly _now: () => number;

    constructor(private readonly _env: PlayerEnv) {
        this._now = _env.now ?? (() => performance.now());
    }

    attach(port: MessagePort): void {
        this._port = port;
        port.onmessage = event => this._onMessage(event.data);
    }

    /** Counts what the scenario logs as errors, for `PlayerMetrics.consoleErrors`, and reports the first few uncaught ones. */
    watchErrors(): void {
        const win = this._env.window;
        const original = win.console.error.bind(win.console);
        win.console.error = (...args: unknown[]): void => {
            this._consoleErrors++;
            original(...args);
        };
        const uncaught = (text: string): void => {
            this._consoleErrors++;
            if (this._running && this._reportedRuntimeErrors++ < MAX_REPORTED_RUNTIME_ERRORS) this._post({ v: 1, type: "error", message: text.slice(0, MAX_TEXT_LENGTH) });
        };
        win.addEventListener("error", event => uncaught(String((event as ErrorEvent).message)));
        win.addEventListener("unhandledrejection", event => uncaught(`unhandledrejection: ${errorText((event as PromiseRejectionEvent).reason)}`));
    }

    private _post(message: PlayerMessage): void {
        this._port?.postMessage(message);
    }

    private _onMessage(data: unknown): void {
        const parsed = parseHostMessage(data);
        if (!parsed.ok) {
            console.warn(`[Player] dropped a malformed host message (${parsed.reason}).`);
            // A `load` the host is waiting on must be answered, or it waits for its timeout.
            if (parsed.type === "load") this._post({ v: 1, type: "error", message: `malformed load: ${parsed.reason}` });
            return;
        }
        this._handle(parsed.message);
    }

    private _handle(message: HostMessage): void {
        switch (message.type) {
            case "load":
                void this._load(message);
                break;
            case "pause":
                this._setPaused(true);
                break;
            case "resume":
                this._setPaused(false);
                break;
            case "toggle-diagnostics":
                if (this._running && this._diag) this._engine?.MemoryProfiler.toggleOverlay();
                break;
            case "measure":
                if (this._running && !this._measuring) void this._measure(message.seconds);
                break;
        }
    }

    private async _load(message: Extract<HostMessage, { type: "load" }>): Promise<void> {
        if (this._loaded) {
            this._post({ v: 1, type: "error", message: "this player already loaded a scenario; a restart uses a fresh frame." });
            return;
        }
        this._loaded = true;
        this._loadStartedAt = this._now();
        try {
            const engine = await this._env.importEngine(message.engineUrl);
            this._engine = engine;
            // Before any scenario code can run: the host's diagnostics decision is final.
            if (!message.diag) engine.MemoryProfiler.diagnosticsAllowed = false;
            this._diag = message.diag;
            engine.Texture2D.ktx2TranscoderPath = message.transcoderPath;
            engine.Scenario.engineModuleUrl = message.engineUrl;
            engine.Scenario.onResult = result => this._post({ v: 1, type: "result", score: result.score, completed: result.completed });

            const canvas = this._createCanvas();
            const app = new engine.Application(canvas);
            const onProgress = (p: { progress: number; currentOperation: string }): void =>
                this._post({ v: 1, type: "progress", progress: p.progress, operation: p.currentOperation });
            await PlayerSession._run(app, message.source, onProgress);

            if (message.diag) {
                engine.MemoryProfiler.enableToggle();
                engine.MemoryProfiler.showOverlay();
            }
            this._running = true;
            this._post({ v: 1, type: "running" });
            this._afterRunning(engine);
        } catch (error) {
            this._post({ v: 1, type: "error", message: errorText(error) });
        }
    }

    private static async _run(
        app: InstanceType<PlayerEngine["Application"]>,
        source: PlayerLoadSource,
        onProgress: (p: { progress: number; currentOperation: string }) => void,
    ): Promise<void> {
        if (source.kind === "blob") await app.loadScenarioFromBuffer(await source.blob.arrayBuffer(), onProgress);
        else await app.loadScenarioFromManifest(source.url, onProgress);
    }

    private _createCanvas(): HTMLCanvasElement {
        const doc = this._env.window.document;
        doc.body.style.cssText = "margin:0;overflow:hidden";
        const canvas = doc.createElement("canvas");
        canvas.style.cssText = "display:block;width:100vw;height:100vh";
        doc.body.append(canvas);
        canvas.addEventListener("webglcontextlost", () => this._post({ v: 1, type: "context-lost" }));
        return canvas;
    }

    /** Frame-rate reports, the first-frame stamp, and the audio unlock the engine never performs itself. */
    private _afterRunning(engine: PlayerEngine): void {
        const win = this._env.window;
        const { Time, AudioManager } = engine;

        // Browsers keep an AudioContext suspended until a gesture inside the frame; the engine never resumes it.
        const unlock = (): void => {
            win.document.removeEventListener("pointerdown", unlock, true);
            win.document.removeEventListener("keydown", unlock, true);
            try {
                void AudioManager.resume().catch(() => undefined);
            } catch {
                // No Web Audio here (some WebKit builds): nothing to unlock.
            }
        };
        win.document.addEventListener("pointerdown", unlock, true);
        win.document.addEventListener("keydown", unlock, true);

        // The frame's only teardown signal is its document going away; drop the input listeners with it.
        win.addEventListener("keydown", this._onKeyDown, true);
        win.addEventListener("pagehide", () => {
            win.removeEventListener("keydown", this._onKeyDown, true);
            win.document.removeEventListener("pointerdown", unlock, true);
            win.document.removeEventListener("keydown", unlock, true);
        }, { once: true });

        const baseline = Time.frameCount;
        let lastFrames = baseline;
        let lastAt = this._now();
        win.setInterval(() => {
            const at = this._now();
            const frames = Time.frameCount;
            if (this._firstFrameAt === null && frames > baseline) this._firstFrameAt = at;
            if (at > lastAt) this._post({ v: 1, type: "fps", value: Math.round(((frames - lastFrames) * 1000) / (at - lastAt) * 10) / 10 });
            lastFrames = frames;
            lastAt = at;
        }, FPS_INTERVAL_MS);
    }

    /**
     * Space toggles pause. Registered only once the scenario runs, so a key during load does nothing. The default action
     * is consumed for every plain Space, repeats included, so one held key is one toggle and no stray default fires;
     * with a modifier or in an editable element the key is left untouched.
     */
    private readonly _onKeyDown = (event: KeyboardEvent): void => {
        if (event.code !== "Space" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || isEditable(event.target)) return;
        event.preventDefault();
        if (!event.repeat) this._setPaused(!this._paused);
    };

    private _setPaused(paused: boolean): void {
        const engine = this._engine;
        if (!engine || !this._running || paused === this._paused) return;
        if (paused) {
            this._savedTimeScale = engine.Time.timeScale;
            engine.Time.timeScale = 0;
        } else {
            engine.Time.timeScale = this._savedTimeScale;
        }
        this._paused = paused;
        this._post({ v: 1, type: "paused", value: paused });
    }

    private async _measure(seconds: number): Promise<void> {
        const engine = this._engine;
        if (!engine) return;
        this._measuring = true;
        try {
            const startedAt = this._now();
            const startFrames = engine.Time.frameCount;
            await new Promise<void>(resolve => this._env.window.setTimeout(resolve, seconds * 1000));
            const elapsedS = Math.max((this._now() - startedAt) / 1000, 1e-3);
            const firstFrameAt = this._firstFrameAt ?? this._now();
            const metrics: PlayerMetrics = {
                timeToFirstFrameMs: Math.max(0, firstFrameAt - this._loadStartedAt),
                avgFps: (engine.Time.frameCount - startFrames) / elapsedS,
                gpuMemoryBytes: PlayerSession._gpuBytes(engine),
                consoleErrors: this._consoleErrors,
                engineBuild: `${engine.BuildInfo.version} (${engine.BuildInfo.builtAt ?? "unstamped"})`.slice(0, MAX_TEXT_LENGTH),
            };
            this._post({ v: 1, type: "metrics", metrics });
        } catch (error) {
            this._post({ v: 1, type: "error", message: `measure failed: ${errorText(error)}` });
        } finally {
            this._measuring = false;
        }
    }

    private static _gpuBytes(engine: PlayerEngine): number {
        const renderer = engine.MemoryProfiler.snapshot().renderer;
        return renderer ? renderer.estimatedTextureVramBytes + renderer.estimatedGeometryVramBytes + renderer.estimatedRenderTargetVramBytes : 0;
    }
}
