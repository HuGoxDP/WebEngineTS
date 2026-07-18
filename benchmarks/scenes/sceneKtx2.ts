// path: benchmarks/scenes/sceneKtx2.ts

import {
    GameObject, Mesh, MeshFilter, MeshRenderer,
    StandardMaterial, Texture2D, Vector3,
} from "WebEngineTS";
import { Rotator } from "./Rotator.ts";
import { addKeyLight, createMainCamera, type SceneInfo } from "./common.ts";

/**
 * KTX2 fallback-verification scene: loads a Basis-compressed `.ktx2` texture and
 * displays it on a slowly rotating cube. The transcoder targets the GPU's native
 * compressed format (BC7 on desktop, ASTC/ETC2 on integrated/mobile). If the
 * texture renders (not black/magenta), transcoding succeeded on that GPU; the
 * overlay's "Tex VRAM" and "GPU" lines confirm the compressed footprint and device.
 */
export async function buildKtx2Test(): Promise<SceneInfo> {
    const res = await fetch("./assets/ktx2-test.ktx2");
    if (!res.ok) throw new Error(`KTX2 fetch failed: HTTP ${res.status}`);
    const tex = await Texture2D.fromKTX2ArrayBuffer(await res.arrayBuffer());

    const go = new GameObject("KTX2 Cube");
    go.addComponent(MeshFilter).sharedMesh = Mesh.createCube(2);
    const mat = new StandardMaterial();
    mat.albedoTexture = tex;
    mat.metallic = 0;
    mat.smoothness = 0.2;
    go.addComponent(MeshRenderer).sharedMaterial = mat;
    go.addComponent(Rotator).degreesPerSecond = new Vector3(15, 25, 0);

    createMainCamera(new Vector3(0, 0, -5), new Vector3(0, 0, 0));
    addKeyLight();

    const vramMB = (tex._estimateVramBytes() / 1048576).toFixed(3);
    return {
        label: "KTX2 fallback test",
        objects: 1,
        extra: `KTX2 albedo → est. ${vramMB} MB VRAM (compressed)`,
    };
}
