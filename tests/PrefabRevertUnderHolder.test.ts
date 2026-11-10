import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * M0.2f: reverting a top-level instance that sits under a parent must build the
 * fresh instance under that parent before the wake pass — the load contract
 * M0.2a gave every load and nested instance — rather than instantiate it as a
 * scene root and move it afterwards. Before the fix a fresh instance under an
 * inactive holder woke as a scene root (`awake` seeing the scene root, then
 * `onEnable`) and was only then moved under the holder, which disabled it
 * (`onDisable`): it woke and immediately un-woke. Unity never wakes a script
 * that ends up under an inactive parent at all. Under an active holder the same
 * build-under makes `awake` see its parent, as every other rebuild does.
 */

const log: string[] = [];

@Serializable({ typeName: "RevertHolder.Src" })
class Src extends ScriptableBehaviour {
    @SerializedField()
    public label: string = "";

    public override awake(): void { log.push(`${this.gameObject.name}.awake@${this.transform.parent?.gameObject.name ?? "root"}`); }
    public override onEnable(): void { log.push(`${this.gameObject.name}.onEnable`); }
    public override onDisable(): void { log.push(`${this.gameObject.name}.onDisable`); }
    public override onDestroy(): void { log.push(`${this.gameObject.name}.onDestroy`); }
}

/** A prefab whose root (and each named child) carries a scripted component. */
function srcPrefab(...childNames: string[]): Prefab {
    const go = new GameObject("Src");
    go.addComponent(Src);
    for (const name of childNames) {
        const child = new GameObject(name);
        child.addComponent(Src);
        child.transform.setParent(go.transform, false);
    }
    const prefab = Prefab.fromGameObject(go);
    go.destroyImmediate();
    return prefab;
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    log.length = 0;
}
beforeEach(clear);
afterEach(() => { clear(); AssetDatabase.clear(); });

describe("revert of an instance under an inactive holder", () => {
    test("the fresh instance never wakes — it waits for the holder to activate", async () => {
        const prefab = srcPrefab();
        const holder = new GameObject("Holder");
        holder.setActive(false);
        const instance = prefab.instantiate();
        instance.transform.setParent(holder.transform, false);
        instance.getComponent(Src)!.label = "tweaked";
        await Promise.resolve();
        log.length = 0;

        const fresh = prefab.revert(instance);
        await Promise.resolve();

        // Only the destroyed instance's onDestroy; the fresh one is built under
        // the inactive holder and its script never awakes there.
        expect(log).toEqual(["Src.onDestroy"]);
        expect(fresh.activeInHierarchy).toBe(false);
        expect(fresh.transform.parent?.gameObject).toBe(holder);
        expect(fresh.isPrefabInstance).toBe(true);
        expect(fresh.getComponent(Src)!.label).toBe("");   // reverted to the prefab
        expect(prefab.getOverrides(fresh)).toEqual([]);

        // It deferred, not lost: activating the holder wakes it under the holder.
        log.length = 0;
        holder.setActive(true);
        await Promise.resolve();
        expect(log).toEqual(["Src.awake@Holder", "Src.onEnable"]);
        expect(fresh.activeInHierarchy).toBe(true);

        log.length = 0;
        holder.setActive(false);
        await Promise.resolve();
        expect(log).toEqual(["Src.onDisable"]);
    });

    test("a whole subtree waits, parents first when it finally wakes", async () => {
        const prefab = srcPrefab("Sub");
        const holder = new GameObject("Holder");
        holder.setActive(false);
        const instance = prefab.instantiate();
        instance.transform.setParent(holder.transform, false);
        await Promise.resolve();
        log.length = 0;

        const fresh = prefab.revert(instance);
        await Promise.resolve();
        // The old subtree is destroyed (parents first); the fresh one does not wake.
        expect(log).toEqual(["Src.onDestroy", "Sub.onDestroy"]);
        expect(fresh.activeInHierarchy).toBe(false);
        expect(fresh.transform.getChild(0).gameObject.activeInHierarchy).toBe(false);

        log.length = 0;
        holder.setActive(true);
        await Promise.resolve();
        expect(log).toEqual(["Src.awake@Holder", "Src.onEnable", "Sub.awake@Src", "Sub.onEnable"]);
    });
});

describe("revert of an instance under an active holder", () => {
    test("the fresh instance is built under the parent, so awake sees it", async () => {
        const prefab = srcPrefab();
        const holder = new GameObject("Holder");
        const instance = prefab.instantiate();
        instance.transform.setParent(holder.transform, false);
        instance.getComponent(Src)!.label = "tweaked";
        await Promise.resolve();
        log.length = 0;

        const fresh = prefab.revert(instance);
        await Promise.resolve();

        // Built under the holder: no root wake-and-move, so awake sees the parent
        // and there is no balancing onDisable.
        expect(log).toEqual(["Src.onDisable", "Src.onDestroy", "Src.awake@Holder", "Src.onEnable"]);
        expect(fresh.activeInHierarchy).toBe(true);
        expect(fresh.transform.parent?.gameObject).toBe(holder);
        expect(fresh.getComponent(Src)!.label).toBe("");
    });

    test("the instance keeps its sibling index under an inactive holder too", async () => {
        const prefab = srcPrefab();
        const holder = new GameObject("Holder");
        holder.setActive(false);
        new GameObject("First").transform.setParent(holder.transform, false);
        const instance = prefab.instantiate();
        instance.transform.setParent(holder.transform, false);
        new GameObject("Last").transform.setParent(holder.transform, false);
        await Promise.resolve();

        const fresh = prefab.revert(instance);

        expect(holder.transform.childCount).toBe(3);
        expect(fresh.transform.getSiblingIndex()).toBe(1);
        expect(fresh.isPrefabInstance).toBe(true);
        expect(prefab.getOverrides(fresh)).toEqual([]);
    });
});
