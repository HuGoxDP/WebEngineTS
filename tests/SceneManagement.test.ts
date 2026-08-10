import { describe, test, expect, beforeEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { SceneManager, LoadSceneMode } from "../src/engine/core/SceneManager";

/** Leaves exactly one empty scene loaded, whatever the previous test did. */
function resetScenes(): void {
    SceneManager.loadScene("Test");
}

describe("SceneManager — additive loading", () => {
    beforeEach(resetScenes);

    test("an additive load adds a scene without unloading anything", () => {
        const first = SceneManager.activeScene;
        new GameObject("Kept");

        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);

        expect(SceneManager.sceneCount).toBe(2);
        expect(first.getRootGameObjects().length).toBe(1);
    });

    test("an additive load leaves the active scene alone", () => {
        const first = SceneManager.activeScene;

        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);

        // New objects keep going where the caller expects, which is why Unity
        // does not switch on an additive load.
        expect(SceneManager.activeScene).toBe(first);
        expect(new GameObject("Spawned").scene).toBe(first);
    });

    test("a single load replaces every loaded scene", () => {
        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);
        expect(SceneManager.sceneCount).toBe(2);

        SceneManager.loadScene("Fresh");

        expect(SceneManager.sceneCount).toBe(1);
        expect(SceneManager.activeScene.name).toBe("Fresh");
    });

    test("loading additively fires the loaded event but not the active change", () => {
        const loaded: string[] = [];
        const changed: string[] = [];
        SceneManager.onSceneLoaded.push(s => loaded.push(s.name));
        SceneManager.onActiveSceneChanged.push((_, next) => changed.push(next.name));

        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);

        expect(loaded).toEqual(["Overlay"]);
        expect(changed).toEqual([]);

        SceneManager.onSceneLoaded.length = 0;
        SceneManager.onActiveSceneChanged.length = 0;
    });
});

describe("SceneManager — unloading", () => {
    beforeEach(resetScenes);

    test("unloading destroys the scene's objects", () => {
        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);
        const overlay = SceneManager.getSceneByName("Overlay")!;
        SceneManager.moveGameObjectToScene(new GameObject("Doomed"), overlay);

        expect(SceneManager.unloadScene(overlay)).toBe(true);

        expect(SceneManager.sceneCount).toBe(1);
        expect(SceneManager.getSceneByName("Overlay")).toBeNull();
    });

    test("unloading the active scene hands over to a remaining one", () => {
        const first = SceneManager.activeScene;
        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);
        const overlay = SceneManager.getSceneByName("Overlay")!;
        SceneManager.setActiveScene(overlay);

        SceneManager.unloadScene(overlay);

        // Something always has to be active.
        expect(SceneManager.activeScene).toBe(first);
    });

    test("the last scene is refused, since there must always be one", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(SceneManager.unloadScene(SceneManager.activeScene)).toBe(false);

        expect(SceneManager.sceneCount).toBe(1);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test("a scene that is not loaded reports that nothing happened", () => {
        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);
        const overlay = SceneManager.getSceneByName("Overlay")!;
        SceneManager.unloadScene(overlay);

        expect(SceneManager.unloadScene(overlay)).toBe(false);
    });
});

describe("SceneManager — moving objects between scenes", () => {
    beforeEach(resetScenes);

    test("a root moves and its scene pointer follows", () => {
        const from = SceneManager.activeScene;
        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);
        const to = SceneManager.getSceneByName("Overlay")!;
        const go = new GameObject("Traveller");

        expect(SceneManager.moveGameObjectToScene(go, to)).toBe(true);

        expect(go.scene).toBe(to);
        expect(from.getRootGameObjects()).not.toContain(go);
        expect(to.getRootGameObjects()).toContain(go);
    });

    test("a child cannot move on its own", () => {
        SceneManager.loadScene("Overlay", LoadSceneMode.Additive);
        const to = SceneManager.getSceneByName("Overlay")!;

        const parent = new GameObject("Parent");
        const child = new GameObject("Child");
        child.transform.parent = parent.transform;

        // A hierarchy split across two scenes is not a thing.
        expect(SceneManager.moveGameObjectToScene(child, to)).toBe(false);
    });

    test("moving to the scene it is already in is a no-op that reports success", () => {
        const go = new GameObject("Stayer");

        expect(SceneManager.moveGameObjectToScene(go, SceneManager.activeScene)).toBe(true);
        expect(SceneManager.activeScene.getRootGameObjects().filter(g => g === go).length).toBe(1);
    });
});

describe("EngineObject.DontDestroyOnLoad", () => {
    beforeEach(resetScenes);

    test("a marked object survives a single load and moves to the new scene", () => {
        const keeper = new GameObject("Music");
        EngineObject.DontDestroyOnLoad(keeper);
        new GameObject("Doomed");

        SceneManager.loadScene("Next");

        expect(keeper.exists()).toBe(true);
        expect(keeper.scene).toBe(SceneManager.activeScene);
        expect(SceneManager.activeScene.getRootGameObjects().map(g => g.name)).toEqual(["Music"]);
    });

    test("an unmarked object does not survive", () => {
        const doomed = new GameObject("Doomed");

        SceneManager.loadScene("Next");

        expect(doomed.exists()).toBe(false);
    });

    test("a marked object survives repeated loads", () => {
        const keeper = new GameObject("Music");
        EngineObject.DontDestroyOnLoad(keeper);

        SceneManager.loadScene("Second");
        SceneManager.loadScene("Third");

        expect(keeper.exists()).toBe(true);
        expect(keeper.scene.name).toBe("Third");
    });

    test("a marked object keeps its children", () => {
        const keeper = new GameObject("Rig");
        const child = new GameObject("Speaker");
        child.transform.parent = keeper.transform;
        EngineObject.DontDestroyOnLoad(keeper);

        SceneManager.loadScene("Next");

        expect(child.exists()).toBe(true);
        expect(keeper.transform.childCount).toBe(1);
    });
});
