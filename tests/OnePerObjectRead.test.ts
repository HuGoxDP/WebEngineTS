import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Component } from "../src/engine/core/Component";
import { Transform } from "../src/engine/core/Transform";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { EngineObject } from "../src/engine/core/EngineObject";

/**
 * Reading one-per-object from outside the engine.
 *
 * `GameObject.addComponent` has held one `RectTransform`/`Transform` per object
 * since M0.2b (Unity's `[DisallowMultipleComponent]`), but the rule lived behind
 * `Component._allowMultiple`, an `@internal` static. A host UI that offers
 * components therefore offered them all as if addable: the editor's Add
 * Component menu listed `RectTransform` next to an object that already had one,
 * and the add was a silent no-op with a console warning.
 *
 * Two public reads say the same thing the add says:
 * - `Component.allowsMultiple` — the type's side of the rule, on the class;
 * - `GameObject.hasComponent(type)` — the object's side, Transform included,
 *   because the Transform is never in the component list.
 */

class Script extends ScriptableBehaviour {}

describe("reading one-per-object", () => {
    let warn: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(() => {
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        warn?.mockRestore();
        EngineObject._clearPendingDestroys();
    });

    describe("Component.allowsMultiple", () => {
        test("is false for the one-per-object types, true for the rest", () => {
            expect(RectTransform.allowsMultiple).toBe(false);
            expect(Transform.allowsMultiple).toBe(false);
            expect(UIImage.allowsMultiple).toBe(true);
            expect(Script.allowsMultiple).toBe(true);
            expect(Component.allowsMultiple).toBe(true);
        });

        test("a subclass inherits its base's answer", () => {
            class MyRect extends RectTransform {}
            class MyScript extends ScriptableBehaviour {}

            expect(MyRect.allowsMultiple).toBe(false);
            expect(MyScript.allowsMultiple).toBe(true);
        });
    });

    describe("GameObject.hasComponent", () => {
        test("finds the Transform, which is never in the component list", () => {
            const go = new GameObject("Object");

            // getComponent cannot answer this one: the Transform is not a
            // component in the list, it is part of the object.
            expect(go.getComponent(Transform)).toBe(null);
            expect(go.hasComponent(Transform)).toBe(true);
        });

        test("finds a single-copy component a sibling graphic added", () => {
            const go = new GameObject("Panel");

            expect(go.hasComponent(RectTransform)).toBe(false);

            go.addComponent(UIImage);

            expect(go.hasComponent(RectTransform)).toBe(true);
            expect(go.hasComponent(UIImage)).toBe(true);
        });

        test("answers the same way addComponent does about a component awaiting its destroy", () => {
            // One destroyed with destroy is still occupying its slot until the
            // frame ends — adding a second is refused in that window, so the
            // read reports it as held. After the frame, both agree it is gone.
            const go = new GameObject("Panel");
            go.addComponent(RectTransform);
            go.destroyImmediate();

            expect(go.hasComponent(RectTransform)).toBe(false);
            expect(go.addComponent(RectTransform)).not.toBe(go.transform);
            expect(warn).not.toHaveBeenCalled();
        });

        test("a component destroyed with destroy counts until the frame ends", () => {
            const go = new GameObject("Panel");
            const rect = go.addComponent(RectTransform);
            rect.destroy();

            expect(go.hasComponent(RectTransform)).toBe(true);

            EngineObject._updatePendingDestroys(1 / 60);

            expect(go.hasComponent(RectTransform)).toBe(false);
        });

        test("a type that allows several says true when any is held", () => {
            const go = new GameObject("Object");

            expect(go.hasComponent(Script)).toBe(false);

            go.addComponent(Script);

            expect(go.hasComponent(Script)).toBe(true);
        });

        test("is what addComponent refuses on: the offer and the refusal agree", () => {
            const go = new GameObject("Object");
            go.addComponent(RectTransform);
            warn?.mockClear();

            // The editor's read, then the editor's action.
            const blocked = RectTransform.allowsMultiple === false && go.hasComponent(RectTransform);
            expect(blocked).toBe(true);

            // And the action it just took out of the menu really was a no-op.
            const before = go.getComponents(RectTransform).length;
            go.addComponent(RectTransform);
            expect(go.getComponents(RectTransform).length).toBe(before);
            expect(warn).toHaveBeenCalledTimes(1);
        });
    });
});
