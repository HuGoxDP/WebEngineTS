import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Transform } from "../src/engine/core/Transform";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { UIImage } from "../src/engine/core/ui/UIImage";

/**
 * A type that allows one per object (Unity's `[DisallowMultipleComponent]`,
 * and the Transforms, which Unity never lets an object hold twice) is held
 * once however it is added.
 *
 * `addComponent` of such a type on an object that already has one adds
 * nothing: it warns and returns the component the object has. Before, it made
 * a second one; every UI component bound to the first, so the second was
 * edited by nobody's layout, and the next load folded it away.
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

const names = (go: GameObject): string[] => go.getAllComponents().map(c => c.constructor.name);

class Counter extends ScriptableBehaviour {
    public awakes = 0;
    public enables = 0;
    public override awake(): void { this.awakes++; }
    public override onEnable(): void { this.enables++; }
}

describe("addComponent of a type that allows one per object", () => {
    test("returns the RectTransform a graphic added, and adds no second one", () => {
        const go = new GameObject("Panel");
        const image = go.addComponent(UIImage);

        const rt = go.addComponent(RectTransform);

        expect(rt).toBe(image.rectTransform);
        expect(names(go)).toEqual(["UIImage", "RectTransform"]);
    });

    test("returns the same RectTransform when it is added twice", () => {
        const go = new GameObject("Panel");
        const first = go.addComponent(RectTransform);

        const second = go.addComponent(RectTransform);

        expect(second).toBe(first);
        expect(go.getComponents(RectTransform)).toHaveLength(1);
    });

    test("leaves what the object already had untouched", () => {
        const go = new GameObject("Panel");
        const rt = go.addComponent(RectTransform);
        rt.sizeDelta.set(321, 45);

        go.addComponent(RectTransform);

        expect([rt.sizeDelta.x, rt.sizeDelta.y]).toEqual([321, 45]);
    });

    test("says so, naming the object and the type", () => {
        const go = new GameObject("Panel");
        go.addComponent(UIImage);

        go.addComponent(RectTransform);

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0][0]);
        expect(message).toContain("Panel");
        expect(message).toContain("RectTransform");
    });

    test("does not warn for the first one", () => {
        const go = new GameObject("Panel");
        go.addComponent(RectTransform);
        go.addComponent(UIImage);

        expect(warn).not.toHaveBeenCalled();
    });

    test("a layout set through what it returns is the one the graphic draws and the one that is saved", () => {
        const go = new GameObject("Panel");
        const image = go.addComponent(UIImage);
        go.addComponent(RectTransform).sizeDelta.set(321, 45);
        expect([image.rectTransform.sizeDelta.x, image.rectTransform.sizeDelta.y]).toEqual([321, 45]);
        warn.mockClear();

        const saved = SceneSerializer.serializeScene(SceneManager.activeScene);
        go.destroyImmediate();
        const [loaded] = SceneSerializer.deserializeScene(saved);

        expect(names(loaded)).toEqual(["UIImage", "RectTransform"]);
        const rt = loaded.getComponent(RectTransform)!;
        expect([rt.sizeDelta.x, rt.sizeDelta.y]).toEqual([321, 45]);
        expect(warn).not.toHaveBeenCalled();
    });

    test("a RectTransform destroyed at once can be added again", () => {
        const go = new GameObject("Panel");
        const first = go.addComponent(RectTransform);
        first.destroyImmediate();

        const second = go.addComponent(RectTransform);

        expect(second).not.toBe(first);
        expect(go.getComponents(RectTransform)).toEqual([second]);
        expect(warn).not.toHaveBeenCalled();
    });

    test("returns the object's Transform for a Transform, and lists nothing", () => {
        const go = new GameObject("Mover");

        const t = go.addComponent(Transform);

        expect(t).toBe(go.transform);
        expect(go.getAllComponents()).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("Transform");
    });

    test("refuses a subclass when the object already holds the type it narrows", () => {
        class FancyRect extends RectTransform {}
        const go = new GameObject("Panel");
        go.addComponent(RectTransform);

        expect(() => go.addComponent(FancyRect)).toThrow(/RectTransform/);
        expect(go.getComponents(RectTransform)).toHaveLength(1);
    });

    test("returns a subclass the object holds when the base type is asked for", () => {
        class FancyRect extends RectTransform {}
        const go = new GameObject("Panel");
        const fancy = go.addComponent(FancyRect);

        expect(go.addComponent(RectTransform)).toBe(fancy);
        expect(go.getComponents(RectTransform)).toHaveLength(1);
    });

    test("is reached through Component.addComponent as well", () => {
        const go = new GameObject("Panel");
        const image = go.addComponent(UIImage);

        expect(image.addComponent(RectTransform)).toBe(image.rectTransform);
        expect(go.getComponents(RectTransform)).toHaveLength(1);
    });
});

describe("addComponent of a type that allows several", () => {
    test("still adds a second one, and wakes it", () => {
        const go = new GameObject("Holder");
        const a = go.addComponent(Counter);
        const b = go.addComponent(Counter);

        expect(b).not.toBe(a);
        expect(go.getComponents(Counter)).toEqual([a, b]);
        expect([b.awakes, b.enables]).toEqual([1, 1]);
        expect(warn).not.toHaveBeenCalled();
    });

    test("does not wake the existing one again when a single-copy type is refused", () => {
        const go = new GameObject("Holder");
        const counter = go.addComponent(Counter);
        go.addComponent(RectTransform);

        go.addComponent(RectTransform);

        expect([counter.awakes, counter.enables]).toEqual([1, 1]);
    });
});
