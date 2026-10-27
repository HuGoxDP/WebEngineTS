// tests/PlayerProtocol.test.ts
// ============================================================
// The wire parsers (src/player/protocol.ts) used by BOTH sides. Policy under test: a message that does not parse
// is dropped; a finite number outside its range is clamped; a non-finite number is dropped; text is truncated to
// 500 characters; a URL must be absolute http(s) and is rejected, never truncated, if too long.
// ============================================================

import { describe, expect, test } from "vitest";
import {
    MAX_TEXT_LENGTH, MAX_URL_LENGTH, PLAYER_ALLOW, PLAYER_SANDBOX_TOKENS, parseHello, parseHostMessage, parsePlayerMessage,
    readNumber, readText, readUrl,
} from "../src/player/protocol";

describe("field readers", () => {
    test("readNumber clamps finite values and rejects the rest", () => {
        expect(readNumber(5, 0, 10)).toBe(5);
        expect(readNumber(-1, 0, 10)).toBe(0);
        expect(readNumber(1e9, 0, 1000)).toBe(1000);
        for (const bad of [Number.NaN, Infinity, -Infinity, "5", null, undefined, {}, true]) expect(readNumber(bad, 0, 10)).toBeNull();
    });

    test("readText truncates to the cap and rejects non-strings", () => {
        expect(readText("abc")).toBe("abc");
        expect(readText("x".repeat(10_000))).toHaveLength(MAX_TEXT_LENGTH);
        expect(readText(5)).toBeNull();
        expect(readText(undefined)).toBeNull();
    });

    test("readUrl accepts absolute http(s) only, and rejects over-long URLs instead of cutting them", () => {
        expect(readUrl("https://a.test/x?y=1")).toBe("https://a.test/x?y=1");
        expect(readUrl("http://127.0.0.1:8080/basis/")).toBe("http://127.0.0.1:8080/basis/");
        for (const bad of ["/relative", "javascript:alert(1)", "data:text/plain,1", "blob:https://a.test/1", "file:///x", "", 5, null, "https://a.test/" + "x".repeat(MAX_URL_LENGTH)]) {
            expect(readUrl(bad)).toBeNull();
        }
    });
});

describe("shared constants", () => {
    test("the frame tokens never include allow-same-origin and the allow attribute is autoplay", () => {
        expect([...PLAYER_SANDBOX_TOKENS]).toEqual(["allow-scripts", "allow-pointer-lock"]);
        expect(PLAYER_ALLOW).toBe("autoplay");
    });
});

describe("parseHello", () => {
    test("a well-formed hello parses, even with a foreign version (the host answers that with 'version')", () => {
        expect(parseHello({ v: 1, type: "hello", origin: "null" })).toEqual({ ok: true, message: { v: 1, origin: "null" } });
        expect(parseHello({ v: 9, type: "hello", origin: "null" })).toMatchObject({ ok: true, message: { v: 9 } });
    });

    test("anything else does not", () => {
        for (const bad of [null, 1, "hello", [], {}, { type: "hello" }, { v: 1, type: "hello" }, { v: "1", type: "hello", origin: "null" }, { v: 1, type: "nope", origin: "null" }, { v: 1, type: "hello", origin: 5 }]) {
            expect(parseHello(bad).ok).toBe(false);
        }
    });
});

