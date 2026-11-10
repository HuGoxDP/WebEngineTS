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
 * Component ids as they land in files (A5 Phase 2): a component `id` inside
 * prefab trees, link-mode instance interiors and prefab files, and a `cid`
 * on a `ComponentRef` whose target node has an id — always beside the old
 * fields, and never in a file that node ids alone would not already have
 * made version 2. A plain scene gains nothing: byte for byte what it was.
 *
 * The version gate is asserted rather than assumed: whatever carries a
 * component id needs the link reader for node reasons already, so stripping
 * every id changes nothing about what a file asks of its reader.
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

@Serializable({ typeName: "FormatSpec.Tag" })
class Tag extends Behaviour {
    @SerializedField()
    public label: string = "";
}

@Serializable({ typeName: "FormatSpec.Part" })
class Part extends Behaviour {
    @SerializedField({ type: FieldType.Component })
    public part: object | null = null;
}

/** A copy with every component `id` and every `cid` taken out. */
const withoutIds = (json: unknown): unknown => {
    if (Array.isArray(json)) return json.map(withoutIds);
    if (json === null || typeof json !== "object") return json;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if ((key === "id" || key === "cid") && typeof value === "string") continue;
        out[key] = withoutIds(value);
    }
    return out;
};

/** Every component `id` and `cid` a file carries, in order. */
const idsIn = (json: unknown): string[] => {
    if (Array.isArray(json)) return json.flatMap(idsIn);
    if (json === null || typeof json !== "object") return [];
    const found: string[] = [];
    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if ((key === "id" || key === "cid") && typeof value === "string") found.push(value);
        found.push(...idsIn(value));
    }
    return found;
};

const pose = (): SerializedGameObject["transform"] => ({
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
});

describe("component ids in files — writers and the version gate", () => {
    test("a plain scene with component references writes no cid, and stays version 1", () => {
        const target = new GameObject("Target");
        const part = target.addComponent(Part);
        const holder = new GameObject("Holder");
        const linked = holder.addComponent(Part);
        linked.part = part;

        const scene = SceneSerializer.serializeScene(SceneManager.activeScene);

        expect(JSON.stringify(scene)).not.toContain('"cid"');
        expect(idsIn(scene)).toEqual([]);
        expect(scene.version).toBe(1);
        expect(SceneSerializer._needsLinkReader(scene.roots)).toBe(false);
    });

    test("a clipboard object writes no component id either", () => {
        const go = new GameObject("Copied");
        go.addComponent(Tag);

        const json = SceneSerializer.serializeGameObject(go);

        expect(idsIn(json)).toEqual([]);
    });

    test("a linked instance writes component ids only where node ids already are", () => {
        const source = new GameObject("Tank");
        const hull = new GameObject("Hull");
        hull.transform.setParent(source.transform, false);
        hull.addComponent(Tag);
        const tank = Prefab.fromGameObject(source, "Tank");
        AssetDatabase._bindGuid("guid-format-tank", tank);
        const instance = tank.instantiate();
        instance.transform.getChild(0).gameObject.addComponent(Tag).label = "extra";

        const scene = SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });

        const ids = idsIn(scene.roots);
        expect(ids.length).toBeGreaterThan(0);
        // The instance is written as prefab plus changes, so a link reader
        // was needed before any component id appeared.
        expect(scene.version).toBe(2);
        expect(SceneSerializer._needsLinkReader(scene.roots)).toBe(true);
        // Stripping the ids asks nothing different of the reader.
        expect(SceneSerializer._needsLinkReader(withoutIds(scene.roots)))
            .toBe(SceneSerializer._needsLinkReader(scene.roots));
    });

    test("a prefab file carries its components' ids, gate unchanged", () => {
        const source = new GameObject("Tank");
        const hull = new GameObject("Hull");
        hull.transform.setParent(source.transform, false);
        hull.addComponent(Tag);

        const file = Prefab.fromGameObject(source, "Tank").toJSON();

        expect("snapshot" in file).toBe(true);
        const snapshot = (file as { snapshot: SerializedGameObject }).snapshot;
        expect(idsIn(snapshot).length).toBeGreaterThan(0);
        expect(SceneSerializer._needsLinkReader(snapshot))
            .toBe(SceneSerializer._needsLinkReader(withoutIds(snapshot)));
    });

    test("a variant of a prefab keeps its base's component ids in the added changes", () => {
        const source = new GameObject("Tank");
        const hull = new GameObject("Hull");
        hull.transform.setParent(source.transform, false);
        hull.addComponent(Tag);
        const tank = Prefab.fromGameObject(source, "Tank");
        AssetDatabase._bindGuid("guid-format-base", tank);

        const instance = tank.instantiate();
        instance.transform.getChild(0).gameObject.addComponent(Tag).label = "extra";
        const variant = Prefab.createVariant(tank, tank.getChanges(instance), "Elite");
        const file = variant.toJSON();

        expect(idsIn(file).length).toBeGreaterThan(0);
        expect(SceneSerializer._needsLinkReader(file))
            .toBe(SceneSerializer._needsLinkReader(withoutIds(file)));
    });
});
