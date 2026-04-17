import { describe, test, expect, vi, beforeEach } from "vitest";
import { AudioClip } from "../src/engine/core/audio/AudioClip";
import { AudioRolloffMode } from "../src/engine/core/audio/AudioSource";
import { AudioManager } from "../src/engine/core/audio/AudioManager";

// Minimal AudioBuffer stub for testing AudioClip without a real AudioContext.
function makeBuffer(duration: number, channels: number, sampleRate: number): AudioBuffer {
    return {
        duration,
        numberOfChannels: channels,
        sampleRate,
        length: Math.round(duration * sampleRate),
        getChannelData: () => new Float32Array(0),
        copyFromChannel: () => {},
        copyToChannel: () => {},
    } as unknown as AudioBuffer;
}

describe("AudioClip", () => {
    test("exposes buffer properties", () => {
        const buf = makeBuffer(2.5, 2, 44100);
        const clip = new AudioClip(buf, "explosion");

        expect(clip.name).toBe("explosion");
        expect(clip.duration).toBeCloseTo(2.5);
        expect(clip.channels).toBe(2);
        expect(clip.frequency).toBe(44100);
        expect(clip.samples).toBe(Math.round(2.5 * 44100));
    });

    test("name defaults to empty string", () => {
        const clip = new AudioClip(makeBuffer(1, 1, 22050));
        expect(clip.name).toBe("");
    });

    test("_buffer reference is the same object", () => {
        const buf = makeBuffer(1, 1, 44100);
        const clip = new AudioClip(buf, "test");
        expect(clip._buffer).toBe(buf);
    });
});

describe("AudioRolloffMode", () => {
    test("enum values are distinct", () => {
        const values = new Set([AudioRolloffMode.Logarithmic, AudioRolloffMode.Linear]);
        expect(values.size).toBe(2);
    });

    test("Logarithmic is default string", () => {
        expect(AudioRolloffMode.Logarithmic).toBe("Logarithmic");
    });

    test("Linear is correct string", () => {
        expect(AudioRolloffMode.Linear).toBe("Linear");
    });
});

describe("AudioManager", () => {
    beforeEach(() => {
        const gainNode = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
        // Must be a class/function so `new AudioContext()` works.
        class MockAudioContext {
            state = "running";
            destination = {};
            createGain() { return gainNode; }
            close() { return Promise.resolve(); }
            resume() { return Promise.resolve(); }
        }
        (globalThis as any).AudioContext = MockAudioContext;
        AudioManager._reset();
    });

    test("masterVolume getter/setter round-trips via gain node", () => {
        AudioManager.context;
        AudioManager.masterVolume = 0.5;
        expect(AudioManager.masterVolume).toBeCloseTo(0.5);
    });

    test("masterVolume clamps to 0 minimum", () => {
        AudioManager.context;
        AudioManager.masterVolume = -1;
        expect(AudioManager.masterVolume).toBe(0);
    });

    test("resume resolves immediately when running", async () => {
        AudioManager.context;
        await expect(AudioManager.resume()).resolves.toBeUndefined();
    });

    test("_reset tears down context", () => {
        AudioManager.context;
        AudioManager._reset();
        const ctx2 = AudioManager.context;
        expect(ctx2).toBeDefined();
    });
});
