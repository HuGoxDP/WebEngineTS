import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import {
    SceneSerializer, type SerializedGameObject, type SerializedScene,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { PrefabDiff } from "../src/engine/core/serialization/PrefabOverride";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * A reference into a prefab instance addresses its target by node id, so it
 * survives the prefab gaining or losing siblings in front of the target
 * (design/prefab-instances-plan.md, Stage 6, section 7.7).
 */

@Serializable({ typeName: "RefSpec.Aim" })
class Aim extends Behaviour {
    @SerializedField({ type: FieldType.GameObject })
    public target: GameObject | null = null;
}

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
});

function node(name: string, rest: Partial<SerializedGameObject> = {}): SerializedGameObject {
    const out: SerializedGameObject = {
        name, active: true, transform: pose(),
        components: rest.components ?? [], children: rest.children ?? [],
    };
    if (rest.id !== undefined) out.id = rest.id;
    if (rest.prefab !== undefined) out.prefab = rest.prefab;
    return out;
}

const aim = (path: Array<number | string>) =>
    ({ type: "RefSpec.Aim", fields: { target: { $type: "GameObjectRef", path } } });

function turretTree(): SerializedGameObject {
    return node("Turret", { id: "t-root", children: [node("Barrel", { id: "t-barrel" })] });
}

function tankTree(): SerializedGameObject {
    return node("Tank", {
        id: "k-root",
        components: [aim([0, "k-hull"])],
        children: [
            node("Hull", { id: "k-hull" }),
            node("Turret", { id: "k-turret", prefab: { guid: "guid-turret", changes: { overrides: [] } } }),
        ],
    });
}

function bind(guid: string, tree: SerializedGameObject): Prefab {
    const prefab = new Prefab(tree);
    AssetDatabase._bindGuid(guid, prefab);
    return prefab;
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

const child = (go: GameObject, ...path: number[]): GameObject =>
    path.reduce((cur, i) => cur.transform.getChild(i).gameObject, go);

const scene = (...roots: SerializedGameObject[]): SerializedScene =>
    ({ name: SceneManager.activeScene.name, version: 1, roots });

const tankLink = () => node("Tank", { prefab: { guid: "guid-tank", changes: { overrides: [] } } });

const saveLinked = (): SerializedScene =>
    SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });

/** Every path of every reference in a saved value. */
function paths(value: unknown, out: unknown[][] = []): unknown[][] {
    if (Array.isArray(value)) {
        value.forEach(v => paths(v, out));
    } else if (value !== null && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if ((obj["$type"] === "GameObjectRef" || obj["$type"] === "ComponentRef") && Array.isArray(obj["path"])) {
            out.push(obj["path"] as unknown[]);
        }
        Object.values(obj).forEach(v => paths(v, out));
    }
    return out;
}

beforeEach(() => {
    clear();
    bind("guid-turret", turretTree());
    bind("guid-tank", tankTree());
});
afterEach(() => AssetDatabase.clear());

