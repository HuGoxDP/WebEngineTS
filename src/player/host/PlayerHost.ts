// src/player/host/PlayerHost.ts
// ============================================================
// The host side of the sandboxed player: framework-agnostic, no engine import.
//
// A host page owns a container element. PlayerHost puts a sandboxed iframe in it
// (opaque origin: the scenario's scripts cannot reach the host's storage, token
// or DOM), performs the handshake, and then talks to the player over a private
// MessageChannel.
//
// Trust model. The frame runs arbitrary scenario code, so everything it sends is
// untrusted input and is parsed by `protocol.ts` before it is used. The one
// message that crosses on the window is `hello`, and it is acted on exactly once,
// only when it comes from this frame's own window and its self-reported origin
// and protocol version are the ones the host expects. The host never sends the
// scenario's bytes before that. `port` is posted with targetOrigin "*" because an
// opaque origin cannot be named; that is safe only because nothing secret
// travels in it - the port is a capability, and the frame is the only window
// the host hands it to.
// ============================================================

import {
    MAX_TEXT_LENGTH,
    PLAYER_ALLOW,
    PLAYER_PROTOCOL_VERSION,
    PLAYER_SANDBOX_TOKENS,
    parseHello,
    parsePlayerMessage,
    readUrl,
    type HostMessage,
    type PlayerError,
    type PlayerErrorCode,
    type PlayerLoadSource,
    type PlayerMessage,
    type PlayerMetrics,
    type PlayerProgress,
    type PlayerState,
} from "../protocol";

export type { PlayerError, PlayerMessage, PlayerMetrics, PlayerProgress, PlayerState, PlayerLoadSource };
export { PLAYER_PROTOCOL_VERSION };

export interface PlayerCallbacks {
    onState(state: PlayerState): void;
    onProgress(progress: PlayerProgress): void;
    onFps(value: number): void;
    onPaused(paused: boolean): void;
    onError(error: PlayerError): void;
    onContextLost(): void;
}

export interface PlayerHostOptions {
    /** URL of `player.html` as served with `player.nginx.conf`'s headers. Relative URLs resolve against the host page. */
    playerUrl: string;
    /** URL of the engine bundle the player imports (`WebEngineTS.standalone.js`); needs `Access-Control-Allow-Origin: *`. */
    engineUrl: string;
    /** Directory the Basis transcoder is served from. Default: `/basis/` on the host's origin. */
    transcoderPath?: string;
    /** The origin the player must report. Default `"null"`, the opaque origin of a sandboxed frame. */
    expectedOrigin?: string;
    /** How long to wait for the player's `hello`. Default 10 000 ms. */
    handshakeTimeoutMs?: number;
    /** How long a load may go without any progress message before it fails. Default 60 000 ms. */
    loadTimeoutMs?: number;
    callbacks?: Partial<PlayerCallbacks>;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_LOAD_TIMEOUT_MS = 60_000;
/** Slack added to a measurement's own length before the host gives up on its result. */
const MEASURE_SLACK_MS = 15_000;

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: Error): void;
}

function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Everything that belongs to one frame; replaced wholesale by restart, load and dispose. */
interface Session {
    frame: HTMLIFrameElement;
    port: MessagePort | null;
    state: PlayerState;
    load: Deferred<void>;
    measure: Deferred<PlayerMetrics> | null;
    timer: ReturnType<typeof setTimeout> | null;
    measureTimer: ReturnType<typeof setTimeout> | null;
    onWindowMessage: (event: MessageEvent) => void;
    warnedMalformed: boolean;
}

/**
 * Runs a scenario in a sandboxed player frame.
 *
 * @example
 * ```ts
 * const host = new PlayerHost(container, {
 *     playerUrl: "/player/player.html",
 *     engineUrl: "/assets/WebEngineTS.standalone.js",
 *     callbacks: { onError: e => showBanner(e.message), onFps: v => (fps = v) },
 * });
 * await host.load({ kind: "blob", blob: zipBlob }, { diag: false });
 * ```
 */
