import { describe, test, expect, afterEach, vi } from "vitest";

// A measuring context: every glyph is half its font size wide, which is enough
// for the layout to have something to wrap and stack.
vi.stubGlobal("document", {
    createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({
            font: "16px sans-serif",
            measureText(text: string) {
                const size = Number.parseFloat(this.font) || 16;
                return { width: text.length * size * 0.5 };
            },
        }),
    }),
});

const { UIText } = await import("../src/engine/core/ui/UIText");
const { RectTransform } = await import("../src/engine/core/ui/RectTransform");
const { GameObject } = await import("../src/engine/core/GameObject");

/**
 * `<size=40>` inside a 16pt label draws at 40px, and every line advanced by the
 * label's own size — so a big run drew over the line beneath it, and the label
 * reported a height too small to hold what it was about to draw. `RichLine`
 * carries `maxSize` for exactly this and only the baseline alignment used it.
 * Audit part 7, F47.
 */

const made: GameObject[] = [];

function label(text: string, rich = true) {
    const go = new GameObject("Label");
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(1000, 200);
    const ui = go.addComponent(UIText);
    ui.fontSize = 16;
    ui.lineHeight = 1;
    ui.richText = rich;
    ui.wordWrap = false;
    ui.text = text;
    return ui;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Rich text line height", () => {
    test("a bigger run makes its line taller", () => {
        const plain = label("one\ntwo");
        const big = label("one\n<size=40>two</size>");

        expect(big.preferredHeight).toBeGreaterThan(plain.preferredHeight);
    });

    test("the height is the sum of each line's largest run", () => {
        const ui = label("<size=40>big</size>\nsmall");

        // 40 for the first line, the label's own 16 for the second.
        expect(ui.preferredHeight).toBeCloseTo(56);
    });

    test("a label with no size tags is unchanged", () => {
        const ui = label("one\ntwo\nthree");

        expect(ui.preferredHeight).toBeCloseTo(48);
    });

    test("lineHeight still multiplies", () => {
        const ui = label("<size=40>big</size>\nsmall");
        ui.lineHeight = 2;

        expect(ui.preferredHeight).toBeCloseTo(112);
    });

    test("a blank paragraph keeps the label's own height", () => {
        // An empty line has no runs to measure, so it falls back rather than
        // collapsing to nothing.
        const ui = label("one\n\ntwo");

        expect(ui.preferredHeight).toBeCloseTo(48);
    });

    test("plain text is measured the same way as before", () => {
        const ui = label("one\ntwo", false);

        expect(ui.preferredHeight).toBeCloseTo(32);
    });
});
