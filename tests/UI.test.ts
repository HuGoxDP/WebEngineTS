import { describe, test, expect } from "vitest";
import { CanvasRenderMode, CanvasRepaintMode } from "../src/engine/core/ui/Canvas";
import { Button, ButtonState } from "../src/engine/core/ui/Button";
import { TextAlignment, UIText, VerticalAlignment } from "../src/engine/core/ui/UIText";
import { ImageFillMethod, ImageFillOrigin, UIImage } from "../src/engine/core/ui/UIImage";
import {
    CanvasPhysicalUnit,
    CanvasScaleMode,
    CanvasScaler,
    ScreenMatchMode,
} from "../src/engine/core/ui/CanvasScaler";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { cssColor, roundedRectPath } from "../src/engine/core/ui/UIUtils";
import { GameObject } from "../src/engine/core/GameObject";
import { Color } from "../src/engine/core/math/Color";

// RectTransform logic is pure math — test it without a full engine context.
// We import the class directly and stub its dependencies.
import { Rect } from "../src/engine/core/math/Rect";
import { Vector2 } from "../src/engine/core/math/Vector2";

// ---------------------------------------------------------------------------
// Recording stand-in for CanvasRenderingContext2D (no DOM under vitest)
// ---------------------------------------------------------------------------

interface MockContext {
    ops: string[];
    rects: number[][];
    texts: string[];
    measureCount: number;
    ctx: CanvasRenderingContext2D;
}

function makeContext(): MockContext {
    const ops: string[] = [];
    const rects: number[][] = [];
    const texts: string[] = [];
    const state = { measureCount: 0 };

    const ctx = {
        fillStyle: "", strokeStyle: "", font: "", textAlign: "", textBaseline: "",
        lineWidth: 0, lineJoin: "", globalAlpha: 1, imageSmoothingEnabled: true,
        beginPath: () => { ops.push("beginPath"); },
        closePath: () => { ops.push("closePath"); },
        moveTo: () => { ops.push("moveTo"); },
        lineTo: () => { ops.push("lineTo"); },
        arcTo:  () => { ops.push("arcTo"); },
        arc:    () => { ops.push("arc"); },
        clip:   () => { ops.push("clip"); },
        fill:   () => { ops.push("fill"); },
        stroke: () => { ops.push("stroke"); },
        save:   () => { ops.push("save"); },
        restore: () => { ops.push("restore"); },
        rect: (x: number, y: number, w: number, h: number) => {
            ops.push("rect");
            rects.push([x, y, w, h]);
        },
        fillRect: (x: number, y: number, w: number, h: number) => {
            ops.push("fillRect");
            rects.push([x, y, w, h]);
        },
        fillText: (t: string) => { ops.push("fillText"); texts.push(t); },
        strokeText: (t: string) => { ops.push("strokeText"); texts.push(t); },
        drawImage: () => { ops.push("drawImage"); },
        measureText: (s: string) => {
            state.measureCount++;
            return { width: s.length * 10 };
        },
    };

    return {
        ops, rects, texts,
        get measureCount() { return state.measureCount; },
        ctx: ctx as unknown as CanvasRenderingContext2D,
    };
}

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

describe("CanvasRepaintMode", () => {
    test("OnDemand is the mode that skips unchanged frames", () => {
        expect(CanvasRepaintMode.Always).toBe("Always");
        expect(CanvasRepaintMode.OnDemand).toBe("OnDemand");
    });
});

// ---------------------------------------------------------------------------
// RectTransform — live components (no Canvas → 800x600 viewport fallback)
// ---------------------------------------------------------------------------