describe("parsePlayerMessage", () => {
    test("accepts each message type", () => {
        expect(parsePlayerMessage({ v: 1, type: "running" })).toEqual({ ok: true, message: { v: 1, type: "running" } });
        expect(parsePlayerMessage({ v: 1, type: "context-lost" }).ok).toBe(true);
        expect(parsePlayerMessage({ v: 1, type: "paused", value: false })).toMatchObject({ ok: true, message: { value: false } });
        expect(parsePlayerMessage({ v: 1, type: "fps", value: 59.9 })).toMatchObject({ ok: true, message: { value: 59.9 } });
        expect(parsePlayerMessage({ v: 1, type: "error", message: "boom" })).toMatchObject({ ok: true, message: { message: "boom" } });
        expect(parsePlayerMessage({ v: 1, type: "progress", progress: 0.25, operation: "x" })).toMatchObject({ ok: true, message: { progress: 0.25, operation: "x" } });
    });

    test("rejects a wrong or missing version, unknown type and non-objects, reporting the type it saw", () => {
        expect(parsePlayerMessage({ v: 2, type: "running" })).toMatchObject({ ok: false, type: "running" });
        expect(parsePlayerMessage({ type: "running" }).ok).toBe(false);
        expect(parsePlayerMessage({ v: 1, type: "hello" }).ok).toBe(false);
        for (const bad of [null, undefined, 3, "running", []]) expect(parsePlayerMessage(bad).ok).toBe(false);
    });

    test("DW_1_2 result: a valid message parses and the score is clamped into 0..1", () => {
        expect(parsePlayerMessage({ v: 1, type: "result", score: 0.25, completed: true })).toEqual({ ok: true, message: { v: 1, type: "result", score: 0.25, completed: true } });
        expect(parsePlayerMessage({ v: 1, type: "result", score: 5, completed: false })).toMatchObject({ ok: true, message: { score: 1 } });
        expect(parsePlayerMessage({ v: 1, type: "result", score: -5, completed: false })).toMatchObject({ ok: true, message: { score: 0 } });
    });

    test("DW_1_2 result: NaN/Infinity/non-number score, non-boolean or missing completed, wrong version are dropped", () => {
        for (const score of [Number.NaN, Infinity, -Infinity, "1", null, undefined]) expect(parsePlayerMessage({ v: 1, type: "result", score, completed: true }).ok).toBe(false);
        for (const completed of ["true", 1, null, undefined]) expect(parsePlayerMessage({ v: 1, type: "result", score: 1, completed }).ok).toBe(false);
        expect(parsePlayerMessage({ v: 2, type: "result", score: 1, completed: true }).ok).toBe(false);
        expect(parsePlayerMessage({ v: 1, type: "result" })).toMatchObject({ ok: false, type: "result" });
    });

    test("metrics: every field clamped, the error count floored, text capped; one missing field rejects the lot", () => {
        const parsed = parsePlayerMessage({
            v: 1, type: "metrics",
            metrics: { timeToFirstFrameMs: -5, avgFps: 1e9, gpuMemoryBytes: 1e300, consoleErrors: 3.7, engineBuild: "b".repeat(900) },
        });
        expect(parsed.ok && parsed.message.type === "metrics" && parsed.message.metrics).toEqual({
            timeToFirstFrameMs: 0, avgFps: 1000, gpuMemoryBytes: Number.MAX_SAFE_INTEGER, consoleErrors: 3, engineBuild: "b".repeat(500),
        });
        expect(parsePlayerMessage({ v: 1, type: "metrics", metrics: { avgFps: 1 } }).ok).toBe(false);
        expect(parsePlayerMessage({ v: 1, type: "metrics" }).ok).toBe(false);
        expect(parsePlayerMessage({ v: 1, type: "metrics", metrics: { timeToFirstFrameMs: Number.NaN, avgFps: 1, gpuMemoryBytes: 1, consoleErrors: 0, engineBuild: "x" } }).ok).toBe(false);
    });

    test("progress without bytes omits them; negative bytes clamp to 0", () => {
        const plain = parsePlayerMessage({ v: 1, type: "progress", progress: 1, operation: "x" });
        expect(plain.ok && "loadedBytes" in plain.message).toBe(false);
        const negative = parsePlayerMessage({ v: 1, type: "progress", progress: 1, operation: "x", loadedBytes: -1, totalBytes: Number.NaN });
        expect(negative.ok && negative.message).toMatchObject({ loadedBytes: 0 });
        expect(negative.ok && "totalBytes" in negative.message).toBe(false);
    });
});

describe("parseHostMessage", () => {
    const load = (over: Record<string, unknown> = {}) => ({
        v: 1, type: "load", source: { kind: "blob", blob: new Blob(["x"]) },
        engineUrl: "https://a.test/engine.js", transcoderPath: "https://a.test/basis/", diag: false, ...over,
    });

    test("a valid load parses with a Blob or a manifest source", () => {
        const blob = parseHostMessage(load());
        expect(blob.ok && blob.message.type === "load" && blob.message.source.kind).toBe("blob");
        const manifest = parseHostMessage(load({ source: { kind: "manifest", url: "https://a.test/s.json" } }));
        expect(manifest.ok && manifest.message.type === "load" && manifest.message.source).toEqual({ kind: "manifest", url: "https://a.test/s.json" });
    });

    test("a load with a non-Blob source, a bad URL or a non-boolean diag is rejected and says it was a load", () => {
        for (const bad of [
            load({ source: { kind: "blob", blob: "not a blob" } }), load({ source: { kind: "blob", blob: { size: 1 } } }),
            load({ source: { kind: "blob" } }), load({ source: { kind: "zip", blob: new Blob() } }), load({ source: null }), load({ source: "x" }),
            load({ source: { kind: "manifest", url: "javascript:1" } }),
            load({ engineUrl: "/relative.js" }), load({ engineUrl: undefined }), load({ transcoderPath: "data:," }), load({ diag: "yes" }), load({ diag: undefined }),
        ]) {
            expect(parseHostMessage(bad)).toMatchObject({ ok: false, type: "load" });
        }
    });

    test("pause, resume and toggle-diagnostics need nothing but the envelope", () => {
        for (const type of ["pause", "resume", "toggle-diagnostics"]) expect(parseHostMessage({ v: 1, type })).toEqual({ ok: true, message: { v: 1, type } });
    });

    test("measure.seconds is clamped to 1..60 and must be finite", () => {
        expect(parseHostMessage({ v: 1, type: "measure", seconds: 0 })).toMatchObject({ ok: true, message: { seconds: 1 } });
        expect(parseHostMessage({ v: 1, type: "measure", seconds: 1e9 })).toMatchObject({ ok: true, message: { seconds: 60 } });
        expect(parseHostMessage({ v: 1, type: "measure", seconds: Number.NaN }).ok).toBe(false);
        expect(parseHostMessage({ v: 1, type: "measure" }).ok).toBe(false);
    });

    test("wrong version, unknown type and non-objects are rejected", () => {
        expect(parseHostMessage({ v: 2, type: "pause" }).ok).toBe(false);
        expect(parseHostMessage({ v: 1, type: "format-disk" }).ok).toBe(false);
        for (const bad of [null, 5, "pause", []]) expect(parseHostMessage(bad).ok).toBe(false);
    });
});
