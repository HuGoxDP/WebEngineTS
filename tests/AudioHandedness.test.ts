import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioSource } from "../src/engine/core/audio/AudioSource";
import { AudioListener } from "../src/engine/core/audio/AudioListener";
import { AudioClip } from "../src/engine/core/audio/AudioClip";
import { AudioManager } from "../src/engine/core/audio/AudioManager";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * Web Audio's space is right-handed — it derives the listener's right ear as
 * `forward × up`. The engine's world is Unity's, left-handed with +Z forward,
 * where right is `up × forward`. Handing engine vectors over unconverted panned
 * a source on +X into the *left* ear.
 *
 * That used to agree with the picture only because the renderer was mirrored
 * too. Fixing the render (F7) split them, which is what these pin: audio and
 * picture must place a sound on the same side.
 */

const made: GameObject[] = [];

function param() {
    return { value: 0 };
}

function stubAudio() {
    const listener = {
        positionX: param(), positionY: param(), positionZ: param(),
        forwardX: param(), forwardY: param(), forwardZ: param(),
        upX: param(), upY: param(), upZ: param(),
    };
    const panner = {
        connect: vi.fn(), disconnect: vi.fn(),
        panningModel: "", distanceModel: "",
        refDistance: 1, maxDistance: 100, rolloffFactor: 1,
        positionX: param(), positionY: param(), positionZ: param(),
        setPosition: vi.fn(),
    };
    const gain = () => ({
        connect: vi.fn(), disconnect: vi.fn(),
        gain: { value: 1, setValueAtTime: vi.fn() },
    });
    const context = {
        currentTime: 0,
        destination: {},
        state: "running",
        listener,
        createBufferSource: () => ({
            buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0,
            playbackRate: { value: 1 },
            connect: vi.fn(), disconnect: vi.fn(),
            start: vi.fn(), stop: vi.fn(),
            onended: null as (() => void) | null,
        }),
        createGain: gain,
        createPanner: () => panner,
        resume: vi.fn(),
    };
    vi.spyOn(AudioManager, "context", "get").mockReturnValue(context as unknown as AudioContext);
    return { listener, panner };
}

function clip(): AudioClip {
    return new AudioClip({
        duration: 10, numberOfChannels: 1, sampleRate: 44100, length: 441000,
        getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer, "tone");
}

function spawn(name: string): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

beforeEach(() => {
    vi.restoreAllMocks();
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    vi.restoreAllMocks();
});

describe("Audio crosses into Web Audio's right-handed space", () => {
    test("a listener facing engine +Z reports Web Audio's −Z, so +X stays the right ear", () => {
        const { listener } = stubAudio();
        const go = spawn("Ears");
        go.addComponent(AudioListener);

        AudioListener._updateAll();

        // Engine forward +Z → Web Audio (0, 0, −1), which is also its own default.
        expect(listener.forwardZ.value).toBeCloseTo(-1, 5);
        expect(listener.forwardX.value).toBeCloseTo(0, 5);
        expect(listener.upY.value).toBeCloseTo(1, 5);

        // right = forward × up, right-handed → +X. Same side the renderer draws it.
        const f = [listener.forwardX.value, listener.forwardY.value, listener.forwardZ.value];
        const u = [listener.upX.value, listener.upY.value, listener.upZ.value];
        const rightX = f[1] * u[2] - f[2] * u[1];
        expect(rightX).toBeGreaterThan(0.9);
    });

    test("listener position has its Z negated", () => {
        const { listener } = stubAudio();
        const go = spawn("Ears");
        go.transform.position = new Vector3(1, 2, 3);
        go.addComponent(AudioListener);

        AudioListener._updateAll();

        expect(listener.positionX.value).toBeCloseTo(1, 5);
        expect(listener.positionY.value).toBeCloseTo(2, 5);
        expect(listener.positionZ.value).toBeCloseTo(-3, 5);
    });

    test("a source in front of the listener panners to Web Audio's −Z", () => {
        const { panner } = stubAudio();
        const go = spawn("Speaker");
        go.transform.position = new Vector3(4, 0, 6);
        const src = go.addComponent(AudioSource);
        src.spatialBlend = 1;
        src.clip = clip();
        src.play();
        AudioSource._updateAll(); // the per-frame driver that syncs spatial state

        expect(panner.positionX.value).toBeCloseTo(4, 5); // right stays right
        expect(panner.positionZ.value).toBeCloseTo(-6, 5); // in front, in their terms
    });
});
