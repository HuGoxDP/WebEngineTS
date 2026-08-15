import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioSource } from "../src/engine/core/audio/AudioSource";
import { AudioClip } from "../src/engine/core/audio/AudioClip";
import { AudioManager } from "../src/engine/core/audio/AudioManager";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * A disabled AudioSource was dropped from the spatial update and left playing,
 * so hiding an object gave a sound that carried on from wherever the object
 * had been. Unity stops a source when it is disabled. Audit part 10, F58.
 */

const made: GameObject[] = [];

/** The smallest Web Audio graph the source touches. */
function stubAudio() {
    const node = () => ({
        connect: vi.fn(), disconnect: vi.fn(),
        gain: { value: 1, setValueAtTime: vi.fn() },
    });
    const source = {
        buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0,
        playbackRate: { value: 1 },
        connect: vi.fn(), disconnect: vi.fn(),
        start: vi.fn(), stop: vi.fn(),
        onended: null as (() => void) | null,
    };
    const context = {
        currentTime: 0,
        destination: {},
        state: "running",
        createBufferSource: () => source,
        createGain: node,
        createPanner: () => ({
            ...node(),
            panningModel: "", distanceModel: "",
            refDistance: 1, maxDistance: 100, rolloffFactor: 1,
            positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 },
            setPosition: vi.fn(),
        }),
        resume: vi.fn(),
    };
    vi.spyOn(AudioManager, "context", "get").mockReturnValue(context as unknown as AudioContext);
    return { context, source };
}

function clip(): AudioClip {
    return new AudioClip({
        duration: 10, numberOfChannels: 1, sampleRate: 44100, length: 441000,
        getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer, "loop");
}

function playingSource(): AudioSource {
    const go = new GameObject("Speaker");
    made.push(go);
    const src = go.addComponent(AudioSource);
    src.clip = clip();
    src.play();
    return src;
}

beforeEach(() => stubAudio());

afterEach(() => {
    vi.restoreAllMocks();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Disabling an AudioSource", () => {
    test("stops it playing", () => {
        const src = playingSource();
        expect(src.isPlaying).toBe(true);

        src.enabled = false;

        expect(src.isPlaying).toBe(false);
    });

    test("deactivating its GameObject does the same", () => {
        const src = playingSource();

        src.gameObject.setActive(false);

        expect(src.isPlaying).toBe(false);
    });

    test("a hidden object's loop does not carry on", () => {
        const src = playingSource();
        src.loop = true;

        src.gameObject.setActive(false);

        expect(src.isPlaying).toBe(false);
    });

    test("re-enabling does not resume by itself", () => {
        // Stop, not pause: the position is reset, and a scenario that wants the
        // sound back asks for it.
        const src = playingSource();
        src.enabled = false;

        src.enabled = true;

        expect(src.isPlaying).toBe(false);
    });

    test("and it can be played again", () => {
        const src = playingSource();
        src.enabled = false;
        src.enabled = true;

        src.play();

        expect(src.isPlaying).toBe(true);
    });

    test("destroying still stops it too", () => {
        const src = playingSource();

        src.gameObject.destroyImmediate();

        expect(src.isPlaying).toBe(false);
    });
});
