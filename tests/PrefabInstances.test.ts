import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import {
    SceneSerializer, type SerializedGameObject, type SerializedScene,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";

/**
 * A prefab instance in a scene is the prefab plus its changes (E11,
 * design/prefab-instances-plan.md). Stage 3: an instance written in full keeps
 * its link and its node ids through a save and a load.
 */

@Serializable({ typeName: "PrefabSpec.Aim" })
class Aim extends Behaviour {
    @SerializedField({ type: FieldType.GameObject })
    public target: GameObject | null = null;
}

@Serializable({ typeName: "PrefabSpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

const pose = (x = 0, y = 0, z = 0): SerializedGameObject["transform"] => ({
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
});

/** A node in the shape the writer produces, key order included. */
function node(
    name: string,
    rest: Partial<SerializedGameObject> = {},
): SerializedGameObject {
    const out: SerializedGameObject = {
        name,
        active: rest.active ?? true,
        transform: rest.transform ?? pose(),
        components: rest.components ?? [],
        children: rest.children ?? [],
    };
    if (rest.id !== undefined) out.id = rest.id;
    if (rest.prefab !== undefined) out.prefab = rest.prefab;
    return out;
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

function save(): SerializedScene {
    return SceneSerializer.serializeScene(SceneManager.activeScene);
}

/** Player, and a Tank whose Turret is a prefab of its own, saved in full. */
function expandedScene(): SerializedScene {
    return {
        name: "Main",
        version: 1,
        roots: [
            node("Player", { transform: pose(5, 0, 0) }),
            node("Tank", {
                transform: pose(1, 2, 3),
                components: [{ type: "PrefabSpec.Aim", fields: { target: { $type: "GameObjectRef", path: [1, 1, 0] } } }],
                children: [
                    node("Hull", { id: "k2v0f002" }),
                    node("Turret", {
                        transform: pose(0, 1, 0),
                        children: [node("Barrel", { id: "4xe08002", transform: pose(0, 0, 2) })],
                        id: "0uak7004",
                        prefab: { guid: "guid-turret" },
                    }),
                ],
                prefab: { guid: "guid-tank" },
            }),
        ],
    };
}

beforeEach(() => clear());
afterEach(() => AssetDatabase.clear());

describe("a prefab instance saved in full", () => {
    test("an instance saved in full records its prefab and loads back as an instance", () => {
        const prefab = new Prefab(node("Tank"));
        AssetDatabase._bindGuid("guid-tank", prefab);
        const json = expandedScene();

        const [player, tank] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(json)));

        expect(tank.isPrefabInstance).toBe(true);
        expect(tank.prefabSource).toBe(prefab);
        expect(tank.prefabNodeId).toBeNull();
        expect(player.isPrefabInstance).toBe(false);
        expect(JSON.stringify(save().roots)).toBe(JSON.stringify(json.roots));
    });

    test("node ids survive a save and a load", () => {
        SceneSerializer.deserializeScene(expandedScene());
        const saved = save();
        clear();

        const [, tank] = SceneSerializer.deserializeScene(saved);
        const hull = tank.transform.getChild(0).gameObject;
        const turret = tank.transform.getChild(1).gameObject;
        const barrel = turret.transform.getChild(0).gameObject;

        expect(hull.prefabNodeId).toBe("k2v0f002");
        expect(turret.prefabNodeId).toBe("0uak7004");
        expect(barrel.prefabNodeId).toBe("4xe08002");
        expect(tank.getComponent(Aim)!.target).toBe(barrel);
    });

    test("a nested instance stays an instance through an undo-style round trip", () => {
        SceneSerializer.deserializeScene(expandedScene());
        const before = save();
        clear();
        const [, tank] = SceneSerializer.deserializeScene(before);

        const turret = tank.transform.getChild(1).gameObject;
        expect(turret.isPrefabInstance).toBe(true);
        expect(turret.prefabNodeId).toBe("0uak7004");
        expect(turret.transform.localPosition.y).toBeCloseTo(1);
        expect(save().roots).toEqual(before.roots);
    });

    test("a copy of a node inside an instance carries no ids", () => {
        const [, tank] = SceneSerializer.deserializeScene({
            name: "Main",
            version: 1,
            roots: [
                node("Player"),
                node("Tank", {
                    children: [node("Mount", {
                        id: "m0unt001",
                        children: [node("Turret", {
                            id: "0uak7004",
                            children: [node("Barrel", { id: "4xe08002" })],
                            prefab: { guid: "guid-turret" },
                        })],
                    })],
                    prefab: { guid: "guid-tank" },
                }),
            ],
        });
        const mount = tank.transform.getChild(0).gameObject;

        const copy = SceneSerializer.serializeGameObject(mount);

        // The copy holds all of Turret's namespace and none of Tank's: Mount and
        // the Turret root are Tank's nodes, Barrel is Turret's.
        expect(copy.id).toBeUndefined();
        expect(copy.children[0].id).toBeUndefined();
        expect(copy.children[0].prefab).toEqual({ guid: "guid-turret" });
        expect(copy.children[0].children[0].id).toBe("4xe08002");

        const duplicate = EngineObject.Instantiate(mount) as GameObject;
        const turret = duplicate.transform.getChild(0).gameObject;
        expect(duplicate.prefabNodeId).toBeNull();
        expect(turret.isPrefabInstance).toBe(true);
        expect(turret.prefabNodeId).toBeNull();
        expect(turret.transform.getChild(0).gameObject.prefabNodeId).toBe("4xe08002");
    });

    test("a copy of an instance root keeps its link and its interior ids", () => {
        const prefab = new Prefab(node("Tank"));
        AssetDatabase._bindGuid("guid-tank", prefab);
        const [, tank] = SceneSerializer.deserializeScene(expandedScene());

        const copy = EngineObject.Instantiate(tank) as GameObject;

        expect(copy.isPrefabInstance).toBe(true);
        expect(copy.prefabSource).toBe(prefab);
        expect(copy.prefabNodeId).toBeNull();
        expect(copy.transform.getChild(0).gameObject.prefabNodeId).toBe("k2v0f002");
        const turret = copy.transform.getChild(1).gameObject;
        expect(turret.isPrefabInstance).toBe(true);
        expect(turret.prefabNodeId).toBe("0uak7004");
        // Its own reference followed it, not the original's target.
        expect(copy.getComponent(Aim)!.target).toBe(turret.transform.getChild(0).gameObject);
    });

    test("an instance whose prefab is not loaded still reports its link", () => {
        const [, tank] = SceneSerializer.deserializeScene(expandedScene());

        expect(tank.isPrefabInstance).toBe(true);
        expect(tank.prefabSource).toBeNull();
        expect(SceneSerializer.serializeGameObject(tank).prefab).toEqual({ guid: "guid-tank" });

        // Found once it is.
        const prefab = new Prefab(node("Tank"));
        AssetDatabase._bindGuid("guid-tank", prefab);
        expect(tank.prefabSource).toBe(prefab);
    });

    test("a scene from before prefab links loads and saves unchanged", () => {
        const old = {
            // Loading does not rename the scene it loads into.
            name: SceneManager.activeScene.name,
            version: 1,
            roots: [
                node("Bench", {
                    transform: pose(2, 0, -1),
                    components: [
                        { type: "PrefabSpec.Tag", fields: { label: "bench" } },
                        {
                            type: "MeshRenderer",
                            fields: (() => {
                                const go = new GameObject("probe");
                                go.addComponent(MeshRenderer).sharedMaterial = new StandardMaterial();
                                const fields = SceneSerializer.serializeGameObject(go).components[0].fields;
                                go.destroyImmediate();
                                return { ...fields, sharedMaterial: { $type: "AssetRef", guid: "inline-mat-1" } };
                            })(),
                        },
                    ],
                    children: [node("Lamp", {
                        transform: pose(0, 1.5, 0),
                        components: [{
                            type: "PrefabSpec.Aim",
                            fields: { target: { $type: "GameObjectRef", path: [1] } },
                        }],
                    })],
                }),
                node("Flask", { active: false }),
            ],
            renderSettings: {
                fog: true,
                fogColor: { r: 0.5, g: 0.25, b: 0.75, a: 1 },
                fogMode: 1,
                fogStartDistance: 2,
                fogEndDistance: 40,
                fogDensity: 0.125,
                ambientColor: { r: 0.25, g: 0.25, b: 0.5, a: 1 },
            },
            assets: [(() => {
                const go = new GameObject("probe");
                const mat = new StandardMaterial();
                mat.metallic = 0.5;
                go.addComponent(MeshRenderer).sharedMaterial = mat;
                const entry = SceneSerializer.serializeGameObject(go).assets![0];
                go.destroyImmediate();
                return { ...entry, guid: "inline-mat-1" };
            })()],
        } as SerializedScene;
        const text = JSON.stringify(old);

        SceneSerializer.deserializeScene(JSON.parse(text));
        const saved = save();

        expect(JSON.stringify(saved)).toBe(text);
    });
});

// ---------------------------------------------------------------------------
// Stage 4 — link mode: the prefab plus its changes, with scoped references
// ---------------------------------------------------------------------------

/** Turret: a root and a Barrel that aims at nothing. */
function turretTree(): SerializedGameObject {
    return node("Turret", {
        id: "t-root",
        children: [node("Barrel", {
            id: "t-barrel",
            transform: pose(0, 0, 2),
            components: [{ type: "PrefabSpec.Aim", fields: { target: null } }],
        })],
    });
}

/**
 * Tank: aims at its own Hull, and holds a Turret as a link. Its reference is
 * by node id, as a prefab written today stores it.
 */
function tankTree(): SerializedGameObject {
    return node("Tank", {
        id: "k-root",
        components: [{ type: "PrefabSpec.Aim", fields: { target: { $type: "GameObjectRef", path: [0, "k-hull"] } } }],
        children: [
            node("Hull", {
                id: "k-hull",
                components: [{ type: "PrefabSpec.Tag", fields: { label: "hull" } }],
            }),
            node("Turret", {
                id: "k-turret",
                transform: pose(0, 1, 0),
                prefab: { guid: "guid-turret", changes: { overrides: [] } },
            }),
        ],
    });
}

function bind(guid: string, tree: SerializedGameObject): Prefab {
    const prefab = new Prefab(tree);
    AssetDatabase._bindGuid(guid, prefab);
    return prefab;
}

function linkScene(...roots: SerializedGameObject[]): SerializedScene {
    return { name: SceneManager.activeScene.name, version: 1, roots };
}

const tankLink = (changes: object = { overrides: [] }, rest: Partial<SerializedGameObject> = {}) =>
    node("Tank", { transform: pose(1, 2, 3), ...rest, prefab: { guid: "guid-tank", changes } as never });

const saveLinked = (): SerializedScene =>
    SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });

