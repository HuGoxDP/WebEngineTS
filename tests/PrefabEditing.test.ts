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

@Serializable({ typeName: "EditingSpec.Part" })
class Part extends Behaviour {
    @SerializedField({ type: FieldType.Component })
    public part: object | null = null;
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

/** Binds, under `guid`, the prefab loaded there with its file edited. */
function editPrefab(guid: string, edit: (snapshot: SerializedGameObject) => void): Prefab {
    const json = JSON.parse(JSON.stringify((AssetDatabase.get(guid) as Prefab).toJSON()));
    edit(json.snapshot);
    const next = Prefab.fromJSON(json);
    AssetDatabase._bindGuid(guid, next);
    return next;
}

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

    test("a reference from inside an instance to the rest of the scene is listed as a link save records it", () => {
        const inner = prefabOf(() => {
            const turretRoot = make("Turret", "turret", make("Barrel", "barrel"));
            turretRoot.addComponent(Aim).target = child(turretRoot, 0);
            return turretRoot;
        }, "guid-turret");
        const outer = prefabOf(() => {
            const root = make("Tank", "tank", make("Hull", "hull"), inner.instantiate());
            root.addComponent(Aim).target = child(root, 0);
            return root;
        }, "guid-tank");
        const player = new GameObject("Player");
        const instance = outer.instantiate();
        instance.getComponent(Aim)!.target = player;
        child(instance, 1).getComponent(Aim)!.target = player;

        const saved = saveLinked().roots[1].prefab!.changes!;

        expect(saved.overrides.map(o => o.value)).toEqual([
            { $type: "GameObjectRef", path: [0], scope: 1 },
            { $type: "GameObjectRef", path: [0], scope: 2 },
        ]);
        expect(outer.getChanges(instance)).toEqual(saved);
        expect(outer.getOverrides(instance).filter(o => o.field === "target")).toEqual(saved.overrides);

        for (const o of outer.getChanges(instance).overrides) outer.revertOverride(instance, o);
        expect(instance.getComponent(Aim)!.target).toBe(child(instance, 0));
        expect(child(instance, 1).getComponent(Aim)!.target).toBe(child(instance, 1, 0));
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
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

describe("references to what a revert rebuilds", () => {
    /** A Turret whose root aims at its Barrel and holds the Barrel's Tag. */
    function aimingTurret(): Prefab {
        return prefabOf(() => {
            const root = make("Turret", "turret", make("Barrel", "barrel"));
            root.addComponent(Aim).target = child(root, 0);
            root.addComponent(Part).part = child(root, 0).getComponent(Tag);
            return root;
        }, "guid-turret");
    }

    test("a removed child brought back is what the prefab's references point at again", () => {
        const prefab = aimingTurret();
        const instance = prefab.instantiate();
        child(instance, 0).destroyImmediate();

        prefab.revertOverride(instance, prefab.getChanges(instance).removedChildren![0]);

        const barrel = child(instance, 0);
        expect(instance.getComponent(Aim)!.target).toBe(barrel);
        expect(instance.getComponent(Part)!.part).toBe(barrel.getComponent(Tag));
        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
        expect(saveLinked().roots[0].prefab!.changes).toEqual({ overrides: [] });
    });

    test("so is one removed in a saved scene and brought back after it is opened again", () => {
        const prefab = aimingTurret();
        child(prefab.instantiate(), 0).destroyImmediate();
        const saved = saveLinked();
        clear();
        const [instance] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        expect(instance.getComponent(Aim)!.target).toBeNull();

        prefab.revertOverride(instance, prefab.getChanges(instance).removedChildren![0]);

        expect(instance.getComponent(Aim)!.target).toBe(child(instance, 0));
        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
    });

    test("a reference the scene pointed somewhere else is left where it points", () => {
        const prefab = aimingTurret();
        const player = new GameObject("Player");
        const instance = prefab.instantiate();
        instance.getComponent(Aim)!.target = player;
        child(instance, 0).destroyImmediate();

        prefab.revertOverride(instance, prefab.getChanges(instance).removedChildren![0]);

        expect(instance.getComponent(Aim)!.target).toBe(player);
        expect(instance.getComponent(Part)!.part).toBe(child(instance, 0).getComponent(Tag));
    });

    test("a removed component brought back is what the prefab's references point at again", () => {
        const prefab = aimingTurret();
        const instance = prefab.instantiate();
        const barrel = child(instance, 0);
        barrel.removeComponent(barrel.getComponent(Tag)!);

        prefab.revertOverride(instance, prefab.getChanges(instance).removedComponents![0]);

        expect(instance.getComponent(Part)!.part).toBe(barrel.getComponent(Tag));
        expect(instance.getComponent(Aim)!.target).toBe(barrel);
        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
    });

    test("inside a nested instance, and from the outer prefab into one", () => {
        const inner = aimingTurret();
        const outer = prefabOf(() => {
            const nested = inner.instantiate();
            const root = make("Tank", "tank", make("Hull", "hull"), nested);
            root.addComponent(Aim).target = child(nested, 0);
            return root;
        }, "guid-tank");
        const instance = outer.instantiate();
        child(instance, 1, 0).destroyImmediate();

        outer.revertOverride(instance, outer.getChanges(instance).removedChildren![0]);

        const barrel = child(instance, 1, 0);
        expect(child(instance, 1).getComponent(Aim)!.target).toBe(barrel);
        expect(instance.getComponent(Aim)!.target).toBe(barrel);
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
    });

    test("a nested instance rebuilt by revert is what the outer prefab's references point at", () => {
        const inner = aimingTurret();
        const outer = prefabOf(() => {
            const nested = inner.instantiate();
            const root = make("Tank", "tank", make("Hull", "hull"), nested);
            root.addComponent(Aim).target = child(nested, 0);
            return root;
        }, "guid-tank");
        const instance = outer.instantiate();
        child(instance, 1, 0).getComponent(Tag)!.label = "mine";

        const fresh = inner.revert(child(instance, 1));

        expect(instance.getComponent(Aim)!.target).toBe(child(fresh, 0));
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
    });
});

describe("changes inside a nested prefab instance", () => {
    /** A Tank whose Turret's Barrel the Tank prefab itself relabels. */
    function tankWithOverride(): { inner: Prefab; outer: Prefab } {
        const inner = turret();
        const outer = prefabOf(() => {
            const nested = inner.instantiate();
            child(nested, 0).getComponent(Tag)!.label = "outer default";
            return make("Tank", "tank", make("Hull", "hull"), nested);
        }, "guid-tank");
        return { inner, outer };
    }

    test("a change inside a nested instance is recorded field by field", () => {
        const { outer } = tankWithOverride();
        const instance = outer.instantiate();
        const nested = child(instance, 1);
        child(nested, 0).getComponent(Tag)!.count = 5;

        const changes = outer.getChanges(instance);

        expect(changes.overrides).toEqual([{
            path: [1, 0],
            node: `${nested.prefabNodeId}/${child(nested, 0).prefabNodeId}`,
            component: "EditingSpec.Tag",
            componentIndex: 0,
            field: "count",
            value: 5,
        }]);
        expect(JSON.stringify(saveLinked())).not.toContain('"field":"prefab"');
    });

    test("an edit to the outer prefab's nested override reaches an instance that changed another field of it", () => {
        const { outer } = tankWithOverride();
        const instance = outer.instantiate();
        child(instance, 1, 0).getComponent(Tag)!.count = 5;
        const saved = saveLinked();
        clear();

        // The Tank prefab changes what it sets on its Turret's Barrel.
        const link = outer._resolvedTree().children[1].prefab!;
        link.changes!.overrides.find(o => o.field === "label")!.value = "outer edited";
        const [back] = SceneSerializer.deserializeScene(saved);

        const tag = child(back, 1, 0).getComponent(Tag)!;
        expect(tag.label).toBe("outer edited");
        expect(tag.count).toBe(5);
    });

    test("a whole-link override from an earlier file is still read", () => {
        const { inner, outer } = tankWithOverride();
        const turretId = outer._resolvedTree().children[1].id!;
        const barrelId = inner._resolvedTree().children[0].id!;
        const pose = {
            position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        };

        const [back] = SceneSerializer.deserializeScene({
            name: SceneManager.activeScene.name, version: 2, roots: [{
                name: "Tank", active: true, transform: pose, components: [], children: [],
                prefab: { guid: "guid-tank", changes: { overrides: [{
                    path: [1], node: turretId, component: null, componentIndex: 0, field: "prefab",
                    value: { guid: "guid-turret", changes: { overrides: [{
                        path: [0], node: barrelId, component: "EditingSpec.Tag", componentIndex: 0,
                        field: "label", value: "whole link",
                    }] } },
                }] } },
            }],
        });

        expect(child(back, 1, 0).getComponent(Tag)!.label).toBe("whole link");
    });

    test("a change inside a nested instance stays one field while the nested prefab is not loaded", () => {
        const { inner, outer } = tankWithOverride();
        const instance = outer.instantiate();
        child(instance, 1, 0).getComponent(Tag)!.count = 5;
        const saved = saveLinked();
        AssetDatabase._unbind(inner);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        clear();
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        const again = saveLinked();
        warn.mockRestore();

        // Saved back as it was read: not frozen into the nested instance's whole link.
        expect(again).toEqual(saved);
        AssetDatabase._bindGuid("guid-turret", inner);
        clear();
        const [back] = SceneSerializer.deserializeScene(again);
        expect(child(back, 1, 0).getComponent(Tag)!.label).toBe("outer default");
        expect(child(back, 1, 0).getComponent(Tag)!.count).toBe(5);
    });

    test("a change inside a nested instance that no longer applies stays one field, and applies again", () => {
        const { inner } = tankWithOverride();
        const instance = (AssetDatabase.get("guid-tank") as Prefab).instantiate();
        child(instance, 1, 0).getComponent(Tag)!.count = 5;
        const saved = saveLinked();
        editPrefab("guid-turret", root => { root.children = []; });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        clear();
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        const again = saveLinked();
        warn.mockRestore();

        expect(again.roots[0].prefab!.changes).toEqual(saved.roots[0].prefab!.changes);
        AssetDatabase._bindGuid("guid-turret", inner);
        clear();
        const [back] = SceneSerializer.deserializeScene(again);
        expect(child(back, 1, 0).getComponent(Tag)!.count).toBe(5);
    });

    test("a change inside a nested instance is reverted in place", () => {
        const { outer } = tankWithOverride();
        const instance = outer.instantiate();
        const barrel = child(instance, 1, 0);
        const tag = barrel.getComponent(Tag)!;
        tag.label = "mine";
        tag.count = 3;

        const label = outer.getChanges(instance).overrides.find(o => o.field === "label")!;
        outer.revertOverride(instance, label);

        expect(child(instance, 1, 0)).toBe(barrel);
        // Back to what the Tank prefab sets, not to the Turret prefab's own.
        expect(tag.label).toBe("outer default");
        expect(tag.count).toBe(3);
        expect(outer.getChanges(instance).overrides.map(o => o.field)).toEqual(["count"]);
    });
});

describe("a nested instance, edited through its own prefab", () => {
    /**
     * A Turret whose root aims at its Barrel, inside a Tank prefab that
     * relabels the Barrel and aims the Turret at its own Hull instead.
     */
    function tankAimingTurret(): { inner: Prefab; outer: Prefab } {
        const inner = prefabOf(() => {
            const root = make("Turret", "turret", make("Barrel", "barrel"));
            root.addComponent(Aim).target = child(root, 0);
            return root;
        }, "guid-turret");
        const outer = prefabOf(() => {
            const hull = make("Hull", "hull");
            const nested = inner.instantiate();
            child(nested, 0).getComponent(Tag)!.label = "outer default";
            nested.getComponent(Aim)!.target = hull;
            return make("Tank", "tank", hull, nested);
        }, "guid-tank");
        return { inner, outer };
    }

    test("its changes are what the scene changed, not what the outer prefab sets on it", () => {
        const { inner, outer } = tankAimingTurret();
        const instance = outer.instantiate();
        const nested = child(instance, 1);

        expect(inner.getChanges(nested)).toEqual({ overrides: [] });
        expect(inner.getOverrides(nested)).toEqual([]);

        child(nested, 0).getComponent(Tag)!.count = 5;
        nested.transform.localPosition = new Vector3(0, 2, 0);

        expect(inner.getChanges(nested).overrides.map(o => `${o.field}=${JSON.stringify(o.value)}`).sort())
            .toEqual(["count=5", 'transform.position={"x":0,"y":2,"z":0}']);
    });

    test("applying it to its own prefab applies what the scene changed and nothing the outer prefab set", () => {
        const { inner, outer } = tankAimingTurret();
        const player = new GameObject("Player");
        const instance = outer.instantiate();
        const nested = child(instance, 1);
        child(nested, 0).getComponent(Tag)!.count = 5;
        // A reference out of the instance has nothing to point at in a prefab.
        nested.getComponent(Aim)!.target = player;

        inner.applyInstance(nested);

        const fresh = inner.instantiate();
        expect(child(fresh, 0).getComponent(Tag)!.label).toBe("barrel");
        expect(child(fresh, 0).getComponent(Tag)!.count).toBe(5);
        expect(fresh.getComponent(Aim)!.target).toBe(child(fresh, 0));
        // What the instance it came from has of its own is now only that reference.
        expect(inner.getChanges(nested).overrides.map(o => o.field)).toEqual(["target"]);
    });

    test("reverting it keeps what the outer prefab sets on it, in its place", () => {
        const { inner, outer } = tankAimingTurret();
        const instance = outer.instantiate();
        const nested = child(instance, 1);
        child(nested, 0).getComponent(Tag)!.count = 5;
        child(nested, 0).getComponent(Tag)!.label = "mine";
        nested.transform.localPosition = new Vector3(0, 2, 0);
        const id = nested.prefabNodeId;

        const fresh = inner.revert(nested);

        expect(nested.exists()).toBe(false);
        expect(child(instance, 1)).toBe(fresh);
        expect(fresh.prefabNodeId).toBe(id);
        expect(fresh.prefabSource).toBe(inner);
        expect(fresh.transform.localPosition.y).toBeCloseTo(0);
        expect(child(fresh, 0).getComponent(Tag)!.label).toBe("outer default");
        expect(child(fresh, 0).getComponent(Tag)!.count).toBe(0);
        expect(fresh.getComponent(Aim)!.target).toBe(child(instance, 0));
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
    });

    test("reverting one of its changes goes back to what the outer prefab sets", () => {
        const { inner, outer } = tankAimingTurret();
        const instance = outer.instantiate();
        const nested = child(instance, 1);
        const tag = child(nested, 0).getComponent(Tag)!;
        tag.label = "mine";

        const label = inner.getChanges(nested).overrides.find(o => o.field === "label")!;
        inner.revertOverride(nested, label);

        expect(tag.label).toBe("outer default");
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
    });
});

describe("an outer prefab made while its nested prefab was not loaded", () => {
    /**
     * A Tank made from an object holding a Turret instance read while the
     * Turret prefab was not loaded, so the Tank keeps the Turret in full.
     */
    function tankHoldingTurretInFull(): { inner: Prefab; outer: Prefab } {
        const inner = turret();
        const read = SceneSerializer.serializeGameObject(inner.instantiate());
        clear();
        AssetDatabase._unbind(inner);
        const loose = SceneSerializer.deserializeGameObject(read);
        child(loose, 0).getComponent(Tag)!.label = "outer default";
        const outer = prefabOf(() => make("Tank", "tank", make("Hull", "hull"), loose), "guid-tank");
        AssetDatabase._bindGuid("guid-turret", inner);
        return { inner, outer };
    }

    test("it holds the nested instance in full", () => {
        const { outer } = tankHoldingTurretInFull();
        const held = outer._resolvedTree().children[1];
        expect(held.prefab).toEqual({ guid: "guid-turret" });
        expect(held.children.map(c => c.name)).toEqual(["Barrel"]);
    });

    test("an untouched instance has no changes once the nested prefab is loaded", () => {
        const { inner, outer } = tankHoldingTurretInFull();
        const instance = outer.instantiate();

        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
        expect(outer.getOverrides(instance)).toEqual([]);
        expect(inner.getChanges(child(instance, 1))).toEqual({ overrides: [] });
        expect(saveLinked().roots[0].prefab!.changes).toEqual({ overrides: [] });
    });

    test("a change inside the nested instance is one field, and survives a link round trip", () => {
        const { outer } = tankHoldingTurretInFull();
        const instance = outer.instantiate();
        child(instance, 1, 0).getComponent(Tag)!.count = 4;
        new GameObject("Scope").transform.setParent(child(instance, 1, 0).transform, false);

        const changes = outer.getChanges(instance);
        expect(changes.overrides.map(o => o.field)).toEqual(["count"]);
        expect(changes.overrides[0].node).toMatch(/\//);
        expect(changes.addedChildren?.map(a => a.node.name)).toEqual(["Scope"]);

        const saved = saveLinked();
        clear();
        const [back] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        const barrel = child(back, 1, 0);
        expect(barrel.getComponent(Tag)!.label).toBe("outer default");
        expect(barrel.getComponent(Tag)!.count).toBe(4);
        expect(child(barrel, 0).name).toBe("Scope");
        expect(saveLinked()).toEqual(saved);
    });

    test("reverting a change inside it goes back to the outer prefab's copy", () => {
        const { outer } = tankHoldingTurretInFull();
        const instance = outer.instantiate();
        const tag = child(instance, 1, 0).getComponent(Tag)!;
        tag.label = "mine";

        outer.revertOverride(instance, outer.getChanges(instance).overrides[0]);

        expect(tag.label).toBe("outer default");
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });
    });
});

describe("a nested instance's root, after its own prefab changes", () => {
    test("an untouched instance has no changes after the nested prefab's root is rescaled or hidden", () => {
        const outer = tank(turret());
        const saved = (outer.instantiate(), saveLinked());
        editPrefab("guid-turret", root => {
            root.transform.scale = { x: 2, y: 2, z: 2 };
            root.active = false;
        });

        const fresh = outer.instantiate();
        expect(child(fresh, 1).transform.localScale.x).toBeCloseTo(2);
        expect(child(fresh, 1).activeSelf).toBe(false);
        expect(outer.getChanges(fresh)).toEqual({ overrides: [] });
        expect(outer.getOverrides(fresh)).toEqual([]);

        clear();
        const [back] = SceneSerializer.deserializeScene(saved);
        expect(child(back, 1).transform.localScale.x).toBeCloseTo(2);
        expect(saveLinked().roots[0].prefab!.changes).toEqual({ overrides: [] });
    });

    test("a nested root's own scale is recorded inside it, and reverting it takes the nested prefab's", () => {
        const outer = tank(turret());
        const instance = outer.instantiate();
        editPrefab("guid-turret", root => { root.transform.scale = { x: 2, y: 2, z: 2 }; });
        const nested = child(instance, 1);
        nested.transform.localScale = new Vector3(3, 3, 3);

        const scale = outer.getChanges(instance).overrides;
        expect(scale.map(o => [o.node, o.field])).toEqual([
            [`${nested.prefabNodeId}/${(AssetDatabase.get("guid-turret") as Prefab)._resolvedTree().id}`, "transform.scale"],
        ]);
        outer.revertOverride(instance, scale[0]);

        expect(child(instance, 1)).toBe(nested);
        expect(nested.transform.localScale.x).toBeCloseTo(2);
        expect(outer.getChanges(instance)).toEqual({ overrides: [] });

        // Addressed to the nested root as a node of the Tank, as a caller may
        // still hold it: the value comes from the Turret prefab, not from the
        // Tank's stale shell of it.
        nested.transform.localScale = new Vector3(3, 3, 3);
        outer.revertOverride(instance, {
            path: [1], node: nested.prefabNodeId!, component: null, componentIndex: 0,
            field: "transform.scale", value: { x: 3, y: 3, z: 3 },
        });
        expect(nested.transform.localScale.x).toBeCloseTo(2);
    });
});

describe("what the outer prefab added to a nested instance", () => {
    /**
     * A Tank whose own prefab gives its nested Turret a child, Scope, and a
     * second Tag. Neither is the Turret prefab's: both live in the Tank
     * prefab's link to it.
     */
    function tankAddingToTurret(): Prefab {
        const inner = turret();
        return prefabOf(() => {
            const nested = inner.instantiate();
            make("Scope", "scope").transform.setParent(nested.transform, false);
            nested.addComponent(Tag).label = "added by tank";
            return make("Tank", "tank", make("Hull", "hull"), nested);
        }, "guid-tank");
    }

    /** Saves the scene with its instances as links and loads it back. */
    function roundTrip(): GameObject {
        const saved = saveLinked();
        clear();
        return SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)))[0];
    }

