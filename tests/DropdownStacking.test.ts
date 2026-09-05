import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Canvas } from "../src/engine/core/ui/Canvas";
import { Dropdown } from "../src/engine/core/ui/Dropdown";

/**
 * The open list is drawn below the field and past the control's own rect, so it
 * has to cover whatever sits beneath it. It did not: the list stayed at its
 * element's sorting order and the next sibling painted over it — visible in
 * Optics, where the options collided with the slider labels underneath.
 */

const made: GameObject[] = [];

function dropdown(order = 0): Dropdown {
    const canvasGO = new GameObject("Canvas");
    made.push(canvasGO);
    canvasGO.addComponent(Canvas);

    const go = new GameObject("Dropdown");
    made.push(go);
    go.transform.setParent(canvasGO.transform, false);
    const dd = go.addComponent(Dropdown);
    dd.options = ["one", "two", "three"];
    dd.sortingOrder = order;
    return dd;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("an open Dropdown draws above its siblings", () => {
    test("opening raises the sorting order, closing restores it", () => {
        const dd = dropdown(5);

        dd.open();
        expect(dd.isOpen).toBe(true);
        expect(dd.sortingOrder).toBeGreaterThan(5);

        dd.close();
        expect(dd.sortingOrder).toBe(5);
    });

    test("the lift clears a sibling ordered above the closed field", () => {
        const dd = dropdown(0);
        const siblingOrder = 10; // a panel that would otherwise paint over the list

        dd.open();

        expect(dd.sortingOrder).toBeGreaterThan(siblingOrder);
    });

    test("opening twice does not stack the lift, and close still restores", () => {
        const dd = dropdown(3);

        dd.open();
        const once = dd.sortingOrder;
        dd.open();

        expect(dd.sortingOrder).toBe(once);
        dd.close();
        expect(dd.sortingOrder).toBe(3);
    });

    test("toggle round-trips the order", () => {
        const dd = dropdown(7);
        dd.toggle();
        expect(dd.sortingOrder).toBeGreaterThan(7);
        dd.toggle();
        expect(dd.sortingOrder).toBe(7);
    });
});
