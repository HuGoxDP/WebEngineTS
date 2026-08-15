import { describe, test, expect, afterEach } from "vitest";
import { ScrollRect } from "../src/engine/core/ui/ScrollRect";
import { Selectable } from "../src/engine/core/ui/Selectable";
import { Button } from "../src/engine/core/ui/Button";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";
import { Time } from "../src/engine/core/Time";
import { Vector2 } from "../src/engine/core/math/Vector2";

/**
 * Every UI per-frame driver walks an array whose components splice themselves
 * out in `onDisable`. One of them disabling something mid-pass shifted the
 * array and the index loop skipped whatever followed. `ScrollRect` is the one
 * that reaches user code — its tick raises `onValueChanged` — so it is the one
 * a scenario can trigger. Audit part 10, F64.
 */

const made: GameObject[] = [];

function scrollView(name: string): ScrollRect {
    const viewGO = new GameObject(name);
    made.push(viewGO);
    viewGO.addComponent(RectTransform).sizeDelta.set(100, 100);
    const scroll = viewGO.addComponent(ScrollRect);

    const contentGO = new GameObject(`${name}-content`);
    made.push(contentGO);
    contentGO.transform.parent = viewGO.transform;
    const content = contentGO.addComponent(RectTransform);
    content.sizeDelta.set(300, 300);
    scroll.content = content;
    return scroll;
}

function button(name: string): Button {
    const go = new GameObject(name);
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(40, 20);
    return go.addComponent(Button);
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A UI driver whose list changes mid-pass", () => {
    test("still reaches the element after the one that left", () => {
        const first = scrollView("first");
        const second = scrollView("second");

        // The first view disables itself the moment it is ticked, which splices
        // it out of the array the pass is walking.
        first.onValueChanged.addListener(() => { first.enabled = false; });
        first.content!.anchoredPosition.set(-10, 0);

        let secondTicked = false;
        second.onValueChanged.addListener(() => { secondTicked = true; });
        second.content!.anchoredPosition.set(-10, 0);

        Time._update(1 / 60);
        ScrollRect._updateAll();

        expect(first.enabled).toBe(false);
        expect(secondTicked).toBe(true);
    });

    test("the disabled one is gone from the next pass", () => {
        const first = scrollView("first");
        const second = scrollView("second");
        let firstTicks = 0;
        first.onValueChanged.addListener(() => { firstTicks++; first.enabled = false; });
        first.content!.anchoredPosition.set(-10, 0);
        second.content!.anchoredPosition.set(-10, 0);

        Time._update(1 / 60);
        ScrollRect._updateAll();
        first.content!.anchoredPosition.set(-20, 0);
        Time._update(1 / 60);
        ScrollRect._updateAll();

        expect(firstTicks).toBe(1);
    });

    test("Selectable's pass survives a control disabling itself", () => {
        const a = button("a");
        const b = button("b");
        a.onSubmit.addListener(() => { a.enabled = false; });

        Time._update(1 / 60);

        expect(() => Selectable._updateAll()).not.toThrow();
        expect(b.isActiveAndEnabled).toBe(true);
    });

    test("an ordinary pass is unchanged", () => {
        const view = scrollView("only");
        let ticks = 0;
        view.onValueChanged.addListener(() => { ticks++; });
        view.content!.anchoredPosition.set(new Vector2(-10, 0).x, 0);

        Time._update(1 / 60);
        ScrollRect._updateAll();

        expect(ticks).toBe(1);
        expect(view.enabled).toBe(true);
    });
});
