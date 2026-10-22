import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { EngineObject } from "../src/engine/core/EngineObject";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { SceneSerializer, type SerializedScene } from "../src/engine/core/serialization/SceneSerializer";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { UIText } from "../src/engine/core/ui/UIText";

/**
 * A UI object keeps one RectTransform, the saved one, through a load.
 *
 * `go.addComponent(UIImage)` — the usual way to make a UI object — lists
 * `[UIImage, RectTransform]`, because the graphic's awake adds the rect it
 * needs. A load used to add the UIImage first, let that awake add a fresh
 * RectTransform, and then add the saved one beside it: two rects, the graphic
 * bound to the default one, and the layout the author set gone. Every Canvas UI
 * scene the editor saves has that shape. A load now builds every component of
 * an object before the first of them wakes, so the saved rect is there to be
 * found.
 */

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

beforeEach(clear);
afterEach(() => {
    clear();
    AssetDatabase.clear();
});

/** What the tests give the rect, none of it a default. */
function setLayout(rt: RectTransform): void {
    rt.sizeDelta.set(321, 45);
    rt.anchoredPosition.set(12, -34);
    rt.anchorMin.set(0, 0.25);
    rt.anchorMax.set(1, 0.75);
    rt.pivot.set(0, 0);
    rt.localRotation = 30;
}

const layoutOf = (rt: RectTransform) => ({
    sizeDelta: [rt.sizeDelta.x, rt.sizeDelta.y],
    anchoredPosition: [rt.anchoredPosition.x, rt.anchoredPosition.y],
    anchorMin: [rt.anchorMin.x, rt.anchorMin.y],
    anchorMax: [rt.anchorMax.x, rt.anchorMax.y],
    pivot: [rt.pivot.x, rt.pivot.y],
    rotation: rt.localRotation,
});

const names = (go: GameObject): string[] => go.getAllComponents().map(c => c.constructor.name);

/** The two ways a UI object comes to list its components. */
const ORDERS: ReadonlyArray<[string, (go: GameObject) => RectTransform, string[]]> = [
    ["[UIImage, RectTransform], the rect added by the graphic", go => {
        go.addComponent(UIImage);
        return go.getComponent(RectTransform)!;
    }, ["UIImage", "RectTransform"]],
    ["[RectTransform, UIImage], the rect added first", go => {
        const rt = go.addComponent(RectTransform);
        go.addComponent(UIImage);
        return rt;
    }, ["RectTransform", "UIImage"]],
];

/** The ways a saved object is built again. Each returns the copy. */
const PATHS: ReadonlyArray<[string, (source: GameObject) => GameObject]> = [
    ["SceneSerializer.deserializeScene", source => {
        const saved = SceneSerializer.serializeScene(SceneManager.activeScene);
        source.destroyImmediate();
        return SceneSerializer.deserializeScene(saved)[0];
    }],
    ["Prefab.instantiate", source => {
        const prefab = Prefab.fromGameObject(source);
        source.destroyImmediate();
        AssetDatabase._bindGuid("guid-ui", prefab);
        return prefab.instantiate();
    }],
    ["EngineObject.Instantiate", source => EngineObject.Instantiate(source) as GameObject],
];

describe.each(ORDERS)("a UI object saved as %s", (_label, build, order) => {
    describe.each(PATHS)("and built again by %s", (_path, rebuild) => {
        test("has one RectTransform, and it holds the saved layout", () => {
            const source = new GameObject("Panel");
            const rt = build(source);
            setLayout(rt);
            const saved = layoutOf(rt);

            const copy = rebuild(source);

            expect(copy.getComponents(RectTransform)).toHaveLength(1);
            expect(layoutOf(copy.getComponent(RectTransform)!)).toEqual(saved);
            expect(names(copy)).toEqual(order);
        });

        test("binds the graphic to that rect", () => {
            const source = new GameObject("Panel");
            setLayout(build(source));

            const copy = rebuild(source);

            expect(copy.getComponent(UIImage)!.rectTransform).toBe(copy.getComponent(RectTransform));
        });

        test("keeps more than one graphic on the same rect", () => {
            const source = new GameObject("Panel");
            setLayout(build(source));
            source.addComponent(UIText);

            const copy = rebuild(source);

            expect(copy.getComponents(RectTransform)).toHaveLength(1);
            expect(copy.getComponent(UIText)!.rectTransform).toBe(copy.getComponent(RectTransform));
            expect(copy.getComponent(UIImage)!.rectTransform).toBe(copy.getComponent(RectTransform));
        });
    });
});

