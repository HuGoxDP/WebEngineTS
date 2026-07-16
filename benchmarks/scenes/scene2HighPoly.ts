// path: benchmarks/scenes/scene2HighPoly.ts

import {
    GameObject, Mesh, MeshFilter, MeshRenderer,
    StandardMaterial, Color, Vector3,
} from "WebEngineTS";
import { Rotator } from "./Rotator.ts";
import { addKeyLight, createMainCamera, type SceneInfo } from "./common.ts";

/** Options for {@link buildHighPolyModel}. */
export interface HighPolyOptions {
    /** Target triangle count. Default `434000` (paper's model was 436,810). */
    targetTriangles?: number;
}

/**
 * Scene 2 — a single high-polygon model. The paper used an imported 218k-vertex
 * GLB; to keep the benchmark self-contained and asset-free, this generates a
 * procedural high-subdivision sphere with a matching triangle budget, so the
 * geometry workload is reproducible without shipping a large binary.
 *
 * A sphere of `S` segments yields ~2·S² triangles.
 */
export function buildHighPolyModel(opts: HighPolyOptions = {}): SceneInfo {
    const targetTriangles = Math.max(2, Math.floor(opts.targetTriangles ?? 434000));
    const segments = Math.max(3, Math.round(Math.sqrt(targetTriangles / 2)));

    const mesh = Mesh.createSphere(1, segments);
    const material = new StandardMaterial();
    material.albedoColor = new Color(0.8, 0.5, 0.3, 1);
    material.metallic = 0.2;
    material.smoothness = 0.6;

    const go = new GameObject("High-Poly Model");
    go.addComponent(MeshFilter).sharedMesh = mesh;
    go.addComponent(MeshRenderer).sharedMaterial = material;
    go.addComponent(Rotator).degreesPerSecond = new Vector3(0, 15, 0);

    createMainCamera(new Vector3(0, 0, -3), new Vector3(0, 0, 0));
    addKeyLight();

    const triangles = segments * segments * 2;
    return {
        label: `Scene 2 — high-poly (~${triangles.toLocaleString()} tris)`,
        objects: 1,
        extra: `sphere segments=${segments}`,
    };
}