describe("references into a prefab instance", () => {
    test("a reference into an instance is written by node id in link mode", () => {
        const [player, tank] = SceneSerializer.deserializeScene(scene(node("Player"), tankLink()));
        player.addComponent(Aim).target = child(tank, 1, 0);

        const saved = saveLinked();

        expect(saved.roots[0].components[0].fields["target"])
            .toEqual({ $type: "GameObjectRef", path: [1, "k-turret", "t-barrel"] });
    });

    test("it still finds its target after the prefab gains a child in front of it", () => {
        const [player, tank] = SceneSerializer.deserializeScene(scene(node("Player"), tankLink()));
        player.addComponent(Aim).target = child(tank, 0);
        const saved = saveLinked();
        clear();

        const grown = tankTree();
        grown.children.unshift(node("Armour", { id: "k-armour" }));
        bind("guid-tank", grown);
        const [player2, tank2] = SceneSerializer.deserializeScene(saved);

        // A position would now name the Armour.
        expect(player2.getComponent(Aim)!.target).toBe(child(tank2, 1));
        expect(player2.getComponent(Aim)!.target!.name).toBe("Hull");
        expect(tank2.getComponent(Aim)!.target!.name).toBe("Hull");
    });

    test("removing a sibling inside an instance does not turn untouched references into overrides", () => {
        const source = new GameObject("Rig");
        const first = new GameObject("First");
        const second = new GameObject("Second");
        first.transform.setParent(source.transform, false);
        second.transform.setParent(source.transform, false);
        source.addComponent(Aim).target = second;
        const prefab = Prefab.fromGameObject(source);
        source.destroyImmediate();
        expect(paths(prefab._resolvedTree())[0]).toEqual([0, prefab._resolvedTree().children[1].id]);

        const instance = prefab.instantiate();
        child(instance, 0).destroyImmediate();

        expect(prefab.getOverrides(instance)).toEqual([]);
        expect(PrefabDiff.compareChanges(prefab._resolvedTree(), SceneSerializer._serializeForPrefab(instance)))
            .toEqual({ overrides: [], removedChildren: [prefab._resolvedTree().children[0].id] });
    });

    test("an override that holds a reference survives the prefab being reordered", () => {
        const [tank] = SceneSerializer.deserializeScene(scene(tankLink()));
        tank.getComponent(Aim)!.target = child(tank, 1);
        const saved = saveLinked();
        expect(saved.roots[0].prefab!.changes!.overrides[0].value)
            .toEqual({ $type: "GameObjectRef", path: [0, "k-turret"] });
        clear();

        const reordered = tankTree();
        reordered.children.reverse();
        bind("guid-tank", reordered);
        const [back] = SceneSerializer.deserializeScene(saved);

        expect(child(back, 0).name).toBe("Turret");
        expect(back.getComponent(Aim)!.target).toBe(child(back, 0));
    });

    test("a legacy prefab's positional references are read as node ids", () => {
        const legacy = {
            name: "Old",
            snapshot: node("Old", {
                components: [aim([0, 1, 0])],
                children: [node("A"), node("B", { children: [node("Deep")] })],
            }),
        };

        const prefab = Prefab.fromJSON(legacy);

        expect(paths(prefab._resolvedTree())).toEqual([[0, "~1.0"]]);
        const instance = prefab.instantiate();
        expect(instance.getComponent(Aim)!.target).toBe(child(instance, 1, 0));
        expect(prefab.getOverrides(instance)).toEqual([]);
        // The file itself is not touched.
        expect(paths(legacy.snapshot)).toEqual([[0, 1, 0]]);
    });

    test("an id is looked for only inside its own instance", () => {
        // Legacy ids repeat from one prefab to the next: the nested instance's
        // interior has a "~1" of its own, and comes first in the tree.
        bind("guid-inner", node("Inner", { id: "~", children: [node("Decoy", { id: "~1" })] }));
        const outer = bind("guid-outer", node("Outer", {
            id: "~",
            components: [aim([0, "~1"])],
            children: [
                node("Nested", { id: "~0", prefab: { guid: "guid-inner", changes: { overrides: [] } } }),
                node("Real", { id: "~1" }),
            ],
        }));

        const instance = outer.instantiate();

        expect(child(instance, 0, 0).name).toBe("Decoy");
        expect(instance.getComponent(Aim)!.target!.name).toBe("Real");
    });

    test("expand mode never writes an id into a path", () => {
        const [player, tank] = SceneSerializer.deserializeScene(scene(node("Player"), tankLink()));
        player.addComponent(Aim).target = child(tank, 1, 0);
        child(tank, 1, 0).addComponent(Aim).target = player;

        const saved = SceneSerializer.serializeScene(SceneManager.activeScene);
        const found = paths(saved.roots);

        expect(found.length).toBe(3);
        expect(found.every(p => p.every(segment => typeof segment === "number"))).toBe(true);
        expect(JSON.stringify(saved)).not.toMatch(/"scope":/);
    });
});
