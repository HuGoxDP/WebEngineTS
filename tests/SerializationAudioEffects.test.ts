import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";
import { AudioSource, AudioRolloffMode } from "../src/engine/core/audio/AudioSource";
import { AudioListener } from "../src/engine/core/audio/AudioListener";
import { ParticleSystem } from "../src/engine/core/particles/ParticleSystem";
import {
    ParticleSimulationSpace, ParticleRenderMode,
} from "../src/engine/core/particles/ParticleTypes";
import { InstancedMeshRenderer } from "../src/engine/core/rendering/InstancedMeshRenderer";
import { Animation } from "../src/engine/core/animation/Animation";
import { Animator } from "../src/engine/core/animation/Animator";
import { Mesh } from "../src/engine/core/graphics/Mesh";

/**
 * The six components that carried no serialization metadata (§6.6 of
 * `design/canvas-ui-roadmap.md`). A scene saved with any of them on it lost the
 * component outright — not its settings, the component — so a restored
 * GameObject came back without its audio, its particles or its animation.
 *
 * Two of the six have nothing to store and are here anyway: `AudioListener` is a
 * position, and an `Animator`'s configuration is a state machine built by script.
 * For those the test that matters is that the component itself survives.
 */

/**
 * The smallest Web Audio surface `AudioSource.onAwake` touches.
 *
 * There is no `AudioContext` under vitest, and the component builds its gain and
 * panner nodes the moment it is added — so without this the test cannot even
 * construct the thing it means to serialize. Nothing here is exercised; the
 * component only has to survive being created.
 */
function stubWebAudio(): void {
    const node = (): Record<string, unknown> => ({
        gain: { value: 1 },
        connect() { /* nothing downstream */ },
        disconnect() { /* nothing downstream */ },
    });
    (globalThis as Record<string, unknown>).AudioContext = class {
        public readonly destination = node();
        public readonly currentTime = 0;
        public createGain(): unknown { return node(); }
        public createPanner(): unknown { return node(); }
        public createBufferSource(): unknown { return { ...node(), start() {}, stop() {} }; }
    };
}

function destroyScene(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroy();
}

/** Save, drop everything, load back. */
function roundTrip(go: GameObject): GameObject {
    const json = SceneSerializer.serializeGameObject(go);
    destroyScene();
    return SceneSerializer.deserializeGameObject(json);
}

beforeEach(() => { stubWebAudio(); destroyScene(); });
afterEach(() => destroyScene());

describe("AudioSource", () => {
    test("round-trips every authored setting", () => {
        const source = new GameObject("Speaker").addComponent(AudioSource);
        source.volume = 0.4;
        source.pitch = 1.5;
        source.loop = true;
        source.playOnAwake = false;
        source.spatialBlend = 1;
        source.minDistance = 2;
        source.maxDistance = 40;
        source.rolloffMode = AudioRolloffMode.Linear;
        source.mute = true;

        const restored = roundTrip(source.gameObject).getComponent(AudioSource)!;

        expect(restored).not.toBeNull();
        expect(restored.volume).toBeCloseTo(0.4);
        expect(restored.pitch).toBeCloseTo(1.5);
        expect(restored.loop).toBe(true);
        expect(restored.playOnAwake).toBe(false);
        expect(restored.spatialBlend).toBeCloseTo(1);
        expect(restored.minDistance).toBeCloseTo(2);
        expect(restored.maxDistance).toBeCloseTo(40);
        expect(restored.rolloffMode).toBe(AudioRolloffMode.Linear);
        expect(restored.mute).toBe(true);
    });

    test("does not carry playback state across", () => {
        // `isPlaying` and `time` describe a running source. A scene that restored
        // them would come back mid-clip, which is not what was authored.
        const source = new GameObject("Speaker").addComponent(AudioSource);
        const json = SceneSerializer.serializeGameObject(source.gameObject);
        const fields = json.components[0] as unknown as Record<string, unknown>;

        expect(Object.keys(fields)).not.toContain("isPlaying");
        expect(Object.keys(fields)).not.toContain("time");
    });
});

