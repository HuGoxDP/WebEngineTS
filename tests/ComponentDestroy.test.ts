import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { EngineObject } from "../src/engine/core/EngineObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import { SceneSerializer, type SerializedGameObject } from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * D5 (design/prefab-instances-plan.md §4): a destroyed component used to stay
 * in its object's component list, so the serializer wrote it back and every
 * reference to it, and both came back alive. The component twin of D1.
 */

@Serializable({ typeName: "DestroySpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

@Serializable({ typeName: "DestroySpec.Pick" })
class Pick extends Behaviour {
    @SerializedField({ type: FieldType.Component })
    public picked: object | null = null;
}

/** Records what the object's list looked like at each hook. */
class Watched extends ScriptableBehaviour {
    public readonly log: string[] = [];
    public onDestroyCalls = 0;
    public updates = 0;
    public onUpdate: (() => void) | null = null;

    private listed(): string {
        return this.gameObject.getAllComponents().includes(this) ? "listed" : "unlisted";
    }

    public override onDisable(): void { this.log.push(`onDisable ${this.listed()}`); }
    public override onDestroy(): void { this.log.push(`onDestroy ${this.listed()}`); this.onDestroyCalls++; }
    public override update(): void { this.updates++; this.onUpdate?.(); }
}

const savedComponents = (go: GameObject): SerializedGameObject["components"] =>
    SceneSerializer.serializeGameObject(go).components;

const reload = (go: GameObject): GameObject => {
    const saved = SceneSerializer.serializeGameObject(go);
    go.destroyImmediate();
    return SceneSerializer.deserializeScene({ name: "Main", version: 1, roots: [saved] })[0];
};

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

beforeEach(() => clear());
afterEach(() => AssetDatabase.clear());

describe("a destroyed component leaves its object's component list", () => {
    function twoTags(): { go: GameObject; first: Tag; second: Tag; pick: Pick } {
        const go = new GameObject("Holder");
        const first = go.addComponent(Tag);
        first.label = "first";
        const second = go.addComponent(Tag);
        second.label = "second";
        const pick = go.addComponent(Pick);
        pick.picked = second;
        return { go, first, second, pick };
    }

    test("destroyImmediate removes it from getComponents, the saved scene and the reload", () => {
        const { go, first, second, pick } = twoTags();
        expect(savedComponents(go).filter(c => c.type === "DestroySpec.Tag")).toHaveLength(2);

        second.destroyImmediate();

        expect(second.exists()).toBe(false);
        expect(go.getComponents(Tag)).toEqual([first]);
        expect(go.getAllComponents()).toEqual([first, pick]);
        expect(go.getComponentIndex(second)).toBe(-1);

        const saved = savedComponents(go);
        expect(saved.map(c => c.type)).toEqual(["DestroySpec.Tag", "DestroySpec.Pick"]);
        expect(saved[1].fields["picked"] ?? null).toBeNull();

        const back = reload(go);
        expect(back.getComponents(Tag).map(t => t.label)).toEqual(["first"]);
        expect(back.getComponent(Pick)!.picked).toBeNull();
    });

    test("destroy() keeps it listed until the end of the frame, then it is gone the same way", async () => {
        const { go, first, second, pick } = twoTags();

        second.destroy();

        expect(second.exists()).toBe(true);
        expect(go.getComponents(Tag)).toEqual([first, second]);
        expect(savedComponents(go)).toHaveLength(3);

        await Promise.resolve();

        expect(second.exists()).toBe(false);
        expect(go.getComponents(Tag)).toEqual([first]);
        expect(go.getAllComponents()).toEqual([first, pick]);
        expect(savedComponents(go).map(c => c.type)).toEqual(["DestroySpec.Tag", "DestroySpec.Pick"]);
        expect(reload(go).getComponents(Tag)).toHaveLength(1);
    });

    test("a timed destroy leaves the list when its time is up, not before", () => {
        const { go, first, second } = twoTags();

        second.destroy(1);
        EngineObject._updatePendingDestroys(0.5);
        expect(go.getComponents(Tag)).toEqual([first, second]);

        EngineObject._updatePendingDestroys(0.6);
        expect(second.exists()).toBe(false);
        expect(go.getComponents(Tag)).toEqual([first]);
    });

    test("the survivors keep their order and their indices", () => {
        const go = new GameObject("Holder");
        const [a, b, c] = [go.addComponent(Tag), go.addComponent(Tag), go.addComponent(Tag)];
        a.label = "a"; b.label = "b"; c.label = "c";

        b.destroyImmediate();

        expect(go.getComponents(Tag).map(t => t.label)).toEqual(["a", "c"]);
        expect(go.getComponentIndex(c)).toBe(1);
        const holder = go.addComponent(Pick);
        holder.picked = c;
        const saved = savedComponents(go);
        expect(saved[saved.length - 1].fields["picked"]).toMatchObject({ $type: "ComponentRef", component: "DestroySpec.Tag", index: 1 });
    });

    test("it leaves after onDisable and onDestroy have run, not before", () => {
        const go = new GameObject("go");
        const watched = go.addComponent(Watched);

        watched.destroyImmediate();

        expect(watched.log).toEqual(["onDisable listed", "onDestroy listed"]);
        expect(go.getAllComponents()).toEqual([]);
    });

    test("it leaves exactly once, however it is asked to", async () => {
        const go = new GameObject("go");
        const keep = go.addComponent(Watched);
        const gone = go.addComponent(Watched);

        gone.destroyImmediate();
        gone.destroyImmediate();
        gone.destroy();
        await Promise.resolve();
        expect(go.removeComponent(gone)).toBe(false);

        expect(gone.onDestroyCalls).toBe(1);
        expect(go.getAllComponents()).toEqual([keep]);
    });

    test("removeComponent still returns true once and leaves the list the same way", () => {
        const go = new GameObject("go");
        const watched = go.addComponent(Watched);
        const other = go.addComponent(Tag);

        expect(go.removeComponent(watched)).toBe(true);
        expect(go.removeComponent(watched)).toBe(false);

        expect(watched.log).toEqual(["onDisable listed", "onDestroy listed"]);
        expect(go.getAllComponents()).toEqual([other]);
    });

    test("removeComponent still drops a component whose onDestroy throws", () => {
        class Fragile extends ScriptableBehaviour {
            public override onDestroy(): void { throw new Error("cleanup failed"); }
        }
        const go = new GameObject("go");
        const fragile = go.addComponent(Fragile);
        const error = console.error;
        console.error = () => {};
        try {
            expect(go.removeComponent(fragile)).toBe(true);
        } finally {
            console.error = error;
        }

        expect(go.getAllComponents()).toEqual([]);
    });

    test("destroyImmediate drops a component whose onDestroy throws, and says so to the caller", () => {
        class Fragile extends ScriptableBehaviour {
            public override onDestroy(): void { throw new Error("cleanup failed"); }
        }
        const go = new GameObject("go");
        const fragile = go.addComponent(Fragile);

        expect(() => fragile.destroyImmediate()).toThrow("cleanup failed");

        expect(go.getAllComponents()).toEqual([]);
    });

    test("the Transform is not part of any of this", () => {
        const go = new GameObject("go");
        const tag = go.addComponent(Tag);

        tag.destroyImmediate();

        expect(go.removeComponent(go.transform)).toBe(false);
        expect(go.transform.gameObject).toBe(go);
        expect(go.getAllComponents()).toEqual([]);
        expect(go.transform.exists()).toBe(true);
    });
});

describe("destroying the GameObject", () => {
    test("destroys each of its components once and leaves the list empty", () => {
        const go = new GameObject("go");
        const [a, b, c] = [go.addComponent(Watched), go.addComponent(Watched), go.addComponent(Watched)];

        expect(() => go.destroyImmediate()).not.toThrow();

        for (const component of [a, b, c]) {
            expect(component.onDestroyCalls).toBe(1);
            expect(component.log).toEqual(["onDisable listed", "onDestroy listed"]);
            expect(component.exists()).toBe(false);
        }
        expect(go.getAllComponents()).toEqual([]);
    });

    test("a deferred destroy of the object does the same at the end of the frame", async () => {
        const go = new GameObject("go");
        const [a, b, c] = [go.addComponent(Watched), go.addComponent(Watched), go.addComponent(Watched)];

        go.destroy();
        expect(go.getAllComponents()).toEqual([a, b, c]);
        await Promise.resolve();

        expect([a, b, c].map(w => w.onDestroyCalls)).toEqual([1, 1, 1]);
        expect(go.getAllComponents()).toEqual([]);
    });

    test("its components can still find one another while they are being destroyed", () => {
        const seen: string[] = [];
        class Looker extends ScriptableBehaviour {
            public override onDestroy(): void {
                seen.push(`${this.name}:${this.gameObject.getAllComponents().length}`);
            }
        }
        const go = new GameObject("go");
        go.addComponent(Looker).name = "a";
        go.addComponent(Looker).name = "b";
        go.addComponent(Looker).name = "c";

        go.destroyImmediate();

        // Each leaves after its own callbacks, so the one after it still sees the rest.
        expect(seen).toEqual(["a:3", "b:2", "c:1"]);
    });

    test("a component that destroys a sibling in its own onDestroy destroys it once", () => {
        class Reaper extends ScriptableBehaviour {
            public victim: Watched | null = null;
            public override onDestroy(): void { this.victim?.destroyImmediate(); }
        }
        const go = new GameObject("go");
        const reaper = go.addComponent(Reaper);
        const victim = go.addComponent(Watched);
        const bystander = go.addComponent(Watched);
        reaper.victim = victim;

        go.destroyImmediate();

        expect(victim.onDestroyCalls).toBe(1);
        expect(bystander.onDestroyCalls).toBe(1);
        expect(go.getAllComponents()).toEqual([]);
    });

    test("the same, when only the reaper is destroyed", () => {
        class Reaper extends ScriptableBehaviour {
            public victim: Watched | null = null;
            public override onDestroy(): void { this.victim?.destroyImmediate(); }
        }
        const go = new GameObject("go");
        const before = go.addComponent(Watched);
        const reaper = go.addComponent(Reaper);
        const victim = go.addComponent(Watched);
        const after = go.addComponent(Watched);
        reaper.victim = victim;

        reaper.destroyImmediate();

        expect(victim.onDestroyCalls).toBe(1);
        expect(go.getAllComponents()).toEqual([before, after]);
    });

    test("a component that adds one in its own onDestroy does not stop the rest being destroyed", () => {
        class Breeder extends ScriptableBehaviour {
            public override onDestroy(): void { this.gameObject.addComponent(Tag); }
        }
        const go = new GameObject("go");
        go.addComponent(Breeder);
        const last = go.addComponent(Watched);

        go.destroyImmediate();

        expect(last.onDestroyCalls).toBe(1);
    });
});

describe("destroying a component while the frame is running", () => {
    test("one that destroys itself in update does not make the next sibling skip its update", () => {
        const go = new GameObject("go");
        const first = go.addComponent(Watched);
        const second = go.addComponent(Watched);
        const third = go.addComponent(Watched);
        first.onUpdate = () => first.destroyImmediate();

        go._systemUpdate();

        expect([first.updates, second.updates, third.updates]).toEqual([1, 1, 1]);
        expect(go.getAllComponents()).toEqual([second, third]);

        go._systemUpdate();
        expect([first.updates, second.updates, third.updates]).toEqual([1, 2, 2]);
    });

    test("one that destroys an earlier sibling does not make the next one skip its update", () => {
        const go = new GameObject("go");
        const first = go.addComponent(Watched);
        const second = go.addComponent(Watched);
        const third = go.addComponent(Watched);
        second.onUpdate = () => first.destroyImmediate();

        go._systemUpdate();

        expect([first.updates, second.updates, third.updates]).toEqual([1, 1, 1]);
    });

    test("one that destroys a later sibling means that sibling does not update", () => {
        const go = new GameObject("go");
        const first = go.addComponent(Watched);
        const second = go.addComponent(Watched);
        const third = go.addComponent(Watched);
        first.onUpdate = () => second.destroyImmediate();

        go._systemUpdate();

        expect([first.updates, second.updates, third.updates]).toEqual([1, 0, 1]);
    });

    test("destroying a behaviour takes it out of a registry that holds it", () => {
        class Registered extends ScriptableBehaviour {
            public static readonly live = new Set<Registered>();
            public override onEnable(): void { Registered.live.add(this); }
            public override onDisable(): void { Registered.live.delete(this); }
        }
        const go = new GameObject("go");
        const one = go.addComponent(Registered);
        go.addComponent(Registered);
        expect(Registered.live.size).toBe(2);

        one.destroyImmediate();
        expect([...Registered.live]).toEqual(go.getComponents(Registered));

        go.destroyImmediate();
        expect(Registered.live.size).toBe(0);
    });
});

describe("a destroyed component of a prefab instance", () => {
    function tankPrefab(): Prefab {
        const source = new GameObject("Tank");
        source.addComponent(Tag).label = "tank";
        source.addComponent(Pick);
        const prefab = Prefab.fromGameObject(source);
        source.destroyImmediate();
        AssetDatabase._bindGuid("guid-tank", prefab);
        return prefab;
    }

    test("is reported as removed, and revertOverride brings it back", () => {
        const prefab = tankPrefab();
        const instance = prefab.instantiate();
        const tag = instance.getComponent(Tag)!;
        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });

        tag.destroyImmediate();

        const changes = prefab.getChanges(instance);
        expect(changes.removedComponents).toEqual([
            expect.objectContaining({ component: "DestroySpec.Tag", componentIndex: 0 }),
        ]);

        prefab.revertOverride(instance, changes.removedComponents![0]);

        expect(instance.getComponent(Tag)!.label).toBe("tank");
        expect(instance.getComponent(Tag)).not.toBe(tag);
        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
    });

    test("revertOverride points the fields that held it at the one built again", () => {
        const source = new GameObject("Tank");
        const sourceTag = source.addComponent(Tag);
        source.addComponent(Pick).picked = sourceTag;
        const prefab = Prefab.fromGameObject(source);
        source.destroyImmediate();
        AssetDatabase._bindGuid("guid-tank", prefab);
        const instance = prefab.instantiate();
        const pick = instance.getComponent(Pick)!;
        expect(pick.picked).toBe(instance.getComponent(Tag));

        instance.getComponent(Tag)!.destroyImmediate();
        prefab.revertOverride(instance, prefab.getChanges(instance).removedComponents![0]);

        expect(instance.getComponents(Tag)).toHaveLength(1);
        expect(pick.picked).toBe(instance.getComponent(Tag));
    });

    test("is not written into a linked scene, and does not come back on load", () => {
        const prefab = tankPrefab();
        const instance = prefab.instantiate();
        instance.getComponent(Tag)!.destroyImmediate();

        const saved = SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });
        expect(saved.roots[0].prefab!.changes!.removedComponents).toEqual([
            expect.objectContaining({ component: "DestroySpec.Tag", componentIndex: 0 }),
        ]);

        clear();
        const [back] = SceneSerializer.deserializeScene(saved);
        expect(back.getComponent(Tag)).toBeNull();
        expect(back.getComponent(Pick)).not.toBeNull();
    });
});
