import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager, LoadSceneMode } from "../src/engine/core/SceneManager";
import { Application } from "../src/engine/core/Application";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import { SceneSerializer, type SerializedGameObject, type SerializedScene } from "../src/engine/core/serialization/SceneSerializer";
import { Serializable, SerializedField, ExecuteAlways } from "../src/engine/core/reflection/Decorators";

/**
 * C2 Phase 3: switching to play wakes the live world in the order a load would
 * give it, so "switch in place" and "reload" produce the same log; a scenario
 * refuses to start in edit mode; and the Cinemachine drivers run in edit mode.
 */

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

const pose = (x = 0, y = 0, z = 0): SerializedGameObject["transform"] => ({
    position: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
});

let log: string[] = [];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    clear();
    log = [];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    Application.enterPlayMode();
    clear();
});

@Serializable({ typeName: "EditModeWakeSpec.Tag" })
class Tag extends ScriptableBehaviour {
    @SerializedField() public label = "?";
    public override awake(): void { log.push(`${this.label}.awake`); }
    public override onEnable(): void { log.push(`${this.label}.onEnable`); }
    public override start(): void { log.push(`${this.label}.start`); }
    public override update(): void { log.push(`${this.label}.update`); }
    public override lateUpdate(): void { log.push(`${this.label}.lateUpdate`); }
    public override onDisable(): void { log.push(`${this.label}.onDisable`); }
    public override onDestroy(): void { log.push(`${this.label}.onDestroy`); }
}

@Serializable({ typeName: "EditModeWakeSpec.Inert" })
class Inert extends ScriptableBehaviour {
    public override awake(): void { log.push("inert.awake"); }
    public override onEnable(): void { log.push("inert.onEnable"); }
    public override update(): void { log.push("inert.update"); }
}

/** `Holder > Child`, with A and B on the holder and C on the child. */
function buildWorld(): { holder: GameObject; child: GameObject } {
    const holder = new GameObject("Holder");
    const a = holder.addComponent(Tag); a.label = "A";
    const b = holder.addComponent(Tag); b.label = "B";
    const child = new GameObject("Child");
    child.transform.setParent(holder.transform, false);
    const c = child.addComponent(Tag); c.label = "C";
    return { holder, child };
}

/** The same world, written in the shape the serializer produces. */
function worldJson(): SerializedScene {
    const tag = (label: string) => ({ type: "EditModeWakeSpec.Tag", fields: { label } });
    const node = (name: string, components: object[], children: SerializedGameObject[] = []): SerializedGameObject =>
        ({ name, active: true, transform: pose(), components: components as never, children });
    return {
        name: SceneManager.activeScene.name, version: 1,
        roots: [node("Holder", [tag("A"), tag("B")], [node("Child", [tag("C")])])],
    };
}

