// path: benchmarks/scenes/common.ts
//
// Shared helpers for the deterministic benchmark scenes.

import {
    GameObject, Camera, CameraClearFlags,
    DirectionalLight, Color, Vector3,
} from "WebEngineTS";

/** Metadata returned by every scene builder for reporting. */
export interface SceneInfo {
    /** Human-readable label used as the benchmark result label. */
    label: string;
    /** Number of GameObjects the scene created (excluding camera/lights). */
    objects: number;
    /** Optional extra note (e.g. triangle count, rotating fraction). */
    extra?: string;
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded so every run of a scene
 * produces byte-identical content — a precondition for reproducible numbers.
 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function (): number {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Creates the main camera at a fixed position looking at a target.
 * Tagged `"MainCamera"` so {@link Camera.main} selects it.
 */
export function createMainCamera(
    position: Vector3,
    lookAt: Vector3,
    background: Color = new Color(0.01, 0.01, 0.06, 1),
): Camera {
    const go = new GameObject("Main Camera");
    go.tag = "MainCamera";
    const cam = go.addComponent(Camera);
    cam.clearFlags = CameraClearFlags.SolidColor;
    cam.backgroundColor = background;
    cam.fieldOfView = 60;
    go.transform.position = position;
    go.transform.lookAt(lookAt);
    return cam;
}

/** Adds a single directional key light so meshes are shaded. */
export function addKeyLight(): void {
    const go = new GameObject("Key Light");
    const light = go.addComponent(DirectionalLight);
    light.intensity = 1.2;
    light.color = new Color(1.0, 0.98, 0.95, 1);
    go.transform.rotate(new Vector3(50, -30, 0));
}
