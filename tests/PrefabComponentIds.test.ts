import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import {
    SceneSerializer, type SerializedGameObject,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * The verified misbehaviour A5 exists to end (card Q2): the prefab has two
 * colliders; the instance removes the first; the prefab edits the second —
 * and the instance reads the edit, with the removal still naming the first.
 * Plus the shapes around it: a reorder of what the instance added, two
 * instances of one nested prefab side by side, and a reverted removal.
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

@Serializable({ typeName: "PcIdsSpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

const child = (go: GameObject, ...path: number[]): GameObject =>
    path.reduce((cur, i) => cur.transform.getChild(i).gameObject, go);

const saveLinked = (): { name: string; version: number; roots: unknown[] } =>
    SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" }) as never;

/** A prefab whose Hull holds two Tags: "first", then "second". */
function twoColliders(): Prefab {
    const source = new GameObject("Tank");
    const hull = new GameObject("Hull");
    hull.transform.setParent(source.transform, false);
    hull.addComponent(Tag).label = "first";
    hull.addComponent(Tag).label = "second";
    const prefab = Prefab.fromGameObject(source, "Tank");
    source.destroyImmediate();
    AssetDatabase._bindGuid("guid-pcids", prefab);
    return prefab;
}

describe("prefab instances with component ids", () => {
    test("the removal names the first by id, and a prefab edit of the second reaches the instance", () => {
        const prefab = twoColliders();
        const instance = prefab.instantiate();
        child(instance, 0).removeComponent(child(instance, 0).getComponents(Tag)[0]);

        const first = saveLinked();
        const changes = (first.roots[0] as { prefab: { changes: Record<string, unknown> } })
            .prefab.changes as {
            overrides: Array<Record<string, unknown>>;
            removedComponents?: Array<Record<string, unknown>>;
        };
        // The removal names the prefab's first collider by its id — the one
        // the instance removed — not the one it kept.
        const tree = prefab._resolvedTree();
        expect(changes.overrides).toEqual([]);
        expect(changes.removedComponents).toHaveLength(1);
        expect(changes.removedComponents![0].componentId).toBe(tree.children[0].components[0].id);
        expect(changes.removedComponents![0].componentIndex).toBe(0);

        // The prefab edits its second collider; the instance reads the edit.
        const json = JSON.parse(JSON.stringify(prefab.toJSON())) as { snapshot: SerializedGameObject };
        json.snapshot.children[0].components[1].fields.label = "edited to 9";
        const edited = Prefab.fromJSON(json);
        AssetDatabase._bindGuid("guid-pcids", edited);

        clear();
        const [back] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(first)));
        expect(child(back, 0).getComponents(Tag).map(t => t.label)).toEqual(["edited to 9"]);
    });

    test("two instances of one nested prefab do not cross-match", () => {
        const inner = (() => {
            const source = new GameObject("Turret");
            const barrel = new GameObject("Barrel");
            barrel.transform.setParent(source.transform, false);
            barrel.addComponent(Tag).label = "one";
            barrel.addComponent(Tag).label = "two";
            const prefab = Prefab.fromGameObject(source, "Turret");
            source.destroyImmediate();
            AssetDatabase._bindGuid("guid-pcids-inner", prefab);
            return prefab;
        })();
        const outerSource = new GameObject("Carrier");
        const left = inner.instantiate();
        left.name = "Left";
        left.transform.setParent(outerSource.transform, false);
        const right = inner.instantiate();
        right.name = "Right";
        right.transform.setParent(outerSource.transform, false);
        const outer = Prefab.fromGameObject(outerSource, "Carrier");
        outerSource.destroyImmediate();
        AssetDatabase._bindGuid("guid-pcids-outer", outer);

        const carrier = outer.instantiate();
        const leftBarrel = child(carrier, 0, 0);
        leftBarrel.removeComponent(leftBarrel.getComponents(Tag)[0]);

        const saved = saveLinked();
        clear();
        const [back] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));

        // The Left keeps only "two"; the Right is untouched, both of its Tags.
        expect(child(back, 0, 0).getComponents(Tag).map(t => t.label)).toEqual(["two"]);
        expect(child(back, 1, 0).getComponents(Tag).map(t => t.label)).toEqual(["one", "two"]);
    });

    test("reverting a removal restores the removed component by id, with the prefab's values", () => {
        const prefab = twoColliders();
        const instance = prefab.instantiate();
        const tags = child(instance, 0).getComponents(Tag);
        child(instance, 0).removeComponent(tags[0]);

        const changes = prefab.getChanges(instance);
        expect(changes.removedComponents).toHaveLength(1);
        prefab.revertOverride(instance, changes.removedComponents![0]);

        expect(child(instance, 0).getComponents(Tag).map(t => t.label)).toEqual(["first", "second"]);
    });

    test("components the instance added keep their order through a link round trip", () => {
        const prefab = twoColliders();
        const instance = prefab.instantiate();
        const hull = child(instance, 0);
        hull.addComponent(Tag).label = "added-a";
        hull.addComponent(Tag).label = "added-b";

        const first = saveLinked();
        clear();
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(first)));
        expect(JSON.stringify(saveLinked())).toBe(JSON.stringify(first));
    });
});
