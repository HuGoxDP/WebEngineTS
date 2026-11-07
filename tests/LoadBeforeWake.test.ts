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
import { DirectionalLight } from "../src/engine/core/components/DirectionalLight";

/**
 * Unity's load contract: the whole hierarchy is built first — every object,
 * every component, every saved field and reference, every parent link — and
 * only then do `Awake` and `OnEnable` run. A script whose object, or an
 * ancestor of it, is saved inactive does not wake until it is activated.
 *
 * Follow-ups M0.2a ("fields before wake", A12 review) and M0.2d ("a child
 * wakes as a scene root", M0.2c notes).
 */

const log: string[] = [];

/** Logs what its awake sees and, while armed, writes into a sibling `Target`. */
@Serializable({ typeName: "LoadBeforeWake.Writer" })
class Writer extends ScriptableBehaviour {
    public static armed = false;
    @SerializedField() public n = 1;
    @SerializedField({ type: FieldType.GameObject }) public other: GameObject | null = null;
    @SerializedField({ type: FieldType.Component }) public target: Target | null = null;
    public override awake(): void {
        const parent = this.transform.parent?.gameObject.name ?? "none";
        log.push(
            `${this.gameObject.name}.Writer.awake n=${this.n} parent=${parent} ` +
            `children=${this.transform.childCount} other=${this.other?.name ?? "null"} ` +
            `target=${this.target ? this.target.n : "null"}`,
        );
        if (!Writer.armed) return;
        const t = this.gameObject.getComponent(Target);
        if (t) t.n = 42;
    }
    public override onEnable(): void { log.push(`${this.gameObject.name}.Writer.onEnable`); }
    public override onDisable(): void { log.push(`${this.gameObject.name}.Writer.onDisable`); }
}

@Serializable({ typeName: "LoadBeforeWake.Target" })
class Target extends ScriptableBehaviour {
    @SerializedField() public n = 1;
    public override awake(): void { log.push(`${this.gameObject.name}.Target.awake n=${this.n}`); }
}

/** Logs whether the scene's light already has its saved shadow distance. */
@Serializable({ typeName: "LoadBeforeWake.LightReader" })
class LightReader extends ScriptableBehaviour {
    public override awake(): void {
        const light = this.gameObject.getComponent(DirectionalLight);
        log.push(`LightReader.awake shadowDistance=${light?.shadowDistance} intensity=${light?.intensity}`);
    }
}

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
});

function node(
    name: string,
    components: object[] = [],
    children: SerializedGameObject[] = [],
    active = true,
): SerializedGameObject {
    return { name, active, transform: pose(), components: components as never, children };
}

const writer = (n = 5, extra: object = {}) => ({ type: "LoadBeforeWake.Writer", fields: { n, ...extra } });
const target = (n = 7) => ({ type: "LoadBeforeWake.Target", fields: { n } });

function scene(...roots: SerializedGameObject[]): SerializedScene {
    return { name: SceneManager.activeScene.name, version: 1, roots };
}

function clear(): void {
    Writer.armed = false;
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    for (const go of EngineObject.FindObjectsOfType(GameObject, true)) go.destroyImmediate();
}

beforeEach(() => {
    clear();
    log.length = 0;
});
afterEach(clear);

/** Every way a saved tree becomes live objects, each returning the new root. */
const paths: Array<[string, (tree: SerializedGameObject) => GameObject]> = [
    ["a scene load", tree => SceneSerializer.deserializeScene(scene(tree))[0]],
    ["Prefab.instantiate", tree => new Prefab(tree).instantiate()],
    ["EngineObject.Instantiate", tree => {
        // The source is built unarmed, so the copy carries the saved values.
        const armed = Writer.armed;
        Writer.armed = false;
        const source = SceneSerializer.deserializeGameObject(tree);
        Writer.armed = armed;
        log.length = 0;
        const copy = EngineObject.Instantiate(source);
        const during = [...log];
        source.destroyImmediate();
        log.splice(0, log.length, ...during);
        return copy;
    }],
    ["a prefab instance saved as a link", tree => {
        const prefab = new Prefab(tree);
        AssetDatabase._bindGuid("guid-load-before-wake", prefab);
        try {
            return SceneSerializer.deserializeScene(scene({
                ...node(tree.name),
                prefab: { guid: "guid-load-before-wake", changes: { overrides: [] } } as never,
            }))[0];
        } finally {
            AssetDatabase._unbind(prefab);
        }
    }],
];

