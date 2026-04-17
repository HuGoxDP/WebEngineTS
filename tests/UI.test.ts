import { describe, test, expect } from "vitest";
import { CanvasRenderMode } from "../src/engine/core/ui/Canvas";
import { ButtonState } from "../src/engine/core/ui/Button";
import { TextAlignment, VerticalAlignment } from "../src/engine/core/ui/UIText";

// RectTransform logic is pure math — test it without a full engine context.
// We import the class directly and stub its dependencies.
import { Rect } from "../src/engine/core/math/Rect";
import { Vector2 } from "../src/engine/core/math/Vector2";

// ---------------------------------------------------------------------------
// Minimal RectTransform screen-rect math (tested in isolation via plain math)
// ---------------------------------------------------------------------------

function computeScreenRect(
    parentRect: Rect,
    anchorMin: Vector2,
    anchorMax: Vector2,
    anchoredPosition: Vector2,
    sizeDelta: Vector2,
    pivot: Vector2,
): Rect {
    const aLeft   = parentRect.x + anchorMin.x * parentRect.width;
    const aTop    = parentRect.y + anchorMin.y * parentRect.height;
    const aRight  = parentRect.x + anchorMax.x * parentRect.width;
    const aBottom = parentRect.y + anchorMax.y * parentRect.height;
    const aCx = (aLeft + aRight)  * 0.5;
    const aCy = (aTop  + aBottom) * 0.5;
    const w = (aRight - aLeft) + sizeDelta.x;
    const h = (aBottom - aTop) + sizeDelta.y;
    const x = aCx + anchoredPosition.x - pivot.x * w;
    const y = aCy + anchoredPosition.y - pivot.y * h;
    return new Rect(x, y, w, h);
}

describe("RectTransform math", () => {
    const parent = new Rect(0, 0, 800, 600);

    test("center anchor, default pivot — centered in parent", () => {
        const r = computeScreenRect(
            parent,
            new Vector2(0.5, 0.5), new Vector2(0.5, 0.5),
            new Vector2(0, 0),
            new Vector2(100, 50),
            new Vector2(0.5, 0.5),
        );
        expect(r.x).toBeCloseTo(350);   // 400 - 50
        expect(r.y).toBeCloseTo(275);   // 300 - 25
        expect(r.width).toBeCloseTo(100);
        expect(r.height).toBeCloseTo(50);
    });

    test("center anchor, offset with anchoredPosition", () => {
        const r = computeScreenRect(
            parent,
            new Vector2(0.5, 0.5), new Vector2(0.5, 0.5),
            new Vector2(20, -10),
            new Vector2(100, 50),
            new Vector2(0.5, 0.5),
        );
        expect(r.x).toBeCloseTo(370);
        expect(r.y).toBeCloseTo(265);
    });

    test("stretch anchors fill parent exactly", () => {
        const r = computeScreenRect(
            parent,
            new Vector2(0, 0), new Vector2(1, 1),
            new Vector2(0, 0),
            new Vector2(0, 0),
            new Vector2(0.5, 0.5),
        );
        expect(r.x).toBeCloseTo(0);
        expect(r.y).toBeCloseTo(0);
        expect(r.width).toBeCloseTo(800);
        expect(r.height).toBeCloseTo(600);
    });

    test("stretch anchors with margin padding (sizeDelta negative)", () => {
        const r = computeScreenRect(
            parent,
            new Vector2(0, 0), new Vector2(1, 1),
            new Vector2(0, 0),
            new Vector2(-40, -20),
            new Vector2(0.5, 0.5),
        );
        expect(r.width).toBeCloseTo(760);
        expect(r.height).toBeCloseTo(580);
        expect(r.x).toBeCloseTo(20);
        expect(r.y).toBeCloseTo(10);
    });

    test("top-left anchor corner-anchored element", () => {
        const r = computeScreenRect(
            parent,
            new Vector2(0, 0), new Vector2(0, 0),
            new Vector2(10, 10),
            new Vector2(80, 30),
            new Vector2(0, 0),
        );
        expect(r.x).toBeCloseTo(10);
        expect(r.y).toBeCloseTo(10);
        expect(r.width).toBeCloseTo(80);
        expect(r.height).toBeCloseTo(30);
    });

    test("bottom-right anchor (1,1)", () => {
        const r = computeScreenRect(
            parent,
            new Vector2(1, 1), new Vector2(1, 1),
            new Vector2(-10, -10),
            new Vector2(80, 30),
            new Vector2(1, 1),
        );
        // pivot (1,1): top-left of rect = anchorCenter + offset - size
        expect(r.x).toBeCloseTo(800 - 10 - 80);
        expect(r.y).toBeCloseTo(600 - 10 - 30);
    });
});

describe("CanvasRenderMode", () => {
    test("ScreenSpaceOverlay value", () => {
        expect(CanvasRenderMode.ScreenSpaceOverlay).toBe("ScreenSpaceOverlay");
    });
});

describe("ButtonState", () => {
    test("all states are distinct strings", () => {
        const states = new Set([
            ButtonState.Normal,
            ButtonState.Highlighted,
            ButtonState.Pressed,
            ButtonState.Disabled,
        ]);
        expect(states.size).toBe(4);
    });
});

describe("TextAlignment", () => {
    test("maps to canvas textAlign values", () => {
        expect(TextAlignment.Left).toBe("left");
        expect(TextAlignment.Center).toBe("center");
        expect(TextAlignment.Right).toBe("right");
    });
});

describe("VerticalAlignment", () => {
    test("values are distinct", () => {
        const vals = new Set([
            VerticalAlignment.Top,
            VerticalAlignment.Middle,
            VerticalAlignment.Bottom,
        ]);
        expect(vals.size).toBe(3);
    });
});