describe("AudioListener", () => {
    test("survives the round trip", () => {
        const go = new GameObject("Ears");
        go.addComponent(AudioListener);

        expect(roundTrip(go).getComponent(AudioListener)).not.toBeNull();
    });
});

describe("ParticleSystem", () => {
    test("round-trips the main and emission modules", () => {
        const ps = new GameObject("Smoke").addComponent(ParticleSystem);
        ps.duration = 3;
        ps.looping = false;
        ps.startDelay = 0.5;
        ps.startLifetime = 2.5;
        ps.startSpeed = 7;
        ps.startSize = 0.3;
        ps.startColor = new Color(0.2, 0.4, 0.6, 0.8);
        ps.gravityModifier = -1;
        ps.maxParticles = 250;
        ps.playOnAwake = false;
        ps.emissionRate = 42;
        ps.simulationSpace = ParticleSimulationSpace.World;
        ps.renderMode = ParticleRenderMode.StretchedBillboard;
        ps.velocityOverLifetime = new Vector3(0, 3, 0);

        const restored = roundTrip(ps.gameObject).getComponent(ParticleSystem)!;

        expect(restored).not.toBeNull();
        expect(restored.duration).toBeCloseTo(3);
        expect(restored.looping).toBe(false);
        expect(restored.startDelay).toBeCloseTo(0.5);
        expect(restored.startLifetime).toBeCloseTo(2.5);
        expect(restored.startSpeed).toBeCloseTo(7);
        expect(restored.startSize).toBeCloseTo(0.3);
        expect(restored.startColor.r).toBeCloseTo(0.2);
        expect(restored.startColor.a).toBeCloseTo(0.8);
        expect(restored.gravityModifier).toBeCloseTo(-1);
        expect(restored.maxParticles).toBe(250);
        expect(restored.playOnAwake).toBe(false);
        expect(restored.emissionRate).toBeCloseTo(42);
        expect(restored.simulationSpace).toBe(ParticleSimulationSpace.World);
        expect(restored.renderMode).toBe(ParticleRenderMode.StretchedBillboard);
        expect(restored.velocityOverLifetime?.y).toBeCloseTo(3);
    });

    test("leaves the curve modules out rather than writing something unreadable", () => {
        // `bursts`, `shape` and the over-lifetime curves have no representation in
        // ValueSerializer. Pinned so that adding one is a deliberate act with a
        // failing test behind it, not a surprise on the next scene load.
        const ps = new GameObject("Smoke").addComponent(ParticleSystem);
        const json = SceneSerializer.serializeGameObject(ps.gameObject);
        const keys = Object.keys(json.components[0] as unknown as Record<string, unknown>);

        expect(keys).not.toContain("bursts");
        expect(keys).not.toContain("shape");
        expect(keys).not.toContain("sizeOverLifetime");
        expect(keys).not.toContain("colorOverLifetime");
        expect(keys).not.toContain("particleTexture");
    });
});

describe("InstancedMeshRenderer", () => {
    test("round-trips its count and the fields it inherits from Renderer", () => {
        const renderer = new GameObject("Grass").addComponent(InstancedMeshRenderer);
        renderer.mesh = Mesh.createCube(1);
        renderer.count = 64;
        renderer.receiveShadows = false;

        const restored = roundTrip(renderer.gameObject).getComponent(InstancedMeshRenderer)!;

        expect(restored).not.toBeNull();
        expect(restored.count).toBe(64);
        // Inherited from the Renderer base, which declares fields without being
        // @Serializable itself — the subclass is what registers them.
        expect(restored.receiveShadows).toBe(false);
    });
});

describe("Animation and Animator", () => {
    test("Animation round-trips its speed", () => {
        const animation = new GameObject("Rig").addComponent(Animation);
        animation.speed = 0.25;

        const restored = roundTrip(animation.gameObject).getComponent(Animation)!;

        expect(restored).not.toBeNull();
        expect(restored.speed).toBeCloseTo(0.25);
    });

    test("Animator survives the round trip", () => {
        const go = new GameObject("Rig");
        go.addComponent(Animator);

        expect(roundTrip(go).getComponent(Animator)).not.toBeNull();
    });
});
