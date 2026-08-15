import { describe, test, expect, afterEach } from "vitest";
import { LayoutElement, LayoutUtility } from "../src/engine/core/ui/LayoutElement";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { Behaviour } from "../src/engine/core/Behaviour";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * A layout group asks the element itself how big it would like to be, by
 * looking for any component reporting preferredWidth/Height. LayoutElement has
 * both — as `-1` when unset — so it answered that question for whatever it
 * happened to be added before, and the real reporter was never reached. Audit
 * part 6, F37.
 */

const made: GameObject[] = [];

/** A control that reports a size, the way UIText does. */
class Reporter extends Behaviour {
    public preferredWidth = 120;
    public preferredHeight = 30;
}

function element(name = "Row"): GameObject {
    const go = new GameObject(name);
    made.push(go);
    const rt = go.addComponent(RectTransform);
    rt.sizeDelta.set(10, 10);
    return go;
}

function rectOf(go: GameObject): RectTransform {
    return go.getComponent(RectTransform)!;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("The size a layout group is told", () => {
    test("comes from the reporting control, whichever order it was added in", () => {
        const go = element();
        // LayoutElement first — the order that used to break it.
        go.addComponent(LayoutElement);
        go.addComponent(Reporter);

        expect(LayoutUtility.preferredWidth(rectOf(go))).toBe(120);
        expect(LayoutUtility.preferredHeight(rectOf(go))).toBe(30);
    });

    test("and the other order agrees", () => {
        const go = element();
        go.addComponent(Reporter);
        go.addComponent(LayoutElement);

        expect(LayoutUtility.preferredWidth(rectOf(go))).toBe(120);
    });

    test("an explicit LayoutElement override still wins", () => {
        const go = element();
        const layout = go.addComponent(LayoutElement);
        go.addComponent(Reporter);
        layout.preferredWidth = 500;

        expect(LayoutUtility.preferredWidth(rectOf(go))).toBe(500);
        // Height was left unset, so the control still answers for it.
        expect(LayoutUtility.preferredHeight(rectOf(go))).toBe(30);
    });

    test("a disabled reporter is not asked", () => {
        const go = element();
        const reporter = go.addComponent(Reporter);

        reporter.enabled = false;

        expect(LayoutUtility.preferredWidth(rectOf(go))).toBe(10);
    });

    test("with nothing reporting, the element's own rect answers", () => {
        const go = element();
        go.addComponent(LayoutElement);

        expect(LayoutUtility.preferredWidth(rectOf(go))).toBe(10);
        expect(LayoutUtility.preferredHeight(rectOf(go))).toBe(10);
    });

    test("min sizes fall back to the reported preferred size", () => {
        const go = element();
        go.addComponent(LayoutElement);
        go.addComponent(Reporter);

        expect(LayoutUtility.minWidth(rectOf(go))).toBe(120);
        expect(LayoutUtility.minHeight(rectOf(go))).toBe(30);
    });
});