export class PlayerHost {
    private readonly _container: HTMLElement;
    private readonly _window: Window;
    private readonly _playerUrl: string;
    private readonly _engineUrl: string;
    private readonly _transcoderPath: string;
    private readonly _expectedOrigin: string;
    private readonly _handshakeTimeoutMs: number;
    private readonly _loadTimeoutMs: number;
    private readonly _callbacks: Partial<PlayerCallbacks>;

    private _session: Session | null = null;
    private _last: { source: PlayerLoadSource; diag: boolean } | null = null;
    private _disposed = false;

    /** @throws TypeError if `playerUrl`, `engineUrl` or `transcoderPath` is not an http(s) URL. */
    constructor(container: HTMLElement, options: PlayerHostOptions) {
        const doc = container.ownerDocument;
        this._container = container;
        this._window = doc.defaultView ?? window;
        this._playerUrl = PlayerHost._absolute(options.playerUrl, doc, "playerUrl");
        this._engineUrl = PlayerHost._absolute(options.engineUrl, doc, "engineUrl");
        this._transcoderPath = PlayerHost._absolute(options.transcoderPath ?? "/basis/", doc, "transcoderPath");
        this._expectedOrigin = options.expectedOrigin ?? "null";
        this._handshakeTimeoutMs = PlayerHost._positive(options.handshakeTimeoutMs, DEFAULT_HANDSHAKE_TIMEOUT_MS);
        this._loadTimeoutMs = PlayerHost._positive(options.loadTimeoutMs, DEFAULT_LOAD_TIMEOUT_MS);
        this._callbacks = options.callbacks ?? {};
    }

    /**
     * Starts a fresh frame, handshakes, and loads the scenario. Resolves when the scenario is running.
     * Rejects when the handshake, the load or the player fails (the same failure reaches `onError`), and when the
     * host is disposed or a newer `load`/`restart` replaces this one.
     */
    load(source: PlayerLoadSource, opts: { diag: boolean }): Promise<void> {
        this._last = { source, diag: opts.diag };
        return this._start();
    }

    /** Discards the frame and runs the same source again in a new one. Rejects if nothing was loaded before. */
    restart(): Promise<void> {
        if (!this._last) return Promise.reject(new Error("[PlayerHost] restart() before load()."));
        return this._start();
    }

    /** Pauses the scenario's clock. Has no effect unless the scenario is running. */
    pause(): void {
        this._send({ v: 1, type: "pause" });
    }

    /** Resumes after {@link pause}. Has no effect unless the scenario is running. */
    resume(): void {
        this._send({ v: 1, type: "resume" });
    }

    /** Shows or hides the diagnostics overlay; only does anything if `load` was called with `diag: true`. */
    toggleDiagnostics(): void {
        this._send({ v: 1, type: "toggle-diagnostics" });
    }

    /**
     * Measures the running scenario for `seconds` (clamped to 1..60) and resolves with the result.
     * @throws RangeError (as a rejection) if `seconds` is not finite; Error if the scenario is not running or another
     * measurement is in progress.
     */
    measure(seconds: number): Promise<PlayerMetrics> {
        const session = this._session;
        if (!Number.isFinite(seconds)) return Promise.reject(new RangeError("[PlayerHost] measure(seconds): seconds must be finite."));
        if (!session || session.state !== "running" || !session.port) return Promise.reject(new Error("[PlayerHost] measure() needs a running scenario."));
        if (session.measure) return Promise.reject(new Error("[PlayerHost] a measurement is already running."));

        const clamped = Math.min(60, Math.max(1, seconds));
        const pending = defer<PlayerMetrics>();
        session.measure = pending;
        session.measureTimer = setTimeout(() => this._settleMeasure(session, new Error("[PlayerHost] the player never reported its measurement.")), clamped * 1000 + MEASURE_SLACK_MS);
        session.port.postMessage({ v: 1, type: "measure", seconds: clamped } satisfies HostMessage);
        return pending.promise;
    }

