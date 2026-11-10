import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import {
    SceneSerializer, type SerializedGameObject, type SerializedScene,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * Component ids read back (A5 Phase 3): a reference to the second of two
 * same-type components survives the removal of the first through a link save
 * and a reload; a reference whose cid names a component the file removed
 * reads as null rather than as a neighbour; and an old file's address to a
 * second copy of a one-per-object component lands on the first, as the fold
 * reads it.
 */

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    clear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    AssetDatabase.clear();
    clear();
});

@Serializable({ typeName: "LegacySpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

@Serializable({ typeName: "LegacySpec.Aim" })
class Aim extends Behaviour {
    @SerializedField({ type: FieldType.GameObject })
    public target: GameObject | null = null;
}

@Serializable({ typeName: "LegacySpec.Part" })
class Part extends Behaviour {
    @SerializedField({ type: FieldType.Component })
    public part: object | null = null;
}

const child = (go: GameObject, i: number): GameObject => go.transform.getChild(i).gameObject;

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
});

/** A prefab whose Hull holds two Tags: "first", then "second". */
function twoTags(): Prefab {
    const source = new GameObject("Tank");
    const hull = new GameObject("Hull");
    hull.transform.setParent(source.transform, false);
    hull.addComponent(Tag).label = "first";
    hull.addComponent(Tag).label = "second";
    const prefab = Prefab.fromGameObject(source, "Tank");
    source.destroyImmediate();
    return prefab;
}

describe("component ids read back", () => {
    test("a reference to the second of two same-type components survives removal of the first", () => {
        const tank = twoTags();
        AssetDatabase._bindGuid("guid-legacy-tank", tank);
        const instance = tank.instantiate();
        const tags = child(instance, 0).getComponents(Tag);
        child(instance, 0).removeComponent(tags[0]);
        const holder = new GameObject("Holder");
        holder.addComponent(Part).part = tags[1];

        const saved = SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });
        clear();
        const roots = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));

        const back = roots.find(r => r.name === "Holder")!;
        const held = back.getComponent(Part)!.part as Tag | null;
        expect(held).not.toBeNull();
        expect(held!.label).toBe("second");
        // The first is the one the instance removed; the prefab's own second
        // is what the reference follows.
        expect(roots.find(r => r.name === "Tank")!.transform.getChild(0).gameObject
            .getComponents(Tag).map(t => t.label)).toEqual(["second"]);
    });

    test("a cid that names a component the file removed resolves to null, not to a neighbour", () => {
        // The prefab's Hull holds one Tag; the instance removes it, and another
        // object references it by its id.
        const source = new GameObject("Tank");
        const hull = new GameObject("Hull");
        hull.transform.setParent(source.transform, false);
        hull.addComponent(Tag).label = "gone";
        const prefab = Prefab.fromGameObject(source, "Tank");
        AssetDatabase._bindGuid("guid-legacy-removed", prefab);
        source.destroyImmediate();
        const tree = prefab._resolvedTree();
        const nodeId = tree.children[0].id!;
        const removed = tree.children[0].components[0].id!;

        const json: SerializedScene = {
            name: SceneManager.activeScene.name, version: 2, roots: [
                {
                    name: "Tank", active: true, transform: pose(), components: [], children: [],
                    prefab: {
                        guid: "guid-legacy-removed",
                        changes: {
                            overrides: [],
                            removedComponents: [{
                                node: nodeId, component: "LegacySpec.Tag", componentIndex: 0, componentId: removed,
                            }],
                        },
                    },
                },
                {
                    name: "Holder", active: true, transform: pose(), id: "holder",
                    components: [{
                        type: "LegacySpec.Part",
                        fields: {
                            part: {
                                $type: "ComponentRef", path: [0, 0], component: "LegacySpec.Tag",
                                index: 0, cid: removed,
                            },
                        },
                    }],
                    children: [],
                },
            ],
        };
        const roots = SceneSerializer.deserializeScene(json);

        const tank = roots.find(r => r.name === "Tank")!;
        expect(tank.transform.getChild(0).gameObject.getComponents(Tag)).toHaveLength(0);
        expect(roots.find(r => r.name === "Holder")!.getComponent(Part)!.part).toBeNull();
    });

    test("an old file's reference to a second copy of a one-per-object type lands on the first", () => {
        const panel = new GameObject("Panel");
        panel.addComponent(Tag);
        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        const holder: SerializedGameObject = {
            name: "Holder", active: true, transform: pose(), id: "holder",
            components: [{
                type: "LegacySpec.Part",
                fields: {
                    part: {
                        $type: "ComponentRef", path: [0], component: "Transform", index: 1,
                    },
                },
            }],
            children: [],
        };
        json.roots.push(holder);
        clear();
        const roots = SceneSerializer.deserializeScene(json);

        const part = roots.find(r => r.name === "Holder")!.getComponent(Part)!.part;
        expect(part).toBe(roots.find(r => r.name === "Panel")!.transform as unknown);
    });
});
