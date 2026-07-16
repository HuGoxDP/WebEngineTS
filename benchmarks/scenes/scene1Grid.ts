// path: benchmarks/scenes/scene1Grid.ts

import {
    GameObject, Mesh, MeshFilter, MeshRenderer,
    StandardMaterial, Color, Vector3,
} from "WebEngineTS";
import { Rotator } from "./Rotator.ts";
import { addKeyLight, createMainCamera, mulberry32, type SceneInfo } from "./common.ts";

/** Options for {@link buildProceduralGrid}. */
export interface GridOptions {
    /** Total number of primitives. Default `1000`. */
    count?: number;
    /** Fraction that rotate every frame. Default `0.05` (5%). */
    rotateFraction?: number;
    /** Grid spacing in world units. Default `1.5`. */
    spacing?: number;
    /** PRNG seed for spin speeds. Default `1337`. */
    seed?: number;
}

/**
 * Scene 1 — a grid of `N` cubes sharing one mesh and one material, of which a
 * fixed fraction rotate every frame. Isolates per-frame transform overhead.
 *
 * The grid, the rotating subset (every k-th object), and the spin speeds are
 * fully deterministic given `count` and `seed`.
 */
export function buildProceduralGrid(opts: GridOptions = {}): SceneInfo {
    const count = Math.max(1, Math.floor(opts.count ?? 1000));
    const rotateFraction = opts.rotateFraction ?? 0.05;
    const spacing = opts.spacing ?? 1.5;
    const rng = mulberry32(opts.seed ?? 1337);

    // Shared mesh + material — mutations/instancing are not what this scene tests.
    const mesh = Mesh.createCube(1);
    const material = new StandardMaterial();
    material.albedoColor = new Color(0.55, 0.58, 0.65, 1);
    material.metallic = 0.1;
    material.smoothness = 0.5;

    // Rotate exactly every k-th object so the fraction is deterministic.
    const stride = Math.max(1, Math.round(1 / rotateFraction));

    const side = Math.ceil(Math.sqrt(count));
    const half = ((side - 1) * spacing) / 2;

    let rotators = 0;
    for (let i = 0; i < count; i++) {
        const gx = i % side;
        const gz = Math.floor(i / side);

        const go = new GameObject(`Cube_${i}`);
        go.transform.position = new Vector3(gx * spacing - half, 0, gz * spacing - half);
        go.addComponent(MeshFilter).sharedMesh = mesh;
        go.addComponent(MeshRenderer).sharedMaterial = material;

        if (i % stride === 0) {
            const rot = go.addComponent(Rotator);
            rot.degreesPerSecond = new Vector3(0, 30 + rng() * 60, 0);
            rotators++;
        }
    }

    const dist = Math.max(12, side * spacing);
    createMainCamera(new Vector3(0, dist * 0.8, -dist), new Vector3(0, 0, 0));
    addKeyLight();

    return {
        label: `Scene 1 — grid N=${count}`,
        objects: count,
        extra: `${rotators} rotating (~${((rotators / count) * 100).toFixed(1)}%)`,
    };
}