describe.each(ORDERS)("an instance of a prefab made from %s", (_label, build) => {
    function instanceOf(): { prefab: Prefab; instance: GameObject; saved: ReturnType<typeof layoutOf> } {
        const source = new GameObject("Panel");
        const rt = build(source);
        setLayout(rt);
        const saved = layoutOf(rt);
        const prefab = Prefab.fromGameObject(source);
        source.destroyImmediate();
        AssetDatabase._bindGuid("guid-ui", prefab);
        return { prefab, instance: prefab.instantiate(), saved };
    }

    test("has no changes when it has just been made", () => {
        const { prefab, instance } = instanceOf();

        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
    });

    test("reports only the graphic when it is removed, and has none again once it is reverted", () => {
        const { prefab, instance, saved } = instanceOf();

        instance.removeComponent(instance.getComponent(UIImage)!);

        const changes = prefab.getChanges(instance);
        expect(changes.addedComponents).toBeUndefined();
        expect(changes.removedComponents).toEqual([
            expect.objectContaining({ component: "UIImage" }),
        ]);

        prefab.revertOverride(instance, changes.removedComponents![0]);

        expect(prefab.getChanges(instance)).toEqual({ overrides: [] });
        expect(instance.getComponents(RectTransform)).toHaveLength(1);
        expect(layoutOf(instance.getComponent(RectTransform)!)).toEqual(saved);
        expect(instance.getComponent(UIImage)!.rectTransform).toBe(instance.getComponent(RectTransform));
    });

    test("is rebuilt from a link with one rect and no changes", () => {
        const { prefab, instance, saved } = instanceOf();
        const link = SceneSerializer.serializeScene(SceneManager.activeScene, { prefabs: "link" });
        instance.destroyImmediate();

        const [back] = SceneSerializer.deserializeScene(link);

        expect(back.getComponents(RectTransform)).toHaveLength(1);
        expect(layoutOf(back.getComponent(RectTransform)!)).toEqual(saved);
        expect(prefab.getChanges(back)).toEqual({ overrides: [] });
    });
});

describe("a scene saved while a load added a second RectTransform", () => {
    const v2 = (x: number, y: number) => ({ $type: "Vector2", x, y });
    const pose = {
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
    };
    const rect = (sizeDelta: [number, number], anchoredPosition: [number, number], pivot: [number, number]) => ({
        type: "RectTransform",
        fields: {
            anchoredPosition: v2(...anchoredPosition),
            sizeDelta: v2(...sizeDelta),
            anchorMin: v2(0.5, 0.5),
            anchorMax: v2(0.5, 0.5),
            pivot: v2(...pivot),
            localRotation: 0,
            localScale: v2(1, 1),
        },
    });

    /** The default rect a load added beside the saved one, then the author's. */
    const addedByLoad = rect([100, 100], [0, 0], [0.5, 0.5]);
    const authors = rect([321, 45], [12, -34], [0, 0]);

    const sceneOf = (components: object[]): SerializedScene => ({
        name: "Old", version: 1,
        roots: [{ name: "Panel", active: true, transform: pose, components, children: [] }],
    }) as unknown as SerializedScene;

    const image = { type: "UIImage", fields: { type: "Simple", fillAmount: 1 } };
    const text = { type: "UIText", fields: { text: "kept" } };

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
    afterEach(() => warn.mockRestore());

    test("loads with one RectTransform, the later saved values winning", () => {
        const [panel] = SceneSerializer.deserializeScene(sceneOf([image, addedByLoad, authors]));

        expect(panel.getComponents(RectTransform)).toHaveLength(1);
        const rt = panel.getComponent(RectTransform)!;
        expect(layoutOf(rt)).toEqual({
            sizeDelta: [321, 45], anchoredPosition: [12, -34],
            anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0, 0], rotation: 0,
        });
        expect(panel.getComponent(UIImage)!.rectTransform).toBe(rt);
    });

    test("folds a rect that was added again on each reload into the first, keeping the order of the rest", () => {
        const [panel] = SceneSerializer.deserializeScene(
            sceneOf([image, addedByLoad, text, addedByLoad, authors]),
        );

        expect(names(panel)).toEqual(["UIImage", "RectTransform", "UIText"]);
        expect(layoutOf(panel.getComponent(RectTransform)!).sizeDelta).toEqual([321, 45]);
        expect(panel.getComponent(UIText)!.text).toBe("kept");
    });

    test("says so, once for the object, naming the type", () => {
        SceneSerializer.deserializeScene(sceneOf([image, addedByLoad, authors]));

        const messages = warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes("RectTransform"));
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("Panel");
    });

    test("writes one RectTransform when it is saved again", () => {
        const [panel] = SceneSerializer.deserializeScene(sceneOf([image, addedByLoad, authors]));

        const again = SceneSerializer.serializeGameObject(panel);

        expect(again.components.map(c => c.type)).toEqual(["UIImage", "RectTransform"]);
    });

    test("a list that has one is read without a warning", () => {
        SceneSerializer.deserializeScene(sceneOf([image, authors]));

        expect(warn).not.toHaveBeenCalled();
    });
});
