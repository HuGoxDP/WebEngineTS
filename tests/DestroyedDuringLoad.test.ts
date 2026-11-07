import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import {
    SceneSerializer,
    type SerializedGameObject,
    type SerializedScene,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * An object destroyed while it is being loaded takes the rest of its load
 * with it.
 *
 * The singleton pattern: an `awake` that finds another instance already
 * running destroys its own GameObject. Unity builds a whole hierarchy before
 * the first `Awake`, so a `DestroyImmediate(gameObject)` there removes the
 * children too, before any of them wakes — they get no `Awake`, no `OnEnable`
 * and no `OnDestroy`. A load here builds an object's children after its own
 * components wake, so the same outcome is "the children are never built".
 * They were built, woken and enabled, then parented under the dead object,
 * where nothing could reach them again (follow-up M0.2c of the A12 review).
 *
 * `destroy()` is deferred to the end of the frame, in Unity as here: the
 * object is alive for the rest of the load, its children wake as usual, and
 * the whole tree goes together afterwards.
 */

const log: string[] = [];

@Serializable({ typeName: "DestroyedDuringLoad.Log" })
class Log extends ScriptableBehaviour {
    public override awake(): void { log.push(`${this.gameObject.name}.awake`); }
    public override onEnable(): void { log.push(`${this.gameObject.name}.onEnable`); }
    public override onDestroy(): void { log.push(`${this.gameObject.name}.onDestroy`); }
}

/**
 * Destroys its own GameObject in `awake` while armed: the singleton pattern.
 * Static switches, not saved fields: a load writes fields after `awake`.
 */
@Serializable({ typeName: "DestroyedDuringLoad.Singleton" })
class Singleton extends ScriptableBehaviour {
    public static armed = false;
    public static deferred = false;
    public override awake(): void {
        if (!Singleton.armed) return;
        log.push(`${this.gameObject.name}.dies`);
        if (Singleton.deferred) this.gameObject.destroy();
        else this.gameObject.destroyImmediate();
    }
}

/** Destroys the root named "Holder" in `awake` while armed. */
@Serializable({ typeName: "DestroyedDuringLoad.RootKiller" })
class RootKiller extends ScriptableBehaviour {
    public override awake(): void {
        if (!Singleton.armed) return;
        log.push(`${this.gameObject.name}.kills Holder`);
        GameObject.Find("Holder")?.destroyImmediate();
    }
}

@Serializable({ typeName: "DestroyedDuringLoad.Pointer" })
class Pointer extends ScriptableBehaviour {
    @SerializedField({ type: FieldType.GameObject }) public target: GameObject | null = null;
}

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
});

function node(name: string, components: object[] = [], children: SerializedGameObject[] = []): SerializedGameObject {
    return { name, active: true, transform: pose(), components: components as never, children };
}

const logC = { type: "DestroyedDuringLoad.Log", fields: {} };
const singleton = () => ({ type: "DestroyedDuringLoad.Singleton", fields: {} });
const rootKiller = { type: "DestroyedDuringLoad.RootKiller", fields: {} };

function scene(...roots: SerializedGameObject[]): SerializedScene {
    return { name: SceneManager.activeScene.name, version: 1, roots };
}

/** Every live GameObject named `name` anywhere under the active scene's roots. */
function live(name: string): GameObject[] {
    const out: GameObject[] = [];
    const walk = (go: GameObject): void => {
        if (go.exists() && go.name === name) out.push(go);
        for (let i = 0; i < go.transform.childCount; i++) walk(go.transform.getChild(i).gameObject);
    };
    for (const root of SceneManager.activeScene.getRootGameObjects()) walk(root);
    return out;
}

/** Every GameObject the registry still holds alive with this name, reachable from the scene or not. */
function anywhere(name: string): GameObject[] {
    return EngineObject.FindObjectsOfType(GameObject, true).filter(go => go.name === name);
}

/** The hierarchy every path builds: the singleton holder with a child and a grandchild. */
function holderTree(): SerializedGameObject {
    return node("Holder", [singleton(), logC], [
        node("Child", [logC], [node("Grandchild", [logC])]),
    ]);
}

/** Builds the same hierarchy at run time, unarmed, so it can be copied. */
function buildHolder(): GameObject {
    const holder = new GameObject("Holder");
    holder.addComponent(Singleton);
    holder.addComponent(Log);
    const child = new GameObject("Child");
    child.addComponent(Log);
    child.transform.setParent(holder.transform, false);
    const grandchild = new GameObject("Grandchild");
    grandchild.addComponent(Log);
    grandchild.transform.setParent(child.transform, false);
    return holder;
}

function clear(): void {
    Singleton.armed = false;
    Singleton.deferred = false;
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    for (const go of EngineObject.FindObjectsOfType(GameObject, true)) go.destroyImmediate();
}

beforeEach(() => {
    clear();
    log.length = 0;
});
afterEach(clear);

/** What every path must end with when the holder destroyed itself immediately. */
function expectNothingOfTheChildren(during: readonly string[] = log): void {
    expect(during).toEqual(["Holder.dies"]);
    expect(anywhere("Holder")).toEqual([]);
    expect(anywhere("Child")).toEqual([]);
    expect(anywhere("Grandchild")).toEqual([]);
}