describe("RectTransform layout", () => {
    function makeRect(name: string, parent: GameObject | null): RectTransform {
        const go = new GameObject(name);
        if (parent) go.transform.parent = parent.transform;
        return go.addComponent(RectTransform);
    }

    test("getScreenRect writes into the supplied rect and returns it", () => {
        const rt = makeRect("Solo", null);
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.anchoredPosition.set(100, 50);
        rt.sizeDelta.set(400, 200);

        const out = new Rect();
        const result = rt.getScreenRect(out);

        expect(result).toBe(out);
        expect(out.x).toBeCloseTo(100);
        expect(out.y).toBeCloseTo(50);
        expect(out.width).toBeCloseTo(400);
        expect(out.height).toBeCloseTo(200);
    });

    test("child rect is resolved against the parent rect", () => {
        const parent = new GameObject("Panel");
        const prt = parent.addComponent(RectTransform);
        prt.anchorMin.set(0, 0);
        prt.anchorMax.set(0, 0);
        prt.pivot.set(0, 0);
        prt.anchoredPosition.set(100, 50);
        prt.sizeDelta.set(400, 200);

        const crt = makeRect("Child", parent);
        crt.anchorMin.set(0, 0);
        crt.anchorMax.set(1, 1);
        crt.sizeDelta.set(-20, -20);

        const r = crt.getScreenRect(new Rect());
        expect(r.x).toBeCloseTo(110);
        expect(r.y).toBeCloseTo(60);
        expect(r.width).toBeCloseTo(380);
        expect(r.height).toBeCloseTo(180);
    });

    test("re-parenting invalidates the cached ancestor lookup immediately", () => {
        const parent = new GameObject("Panel");
        const prt = parent.addComponent(RectTransform);
        prt.anchorMin.set(0, 0);
        prt.anchorMax.set(0, 0);
        prt.pivot.set(0, 0);
        prt.anchoredPosition.set(100, 50);
        prt.sizeDelta.set(400, 200);

        const crt = makeRect("Child", parent);
        crt.anchorMin.set(0, 0);
        crt.anchorMax.set(1, 1);
        crt.sizeDelta.set(0, 0);

        const before = crt.getScreenRect(new Rect());
        expect(before.width).toBeCloseTo(400);

        crt.gameObject.transform.parent = null;

        // Same frame: the cache keys on parent identity, not only on the frame.
        const after = crt.getScreenRect(new Rect());
        expect(after.width).toBeCloseTo(800);
        expect(after.height).toBeCloseTo(600);
    });

    test("repeated reads stay allocation-free by reusing the out rect", () => {
        const rt = makeRect("Reused", null);
        const out = new Rect();
        for (let i = 0; i < 4; i++) {
            rt.anchoredPosition.set(i, i);
            expect(rt.getScreenRect(out)).toBe(out);
        }
        expect(out.x).toBeCloseTo(400 + 3 - 50);
    });
});

// ---------------------------------------------------------------------------
// CanvasScaler
// ---------------------------------------------------------------------------

describe("CanvasScaler", () => {
    function makeScaler(): CanvasScaler {
        return new GameObject("UI").addComponent(CanvasScaler);
    }

    test("ConstantPixelSize returns the raw scale factor", () => {
        const s = makeScaler();
        s.uiScaleMode = CanvasScaleMode.ConstantPixelSize;
        s.scaleFactor = 2;
        expect(s._computeScaleFactor(1920, 1080, 96)).toBeCloseTo(2);
    });

    test("ConstantPixelSize guards against a non-positive factor", () => {
        const s = makeScaler();
        s.scaleFactor = 0;
        expect(s._computeScaleFactor(1920, 1080, 96)).toBe(1);
    });

    test("ScaleWithScreenSize matches width or height per the blend", () => {
        const s = makeScaler();
        s.uiScaleMode = CanvasScaleMode.ScaleWithScreenSize;
        s.referenceResolution = new Vector2(800, 600);

        // Screen twice the reference on X, same on Y.
        s.matchWidthOrHeight = 0;
        expect(s._computeScaleFactor(1600, 600, 96)).toBeCloseTo(2);

        s.matchWidthOrHeight = 1;
        expect(s._computeScaleFactor(1600, 600, 96)).toBeCloseTo(1);

        // Halfway is the geometric mean, matching Unity's log-space blend.
        s.matchWidthOrHeight = 0.5;
        expect(s._computeScaleFactor(1600, 600, 96)).toBeCloseTo(Math.SQRT2);
    });

    test("Expand never crops and Shrink never overflows", () => {
        const s = makeScaler();
        s.uiScaleMode = CanvasScaleMode.ScaleWithScreenSize;
        s.referenceResolution = new Vector2(800, 600);

        s.screenMatchMode = ScreenMatchMode.Expand;
        expect(s._computeScaleFactor(1600, 600, 96)).toBeCloseTo(1);

        s.screenMatchMode = ScreenMatchMode.Shrink;
        expect(s._computeScaleFactor(1600, 600, 96)).toBeCloseTo(2);
    });

    test("a degenerate reference resolution falls back to 1", () => {
        const s = makeScaler();
        s.uiScaleMode = CanvasScaleMode.ScaleWithScreenSize;
        s.referenceResolution = new Vector2(0, 0);
        expect(s._computeScaleFactor(1600, 900, 96)).toBe(1);
    });

    test("ConstantPhysicalSize matches the CSS absolute-unit definitions", () => {
        const s = makeScaler();
        s.uiScaleMode = CanvasScaleMode.ConstantPhysicalSize;
        s.fallbackScreenDPI = 96;

        s.physicalUnit = CanvasPhysicalUnit.Points;
        expect(s._computeScaleFactor(1920, 1080, 0)).toBeCloseTo(96 / 72);

        s.physicalUnit = CanvasPhysicalUnit.Millimeters;
        expect(s._computeScaleFactor(1920, 1080, 0)).toBeCloseTo(96 / 25.4);

        s.physicalUnit = CanvasPhysicalUnit.Inches;
        expect(s._computeScaleFactor(1920, 1080, 0)).toBeCloseTo(96);
    });
});