describe("the wake pass on entering play mode", () => {
    test("the whole live world wakes in load order, parents before children", () => {
        Application.enterEditMode();
        const { holder } = buildWorld();
        expect(log).toEqual([]);

        Application.enterPlayMode();
        expect(log).toEqual([
            "A.awake", "A.onEnable", "B.awake", "B.onEnable",
            "C.awake", "C.onEnable",
        ]);

        SceneManager.activeScene._update();
        expect(log.slice(6)).toEqual([
            "A.start", "A.update", "B.start", "B.update", "C.start", "C.update",
        ]);

        SceneManager.activeScene._lateUpdate();
        expect(log.slice(12)).toEqual(["A.lateUpdate", "B.lateUpdate", "C.lateUpdate"]);
        expect(holder.exists()).toBe(true);
    });

    test("switching in place gives the same log as loading the same scene in play", () => {
        // In place.
        Application.enterEditMode();
        buildWorld();
        Application.enterPlayMode();
        const inPlace = [...log];
        clear();
        log = [];

        // A reload of the very same JSON.
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(worldJson())));
        const reloaded = [...log];

        expect(reloaded).toEqual(inPlace);
        expect(inPlace).toEqual([
            "A.awake", "A.onEnable", "B.awake", "B.onEnable", "C.awake", "C.onEnable",
        ]);
    });

    test("an opted-in script is not woken twice", () => {
        @Serializable({ typeName: "EditModeWakeSpec.EditorCam" })
        @ExecuteAlways()
        class EditorCam extends ScriptableBehaviour {
            public override awake(): void { log.push("E.awake"); }
            public override onEnable(): void { log.push("E.onEnable"); }
            public override start(): void { log.push("E.start"); }
            public override update(): void { log.push("E.update"); }
        }

        Application.enterEditMode();
        new GameObject("Cam").addComponent(EditorCam);
        expect(log).toEqual(["E.awake", "E.onEnable"]);   // the editor pass already ran it

        Application.enterPlayMode();
        expect(log).toEqual(["E.awake", "E.onEnable"]);   // no second awake / onEnable

        SceneManager.activeScene._update();
        expect(log.slice(2)).toEqual(["E.start", "E.update"]);
    });

    test("an inactive subtree stays asleep, and wakes on activation", () => {
        Application.enterEditMode();
        const { holder, child } = buildWorld();
        holder.setActive(false);
        child.setActive(false);

        Application.enterPlayMode();
        expect(log).toEqual([]);

        // Activation's own order, unchanged by C2: every deferred awake of the
        // object first, then every onEnable, as `setActive` has always done.
        holder.setActive(true);
        expect(log).toEqual(["A.awake", "B.awake", "A.onEnable", "B.onEnable"]);

        child.setActive(true);
        expect(log.slice(4)).toEqual(["C.awake", "C.onEnable"]);
    });

    test("every loaded scene wakes, additive one after the other", () => {
        Application.enterEditMode();
        buildWorld();
        SceneManager.loadScene("Extra", LoadSceneMode.Additive);
        const extra = SceneManager.getSceneByName("Extra")!;
        const solo = new GameObject("Solo");
        const s = solo.addComponent(Tag); s.label = "S";
        log = [];

        Application.enterPlayMode();
        // Both scenes woke: the first scene's world and the additive one's own.
        const soloAwakes = log.filter(e => e === "S.awake");
        expect(soloAwakes).toHaveLength(1);
        expect(log).toContain("A.awake");
        expect(SceneManager.getSceneByName("Extra")).toBe(extra);
        expect(SceneManager.sceneCount).toBeGreaterThanOrEqual(2);
    });

    test("a script that destroys a later sibling during the wake pass leaves no callback unpaired", () => {
        @Serializable({ typeName: "EditModeWakeSpec.Killer" })
        class Killer extends ScriptableBehaviour {
            public override awake(): void {
                log.push("K.awake");
                const victim = GameObject.Find("Victim");
                if (victim) victim.destroyImmediate();
            }
        }

        Application.enterEditMode();
        const killer = new GameObject("Killer");
        killer.addComponent(Killer);
        const victim = new GameObject("Victim");
        const v = victim.addComponent(Tag); v.label = "V";
        log = [];

        Application.enterPlayMode();
        expect(log).toEqual(["K.awake"]);            // the victim never woke
        expect(victim.exists()).toBe(false);
    });

    test("an awake that adds a component does not wake the new one twice", () => {
        @Serializable({ typeName: "EditModeWakeSpec.Adder" })
        class Adder extends ScriptableBehaviour {
            public override awake(): void {
                log.push("adder.awake");
                if (!this.gameObject.getComponent(Tag)) this.gameObject.addComponent(Late);
            }
        }

        @Serializable({ typeName: "EditModeWakeSpec.Late" })
        class Late extends ScriptableBehaviour {
            public override awake(): void { log.push("late.awake"); }
            public override onEnable(): void { log.push("late.onEnable"); }
        }

        Application.enterEditMode();
        const go = new GameObject("Adder");
        go.addComponent(Adder);
        log = [];

        Application.enterPlayMode();
        expect(log).toEqual(["adder.awake", "late.awake", "late.onEnable"]);
    });

    test("every onEnable from the wake pass has its onDisable once the world is destroyed", () => {
        Application.enterEditMode();
        const { holder } = buildWorld();
        Application.enterPlayMode();
        expect(log.filter(e => e.endsWith(".onEnable"))).toHaveLength(3);

        SceneManager.activeScene._update();          // start runs before anything is torn down
        holder.destroyImmediate();
        expect(log.filter(e => e.endsWith(".onDisable"))).toHaveLength(3);
        expect(log.filter(e => e.endsWith(".onDestroy"))).toHaveLength(3);
    });

    test("the reload flow keeps the same bytes and runs the copy's callbacks only in play", () => {
        // The editor's world: built in edit mode, saved as the snapshot Play restores.
        Application.enterEditMode();
        buildWorld();
        const snapshot = SceneSerializer.serializeScene(SceneManager.activeScene);

        // Play in place: the wake pass runs, and the saved bytes do not move.
        Application.enterPlayMode();
        expect(log).toEqual([
            "A.awake", "A.onEnable", "B.awake", "B.onEnable", "C.awake", "C.onEnable",
        ]);
        expect(JSON.stringify(SceneSerializer.serializeScene(SceneManager.activeScene)))
            .toBe(JSON.stringify(snapshot));

        // Stop: clear the play world, back to edit mode, deserialize the
        // snapshot — the editor's copy is asleep and saves back to the same bytes.
        clear();
        Application.enterEditMode();
        log = [];
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(snapshot)));
        expect(log).toEqual([]);
        expect(JSON.stringify(SceneSerializer.serializeScene(SceneManager.activeScene)))
            .toBe(JSON.stringify(snapshot));

        // Play through a reload: clear, play, deserialize — callbacks run once.
        clear();
        Application.enterPlayMode();
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(snapshot)));
        expect(log.filter(e => e === "A.awake")).toHaveLength(1);
        expect(log.filter(e => e === "C.onEnable")).toHaveLength(1);
        expect(JSON.stringify(SceneSerializer.serializeScene(SceneManager.activeScene)))
            .toBe(JSON.stringify(snapshot));
    });
});

describe("a scenario in edit mode", () => {
    test("run() refuses with the message and creates no scene", async () => {
        const scene = new Scenario();
        const before = SceneManager.sceneCount;
        const beforeActive = SceneManager.activeScene;

        Application.enterEditMode();
        await expect(scene.run()).rejects.toThrow(
            "[Scenario] Cannot run in edit mode. Call Application.enterPlayMode() first."
        );

        expect(SceneManager.sceneCount).toBe(before);
        expect(SceneManager.activeScene).toBe(beforeActive);
    });
});
