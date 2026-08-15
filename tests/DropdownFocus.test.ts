import { describe, test, expect, afterEach } from "vitest";
import { Dropdown } from "../src/engine/core/ui/Dropdown";
import { Button } from "../src/engine/core/ui/Button";
import { EventSystem } from "../src/engine/core/ui/EventSystem";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * An open dropdown list draws over whatever is beneath it and swallows pointer
 * input across its whole height. Nothing closed it when focus moved on, so it
 * covered the very control the user had just clicked. Audit part 7, F43.
 */

const made: GameObject[] = [];

function dropdown(name = "Drop"): Dropdown {
    const go = new GameObject(name);
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(120, 24);
    const drop = go.addComponent(Dropdown);
    drop.options = ["one", "two", "three"];
    return drop;
}

function button(name = "Btn"): Button {
    const go = new GameObject(name);
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(80, 24);
    return go.addComponent(Button);
}

afterEach(() => {
    EventSystem._reset();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("An open dropdown", () => {
    test("closes when another control takes focus", () => {
        const drop = dropdown();
        const other = button();
        drop.select();
        drop.open();
        expect(drop.isOpen).toBe(true);

        other.select();

        expect(drop.isOpen).toBe(false);
    });

    test("closes when focus is cleared entirely", () => {
        const drop = dropdown();
        drop.select();
        drop.open();

        EventSystem._setSelected(null);

        expect(drop.isOpen).toBe(false);
    });

    test("keeps its value when it closes that way", () => {
        const drop = dropdown();
        drop.value = 2;
        drop.select();
        drop.open();

        EventSystem._setSelected(null);

        expect(drop.value).toBe(2);
        expect(drop.selectedText).toBe("three");
    });

    test("does not raise onValueChanged just for closing", () => {
        const drop = dropdown();
        drop.value = 1;
        let changes = 0;
        drop.onValueChanged.addListener(() => { changes++; });
        drop.select();
        drop.open();

        EventSystem._setSelected(null);

        expect(changes).toBe(0);
    });

    test("stays open while it still holds focus", () => {
        const drop = dropdown();
        drop.select();
        drop.open();

        // Re-selecting the control that already has focus is a no-op, not a
        // reason to close.
        drop.select();

        expect(drop.isOpen).toBe(true);
    });

    test("losing focus while closed changes nothing", () => {
        const drop = dropdown();
        drop.select();

        EventSystem._setSelected(null);

        expect(drop.isOpen).toBe(false);
    });
});
