import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import {
    SceneSerializer, type SerializedGameObject,
} from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { PrefabDiff, type PrefabChanges } from "../src/engine/core/serialization/PrefabOverride";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * SER1 Phase 2: a prefab saved before `Behaviour.enabled` was serialized
 * carries no `enabled` key, and an instance built from it now writes
 * `enabled: true`. The diff reads the missing key as its default `true` so an
 * untouched instance of an old prefab grows no spurious override (D-2).
 *
 * DW-2.1 a disabled prefab gives disabled instances; switching one on records
 *        exactly one `enabled` override that survives a link-mode round trip.
 * DW-2.2 an old tree (enabled stripped) gives an instance with no enabled override.
 * DW-2.3 the same old tree with the instance disabled records one enabled:false.
 */

@Serializable({ typeName: "EnabledOverrideSpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
});

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

const saveLinked = () => SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });

/** A root MeshRenderer plus a child Tag — two Behaviour components to strip. */
function lamp(rendererEnabled: boolean): GameObject {
    const go = new GameObject("Lamp");
    go.addComponent(MeshRenderer).enabled = rendererEnabled;
    const bulb = new GameObject("Bulb");
    bulb.transform.setParent(go.transform, false);
    bulb.addComponent(Tag).label = "bulb";
    return go;
}

function prefabOf(build: () => GameObject, guid: string): Prefab {
    const source = build();
    const prefab = Prefab.fromGameObject(source);
    source.destroyImmediate();
    AssetDatabase._bindGuid(guid, prefab);
    return prefab;
}

/**
 * The same prefab as a file written before SER1: `enabled` deleted from every
 * component's fields. Returns how many keys were stripped, so the test proves
 * it really built an old tree rather than asserting against a no-op.
 */
function asOld(prefab: Prefab, guid: string): { prefab: Prefab; stripped: number } {
    const json = prefab.toJSON();
    const snapshot = json.snapshot!;
    let stripped = 0;
    const walk = (node: SerializedGameObject): void => {
        for (const comp of node.components) {
            if ("enabled" in comp.fields) {
                delete comp.fields.enabled;
                stripped++;
            }
        }
        node.children.forEach(walk);
    };
    walk(snapshot);
    const old = Prefab.fromJSON(json);
    AssetDatabase._bindGuid(guid, old);
    return { prefab: old, stripped };
}

beforeEach(() => clear());
afterEach(() => AssetDatabase.clear());

describe("a prefab's disabled component reaches its instances", () => {
    test("DW-2.1: a disabled MeshRenderer prefab gives disabled instances; enabling one records one override that survives a link round trip", () => {
        const prefab = prefabOf(() => lamp(false), "guid-enabled");

        const instance = prefab.instantiate();
        expect(instance.getComponent(MeshRenderer)!.enabled).toBe(false);
        // An untouched instance of a disabled prefab reports nothing.
        expect(prefab.getOverrides(instance)).toEqual([]);

        instance.getComponent(MeshRenderer)!.enabled = true;
        const overrides = prefab.getOverrides(instance);
        expect(overrides).toHaveLength(1);
        expect(overrides[0]).toEqual(expect.objectContaining({
            component: "MeshRenderer", field: "enabled", value: true,
        }));

        const saved = saveLinked();
        const link = saved.roots[0].prefab!;
        expect(link.changes!.overrides).toEqual([
            expect.objectContaining({ component: "MeshRenderer", field: "enabled", value: true }),
        ]);

        clear();
        const [loaded] = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        expect(loaded.getComponent(MeshRenderer)!.enabled).toBe(true);
        // The prefab itself was never edited: a fresh instance is still disabled.
        expect(prefab.instantiate().getComponent(MeshRenderer)!.enabled).toBe(false);
    });
});

describe("an old prefab tree without enabled does not churn the diff", () => {
    test("DW-2.2: an instance of a tree with enabled stripped has no enabled override", () => {
        const fresh = prefabOf(() => lamp(true), "guid-old");
        const { prefab: old, stripped } = asOld(fresh, "guid-old");
        expect(stripped).toBe(2);

        const instance = old.instantiate();
        // The load gave both components the default true without a setter call.
        expect(instance.getComponent(MeshRenderer)!.enabled).toBe(true);
        expect(instance.transform.getChild(0).gameObject.getComponent(Tag)!.enabled).toBe(true);

        const overrides = old.getOverrides(instance);
        expect(overrides.filter(o => o.field === "enabled")).toEqual([]);
        expect(overrides).toEqual([]);
    });

    test("DW-2.3: the same old tree with the instance's renderer disabled records exactly one enabled:false override", () => {
        const fresh = prefabOf(() => lamp(true), "guid-old");
        const { prefab: old } = asOld(fresh, "guid-old");

        const instance = old.instantiate();
        instance.getComponent(MeshRenderer)!.enabled = false;

        const overrides = old.getOverrides(instance);
        expect(overrides).toHaveLength(1);
        expect(overrides[0]).toEqual(expect.objectContaining({
            component: "MeshRenderer", field: "enabled", value: false,
        }));
    });
});

describe("the added-component match reads a missing enabled as its default on both sides", () => {
    const tree = (): SerializedGameObject => ({
        name: "Root",
        active: true,
        transform: pose(),
        id: "n-root",
        components: [{ type: "EnabledOverrideSpec.Tag", fields: { label: "x" } }],
        children: [],
    });

    test("a change saved before SER1 still deduplicates against an old prefab that absorbed it", () => {
        // Both sides lack `enabled`. Normalizing only the prefab side would
        // compare {enabled:true,label} against {label}, fail the key count and
        // insert the component a second time. Both sides read as enabled, so
        // the match holds and nothing is inserted.
        const changes: PrefabChanges = {
            overrides: [],
            addedComponents: [{
                node: "n-root", index: 0,
                component: { type: "EnabledOverrideSpec.Tag", fields: { label: "x" } },
            }],
        };
        const out = PrefabDiff.applyChanges(tree(), changes);
        expect(out.components).toHaveLength(1);
        // The tree's own bytes are untouched — no enabled fabricated into it.
        expect(out.components[0].fields).toEqual({ label: "x" });
    });

    test("a genuinely different added component is inserted with its own bytes, no enabled fabricated", () => {
        const changes: PrefabChanges = {
            overrides: [],
            addedComponents: [{
                node: "n-root", index: 1,
                component: { type: "EnabledOverrideSpec.Tag", fields: { label: "y" } },
            }],
        };
        const out = PrefabDiff.applyChanges(tree(), changes);
        expect(out.components).toHaveLength(2);
        expect(out.components[1].fields).toEqual({ label: "y" });
    });
});
