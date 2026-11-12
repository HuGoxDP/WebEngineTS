import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { EngineObject } from "../src/engine/core/EngineObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Application } from "../src/engine/core/Application";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import type { SerializedGameObject } from "../src/engine/core/serialization/SceneSerializer";
import { Camera } from "../src/engine/core/components/Camera";
import { DirectionalLight } from "../src/engine/core/components/DirectionalLight";
import { LODGroup } from "../src/engine/core/components/LODGroup";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { Canvas } from "../src/engine/core/ui/Canvas";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { HorizontalLayoutGroup } from "../src/engine/core/ui/LayoutGroup";
import { Serializable, ExecuteAlways, ExecuteInEditMode, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";

/**
 * C2 Phase 2: in edit mode an undecorated script starts no lifecycle step — not
 * when it is added, not when a scene or prefab that holds it is loaded, not when
 * it is activated. An opted-in script runs everything except `fixedUpdate`, and
 * the built-ins are untouched. Everything after the gate is play-mode behaviour,
 * exactly as before.
 */

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

/** A node in the shape the writer produces. */
const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
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

@Serializable({ typeName: "EditModeLoadSpec.Logger" })
class Logger extends ScriptableBehaviour {
    public override awake(): void { log.push("awake"); }
    public override onEnable(): void { log.push("onEnable"); }
    public override start(): void { log.push("start"); }
    public override update(): void { log.push("update"); }
    public override lateUpdate(): void { log.push("lateUpdate"); }
    public override fixedUpdate(): void { log.push("fixedUpdate"); }
    public override onDisable(): void { log.push("onDisable"); }
    public override onDestroy(): void { log.push("onDestroy"); }

    @SerializedField({ type: FieldType.GameObject }) public target: GameObject | null = null;
    @SerializedField() public count = 7;
}

@Serializable({ typeName: "EditModeLoadSpec.AlwaysLogger" })
@ExecuteAlways()
class AlwaysLogger extends Logger {}

@Serializable({ typeName: "EditModeLoadSpec.EditLogger" })
@ExecuteInEditMode()
class EditLogger extends Logger {}

describe("the lifecycle gate in edit mode", () => {
    test("a script added to an active object runs nothing, and neither does a frame", () => {
        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(Logger);

        expect(log).toEqual([]);
        SceneManager.activeScene._update();
        SceneManager.activeScene._lateUpdate();
        SceneManager.activeScene._fixedUpdate();
        expect(log).toEqual([]);
    });

    test("a loaded scene leaves the script asleep, and its object restored", () => {
        Application.enterEditMode();

        const scene = {
            name: "EditModeLoad", version: 1,
            roots: [{
                name: "Loaded", active: true,
                transform: { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
                components: [{ type: "EditModeLoadSpec.Logger", fields: {} }],
                children: [],
            }],
        };
        const [loaded] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(scene)));
        expect(loaded.getComponent(Logger)).toBeDefined();
        expect(loaded.transform.localPosition.x).toBe(1);

        SceneManager.activeScene._update();
        expect(log).toEqual([]);
    });

    test("an instantiated copy and a prefab instance leave it asleep too", () => {
        Application.enterEditMode();
        const source = new GameObject("Source");
        source.addComponent(Logger);

        const copy = EngineObject.Instantiate(source);
        expect(copy.getComponent(Logger)).toBeDefined();
        expect(log).toEqual([]);

        const prefab = Prefab.fromGameObject(source);
        const instance = prefab.instantiate();
        expect(instance.getComponent(Logger)).toBeDefined();
        expect(instance.isPrefabInstance).toBe(true);

        SceneManager.activeScene._update();
        expect(log).toEqual([]);
    });

    test("a link-mode load of an instance with a script leaves it asleep, and restores its values", () => {
        // A prefab asset with a script on it, and one instance in the scene.
        const tree: SerializedGameObject = {
            name: "Tank", id: "k-root", active: true, transform: pose(), children: [],
            components: [{ type: "EditModeLoadSpec.Logger", fields: {} }],
        };
        const prefab = new Prefab(tree);
        AssetDatabase._bindGuid("guid-editmode", prefab);
        const instance = prefab.instantiate();
        const script = instance.getComponent(Logger)!;
        script.count = 12;
        script.target = new GameObject("Marker");
        const saved = SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });
        expect(saved.version).toBe(2);
        expect(saved.roots[0].prefab?.guid).toBe("guid-editmode");
        clear();
        log = [];                     // what the first instance did in play is not the question

        // The same file, read in edit mode.
        Application.enterEditMode();
        const [loaded] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        const read = loaded.getComponent(Logger)!;
        expect(read).toBeDefined();
        expect(read.count).toBe(12);
        expect(read.target?.name).toBe("Marker");
        expect(log).toEqual([]);

        SceneManager.activeScene._update();
        expect(log).toEqual([]);
    });

    test("an opted-in script runs the whole lifecycle in edit mode — never fixedUpdate", () => {
        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(AlwaysLogger);

        expect(log).toEqual(["awake", "onEnable"]);
        SceneManager.activeScene._update();
        SceneManager.activeScene._lateUpdate();
        SceneManager.activeScene._fixedUpdate();
        expect(log).toEqual(["awake", "onEnable", "start", "update", "lateUpdate"]);

        go.setActive(false);
        expect(log[log.length - 1]).toBe("onDisable");
        go.setActive(true);
        expect(log[log.length - 1]).toBe("onEnable");
        go.destroyImmediate();
        expect(log[log.length - 1]).toBe("onDestroy");
    });

    test("@ExecuteInEditMode opts in exactly as @ExecuteAlways does", () => {
        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(EditLogger);

        expect(log).toEqual(["awake", "onEnable"]);
        SceneManager.activeScene._update();
        expect(log).toEqual(["awake", "onEnable", "start", "update"]);
        SceneManager.activeScene._fixedUpdate();
        expect(log).toEqual(["awake", "onEnable", "start", "update"]);
    });

    test("a prefab's opted-in script wakes when the prefab is instantiated in edit mode", () => {
        const source = new GameObject("Source");
        source.addComponent(AlwaysLogger);
        const prefab = Prefab.fromGameObject(source);
        // The template leaves the scene: only what the prefab stamps stays, so
        // the log is the instance's alone.
        source.destroyImmediate();
        log = [];

        Application.enterEditMode();
        const instance = prefab.instantiate();
        expect(instance.getComponent(AlwaysLogger)).toBeDefined();
        expect(log).toEqual(["awake", "onEnable"]);

        SceneManager.activeScene._update();
        expect(log).toEqual(["awake", "onEnable", "start", "update"]);
        SceneManager.activeScene._fixedUpdate();
        expect(log).toEqual(["awake", "onEnable", "start", "update"]);
    });

    test("the built-ins register in edit mode exactly as they do in play", () => {
        const registryOf = (): Record<string, string> => {
            const go = new GameObject("Builtins");
            return {
                camera: go.addComponent(Camera).constructor.name,
                light: go.addComponent(DirectionalLight).constructor.name,
                renderer: go.addComponent(MeshRenderer).constructor.name,
                lod: go.addComponent(LODGroup).constructor.name,
                collider: go.addComponent(BoxCollider).constructor.name,
                canvas: go.addComponent(Canvas).constructor.name,
                image: go.addComponent(UIImage).constructor.name,
                layout: go.addComponent(HorizontalLayoutGroup).constructor.name,
            };
        };
        const inPlay = registryOf();
        clear();
        Application.enterEditMode();
        const inEdit = registryOf();
        // Membership is a property of the class, not of the mode.
        expect(inEdit).toEqual(inPlay);
        expect(Object.values(inEdit)).toEqual(Object.values(inPlay));
    });

    test("a script with enabled = false gets no awake in edit mode, and awake only in play", () => {
        // Play first: the control, what the engine has always done. Adding the
        // component wakes and enables it, and disabling it right after unwinds
        // that — `start` and `update` never run either way.
        const control = new GameObject("Control");
        control.addComponent(Logger).enabled = false;
        expect(log).toEqual(["awake", "onEnable", "onDisable"]);
        SceneManager.activeScene._update();
        expect(log).toEqual(["awake", "onEnable", "onDisable"]);   // no start, no update
        control.destroyImmediate();
        log = [];

        Application.enterEditMode();
        const gated = new GameObject("Gated");
        gated.addComponent(Logger).enabled = false;
        SceneManager.activeScene._update();
        SceneManager.activeScene._lateUpdate();
        expect(log).toEqual([]);                 // no awake, no start, no update
    });

    test("a never-woken script destroyed in edit mode gets no onDisable and no onDestroy", () => {
        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(Logger);
        go.destroyImmediate();
        expect(log).toEqual([]);
    });

    test("a script that woke in play, then the mode switched, still pairs its destroy", () => {
        const go = new GameObject("Holder");
        go.addComponent(Logger);
        expect(log).toEqual(["awake", "onEnable"]);

        Application.enterEditMode();
        go.destroyImmediate();
        expect(log).toEqual(["awake", "onEnable", "onDisable", "onDestroy"]);
    });
});
