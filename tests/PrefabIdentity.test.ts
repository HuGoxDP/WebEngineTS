import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { SceneSerializer, type SerializedGameObject } from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { PrefabDiff } from "../src/engine/core/serialization/PrefabOverride";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * Prefabs have identity: every node has an id, an instance knows its prefab,
 * and a prefab inside a prefab is a link to its own prefab
 * (design/prefab-instances-plan.md, Stage 5).
 */

@Serializable({ typeName: "IdentitySpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

function make(name: string, label: string, ...children: GameObject[]): GameObject {
    const go = new GameObject(name);
    go.addComponent(Tag).label = label;
    for (const child of children) child.transform.setParent(go.transform, false);
    return go;
}

const child = (go: GameObject, ...path: number[]): GameObject =>
    path.reduce((cur, i) => cur.transform.getChild(i).gameObject, go);

/** A prefab made from a fresh object, bound under `guid` when one is given. */
function prefabOf(build: () => GameObject, guid?: string): Prefab {
    const source = build();
    const prefab = Prefab.fromGameObject(source);
    source.destroyImmediate();
    if (guid !== undefined) AssetDatabase._bindGuid(guid, prefab);
    return prefab;
}

const turret = (): Prefab => prefabOf(() => make("Turret", "turret", make("Barrel", "barrel")), "guid-turret");

beforeEach(() => clear());
afterEach(() => AssetDatabase.clear());

describe("a prefab and its instances", () => {
    test("an instantiated prefab is an instance of it", () => {
        const prefab = turret();

        const instance = prefab.instantiate();

        expect(instance.isPrefabInstance).toBe(true);
        expect(instance.prefabSource).toBe(prefab);
        expect(instance.prefabNodeId).toBeNull();
        expect(child(instance, 0).isPrefabInstance).toBe(false);
    });

    test("every node of a prefab made from an object has an id, and the object is left as it was", () => {
        const inner = turret();
        const nested = inner.instantiate();
        new GameObject("Antenna").transform.setParent(nested.transform, false);
        const source = make("Tank", "tank", make("Hull", "hull", make("Hatch", "hatch")), nested);
        const before = SceneSerializer.serializeGameObject(source);

        const tree = Prefab.fromGameObject(source)._resolvedTree();

        const ids: Array<string | undefined> = [];
        const walk = (n: SerializedGameObject): void => {
            ids.push(n.id);
            n.children.forEach(walk);
        };
        walk(tree);
        expect(ids).toHaveLength(4);
        expect(ids.every(id => typeof id === "string" && id.length > 0)).toBe(true);
        expect(new Set(ids).size).toBe(4);
        // The object added to the nested instance is recorded with an id too.
        expect(tree.children[1].prefab!.changes!.addedChildren![0].node.id).toEqual(expect.any(String));

        expect(SceneSerializer.serializeGameObject(source)).toEqual(before);
        expect(child(nested, 1).prefabNodeId).toBeNull();
        expect(child(source, 0).prefabNodeId).toBeNull();
    });

    test("a prefab file without ids gets the same ids on every load", () => {
        const plain = (name: string, ...children: SerializedGameObject[]): SerializedGameObject => ({
            name, active: true,
            transform: {
                position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
            },
            components: [{ type: "IdentitySpec.Tag", fields: { label: name } }],
            children,
        });
        const file = { name: "Old", snapshot: plain("Old", plain("A", plain("B")), plain("C")) };

        const first = Prefab.fromJSON(file);
        const second = Prefab.fromJSON(file);

        const ids = (t: SerializedGameObject): unknown =>
            [t.id, t.children[0].id, t.children[0].children[0].id, t.children[1].id];
        expect(ids(first._resolvedTree())).toEqual(["~", "~0", "~0.0", "~1"]);
        expect(ids(second._resolvedTree())).toEqual(ids(first._resolvedTree()));
        expect(file.snapshot.id).toBeUndefined();

        // An instance saved against the first load still matches the second.
        AssetDatabase._bindGuid("guid-old", first);
        const instance = first.instantiate();
        child(instance, 0, 0).getComponent(Tag)!.label = "changed";
        const saved = SceneSerializer.serializeGameObject(instance, { prefabs: "link" });
        clear();
        AssetDatabase._bindGuid("guid-old", second);
        const back = SceneSerializer.deserializeGameObject(saved);
        expect(child(back, 0, 0).getComponent(Tag)!.label).toBe("changed");
    });

    test("an instance and its prefab agree node by node", () => {
        const prefab = prefabOf(() => make("Tank", "tank", make("Hull", "hull", make("Hatch", "hatch")), make("Gun", "gun")));
        const tree = prefab._resolvedTree();

        const instance = prefab.instantiate();

        expect(instance.prefabNodeId).toBeNull();
        const walk = (go: GameObject, n: SerializedGameObject): void => {
            for (let i = 0; i < n.children.length; i++) {
                expect(child(go, i).prefabNodeId).toBe(n.children[i].id);
                walk(child(go, i), n.children[i]);
            }
        };
        walk(instance, tree);
    });

    test("a prefab made from an object holding an instance keeps it as a link, and instantiates it in full", () => {
        const inner = turret();
        const tank = prefabOf(() => make("Tank", "tank", inner.instantiate()));

        const tree = tank._resolvedTree();
        expect(tree.children[0].prefab).toEqual({ guid: "guid-turret", changes: { overrides: [] } });
        expect(tree.children[0].children).toEqual([]);

        const instance = tank.instantiate();
        const nested = child(instance, 0);
        expect(nested.isPrefabInstance).toBe(true);
        expect(nested.prefabSource).toBe(inner);
        expect(nested.getComponent(Tag)!.label).toBe("turret");
        expect(child(nested, 0).getComponent(Tag)!.label).toBe("barrel");
    });

    test("an untouched instance has no overrides, nested instances included", () => {
        const inner = turret();
        const tank = prefabOf(() => make("Tank", "tank", inner.instantiate(), make("Hull", "hull")));

        const instance = tank.instantiate();

        expect(tank.getOverrides(instance)).toEqual([]);
        expect(PrefabDiff.compareChanges(tank._resolvedTree(), SceneSerializer._serializeForPrefab(instance)))
            .toEqual({ overrides: [] });
    });

    test("the same prefab nested twice keeps the two apart", () => {
        const inner = turret();
        const tank = prefabOf(() => make("Tank", "tank", inner.instantiate(), inner.instantiate()), "guid-tank");

        const instance = tank.instantiate();
        const [left, right] = [child(instance, 0), child(instance, 1)];
        expect(left.prefabNodeId).not.toBe(right.prefabNodeId);
        expect(left.isPrefabInstance && right.isPrefabInstance).toBe(true);
        // Their interiors are the same prefab's, so they share ids.
        expect(child(left, 0).prefabNodeId).toBe(child(right, 0).prefabNodeId);

        child(right, 0).getComponent(Tag)!.label = "right only";
        const overrides = tank.getOverrides(instance);
        expect(overrides).toHaveLength(1);
        expect(overrides[0].node).toBe(right.prefabNodeId);

        const saved = SceneSerializer.serializeGameObject(instance, { prefabs: "link" });
        clear();
        const back = SceneSerializer.deserializeGameObject(saved);
        expect(child(back, 0, 0).getComponent(Tag)!.label).toBe("barrel");
        expect(child(back, 1, 0).getComponent(Tag)!.label).toBe("right only");
    });

    test("instantiating an instance gives another instance of the same prefab", () => {
        const prefab = turret();
        const instance = prefab.instantiate();

        const copy = EngineObject.Instantiate(instance) as GameObject;

        expect(copy.isPrefabInstance).toBe(true);
        expect(copy.prefabSource).toBe(prefab);
        expect(prefab.getOverrides(copy)).toEqual([]);
    });

    test("duplicating a node inside an instance gives an added object", () => {
        const prefab = turret();
        const instance = prefab.instantiate();

        const duplicate = EngineObject.Instantiate(child(instance, 0)) as GameObject;
        duplicate.transform.setParent(instance.transform, false);

        expect(duplicate.prefabNodeId).toBeNull();
        const changes = SceneSerializer.serializeGameObject(instance, { prefabs: "link" }).prefab!.changes!;
        expect(changes.overrides).toEqual([]);
        expect(changes.addedChildren!.map(a => a.index)).toEqual([1]);
        expect(changes.removedChildren).toBeUndefined();
    });

    test("revert keeps the sibling index and the link", async () => {
        const prefab = turret();
        const parent = new GameObject("Rack");
        new GameObject("First").transform.setParent(parent.transform, false);
        const instance = prefab.instantiate();
        instance.transform.setParent(parent.transform, false);
        new GameObject("Last").transform.setParent(parent.transform, false);
        instance.getComponent(Tag)!.label = "tweaked";

        const reverted = prefab.revert(instance);
        await Promise.resolve();

        expect(parent.transform.childCount).toBe(3);
        expect(reverted.transform.getSiblingIndex()).toBe(1);
        expect(reverted.isPrefabInstance).toBe(true);
        expect(reverted.prefabSource).toBe(prefab);
        expect(reverted.getComponent(Tag)!.label).toBe("turret");
        expect(prefab.getOverrides(reverted)).toEqual([]);
    });

    test("unpacking removes the link and the ids and leaves nested instances; unpacking completely removes those too", () => {
        const inner = turret();
        const tank = prefabOf(() => make("Tank", "tank", inner.instantiate(), make("Hull", "hull")), "guid-tank");

        const partly = tank.instantiate();
        partly.unpackPrefab();
        expect(partly.isPrefabInstance).toBe(false);
        expect(child(partly, 0).prefabNodeId).toBeNull();
        expect(child(partly, 1).prefabNodeId).toBeNull();
        expect(child(partly, 0).isPrefabInstance).toBe(true);
        expect(child(partly, 0, 0).prefabNodeId).not.toBeNull();

        const fully = tank.instantiate();
        fully.unpackPrefab(true);
        expect(child(fully, 0).isPrefabInstance).toBe(false);
        expect(child(fully, 0, 0).prefabNodeId).toBeNull();
    });

    test("unpacking a nested instance is refused", () => {
        const inner = turret();
        const tank = prefabOf(() => make("Tank", "tank", inner.instantiate()), "guid-tank");
        const instance = tank.instantiate();

        expect(() => child(instance, 0).unpackPrefab()).toThrow(/part of the prefab instance "Tank"/);
        expect(child(instance, 0).isPrefabInstance).toBe(true);

        // One added to the instance, not part of its prefab, is its own.
        const added = inner.instantiate();
        added.transform.setParent(instance.transform, false);
        SceneSerializer.serializeGameObject(instance, { prefabs: "link" });
        expect(added.prefabNodeId).not.toBeNull();
        expect(() => added.unpackPrefab()).not.toThrow();
        expect(added.isPrefabInstance).toBe(false);
    });
});
