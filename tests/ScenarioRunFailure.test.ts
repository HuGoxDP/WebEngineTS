import { describe, test, expect, afterEach } from "vitest";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Resources } from "../src/engine/core/assets/Resources";
import type { FetchLike } from "../src/engine/core/assets/StreamingAssetSource";

/**
 * `run()` creates a Scene, installs the asset source and mints script blob
 * URLs. When it threw, all of that stayed: the host was left holding a scenario
 * it could neither run (state is Error) nor clean up (`isLoaded` is false), and
 * the assets stayed in memory until some *later* load happened to unload it.
 * Audit part 4, F23.
 *
 * The failure is induced by the environment rather than faked: `run()` imports
 * the entry point from a blob URL, which Node cannot do. That is a real failure
 * in the same place a broken scenario script fails.
 */

const manifestUrl = "https://cdn.test/f/scenario.json";

const manifest = {
    schema: 1,
    id: "failing-scenario",
    entry: "scripts/main.js",
    scripts: [{ path: "scripts/main.js", url: "main.js" }],
    assets: [
        { path: "data/thing.json", priority: "critical", lods: [{ level: 0, url: "thing.json" }] },
    ],
};

function serve(): FetchLike {
    const files: Record<string, string> = {
        [manifestUrl]: JSON.stringify(manifest),
        "https://cdn.test/f/main.js": "export default class Broken {}",
        "https://cdn.test/f/thing.json": "{}",
    };
    return async (url: string) => {
        const body = files[url];
        if (body === undefined) return { ok: false, status: 404 } as unknown as Response;
        const bytes = new TextEncoder().encode(body);
        return {
            ok: true, status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
            json: async () => JSON.parse(body),
        } as unknown as Response;
    };
}

async function loadThenFailToRun(): Promise<Scenario> {
    const scenario = new Scenario();
    await scenario.loadFromManifestUrl(manifestUrl, { fetch: serve() });
    expect(scenario.isLoaded).toBe(true);

    await expect(scenario.run()).rejects.toThrow();
    return scenario;
}

afterEach(() => {
    Resources.releaseSource();
    Scenario.current?.unload();
});

describe("A scenario whose run() throws", () => {
    test("leaves no scene behind", async () => {
        await loadThenFailToRun();

        expect(SceneManager.getSceneByName("failing-scenario")).toBeNull();
    });

    test("leaves no asset source installed", async () => {
        await loadThenFailToRun();

        expect(Resources.hasSource).toBe(false);
    });

    test("does not stay the current scenario", async () => {
        await loadThenFailToRun();

        expect(Scenario.current).toBeNull();
    });

    test("reports the error state, not a loaded one", async () => {
        const scenario = await loadThenFailToRun();

        expect(scenario.isRunning).toBe(false);
        // The byte sources are gone with the cleanup, so re-running is not on
        // offer — `isLoaded` was already false after an error, so nothing is
        // lost that a caller could have used.
        expect(scenario.isLoaded).toBe(false);
    });
});

describe("Unloading a scenario's scene", () => {
    /**
     * `unload` called `scene.destroy()` directly, which empties a scene but
     * leaves it in SceneManager's list — and active. Audit part 4, F24.
     */
    test("takes it out of SceneManager, rather than emptying it in place", async () => {
        const scenario = await loadThenFailToRun();

        expect(SceneManager.getSceneByName("failing-scenario")).toBeNull();
        expect(scenario).toBeDefined();
    });

    test("leaves a live active scene behind, not a destroyed one", async () => {
        await loadThenFailToRun();

        const active = SceneManager.activeScene;
        expect(active.name).not.toBe("failing-scenario");
        expect(active.isLoaded).toBe(true);
    });

    test("tells listeners the scene went away", async () => {
        const unloaded: string[] = [];
        const listener = (scene: { name: string }): void => { unloaded.push(scene.name); };
        SceneManager.onSceneUnloaded.push(listener as never);

        try {
            await loadThenFailToRun();
        } finally {
            SceneManager.onSceneUnloaded.splice(
                SceneManager.onSceneUnloaded.indexOf(listener as never), 1,
            );
        }

        expect(unloaded).toContain("failing-scenario");
    });
});
