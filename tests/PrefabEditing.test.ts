import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import {
    SceneSerializer, type SerializedGameObject, type SerializedScene,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * What the editor's prefab workflow calls: finding instances, reading their
 * changes, applying and reverting them (design/prefab-instances-plan.md,
 * Stage 9).
 */

@Serializable({ typeName: "EditingSpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";

    @SerializedField()
    public count: number = 0;
}

@Serializable({ typeName: "EditingSpec.Aim" })
class Aim extends Behaviour {
    @SerializedField({ type: FieldType.GameObject })
    public target: GameObject | null = null;
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

function prefabOf(build: () => GameObject, guid: string): Prefab {
    const source = build();
    const prefab = Prefab.fromGameObject(source);
    source.destroyImmediate();
    AssetDatabase._bindGuid(guid, prefab);
    return prefab;
}

const turret = (): Prefab => prefabOf(() => make("Turret", "turret", make("Barrel", "barrel")), "guid-turret");
const tank = (inner: Prefab): Prefab =>
    prefabOf(() => make("Tank", "tank", make("Hull", "hull"), inner.instantiate()), "guid-tank");

const saveLinked = (): SerializedScene =>
    SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });

beforeEach(() => clear());
afterEach(() => AssetDatabase.clear());

describe("finding prefab instances", () => {
    test("prefabInstanceRoot finds the instance a node belongs to; outermostPrefabInstanceRoot crosses nesting", () => {
        const instance = tank(turret()).instantiate();
        const hull = child(instance, 0);
        const nested = child(instance, 1);
        const barrel = child(nested, 0);
        const loose = new GameObject("Loose");

        expect(instance.prefabInstanceRoot).toBe(instance);
        expect(hull.prefabInstanceRoot).toBe(instance);
        expect(nested.prefabInstanceRoot).toBe(nested);
        expect(barrel.prefabInstanceRoot).toBe(nested);
        expect(barrel.outermostPrefabInstanceRoot).toBe(instance);
        expect(nested.outermostPrefabInstanceRoot).toBe(instance);
        expect(loose.prefabInstanceRoot).toBeNull();
        expect(loose.outermostPrefabInstanceRoot).toBeNull();
    });

    test("a missing prefab is reported as missing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const pose = {
            position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        };
        const shell = (name: string, prefab: object): SerializedGameObject =>
            ({ name, active: true, transform: pose, components: [], children: [], prefab } as never);
        const present = turret();
        const [linked, full, found] = SceneSerializer.deserializeScene({
            name: SceneManager.activeScene.name, version: 2, roots: [
                shell("Linked", { guid: "guid-gone", changes: { overrides: [] } }),
                shell("Full", { guid: "guid-gone" }),
                shell("Found", { guid: "guid-turret", changes: { overrides: [] } }),
            ],
        });

        expect(linked.isPrefabAssetMissing).toBe(true);
        expect(full.isPrefabAssetMissing).toBe(true);
        expect(found.isPrefabAssetMissing).toBe(false);
        expect(found.prefabSource).toBe(present);
        expect(new GameObject("Plain").isPrefabAssetMissing).toBe(false);
        warn.mockRestore();
    });
});

