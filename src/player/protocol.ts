// src/player/protocol.ts
// ============================================================
// The wire between the PLAYER (a sandboxed frame running scenario code) and its
// HOST (the page that embeds it). Shared by both sides and imported by neither
// the engine nor anything outside src/player/, so it carries no engine code into
// the host client.
//
// Everything that crosses the wire is parsed here, on the receiving side, by a
// function that returns a typed message or a reason. Nothing is cast: the
// player runs arbitrary scenario scripts, and the host is its own barricade.
//
//   player -> host  (window)  hello    { origin }                  once, targetOrigin "*"
//   host   -> player (window) port     MessagePort, transferred    once
//   host   -> player (port)   load | pause | resume | toggle-diagnostics | measure | capture
//   player -> host   (port)   progress | running | context-lost | error | fps | paused | metrics | result | capture | capture-failed
//
// Every message is the envelope `{ v: 1, type, ... }`.
//
// `capture` is additive within v1: the player advertises it in `hello.features`, and a host that sees no such
// feature does not send it (an older player would drop it and leave the request to time out).
// ============================================================

/** Wire protocol version. A mismatch fails the handshake before the host sends anything. */
export const PLAYER_PROTOCOL_VERSION = 1 as const;

/** The only `sandbox` tokens the player frame is given. `allow-same-origin` is never among them. */
export const PLAYER_SANDBOX_TOKENS: readonly string[] = Object.freeze(["allow-scripts", "allow-pointer-lock"]);

/** The frame's `allow` attribute: autoplay is what lets Chromium start audio after a click on the host. */
export const PLAYER_ALLOW = "autoplay";

/** Longest free text accepted from the other side; longer text is truncated. */
export const MAX_TEXT_LENGTH = 500;

/** Longest URL accepted; a longer one is rejected, because a truncated URL names a different resource. */
export const MAX_URL_LENGTH = 2048;

/** Features a player advertises in `hello.features`; a host only uses what is listed. */
export const PLAYER_FEATURE_CAPTURE = "capture";

/** Encodings a capture can be asked for. */
export type PlayerCaptureType = "image/png" | "image/jpeg";

/** Widest capture accepted: 1920 by default, never more than this. */
export const MAX_CAPTURE_WIDTH = 4096;
export const DEFAULT_CAPTURE_WIDTH = 1920;
const MIN_CAPTURE_WIDTH = 16;
export const DEFAULT_CAPTURE_QUALITY = 0.92;

/** Largest image the host accepts from the player (bytes). */
export const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

/** True when `bytes` start with the file signature of `type` (PNG: 8 bytes, JPEG: SOI + marker). */
export function hasImageSignature(bytes: Uint8Array, type: PlayerCaptureType): boolean {
    const signature = type === "image/png" ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0xff, 0xd8, 0xff];
    return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

export type PlayerState = "handshake" | "loading" | "running" | "error" | "disposed";
export type PlayerErrorCode = "handshake" | "origin" | "version" | "load" | "runtime";

export interface PlayerError {
    code: PlayerErrorCode;
    message: string;
}

export interface PlayerProgress {
    /** 0..1. */
    progress: number;
    operation: string;
    loadedBytes?: number;
    totalBytes?: number;
}

export interface PlayerMetrics {
    timeToFirstFrameMs: number;
    avgFps: number;
    gpuMemoryBytes: number;
    consoleErrors: number;
    engineBuild: string;
}

export interface PlayerResult {
    /** 0..1. */
    score: number;
    completed: boolean;
}

export type PlayerLoadSource = { kind: "blob"; blob: Blob } | { kind: "manifest"; url: string };

/** What the player reports to the host over the port. */
export type PlayerMessage =
    | ({ v: 1; type: "progress" } & PlayerProgress)
    | { v: 1; type: "running" }
    | { v: 1; type: "context-lost" }
    | { v: 1; type: "error"; message: string }
    | { v: 1; type: "fps"; value: number }
    | { v: 1; type: "paused"; value: boolean }
    | { v: 1; type: "metrics"; metrics: PlayerMetrics }
    | { v: 1; type: "result"; score: number; completed: boolean }
    | { v: 1; type: "capture"; id: number; blob: Blob }
    | { v: 1; type: "capture-failed"; id: number; message: string };

