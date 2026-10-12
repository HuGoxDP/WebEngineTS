import { describe, test, expect, beforeEach, afterEach } from "vitest";
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