const child = (go: GameObject, ...path: number[]): GameObject =>
    path.reduce((cur, i) => cur.transform.getChild(i).gameObject, go);

const labels = (go: GameObject): string[] => go.getComponents(Tag).map(t => t.label);

describe("a prefab instance saved as its prefab plus changes", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let tank: Prefab;

    beforeEach(() => {
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        bind("guid-turret", turretTree());
        tank = bind("guid-tank", tankTree());
    });
    afterEach(() => warn.mockRestore());

    /** Every kind of change, in the order the writer produces them. */
    const CHANGES = {
        overrides: [
            { path: [0], node: "k-hull", component: "PrefabSpec.Tag", componentIndex: 0, field: "label", value: "patched" },
        ],
        addedChildren: [
            { parent: "k-root", index: 2, node: node("Flag", {
                components: [{ type: "PrefabSpec.Tag", fields: { label: "flag" } }],
                id: "a-flag",
            }) },
        ],
        addedComponents: [
            { node: "k-hull", index: 1, component: { type: "PrefabSpec.Tag", fields: { label: "extra" } } },
        ],
    };

    test("a linked instance is rebuilt from its prefab plus its changes", () => {
        const [, root] = SceneSerializer.deserializeScene(linkScene(node("Player"), tankLink(CHANGES)));

        expect(root.isPrefabInstance).toBe(true);
        expect(root.prefabSource).toBe(tank);
        expect(root.transform.localPosition.z).toBeCloseTo(3);
        expect([0, 1, 2].map(i => child(root, i).name)).toEqual(["Hull", "Turret", "Flag"]);
        expect(labels(child(root, 0))).toEqual(["patched", "extra"]);
        expect(child(root, 2).prefabNodeId).toBe("a-flag");

        const turret = child(root, 1);
        expect(turret.isPrefabInstance).toBe(true);
        expect(turret.prefabNodeId).toBe("k-turret");
        expect(child(turret, 0).name).toBe("Barrel");
        expect(child(turret, 0).prefabNodeId).toBe("t-barrel");
        expect(root.getComponent(Aim)!.target).toBe(child(root, 0));
    });

    test("saving a rebuilt instance in link mode writes back the same changes", () => {
        const json = linkScene(node("Player"), tankLink(CHANGES));
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(json)));

        expect(JSON.stringify(saveLinked().roots)).toBe(JSON.stringify(json.roots));
    });

    test("an edit to the prefab reaches a linked instance on its next load; its own overrides stay", () => {
        SceneSerializer.deserializeScene(linkScene(tankLink(CHANGES)));
        const saved = saveLinked();
        clear();

        const edited = tankTree();
        edited.children[0].transform = pose(0, -1, 0);
        edited.children[0].components[0].fields["label"] = "renamed in the prefab";
        bind("guid-tank", edited);
        const [root] = SceneSerializer.deserializeScene(saved);

        expect(child(root, 0).transform.localPosition.y).toBeCloseTo(-1);
        expect(labels(child(root, 0))).toEqual(["patched", "extra"]);
    });

    test("a reference inside an instance to its own object resolves inside that instance", () => {
        const [a, b] = SceneSerializer.deserializeScene(linkScene(tankLink(), tankLink()));

        expect(a.getComponent(Aim)!.target).toBe(child(a, 0));
        expect(b.getComponent(Aim)!.target).toBe(child(b, 0));
    });

    test("a reference out of a nested instance counts its scope outward", () => {
        const [player, root] = SceneSerializer.deserializeScene(linkScene(node("Player"), tankLink()));
        child(root, 1, 0).getComponent(Aim)!.target = player;

        const saved = saveLinked();
        // Addressed through the nesting: the Turret in the Tank, then its Barrel.
        const barrel = saved.roots[1].prefab!.changes!.overrides.find(o => o.node === "k-turret/t-barrel")!;
        expect(barrel.field).toBe("target");
        expect(barrel.value).toEqual({ $type: "GameObjectRef", path: [0], scope: 2 });

        clear();
        const [player2, root2] = SceneSerializer.deserializeScene(saved);
        expect(child(root2, 1, 0).getComponent(Aim)!.target).toBe(player2);
    });

    test("a reference from outside into a nested instance finds it", () => {
        const [player, root] = SceneSerializer.deserializeScene(linkScene(node("Player"), tankLink()));
        player.addComponent(Aim).target = child(root, 1, 0);

        const saved = saveLinked();
        clear();
        const [player2, root2] = SceneSerializer.deserializeScene(saved);

        expect(player2.getComponent(Aim)!.target).toBe(child(root2, 1, 0));
    });

    test("a link inside an expanded instance counts its scope past it", () => {
        const [player, root] = SceneSerializer.deserializeScene(linkScene(
            node("Player"),
            node("Tank", {
                children: [node("Turret", {
                    id: "k-turret",
                    prefab: { guid: "guid-turret", changes: { overrides: [] } },
                })],
                // A prefab this session does not have: the instance can only be
                // written in full, while the Turret inside it is still a link.
                prefab: { guid: "guid-not-loaded" },
            }),
        ));
        child(root, 0, 0).getComponent(Aim)!.target = player;

        const saved = saveLinked();
        expect(saved.roots[1].prefab).toEqual({ guid: "guid-not-loaded" });
        const turret = saved.roots[1].children[0].prefab!;
        expect(turret.changes!.overrides[0].value).toEqual({ $type: "GameObjectRef", path: [0], scope: 1 });

        clear();
        const [player2, root2] = SceneSerializer.deserializeScene(saved);
        expect(child(root2, 0, 0).getComponent(Aim)!.target).toBe(player2);
    });

    test("a reference scoped deeper than its stack resolves to null", () => {
        const [holder] = SceneSerializer.deserializeScene(linkScene(node("Holder", {
            components: [{ type: "PrefabSpec.Aim", fields: { target: { $type: "GameObjectRef", path: [0], scope: 3 } } }],
        })));

        expect(holder.getComponent(Aim)!.target).toBeNull();
    });

    test("added and removed children and components round-trip through a scene", () => {
        const [root] = SceneSerializer.deserializeScene(linkScene(tankLink()));
        child(root, 0).destroyImmediate();
        root.removeComponent(root.getComponent(Aim)!);
        new GameObject("Flag").transform.setParent(root.transform, false);
        root.addComponent(Tag).label = "tagged";

        const first = saveLinked();
        const changes = first.roots[0].prefab!.changes!;
        expect(changes.removedChildren).toEqual(["k-hull"]);
        expect(changes.removedComponents).toEqual([{ node: "k-root", component: "PrefabSpec.Aim", componentIndex: 0 }]);
        expect(changes.addedChildren!.map(a => a.node.name)).toEqual(["Flag"]);
        expect(changes.addedComponents!.map(a => a.component.fields["label"])).toEqual(["tagged"]);

        clear();
        const [back] = SceneSerializer.deserializeScene(first);
        expect([0, 1].map(i => child(back, i).name)).toEqual(["Turret", "Flag"]);
        expect(back.getComponent(Aim)).toBeNull();
        expect(labels(back)).toEqual(["tagged"]);
        // The added child kept the id it was given, so the file does not churn.
        expect(saveLinked()).toEqual(first);
    });

    test("an instance whose prefab is missing becomes a placeholder and is written back verbatim", () => {
        const json = linkScene(node("Lost", {
            transform: pose(4, 0, 0),
            prefab: { guid: "guid-missing", changes: CHANGES } as never,
        }));

        const [lost] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(json)));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("not loaded"));
        expect(lost.isPrefabInstance).toBe(true);
        expect(lost.prefabSource).toBeNull();
        expect(lost.transform.childCount).toBe(0);
        expect(lost.transform.localPosition.x).toBeCloseTo(4);
        expect(JSON.stringify(saveLinked().roots)).toBe(JSON.stringify(json.roots));
        expect(JSON.stringify(save().roots)).toBe(JSON.stringify(json.roots));
    });

    test("objects added under a placeholder are reported when it is saved", () => {
        const json = linkScene(node("Lost", { prefab: { guid: "guid-missing", changes: { overrides: [] } } }));
        const [lost] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(json)));
        new GameObject("Added").transform.setParent(lost.transform, false);
        warn.mockClear();

        const saved = saveLinked();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("stands in for a prefab"));
        expect(saved.roots).toEqual(json.roots);
    });

    test("a change addressed to a node the prefab no longer has is kept, and applies again when the node returns", () => {
        const changes = {
            overrides: CHANGES.overrides,
            addedChildren: [{ parent: "k-hull", index: 0, node: node("Decal", { id: "a-decal" }) }],
        };
        const withoutHull = tankTree();
        withoutHull.children.splice(0, 1);
        withoutHull.components = [];
        bind("guid-tank", withoutHull);

        const [root] = SceneSerializer.deserializeScene(linkScene(tankLink(changes)));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("no longer has"));
        expect(root.transform.childCount).toBe(1);

        const saved = saveLinked();
        expect(saved.roots[0].prefab!.changes).toEqual({ overrides: [] });
        expect(saved.roots[0].prefab!.unused).toEqual(changes);

        clear();
        bind("guid-tank", tankTree());
        const [back] = SceneSerializer.deserializeScene(saved);
        expect(labels(child(back, 0))).toEqual(["patched"]);
        expect(child(back, 0, 0).name).toBe("Decal");

        const again = saveLinked().roots[0].prefab!;
        expect(again.unused).toBeUndefined();
        expect(again.changes!.overrides).toEqual(changes.overrides);
        expect(again.changes!.addedChildren).toEqual(changes.addedChildren);
    });

    test("a prefab that contains itself becomes a placeholder instead of recursing", () => {
        bind("guid-loop", node("Loop", {
            id: "l-root",
            children: [node("Inner", { id: "l-inner", prefab: { guid: "guid-loop", changes: { overrides: [] } } })],
        }));
        const json = linkScene(node("Loop", { prefab: { guid: "guid-loop", changes: { overrides: [] } } }));

        const [loop] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(json)));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("contains itself"));
        const inner = child(loop, 0);
        expect(inner.isPrefabInstance).toBe(true);
        expect(inner.transform.childCount).toBe(0);
        expect(JSON.stringify(saveLinked().roots)).toBe(JSON.stringify(json.roots));
    });

    test("the shell's name, position and rotation win; scale and active follow the prefab", () => {
        const scaled = (s: number): SerializedGameObject["transform"] => ({
            position: { x: 9, y: 9, z: 9 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: s, y: s, z: s },
        });
        bind("guid-crate", node("Crate", { id: "c-root", transform: scaled(2) }));
        const turned = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
        const shell = (changes: object) => node("Box 1", {
            active: false,
            transform: { position: { x: 1, y: 0, z: 0 }, rotation: turned, scale: { x: 5, y: 5, z: 5 } },
            prefab: { guid: "guid-crate", changes } as never,
        });

        const [plain, overridden] = SceneSerializer.deserializeScene(linkScene(
            shell({ overrides: [] }),
            shell({ overrides: [
                { path: [], node: "c-root", component: null, componentIndex: 0, field: "active", value: false },
                { path: [], node: "c-root", component: null, componentIndex: 0, field: "transform.scale", value: { x: 3, y: 3, z: 3 } },
            ] }),
        ));

        expect(plain.name).toBe("Box 1");
        expect(plain.transform.localPosition.x).toBeCloseTo(1);
        expect(plain.transform.localRotation.y).toBeCloseTo(Math.SQRT1_2);
        expect(plain.transform.localScale.x).toBeCloseTo(2);
        expect(plain.activeSelf).toBe(true);
        expect(overridden.transform.localScale.x).toBeCloseTo(3);
        expect(overridden.activeSelf).toBe(false);

        // Name, position and rotation differ from the prefab, yet are never
        // written as overrides: the shell carries them.
        const fields = (i: number) => saveLinked().roots[i].prefab!.changes!.overrides.map(o => o.field);
        expect(fields(0)).toEqual([]);
        expect(fields(1)).toEqual(["active", "transform.scale"]);
    });

    test("reordering prefab children inside an instance saves that instance in full", () => {
        const [root] = SceneSerializer.deserializeScene(linkScene(tankLink()));
        child(root, 0).transform.setSiblingIndex(1);

        const saved = saveLinked();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("reordered"));
        expect(saved.roots[0].prefab).toEqual({ guid: "guid-tank" });
        expect(saved.roots[0].children.map(c => c.name)).toEqual(["Turret", "Hull"]);

        clear();
        const [back] = SceneSerializer.deserializeScene(saved);
        expect(back.isPrefabInstance).toBe(true);
        expect([0, 1].map(i => child(back, i).name)).toEqual(["Turret", "Hull"]);
        expect(child(back, 0).isPrefabInstance).toBe(true);
    });

    test("a prefab's own inline material is there when a linked instance is rebuilt", () => {
        const source = new GameObject("Crate");
        const mat = new StandardMaterial();
        mat.metallic = 0.3;
        source.addComponent(MeshRenderer).sharedMaterial = mat;
        const tree = SceneSerializer.serializeGameObject(source);
        tree.id = "c-root";
        source.destroyImmediate();
        bind("guid-crate", tree);

        const [crate] = SceneSerializer.deserializeScene(linkScene(
            node("Crate", { prefab: { guid: "guid-crate", changes: { overrides: [] } } }),
        ));

        const back = crate.getComponent(MeshRenderer)!.sharedMaterial as StandardMaterial;
        expect(back).toBeInstanceOf(StandardMaterial);
        expect(back).not.toBe(mat);
        expect(back.metallic).toBeCloseTo(0.3);
        expect(SceneSerializer.pendingAssetGuids).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Stage 7 — what a link-mode file needs: references, version, assets
// ---------------------------------------------------------------------------

describe("what a file with prefab links needs", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        bind("guid-turret", turretTree());
        bind("guid-tank", tankTree());
    });
    afterEach(() => warn.mockRestore());

    test("a scene with a linked instance lists its prefab as something to load first", () => {
        SceneSerializer.deserializeScene(linkScene(node("Player"), tankLink()));

        // The Turret inside it is the Tank prefab's business, not the scene's.
        expect(SceneSerializer.assetReferences(saveLinked())).toEqual(["guid-tank"]);
    });

    test("an expanded instance's prefab is not listed", () => {
        SceneSerializer.deserializeScene(linkScene(node("Player"), tankLink()));

        const saved = save();

        expect(saved.roots[1].prefab).toEqual({ guid: "guid-tank" });
        expect(SceneSerializer.assetReferences(saved)).toEqual([]);
    });

    test("a scene with a link is written as version 2; one without stays version 1", () => {
        SceneSerializer.deserializeScene(linkScene(node("Player"), tankLink()));

        expect(saveLinked().version).toBe(2);
        expect(save().version).toBe(1);

        clear();
        SceneSerializer.deserializeScene(linkScene(node("Player")));
        expect(saveLinked().version).toBe(1);

        // A prefab file follows the same rule.
        expect(Prefab.fromGameObject(new GameObject("Plain")).toJSON()).not.toHaveProperty("version");
        expect(new Prefab(tankTree()).toJSON().version).toBe(2);
    });

    test("a file of a version the engine does not know is refused", () => {
        const future = { ...linkScene(node("Player")), version: 3 } as unknown as SerializedScene;

        expect(() => SceneSerializer.deserializeScene(future)).toThrow(/version 3/);
        expect(() => Prefab.fromJSON({ name: "Future", version: 3, snapshot: node("Future") })).toThrow(/version 3/);
        expect(SceneManager.activeScene.getRootGameObjects()).toHaveLength(0);

        // The two this build writes are both read.
        expect(SceneSerializer.deserializeScene({ ...linkScene(tankLink()), version: 2 })).toHaveLength(1);
    });

    test("a linked instance does not copy its prefab's inline material into the scene", () => {
        const source = new GameObject("Crate");
        const mat = new StandardMaterial();
        mat.metallic = 0.3;
        source.addComponent(MeshRenderer).sharedMaterial = mat;
        const tree = SceneSerializer.serializeGameObject(source);
        tree.id = "c-root";
        source.destroyImmediate();
        bind("guid-crate", tree);
        const [crate, other] = SceneSerializer.deserializeScene(linkScene(
            node("Crate", { prefab: { guid: "guid-crate", changes: { overrides: [] } } }),
            node("Other", { prefab: { guid: "guid-crate", changes: { overrides: [] } } }),
        ));

        const untouched = saveLinked();
        expect(untouched.assets).toBeUndefined();

        // A material the instance was given is its own, and the scene carries it.
        const own = new StandardMaterial();
        own.metallic = 0.9;
        other.getComponent(MeshRenderer)!.sharedMaterial = own;
        const changed = saveLinked();
        expect(changed.assets).toHaveLength(1);
        expect(changed.assets![0].fields["metallic"]).toBeCloseTo(0.9);

        clear();
        AssetDatabase.clearLoaded();
        bind("guid-crate", tree);
        const [crate2, other2] = SceneSerializer.deserializeScene(changed);
        expect((crate2.getComponent(MeshRenderer)!.sharedMaterial as StandardMaterial).metallic).toBeCloseTo(0.3);
        expect((other2.getComponent(MeshRenderer)!.sharedMaterial as StandardMaterial).metallic).toBeCloseTo(0.9);
        expect(crate).not.toBe(crate2);
    });
});