/** What the host asks of the player over the port. */
export type HostMessage =
    | { v: 1; type: "load"; source: PlayerLoadSource; engineUrl: string; transcoderPath: string; diag: boolean }
    | { v: 1; type: "pause" }
    | { v: 1; type: "resume" }
    | { v: 1; type: "toggle-diagnostics" }
    | { v: 1; type: "measure"; seconds: number }
    | { v: 1; type: "capture"; id: number; maxWidth: number; mime: PlayerCaptureType; quality: number };

export interface PlayerHello {
    v: number;
    origin: string;
    /** Optional capabilities beyond the v1 core; absent from a player that predates them. */
    features?: string[];
}

export type Parsed<T> = { ok: true; message: T } | { ok: false; reason: string; type?: string };

// ── field readers: each returns null for "not acceptable" ─────────────

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null;
const fail = (reason: string, type?: string): { ok: false; reason: string; type?: string } => ({ ok: false, reason, type });

/** A finite number clamped into [min, max]; NaN, Infinity and non-numbers are rejected rather than guessed at. */
export const readNumber = (value: unknown, min: number, max: number): number | null =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;

/** A string truncated to {@link MAX_TEXT_LENGTH}. */
export const readText = (value: unknown): string | null =>
    typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : null;

/** An absolute http(s) URL of acceptable length, normalised; anything else is rejected. */
export function readUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

// ── player -> host ────────────────────────────────────────────────────

/** Parses the player's `hello`. A foreign `v` is still a hello: the host answers it with a `version` error. */
export function parseHello(data: unknown): Parsed<PlayerHello> {
    if (!isRecord(data) || data.type !== "hello") return fail("not a hello");
    if (typeof data.v !== "number" || typeof data.origin !== "string") return fail("hello without v or origin", "hello");
    const message: PlayerHello = { v: data.v, origin: data.origin.slice(0, MAX_TEXT_LENGTH) };
    if (Array.isArray(data.features)) {
        message.features = data.features.slice(0, 16).filter((f): f is string => typeof f === "string").map(f => f.slice(0, 64));
    }
    return { ok: true, message };
}

/** Parses a message from the player's port; every number is clamped, every string capped. */
export function parsePlayerMessage(data: unknown): Parsed<PlayerMessage> {
    if (!isRecord(data)) return fail("not an object");
    const type = typeof data.type === "string" ? data.type : undefined;
    if (data.v !== PLAYER_PROTOCOL_VERSION) return fail(`unsupported protocol version ${String(data.v)}`, type);

    const ok = (message: PlayerMessage): Parsed<PlayerMessage> => ({ ok: true, message });
    switch (type) {
        case "running":
        case "context-lost":
            return ok({ v: 1, type });
        case "error": {
            const message = readText(data.message);
            return message === null ? fail("error without message", type) : ok({ v: 1, type, message });
        }
        case "fps": {
            const value = readNumber(data.value, 0, 1000);
            return value === null ? fail("fps is not a finite number", type) : ok({ v: 1, type, value });
        }
        case "paused":
            return typeof data.value === "boolean" ? ok({ v: 1, type, value: data.value }) : fail("paused is not a boolean", type);
        case "progress": {
            const progress = readNumber(data.progress, 0, 1);
            const operation = readText(data.operation);
            if (progress === null || operation === null) return fail("progress without progress/operation", type);
            const message: PlayerMessage = { v: 1, type, progress, operation };
            const loaded = readNumber(data.loadedBytes, 0, Number.MAX_SAFE_INTEGER);
            const total = readNumber(data.totalBytes, 0, Number.MAX_SAFE_INTEGER);
            if (loaded !== null) message.loadedBytes = loaded;
            if (total !== null) message.totalBytes = total;
            return ok(message);
        }
        case "metrics": {
            const m = isRecord(data.metrics) ? data.metrics : {};
            const metrics: PlayerMetrics | null = readMetrics(m);
            return metrics === null ? fail("metrics incomplete", type) : ok({ v: 1, type, metrics });
        }
        case "result": {
            const score = readNumber(data.score, 0, 1);
            if (score === null || typeof data.completed !== "boolean") return fail("result without a finite score and boolean completed", type);
            return ok({ v: 1, type, score, completed: data.completed });
        }
        case "capture": {
            // A bad body for a usable id still settles that request; without an id there is nothing to settle.
            if (!isRequestId(data.id)) return fail("capture without a valid id", type);
            if (typeof Blob !== "function" || !(data.blob instanceof Blob)) return ok({ v: 1, type: "capture-failed", id: data.id, message: "the player sent a capture that is not an image blob" });
            return ok({ v: 1, type, id: data.id, blob: data.blob });
        }
        case "capture-failed": {
            const message = readText(data.message);
            if (!isRequestId(data.id) || message === null) return fail("capture-failed without id and message", type);
            return ok({ v: 1, type, id: data.id, message });
        }
        default:
            return fail(`unknown type ${String(type)}`, type);
    }
}

