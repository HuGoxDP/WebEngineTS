import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import type { Component } from "../src/engine/core/Component";
import { Behaviour } from "../src/engine/core/Behaviour";
import { EngineObject } from "../src/engine/core/EngineObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import {
    SceneSerializer, type SerializedGameObject,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { PrefabDiff } from "../src/engine/core/serialization/PrefabOverride";

/**
 * Component ids (A5, decision Q2): a component inside a prefab tree, a
 * link-mode instance interior or a prefab file is addressed by its own id,
 * minted like a node id, so that removing the first of two same-type
 * components no longer moves every override and reference aimed at the second.
 *
 * Phase 1 pins the contract the writers (Phase 2), the readers (Phase 3) and
 * the diff (Phase 4) build on: the live field, the minting passes, the legacy
 * id format and the copy rule — with nothing written anywhere yet, so a plain
 * scene saves byte for byte as it did before.
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
    clear();
});

@Serializable({ typeName: "ComponentIdsSpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

@Serializable({ typeName: "ComponentIdsSpec.Aim" })
class Aim extends Behaviour {
    @SerializedField({ type: FieldType.GameObject })
    public target: GameObject | null = null;
}

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
});

const node = (name: string, components: SerializedGameObject["components"], id?: string): SerializedGameObject => ({
    name, active: true, transform: pose(), components, children: [], ...(id !== undefined ? { id } : {}),
});

/** Every component of `go` and its whole subtree, except Transform. */
const componentsOf = (go: GameObject): Component[] => {
    const out: Component[] = [...go.getAllComponents()];
    for (let i = 0; i < go.transform.childCount; i++) {
        out.push(...componentsOf(go.transform.getChild(i).gameObject));
    }
    return out;
};

describe("component ids on their own — data, minting, derivation, copies", () => {
    test("a prefab made from a live tree gives every component of every id'd node a live id", () => {
        const root = new GameObject("Root");
        root.addComponent(Tag);
        const child = new GameObject("Child");
        child.transform.setParent(root.transform, false);
        child.addComponent(Tag);
        child.addComponent(Aim);

        Prefab.fromGameObject(root, undefined, { connect: true });

        // The root is the whole prefab, not one of its nodes: it has no node
        // id, and its components have no id either.
        expect(root.prefabNodeId).toBeNull();
        expect(root.getComponent(Tag)!._prefabComponentId).toBeNull();

        expect(child.prefabNodeId).not.toBeNull();
        const ids = [child.getComponent(Tag)!._prefabComponentId, child.getComponent(Aim)!._prefabComponentId];
        expect(ids[0]).not.toBeNull();
        expect(ids[1]).not.toBeNull();
        expect(new Set(ids).size).toBe(2);
        expect(ids[0]).not.toMatch(/^~/);
    });

    test("ids are minted once: a second pass leaves the ones it minted", () => {
        const root = new GameObject("Root");
        const child = new GameObject("Child");
        child.transform.setParent(root.transform, false);
        child.addComponent(Tag);

        Prefab.fromGameObject(root, undefined, { connect: true });
        const first = child.getComponent(Tag)!._prefabComponentId;
        Prefab.fromGameObject(root, undefined, { connect: true });
        expect(child.getComponent(Tag)!._prefabComponentId).toBe(first);
    });

    test("legacy ids are derived per type, deterministically, after the fold", () => {
        const tree = node("n", [
            { type: "ComponentIdsSpec.Tag", fields: { label: "a" } },
            { type: "ComponentIdsSpec.Tag", fields: { label: "b" } },
            { type: "ComponentIdsSpec.Aim", fields: {} },
        ], "n1");

        PrefabDiff._ensureComponentIds(tree, true);
        expect(tree.components.map(c => c.id)).toEqual([
            "~c:n1:ComponentIdsSpec.Tag:0",
            "~c:n1:ComponentIdsSpec.Tag:1",
            "~c:n1:ComponentIdsSpec.Aim:0",
        ]);

        const twin = JSON.parse(JSON.stringify(tree)) as SerializedGameObject;
        for (const c of twin.components) delete c.id;
        PrefabDiff._ensureComponentIds(twin, true);
        expect(JSON.stringify(twin)).toBe(JSON.stringify(tree));

        // A doubled single-copy component is folded before ids are derived,
        // so the fold leaves no id behind that nothing can address any more.
        const panel = new GameObject("Panel");
        panel.addComponent(RectTransform);
        const doubled = SceneSerializer.serializeGameObject(panel);
        doubled.components.push({ type: "RectTransform", fields: { ...doubled.components[0].fields } });
        doubled.id = "n1";
        SceneSerializer._foldSingleCopies(doubled, "test");
        PrefabDiff._ensureComponentIds(doubled, true);
        expect(doubled.components).toHaveLength(1);
        expect(doubled.components[0].id).toBe("~c:n1:RectTransform:0");
    });

    test("a node without an id gives its components none", () => {
        const tree = node("n", [{ type: "ComponentIdsSpec.Tag", fields: {} }]);
        PrefabDiff._ensureComponentIds(tree, true);
        expect(tree.components[0].id).toBeUndefined();
    });

    test("a copy of an object inside an instance has null component ids", () => {
        const source = new GameObject("Tank");
        const hull = new GameObject("Hull");
        hull.transform.setParent(source.transform, false);
        const tag = hull.addComponent(Tag);
        Prefab.fromGameObject(source, undefined, { connect: true });
        expect(tag._prefabComponentId).not.toBeNull();

        const copy = EngineObject.Instantiate(hull);
        expect(componentsOf(copy).every(c => c._prefabComponentId === null)).toBe(true);

        const clipboard = SceneSerializer.deserializeGameObject(
            SceneSerializer.serializeGameObject(hull), hull.scene,
        );
        expect(componentsOf(clipboard).every(c => c._prefabComponentId === null)).toBe(true);
    });

    test("unpacking an instance cuts its components' ids with its node ids", () => {
        const source = new GameObject("Tank");
        const hull = new GameObject("Hull");
        hull.transform.setParent(source.transform, false);
        hull.addComponent(Tag);
        const prefab = Prefab.fromGameObject(source, undefined, { connect: true });
        const made = prefab.instantiate();
        const madeHull = made.transform.getChild(0).gameObject;
        const madeTag = madeHull.getComponent(Tag)!;
        // As a load of a link file would have left them: node and component
        // addressed within the prefab, then cut loose together.
        madeHull._prefabNodeId = "k-hull";
        madeTag._prefabComponentId = "c-hull";

        made.unpackPrefab();

        expect(madeHull.prefabNodeId).toBeNull();
        expect(madeTag._prefabComponentId).toBeNull();
    });

    test("a plain scene save carries no component id, and re-saving it changes nothing", () => {
        const root = new GameObject("Root");
        root.addComponent(Tag);
        const child = new GameObject("Child");
        child.transform.setParent(root.transform, false);
        child.addComponent(Aim);

        const first = SceneSerializer.serializeScene(SceneManager.activeScene);
        expect(JSON.stringify(first)).not.toContain('"id":"~c:');
        const noIds = (go: SerializedGameObject): void => {
            for (const c of go.components) expect(c.id).toBeUndefined();
            go.children.forEach(noIds);
        };
        first.roots.forEach(noIds);

        const scene = SceneManager.activeScene;
        clear();
        SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(first)), scene);
        const second = SceneSerializer.serializeScene(scene);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
});