describe.each(paths)("fields before wake: %s", (_label, load) => {
    test("an awake sees its own saved fields", () => {
        load(node("Holder", [writer(5)]));

        expect(log[0]).toMatch(/^Holder\.Writer\.awake n=5 /);
    });

    test("a write from an awake into a later sibling's saved field stays ([Writer, Target])", () => {
        Writer.armed = true;
        const go = load(node("Holder", [writer(), target(7)]));

        expect(go.getComponent(Target)!.n).toBe(42);
        // The later sibling's own awake sees the write, not its saved value.
        expect(log).toContain("Holder.Target.awake n=42");
    });

    test("a write from an awake into an earlier sibling's saved field stays ([Target, Writer])", () => {
        Writer.armed = true;
        const go = load(node("Holder", [target(7), writer()]));

        expect(go.getComponent(Target)!.n).toBe(42);
        expect(log).toContain("Holder.Target.awake n=7");
    });

    test("an awake sees saved references already resolved", () => {
        load(node("Holder", [
            writer(5, {
                other: { $type: "GameObjectRef", path: [0, 0] },
                target: { $type: "ComponentRef", path: [0, 0], component: "LoadBeforeWake.Target", index: 0 },
            }),
        ], [node("Child", [target(9)])]));

        expect(log[0]).toBe("Holder.Writer.awake n=5 parent=none children=1 other=Child target=9");
    });

    test("a child wakes under its parent, after the parent", () => {
        load(node("Holder", [writer(1)], [node("Child", [writer(2)])]));

        expect(log).toEqual([
            "Holder.Writer.awake n=1 parent=none children=1 other=null target=null",
            "Holder.Writer.onEnable",
            "Child.Writer.awake n=2 parent=Holder children=0 other=null target=null",
            "Child.Writer.onEnable",
        ]);
    });

    test("a child of an inactive parent does not wake until the parent is activated", () => {
        const go = load(node("Holder", [], [node("Child", [writer(2)])], false));

        expect(log).toEqual([]);
        const child = go.transform.getChild(0).gameObject;
        expect(child.activeSelf).toBe(true);
        expect(child.activeInHierarchy).toBe(false);

        go.setActive(true);

        expect(log).toEqual([
            "Child.Writer.awake n=2 parent=Holder children=0 other=null target=null",
            "Child.Writer.onEnable",
        ]);
    });

    test("a built-in keeps a saved value its setter writes into what its onAwake creates", () => {
        const go = load(node("Holder", [
            { type: "LoadBeforeWake.LightReader", fields: {} },
            { type: "DirectionalLight", fields: { shadowDistance: 75, intensity: 3 } },
        ]));

        expect(go.getComponent(DirectionalLight)!.shadowDistance).toBe(75);
        expect(log).toEqual(["LightReader.awake shadowDistance=75 intensity=3"]);
    });
});

describe("a component restored by a prefab revert", () => {
    test("takes its fields before it wakes", () => {
        const go = SceneSerializer.deserializeGameObject(node("Holder", [target(1)]));
        log.length = 0;

        const restored = SceneSerializer._restoreComponent([go], writer(8) as never, go, 0, undefined);

        expect(log[0]).toMatch(/^Holder\.Writer\.awake n=8 /);
        expect(go.getAllComponents()[0]).toBe(restored);
    });
});