// ---------------------------------------------------------------------------
// Shared draw helpers
// ---------------------------------------------------------------------------

describe("UIUtils", () => {
    test("cssColor emits rgb when opaque and rgba otherwise", () => {
        expect(cssColor(new Color(1, 0, 0, 1))).toBe("rgb(255,0,0)");
        expect(cssColor(new Color(0, 0, 1, 0.5))).toBe("rgba(0,0,255,0.5)");
    });

    test("cssColor clamps out-of-range channels", () => {
        expect(cssColor(new Color(2, -1, 0.5, 3))).toBe("rgb(255,0,127)");
    });

    test("roundedRectPath always opens a fresh path", () => {
        const m = makeContext();
        roundedRectPath(m.ctx, 0, 0, 100, 50, 0);
        expect(m.ops[0]).toBe("beginPath");
        expect(m.ops).toContain("rect");

        const m2 = makeContext();
        roundedRectPath(m2.ctx, 0, 0, 100, 50, 8);
        expect(m2.ops[0]).toBe("beginPath");
        expect(m2.ops).toContain("arcTo");
        expect(m2.ops).toContain("closePath");
    });

    test("roundedRectPath clamps the radius to half the shorter side", () => {
        const m = makeContext();
        // A 20-unit radius on a 10-tall rect must not invert the arcs.
        roundedRectPath(m.ctx, 0, 0, 100, 10, 20);
        expect(m.ops.filter(o => o === "arcTo").length).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Graphic components
// ---------------------------------------------------------------------------

describe("UIImage drawing", () => {
    function makeImage(): UIImage {
        return new GameObject("Img").addComponent(UIImage);
    }

    test("plain rect fills without clipping", () => {
        const img = makeImage();
        const m = makeContext();
        img._draw(m.ctx, new Rect(10, 20, 100, 50));

        expect(m.ops).toEqual(["fillRect"]);
        expect(m.rects[0]).toEqual([10, 20, 100, 50]);
    });

    test("borderRadius clips so the corners actually round", () => {
        const img = makeImage();
        img.borderRadius = 8;

        const m = makeContext();
        img._draw(m.ctx, new Rect(0, 0, 100, 50));

        expect(m.ops).toContain("clip");
        expect(m.ops.indexOf("clip")).toBeLessThan(m.ops.indexOf("fillRect"));
    });

    test("horizontal fill clips from the chosen origin", () => {
        const img = makeImage();
        img.fillAmount = 0.25;

        const m = makeContext();
        img._draw(m.ctx, new Rect(0, 0, 100, 50));
        expect(m.rects[0]).toEqual([0, 0, 25, 50]);

        img.fillOrigin = ImageFillOrigin.Right;
        const m2 = makeContext();
        img._draw(m2.ctx, new Rect(0, 0, 100, 50));
        expect(m2.rects[0]).toEqual([75, 0, 25, 50]);
    });

    test("vertical fill clips along Y", () => {
        const img = makeImage();
        img.fillAmount = 0.5;
        img.fillMethod = ImageFillMethod.Vertical;

        const m = makeContext();
        img._draw(m.ctx, new Rect(0, 0, 100, 80));
        expect(m.rects[0]).toEqual([0, 0, 100, 40]);

        img.fillOrigin = ImageFillOrigin.Bottom;
        const m2 = makeContext();
        img._draw(m2.ctx, new Rect(0, 0, 100, 80));
        expect(m2.rects[0]).toEqual([0, 40, 100, 40]);
    });

    test("nothing is drawn for an empty fill or a transparent color", () => {
        const img = makeImage();
        img.fillAmount = 0;
        const m = makeContext();
        img._draw(m.ctx, new Rect(0, 0, 100, 50));
        expect(m.ops).toEqual([]);

        img.fillAmount = 1;
        img.color = new Color(1, 1, 1, 0);
        const m2 = makeContext();
        img._draw(m2.ctx, new Rect(0, 0, 100, 50));
        expect(m2.ops).toEqual([]);
    });

    test("visual hash reacts to every drawn property", () => {
        const img = makeImage();
        const base = img._visualHash();

        img.color = new Color(1, 0, 0, 1);
        const tinted = img._visualHash();
        expect(tinted).not.toBe(base);

        img.fillAmount = 0.5;
        expect(img._visualHash()).not.toBe(tinted);
    });
});

describe("UIText drawing", () => {
    function makeText(): UIText {
        const t = new GameObject("Label").addComponent(UIText);
        t.text = "the quick brown fox jumps";
        return t;
    }

    test("word wrap is measured once and reused across frames", () => {
        const t = makeText();
        const m = makeContext();
        const rect = new Rect(0, 0, 120, 200);

        t._draw(m.ctx, rect);
        const afterFirst = m.measureCount;
        expect(afterFirst).toBeGreaterThan(0);

        t._draw(m.ctx, rect);
        t._draw(m.ctx, rect);
        expect(m.measureCount).toBe(afterFirst);
    });

    test("changing the text re-measures", () => {
        const t = makeText();
        const m = makeContext();
        const rect = new Rect(0, 0, 120, 200);

        t._draw(m.ctx, rect);
        const afterFirst = m.measureCount;

        t.text = "a completely different string";
        t._draw(m.ctx, rect);
        expect(m.measureCount).toBeGreaterThan(afterFirst);
    });

    test("a narrower rect re-measures the wrap", () => {
        const t = makeText();
        const m = makeContext();

        t._draw(m.ctx, new Rect(0, 0, 200, 200));
        const afterFirst = m.measureCount;

        t._draw(m.ctx, new Rect(0, 0, 90, 200));
        expect(m.measureCount).toBeGreaterThan(afterFirst);
    });

    test("outline strokes behind every line", () => {
        const t = makeText();
        t.text = "one\ntwo";
        t.wordWrap = false;
        t.outlineWidth = 2;

        const m = makeContext();
        t._draw(m.ctx, new Rect(0, 0, 200, 200));

        expect(m.ops.filter(o => o === "strokeText").length).toBe(2);
        expect(m.ops.filter(o => o === "fillText").length).toBe(2);
        expect(m.ops.indexOf("strokeText")).toBeLessThan(m.ops.indexOf("fillText"));
    });

    test("visual hash tracks the text", () => {
        const t = makeText();
        const before = t._visualHash();
        t.text = "score: 1";
        expect(t._visualHash()).not.toBe(before);
    });
});

describe("Button", () => {
    test("visual hash follows the interaction state", () => {
        const btn = new GameObject("Btn").addComponent(Button);
        const normal = btn._visualHash();

        btn._state = ButtonState.Pressed;
        expect(btn._visualHash()).not.toBe(normal);

        btn._state = ButtonState.Normal;
        expect(btn._visualHash()).toBe(normal);
    });

    test("a disabled button reports the disabled color regardless of state", () => {
        const btn = new GameObject("Btn").addComponent(Button);
        btn._state = ButtonState.Pressed;
        const enabledHash = btn._visualHash();

        btn.interactable = false;
        expect(btn._visualHash()).not.toBe(enabledHash);
    });

    test("sorting order changes are accepted before the canvas exists", () => {
        const btn = new GameObject("Btn").addComponent(Button);
        btn.sortingOrder = 5;
        expect(btn.sortingOrder).toBe(5);
    });
});