    /** Removes the frame and closes the channel. Pending promises reject; safe to call again. */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this._teardown(this._session, new Error("[PlayerHost] disposed."));
        this._emit("onState", "disposed");
    }

    // ── session lifecycle ─────────────────────────────────────────────

    private _start(): Promise<void> {
        if (this._disposed) return Promise.reject(new Error("[PlayerHost] disposed."));
        this._teardown(this._session, new Error("[PlayerHost] superseded by a newer load()/restart()."));

        const frame = PlayerHost._createFrame(this._container, this._playerUrl);
        const session: Session = {
            frame, port: null, state: "handshake", load: defer<void>(), measure: null,
            timer: null, measureTimer: null, onWindowMessage: event => this._onWindowMessage(session, event), warnedMalformed: false,
        };
        this._session = session;
        this._window.addEventListener("message", session.onWindowMessage);
        session.timer = setTimeout(
            () => this._fail(session, "handshake", `the player did not say hello within ${this._handshakeTimeoutMs} ms.`),
            this._handshakeTimeoutMs,
        );
        this._setState(session, "handshake");
        this._container.appendChild(frame);
        return session.load.promise;
    }

    /** The one place a frame is made: exactly the sandbox and allow values the design fixes, nothing configurable. */
    private static _createFrame(container: HTMLElement, playerUrl: string): HTMLIFrameElement {
        const frame = container.ownerDocument.createElement("iframe");
        frame.setAttribute("sandbox", PLAYER_SANDBOX_TOKENS.join(" "));
        frame.setAttribute("allow", PLAYER_ALLOW);
        frame.style.cssText = "width:100%;height:100%;border:0;display:block";
        frame.src = playerUrl;
        return frame;
    }

    private _onWindowMessage(session: Session, event: MessageEvent): void {
        // After the handshake the window is not listened to at all: a script inside the frame can still post to it.
        if (session !== this._session || session.port) return;
        if (event.source === null || event.source !== session.frame.contentWindow) return;

        const hello = parseHello(event.data);
        if (!hello.ok) return;
        if (hello.message.v !== PLAYER_PROTOCOL_VERSION) {
            return this._fail(session, "version", `the player speaks protocol v${hello.message.v}, this host speaks v${PLAYER_PROTOCOL_VERSION}.`);
        }
        // Two origins must agree: the one the browser stamped on the message and the one the player reports about itself.
        if (event.origin !== this._expectedOrigin || hello.message.origin !== this._expectedOrigin) {
            return this._fail(session, "origin", `the player reported origin "${hello.message.origin}" (message origin "${event.origin}"), expected "${this._expectedOrigin}".`);
        }

        const target = session.frame.contentWindow;
        if (!target) return this._fail(session, "handshake", "the player frame has no window.");
        this._window.removeEventListener("message", session.onWindowMessage);
        this._clearTimer(session);

        const channel = new MessageChannel();
        session.port = channel.port1;
        channel.port1.onmessage = message => this._onPortMessage(session, message.data);
        target.postMessage({ v: PLAYER_PROTOCOL_VERSION, type: "port" }, "*", [channel.port2]);

        const last = this._last;
        if (!last) return this._fail(session, "handshake", "no source to load.");
        this._setState(session, "loading");
        this._armLoadTimer(session);
        channel.port1.postMessage({
            v: 1, type: "load", source: last.source, engineUrl: this._engineUrl, transcoderPath: this._transcoderPath, diag: last.diag,
        } satisfies HostMessage);
    }

    private _onPortMessage(session: Session, data: unknown): void {
        if (session !== this._session) return;
        const parsed = parsePlayerMessage(data);
        if (!parsed.ok) {
            if (!session.warnedMalformed) {
                session.warnedMalformed = true;
                console.warn(`[PlayerHost] dropped a malformed player message (${parsed.reason}); further ones are dropped silently.`);
            }
            return;
        }

        const message = parsed.message;
        switch (message.type) {
            case "progress":
                if (session.state === "loading") this._armLoadTimer(session);
                this._emit("onProgress", { progress: message.progress, operation: message.operation, loadedBytes: message.loadedBytes, totalBytes: message.totalBytes });
                break;
            case "running":
                if (session.state !== "loading") break;
                this._clearTimer(session);
                this._setState(session, "running");
                session.load.resolve();
                break;
            case "error":
                this._fail(session, session.state === "running" ? "runtime" : "load", message.message);
                break;
            case "fps":
                this._emit("onFps", message.value);
                break;
            case "paused":
                this._emit("onPaused", message.value);
                break;
            case "context-lost":
                this._emit("onContextLost");
                break;
            case "metrics":
                this._settleMeasure(session, null, message.metrics);
                break;
        }
    }

    /**
     * Reports a failure. Handshake-time and load-time failures also remove the frame (nothing useful is running);
     * a `runtime` error leaves it, so the host can show the scenario's last state or call `restart()`.
     */
    private _fail(session: Session, code: PlayerErrorCode, message: string): void {
        if (session !== this._session) return;
        const error = new Error(`[PlayerHost] ${code}: ${message}`);
        this._setState(session, "error");
        this._emit("onError", { code, message: message.slice(0, MAX_TEXT_LENGTH) });
        if (code !== "runtime") {
            this._teardown(session, error);
            return;
        }
        this._settleMeasure(session, error);
    }

    private _teardown(session: Session | null, reason: Error): void {
        if (!session) return;
        if (this._session === session) this._session = null;
        this._window.removeEventListener("message", session.onWindowMessage);
        this._clearTimer(session);
        this._settleMeasure(session, reason);
        if (session.port) {
            session.port.onmessage = null;
            session.port.close();
            session.port = null;
        }
        session.frame.remove();
        session.load.reject(reason);
        // The caller that dropped the promise (fire-and-forget `host.load(...)`) must not see an unhandled rejection.
        session.load.promise.catch(() => undefined);
    }

    // ── helpers ───────────────────────────────────────────────────────

    private _send(message: HostMessage): void {
        const session = this._session;
        if (session?.state === "running") session.port?.postMessage(message);
    }

    private _setState(session: Session, state: PlayerState): void {
        session.state = state;
        this._emit("onState", state);
    }

    private _armLoadTimer(session: Session): void {
        this._clearTimer(session);
        session.timer = setTimeout(
            () => this._fail(session, "load", `no progress for ${this._loadTimeoutMs} ms; the load was abandoned.`),
            this._loadTimeoutMs,
        );
    }

    private _clearTimer(session: Session): void {
        if (session.timer !== null) clearTimeout(session.timer);
        session.timer = null;
    }

    private _settleMeasure(session: Session, error: Error | null, metrics?: PlayerMetrics): void {
        const pending = session.measure;
        if (!pending) return;
        session.measure = null;
        if (session.measureTimer !== null) clearTimeout(session.measureTimer);
        session.measureTimer = null;
        if (error) {
            pending.reject(error);
            pending.promise.catch(() => undefined);
        } else if (metrics) {
            pending.resolve(metrics);
        }
    }

    /** Callbacks belong to the embedding app; one that throws must not break the protocol. */
    private _emit<K extends keyof PlayerCallbacks>(name: K, ...args: Parameters<PlayerCallbacks[K]>): void {
        try {
            (this._callbacks[name] as ((...a: unknown[]) => void) | undefined)?.(...args);
        } catch (error) {
            console.error(`[PlayerHost] ${name} threw:`, error);
        }
    }

    private static _absolute(value: string, doc: Document, name: string): string {
        let resolved: string | null = null;
        try {
            resolved = readUrl(new URL(value, doc.baseURI).href);
        } catch {
            resolved = null;
        }
        if (resolved === null) throw new TypeError(`[PlayerHost] ${name} must be an http(s) URL, got "${String(value)}".`);
        return resolved;
    }

    private static _positive(value: number | undefined, fallback: number): number {
        return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
    }
}
