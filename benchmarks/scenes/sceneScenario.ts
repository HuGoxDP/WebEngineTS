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
 */
export async function buildScenario(app: Application, url: string): Promise<SceneInfo> {
    await app.loadScenarioFromUrl(url);
    const name = decodeURIComponent(url.split("/").pop() ?? url);
    return {
        label: `Scenario: ${name}`,
        objects: 0,
        extra: "real scenario ZIP (models + textures)",
    };
}