const isRequestId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function readMetrics(m: Rec): PlayerMetrics | null {
    const timeToFirstFrameMs = readNumber(m.timeToFirstFrameMs, 0, 3_600_000);
    const avgFps = readNumber(m.avgFps, 0, 1000);
    const gpuMemoryBytes = readNumber(m.gpuMemoryBytes, 0, Number.MAX_SAFE_INTEGER);
    const consoleErrors = readNumber(m.consoleErrors, 0, 1_000_000);
    const engineBuild = readText(m.engineBuild);
    if (timeToFirstFrameMs === null || avgFps === null || gpuMemoryBytes === null || consoleErrors === null || engineBuild === null) return null;
    return { timeToFirstFrameMs, avgFps, gpuMemoryBytes, consoleErrors: Math.floor(consoleErrors), engineBuild };
}

// ── host -> player ────────────────────────────────────────────────────

/** Parses a message from the host's port. A `load` whose source is not a Blob or manifest URL is rejected. */
export function parseHostMessage(data: unknown): Parsed<HostMessage> {
    if (!isRecord(data)) return fail("not an object");
    const type = typeof data.type === "string" ? data.type : undefined;
    if (data.v !== PLAYER_PROTOCOL_VERSION) return fail(`unsupported protocol version ${String(data.v)}`, type);

    switch (type) {
        case "pause":
        case "resume":
        case "toggle-diagnostics":
            return { ok: true, message: { v: 1, type } };
        case "measure": {
            const seconds = readNumber(data.seconds, 1, 60);
            return seconds === null ? fail("measure.seconds is not a finite number", type) : { ok: true, message: { v: 1, type, seconds } };
        }
        case "capture": {
            if (!isRequestId(data.id)) return fail("capture.id is not a non-negative integer", type);
            if (data.mime !== "image/png" && data.mime !== "image/jpeg") return fail("capture.mime is neither image/png nor image/jpeg", type);
            const maxWidth = readNumber(data.maxWidth, MIN_CAPTURE_WIDTH, MAX_CAPTURE_WIDTH);
            const quality = readNumber(data.quality, 0, 1);
            if (maxWidth === null || quality === null) return fail("capture.maxWidth/quality are not finite numbers", type);
            return { ok: true, message: { v: 1, type, id: data.id, maxWidth: Math.round(maxWidth), mime: data.mime, quality } };
        }
        case "load":
            return parseLoad(data);
        default:
            return fail(`unknown type ${String(type)}`, type);
    }
}

function parseLoad(data: Rec): Parsed<HostMessage> {
    const source = data.source;
    let parsed: PlayerLoadSource | null = null;
    if (isRecord(source) && source.kind === "blob" && typeof Blob === "function" && source.blob instanceof Blob) {
        parsed = { kind: "blob", blob: source.blob };
    } else if (isRecord(source) && source.kind === "manifest") {
        const url = readUrl(source.url);
        if (url !== null) parsed = { kind: "manifest", url };
    }
    const engineUrl = readUrl(data.engineUrl);
    const transcoderPath = readUrl(data.transcoderPath);
    if (parsed === null) return fail("load.source is neither a Blob nor a manifest URL", "load");
    if (engineUrl === null) return fail("load.engineUrl is not an absolute http(s) URL", "load");
    if (transcoderPath === null) return fail("load.transcoderPath is not an absolute http(s) URL", "load");
    if (typeof data.diag !== "boolean") return fail("load.diag is not a boolean", "load");
    return { ok: true, message: { v: 1, type: "load", source: parsed, engineUrl, transcoderPath, diag: data.diag } };
}