describe("reading, applying and reverting an instance's changes", () => {
    test("getChanges reports added and removed children by node id", () => {
        const prefab = tank(turret());
        const instance = prefab.instantiate();
        const hullId = child(instance, 0).prefabNodeId;
        child(instance, 0).destroyImmediate();
        const flag = new GameObject("Flag");
        flag.transform.setParent(instance.transform, false);
        instance.transform.localPosition = new Vector3(9, 9, 9);

        const changes = prefab.getChanges(instance);

        expect(changes.removedChildren).toEqual([hullId]);
        expect(changes.addedChildren).toHaveLength(1);
        // The added object was given its id, and it maps back to it.
        expect(flag.prefabNodeId).not.toBeNull();
        expect(changes.addedChildren![0].node.id).toBe(flag.prefabNodeId);
        expect(changes.addedChildren![0].parent).toBe(prefab._resolvedTree().id);
        // The root's own position is not one of its changes.
        expect(changes.overrides).toEqual([]);
        expect(prefab.getChanges(instance)).toEqual(changes);
    });

    test("applying an instance writes it into the prefab, and other instances follow on reload", () => {
        const prefab = tank(turret());
        const edited = prefab.instantiate();
        const other = prefab.instantiate();
        other.transform.localPosition = new Vector3(5, 0, 0);
        edited.transform.localPosition = new Vector3(-5, 0, 0);
        edited.getComponent(Tag)!.label = "applied";
        new GameObject("Flag").transform.setParent(edited.transform, false);
        const before = saveLinked();

        prefab.applyInstance(edited);

        expect(prefab.getChanges(edited)).toEqual({ overrides: [] });
        // The root keeps its own place: position is not applied.
        expect(prefab._resolvedTree().transform.position).toEqual({ x: 0, y: 0, z: 0 });
        const fresh = prefab.instantiate();
        expect(fresh.getComponent(Tag)!.label).toBe("applied");
        expect(child(fresh, 2).name).toBe("Flag");

        clear();
        const [edited2, other2] = SceneSerializer.deserializeScene(before);
        expect(other2.getComponent(Tag)!.label).toBe("applied");
        expect(child(other2, 2).name).toBe("Flag");
        expect(other2.transform.localPosition.x).toBeCloseTo(5);
        expect(edited2.getComponent(Tag)!.label).toBe("applied");
        expect(edited2.transform.childCount).toBe(3);
    });

    test("applying an instance that contains its own prefab is refused", () => {
        const inner = turret();
        const outer = tank(inner);

        const direct = outer.instantiate();
        outer.instantiate().transform.setParent(direct.transform, false);
        expect(() => outer.applyInstance(direct)).toThrow(/contains itself/);

        // Through another prefab: Turret now holding a Tank would hold itself.
        const turretInstance = inner.instantiate();
        outer.instantiate().transform.setParent(turretInstance.transform, false);
        expect(() => inner.applyInstance(turretInstance)).toThrow(/contains itself/);

        const before = JSON.stringify(inner._resolvedTree());
        expect(JSON.stringify(inner._resolvedTree())).toBe(before);
    });

    test("reverting one override restores that field in place and keeps the others", () => {
        const prefab = tank(turret());
        const instance = prefab.instantiate();
        const hull = child(instance, 0);
        const tag = hull.getComponent(Tag)!;
        tag.label = "changed";
        tag.count = 7;
        hull.transform.localScale = new Vector3(2, 2, 2);

        const label = prefab.getChanges(instance).overrides.find(o => o.field === "label")!;
        prefab.revertOverride(instance, label);

        expect(child(instance, 0)).toBe(hull);
        expect(hull.getComponent(Tag)).toBe(tag);
        expect(tag.label).toBe("hull");
        expect(tag.count).toBe(7);
        expect(prefab.getChanges(instance).overrides.map(o => o.field).sort()).toEqual(["count", "transform.scale"]);

        const scale = prefab.getChanges(instance).overrides.find(o => o.field === "transform.scale")!;
        prefab.revertOverride(instance, scale);
        expect(hull.transform.localScale.x).toBeCloseTo(1);
    });

    test("shape changes are reverted in place, and references to untouched objects survive", () => {
        const prefab = tank(turret());
        const instance = prefab.instantiate();
        const hull = child(instance, 0);
        const watcher = new GameObject("Watcher");
        watcher.addComponent(Aim).target = hull;
        const turretId = child(instance, 1).prefabNodeId!;

        child(instance, 1).destroyImmediate();
        new GameObject("Flag").transform.setParent(instance.transform, false);
        instance.removeComponent(instance.getComponent(Tag)!);
        hull.addComponent(Aim);

        for (const change of [
            ...prefab.getChanges(instance).removedChildren ?? [],
            ...prefab.getChanges(instance).addedChildren ?? [],
            ...prefab.getChanges(instance).removedComponents ?? [],
            ...prefab.getChanges(instance).addedComponents ?? [],
        ]) {
            prefab.revertOverride(instance, change);
        }

        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
        expect(child(instance, 0)).toBe(hull);
        expect(child(instance, 1).prefabNodeId).toBe(turretId);
        expect(child(instance, 1).isPrefabInstance).toBe(true);
        expect(child(instance, 1, 0).name).toBe("Barrel");
        expect(instance.getComponent(Tag)!.label).toBe("tank");
        expect(watcher.getComponent(Aim)!.target).toBe(hull);
    });

    test("connecting makes the source an instance of the prefab made from it", () => {
        const inner = turret();
        const source = make("Tank", "tank", make("Hull", "hull"), inner.instantiate());

        const prefab = Prefab.fromGameObject(source, "Tank", { connect: true });

        expect(source.isPrefabInstance).toBe(true);
        expect(source.prefabSource).toBe(prefab);
        expect(source.prefabNodeId).toBeNull();
        const tree = prefab._resolvedTree();
        expect(child(source, 0).prefabNodeId).toBe(tree.children[0].id);
        expect(child(source, 1).prefabNodeId).toBe(tree.children[1].id);
        expect(prefab.getChanges(source)).toEqual({ overrides: [] });
        expect(prefab.getOverrides(source)).toEqual([]);

        // Without connecting, the source is left alone.
        const other = make("Crate", "crate", make("Lid", "lid"));
        Prefab.fromGameObject(other);
        expect(other.isPrefabInstance).toBe(false);
        expect(child(other, 0).prefabNodeId).toBeNull();
    });

    test("removing unused overrides drops what no longer applies", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const prefab = tank(turret());
        const instance = prefab.instantiate();
        child(instance, 0).getComponent(Tag)!.label = "patched";
        const saved = saveLinked();
        clear();

        // The prefab loses the Hull the override was for.
        const shrunk = new Prefab(JSON.parse(JSON.stringify(prefab._resolvedTree())) as SerializedGameObject);
        (shrunk._resolvedTree().children).splice(0, 1);
        AssetDatabase._bindGuid("guid-tank", shrunk);
        const [back] = SceneSerializer.deserializeScene(saved);
        expect(saveLinked().roots[0].prefab!.unused!.overrides).toHaveLength(1);

        const removed = shrunk.removeUnusedOverrides(back);

        expect(removed!.overrides[0].value).toBe("patched");
        expect(saveLinked().roots[0].prefab!.unused).toBeUndefined();
        expect(shrunk.removeUnusedOverrides(back)).toBeNull();
        expect(() => prefab.removeUnusedOverrides(back)).toThrow(/not an instance/);
        warn.mockRestore();
    });
});