    test("removing a child it added stays removed through a link round trip", () => {
        const instance = tankAddingToTurret().instantiate();
        child(instance, 1, 1).destroyImmediate();

        const back = roundTrip();

        expect(child(back, 1).transform.childCount).toBe(1);
        expect(child(back, 1, 0).name).toBe("Barrel");
    });

    test("an edit to a component it added survives a link round trip", () => {
        const instance = tankAddingToTurret().instantiate();
        child(instance, 1).getComponents(Tag)[1].label = "edited";

        const back = roundTrip();

        expect(child(back, 1).getComponents(Tag).map(t => t.label)).toEqual(["turret", "edited"]);
    });

    test("an edit inside a child it added survives, and is not reported as addressing nothing", () => {
        const instance = tankAddingToTurret().instantiate();
        child(instance, 1, 1).getComponent(Tag)!.label = "edited";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const back = roundTrip();

        expect(child(back, 1, 1).getComponent(Tag)!.label).toBe("edited");
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test("removing a component it added stays removed through a link round trip", () => {
        const instance = tankAddingToTurret().instantiate();
        const nested = child(instance, 1);
        nested.removeComponent(nested.getComponents(Tag)[1] as never);

        const back = roundTrip();

        expect(child(back, 1).getComponents(Tag).map(t => t.label)).toEqual(["turret"]);
    });

    test("a variant made from such changes keeps them", () => {
        const outer = tankAddingToTurret();
        const instance = outer.instantiate();
        child(instance, 1, 1).getComponent(Tag)!.label = "variant";
        child(instance, 1).getComponents(Tag)[1].count = 4;

        const variant = Prefab.createVariant(outer, outer.getChanges(instance)).instantiate();

        expect(child(variant, 1, 1).getComponent(Tag)!.label).toBe("variant");
        expect(child(variant, 1).getComponents(Tag)[1].count).toBe(4);
    });

    test("two prefabs that change something inside each other are rebuilt without recursing forever", () => {
        const pose = {
            position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        };
        const tag = (label: string) => ({ type: "EditingSpec.Tag", fields: { label, count: 0 } });
        const node = (name: string, extra: Partial<SerializedGameObject>): SerializedGameObject => ({
            name, active: true, transform: pose, components: [], children: [], ...extra,
        });
        const relabel = (node: string, value: string) => ({
            path: [1, 0], node, component: "EditingSpec.Tag", componentIndex: 0, field: "label", value,
        });
        // A holds B, B holds A, and each relabels something inside the other.
        AssetDatabase._bindGuid("guid-a", Prefab.fromJSON({ name: "A", snapshot: node("A", {
            id: "a-root",
            children: [
                node("X", { id: "a-x", components: [tag("x")] }),
                node("B", { id: "a-b", prefab: { guid: "guid-b", changes: { overrides: [relabel("b-a/a-x", "from A")] } } }),
            ],
        }) }));
        AssetDatabase._bindGuid("guid-b", Prefab.fromJSON({ name: "B", snapshot: node("B", {
            id: "b-root",
            children: [
                node("Y", { id: "b-y", components: [tag("y")] }),
                node("A", { id: "b-a", prefab: { guid: "guid-a", changes: { overrides: [relabel("a-b/b-y", "from B")] } } }),
            ],
        }) }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const a = (AssetDatabase.get("guid-a") as Prefab).instantiate();

        expect(child(a, 1, 0).getComponent(Tag)!.label).toBe("y");
        expect(child(a, 1, 1).isPrefabAssetMissing).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("contains itself"));
        warn.mockRestore();
    });
});
