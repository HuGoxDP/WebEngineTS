// path: benchmarks/scenes/sceneScenario.ts

import { Application } from "WebEngineTS";
import type { SceneInfo } from "./common.ts";

/**
 * Loads and runs a real scenario ZIP (built by ScenarioCreator) via
 * {@link Application.loadScenarioFromUrl}, then reports it for benchmarking.
 *
 * This is the faithful reproduction of the paper's scenes — it runs the actual
 * deployed content (real models, textures, skybox, KTX2), exercising the real
 * scenario runtime instead of a procedural stand-in. The ZIP is self-contained
 * (assets are inside it), so only the ZIP itself needs to be served.
 *
 * `loadScenarioFromUrl` starts the engine loop internally, so the caller does
 * not need to build a scene or call `run()` for this path.
 *
 * @param app - the running Application.
 * @param url - URL of the scenario `.zip` (e.g. `/benchmarks/scenarios/scene3.zip`).
 * @param opts - `releaseArchive`: free the ZIP from the heap after load (paper's Scene 3 opt).
 */
export async function buildScenario(
    app: Application,
    url: string,
    opts: { releaseArchive?: boolean } = {},
): Promise<SceneInfo> {
    const scenario = await app.loadScenarioFromUrl(url);
    if (opts.releaseArchive) {
        // Free the compressed ZIP from the JS heap now that all assets are loaded
        // (the paper's releaseArchive optimization). No further asset loading is
        // possible after this.
        scenario.assets?.releaseArchive();
    }
    const name = decodeURIComponent(url.split("/").pop() ?? url);
    return {
        label: `Scenario: ${name}`,
        objects: 0,
        extra: `real scenario ZIP (models + textures)${opts.releaseArchive ? ", archive released" : ""}`,
    };
}