describe("an object that destroys itself immediately during its own load", () => {
    test("a scene load builds none of its children", () => {
        Singleton.armed = true;
        const [holder] = SceneSerializer.deserializeScene(scene(holderTree()));

        expect(holder.exists()).toBe(false);
        expectNothingOfTheChildren();
    });

    test("Prefab.instantiate builds none of its children", () => {
        const prefab = Prefab.fromGameObject(buildHolder());
        clear();
        log.length = 0;

        Singleton.armed = true;
        const made = prefab.instantiate();

        expect(made.exists()).toBe(false);
        expectNothingOfTheChildren();
    });

    test("EngineObject.Instantiate builds none of its children", () => {
        const source = buildHolder();
        log.length = 0;

        Singleton.armed = true;
        const copy = EngineObject.Instantiate(source);
        const during = [...log];
        source.destroyImmediate(); // so that only the copy could be left over

        expect(copy.exists()).toBe(false);
        expectNothingOfTheChildren(during);
    });

    test("a prefab instance saved as a link builds none of its children", () => {
        const prefab = new Prefab(holderTree());
        AssetDatabase._bindGuid("guid-holder", prefab);
        try {
            Singleton.armed = true;
            const [holder] = SceneSerializer.deserializeScene(scene({
                ...node("Holder"),
                prefab: { guid: "guid-holder", changes: { overrides: [] } } as never,
            }));

            expect(holder.exists()).toBe(false);
            expectNothingOfTheChildren();
        } finally {
            AssetDatabase._unbind(prefab);
        }
    });

    test("the other roots load, and a reference into the dead tree reads as gone", () => {
        Singleton.armed = true;
        const [holder, other] = SceneSerializer.deserializeScene(scene(
            holderTree(),
            node("Other", [
                logC,
                { type: "DestroyedDuringLoad.Pointer", fields: { target: { $type: "GameObjectRef", path: [0, 0] } } },
            ]),
        ));

        expect(holder.exists()).toBe(false);
        expect(other.exists()).toBe(true);
        expect(log).toEqual(["Holder.dies", "Other.awake", "Other.onEnable"]);
        const target = other.getComponent(Pointer)!.target;
        expect(target === null || !target.exists()).toBe(true);
    });
});

describe("a child that destroys itself immediately during its own load", () => {
    test("is not attached to its parent, and the siblings after it still load", () => {
        Singleton.armed = true;
        const [holder] = SceneSerializer.deserializeScene(scene(
            node("Holder", [logC], [
                node("Dead", [singleton(), logC], [node("DeadChild", [logC])]),
                node("Sibling", [logC]),
            ]),
        ));

        expect(holder.exists()).toBe(true);
        expect(log).toEqual([
            "Holder.awake", "Holder.onEnable",
            "Dead.dies",
            "Sibling.awake", "Sibling.onEnable",
        ]);
        expect(anywhere("Dead")).toEqual([]);
        expect(anywhere("DeadChild")).toEqual([]);
        expect(live("Sibling")).toHaveLength(1);
        expect(live("Sibling")[0].transform.parent).toBe(holder.transform);
    });

    test("keeps its place: saved references count the siblings as they were saved", () => {
        Singleton.armed = true;
        const pointer = (path: number[]) =>
            ({ type: "DestroyedDuringLoad.Pointer", fields: { target: { $type: "GameObjectRef", path } } });
        const [holder] = SceneSerializer.deserializeScene(scene(
            node("Holder", [pointer([0, 0]), pointer([0, 1])], [
                node("Dead", [singleton()]),
                node("Sibling"),
            ]),
        ));

        const [toDead, toSibling] = holder.getComponents(Pointer);
        expect(toDead.target).toBeNull();
        expect(toSibling.target).toBe(live("Sibling")[0]);
        expect(holder.transform.childCount).toBe(1);
    });
});

describe("an ancestor destroyed immediately by a descendant's awake", () => {
    test("takes the part already built with it and builds no more", () => {
        Singleton.armed = true;
        SceneSerializer.deserializeScene(scene(
            node("Holder", [logC], [
                node("Child", [logC], [node("Grandchild", [rootKiller, logC]), node("Late", [logC])]),
                node("Later", [logC]),
            ]),
        ));

        // Holder, Child and Grandchild had woken, so each gets its onDestroy;
        // Late and Later were never built.
        expect(log.filter(l => !l.endsWith(".onDestroy"))).toEqual([
            "Holder.awake", "Holder.onEnable",
            "Child.awake", "Child.onEnable",
            "Grandchild.kills Holder",
            "Grandchild.awake", "Grandchild.onEnable",
        ]);
        expect(log.filter(l => l.endsWith(".onDestroy")).sort()).toEqual(
            ["Child.onDestroy", "Grandchild.onDestroy", "Holder.onDestroy"],
        );
        for (const name of ["Holder", "Child", "Grandchild", "Late", "Later"]) {
            expect(anywhere(name)).toEqual([]);
        }
    });
});

describe("an object that asks to be destroyed at the end of the frame", () => {
    test("loads its children as usual, and goes with them afterwards", async () => {
        Singleton.armed = true;
        Singleton.deferred = true;
        const [holder] = SceneSerializer.deserializeScene(scene(
            node("Holder", [singleton(), logC], [node("Child", [logC])]),
        ));

        expect(log).toEqual([
            "Holder.dies", "Holder.awake", "Holder.onEnable", "Child.awake", "Child.onEnable",
        ]);
        expect(live("Child")[0].transform.parent).toBe(holder.transform);

        await Promise.resolve();
        await Promise.resolve();

        expect(holder.exists()).toBe(false);
        expect(anywhere("Child")).toEqual([]);
        expect(log.slice(5).sort()).toEqual(["Child.onDestroy", "Holder.onDestroy"]);
    });
});
