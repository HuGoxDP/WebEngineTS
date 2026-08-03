import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Canvas, CanvasRenderMode, CanvasRepaintMode } from "../src/engine/core/ui/Canvas";
import { EventSystem } from "../src/engine/core/ui/EventSystem";
import { Input } from "../src/engine/core/Input";
import { Touch, TouchInfo, TouchPhase } from "../src/engine/core/input/Touch";
import { Button, ButtonState } from "../src/engine/core/ui/Button";
import { TextAlignment, UIText, VerticalAlignment } from "../src/engine/core/ui/UIText";
import { ImageFillMethod, ImageFillOrigin, UIImage } from "../src/engine/core/ui/UIImage";
import {
    CanvasPhysicalUnit,
    CanvasScaleMode,
    CanvasScaler,
    ScreenMatchMode,
} from "../src/engine/core/ui/CanvasScaler";
import {
    RectTransform,
    RectTransformAxis,
    RectTransformEdge,
} from "../src/engine/core/ui/RectTransform";
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
// RectTransform anchor math — exercised through real components.
//
// With no Canvas ancestor the root rect falls back to an 800x600 viewport, which
// is what every case below is expressed against.
// ---------------------------------------------------------------------------

/** Builds a live root RectTransform with the given anchor configuration. */
function layout(
    anchorMin: [number, number],
    anchorMax: [number, number],
    anchoredPosition: [number, number],
    sizeDelta: [number, number],
    pivot: [number, number],
): Rect {
    const rt = new GameObject("Anchored").addComponent(RectTransform);
    rt.anchorMin.set(anchorMin[0], anchorMin[1]);
    rt.anchorMax.set(anchorMax[0], anchorMax[1]);
    rt.anchoredPosition.set(anchoredPosition[0], anchoredPosition[1]);
    rt.sizeDelta.set(sizeDelta[0], sizeDelta[1]);
    rt.pivot.set(pivot[0], pivot[1]);
    return rt.getScreenRect(new Rect());
}

describe("RectTransform anchor math", () => {
    test("center anchor, default pivot — centered in parent", () => {
        const r = layout([0.5, 0.5], [0.5, 0.5], [0, 0], [100, 50], [0.5, 0.5]);
        expect(r.x).toBeCloseTo(350);   // 400 - 50
        expect(r.y).toBeCloseTo(275);   // 300 - 25
        expect(r.width).toBeCloseTo(100);
        expect(r.height).toBeCloseTo(50);
    });

    test("center anchor, offset with anchoredPosition", () => {
        const r = layout([0.5, 0.5], [0.5, 0.5], [20, -10], [100, 50], [0.5, 0.5]);
        expect(r.x).toBeCloseTo(370);
        expect(r.y).toBeCloseTo(265);
    });

    test("stretch anchors fill parent exactly", () => {
        const r = layout([0, 0], [1, 1], [0, 0], [0, 0], [0.5, 0.5]);
        expect(r.x).toBeCloseTo(0);
        expect(r.y).toBeCloseTo(0);
        expect(r.width).toBeCloseTo(800);
        expect(r.height).toBeCloseTo(600);
    });

    test("stretch anchors with margin padding (sizeDelta negative)", () => {
        const r = layout([0, 0], [1, 1], [0, 0], [-40, -20], [0.5, 0.5]);
        expect(r.width).toBeCloseTo(760);
        expect(r.height).toBeCloseTo(580);
        expect(r.x).toBeCloseTo(20);
        expect(r.y).toBeCloseTo(10);
    });

    test("anchorMin (0,0) is the TOP-left corner in this Y-down system", () => {
        const r = layout([0, 0], [0, 0], [10, 10], [80, 30], [0, 0]);
        expect(r.x).toBeCloseTo(10);
        expect(r.y).toBeCloseTo(10);
        expect(r.width).toBeCloseTo(80);
        expect(r.height).toBeCloseTo(30);
    });

    test("anchorMax (1,1) is the BOTTOM-right corner, so Y grows downward", () => {
        const r = layout([1, 1], [1, 1], [-10, -10], [80, 30], [1, 1]);
        // pivot (1,1) is the element's bottom-right, the inverse of Unity.
        expect(r.x).toBeCloseTo(800 - 10 - 80);
        expect(r.y).toBeCloseTo(600 - 10 - 30);
    });

    test("a larger anchoredPosition.y moves the element down the screen", () => {
        const high = layout([0, 0], [0, 0], [0, 100], [10, 10], [0, 0]);
        const low  = layout([0, 0], [0, 0], [0, 200], [10, 10], [0, 0]);
        expect(low.y).toBeGreaterThan(high.y);
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

// ---------------------------------------------------------------------------
// Canvas — draw order and registration
//
// No DOM under vitest, so the Canvas has no 2D context and never paints; the
// ordering and registration logic in `_prepare` runs regardless, which is what
// these cover.
// ---------------------------------------------------------------------------

/** Creates a GameObject parented to `parent` before any component is added. */
function child(name: string, parent: GameObject): GameObject {
    const go = new GameObject(name);
    go.transform.parent = parent.transform;
    return go;
}

describe("Canvas draw order", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => Canvas._reset());

    /**
     * Canvas ─ Panel(bg) ─┬─ LabelA
     *                     └─ LabelB
     */
    function makeTree() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);

        const panelGO = child("Panel", canvasGO);
        const bg = panelGO.addComponent(UIImage);

        const a = child("LabelA", panelGO).addComponent(UIText);
        const b = child("LabelB", panelGO).addComponent(UIText);

        return { canvas, bg, a, b };
    }

    test("graphics draw in hierarchy order, parents before children", () => {
        const { canvas, bg, a, b } = makeTree();
        canvas._prepare();
        expect(Array.from(canvas._graphicList)).toEqual([bg, a, b]);
    });

    test("re-enabling a parent graphic does not lift it above its children", () => {
        const { canvas, bg, a, b } = makeTree();
        canvas._prepare();

        // Re-registration appends, so without a hierarchy tiebreaker the panel
        // background would end up painting over its own labels.
        bg.enabled = false;
        bg.enabled = true;
        canvas._prepare();

        expect(Array.from(canvas._graphicList)).toEqual([bg, a, b]);
    });

    test("sortingOrder still wins over hierarchy position", () => {
        const { canvas, bg, a, b } = makeTree();
        bg.sortingOrder = 10;
        canvas._prepare();
        expect(Array.from(canvas._graphicList)).toEqual([a, b, bg]);
    });

    test("re-parenting reorders on the same frame it happens", () => {
        const { canvas, bg, a, b } = makeTree();
        canvas._prepare();
        expect(Array.from(canvas._graphicList)).toEqual([bg, a, b]);

        // Move LabelA out to be a direct sibling of Panel, after it.
        a.gameObject.transform.parent = canvas.gameObject.transform;
        canvas._prepare();

        expect(Array.from(canvas._graphicList)).toEqual([bg, b, a]);
    });
});

describe("Canvas registration", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => Canvas._reset());

    test("a Canvas added after its children adopts them", () => {
        const rootGO = new GameObject("Root");
        const img = child("Child", rootGO).addComponent(UIImage);

        // Resolved (and cached) as "no canvas" before the Canvas exists.
        expect(img.canvas).toBeNull();

        const canvas = rootGO.addComponent(Canvas);

        expect(img.canvas).toBe(canvas);
        expect(Array.from(canvas._graphicList)).toContain(img);
    });

    test("disabling a graphic unregisters it from the canvas", () => {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        const img = child("Child", canvasGO).addComponent(UIImage);

        expect(Array.from(canvas._graphicList)).toContain(img);
        img.enabled = false;
        expect(Array.from(canvas._graphicList)).not.toContain(img);
    });
});

describe("RectTransform ancestor cache", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => Canvas._reset());

    test("a missing Canvas is cached for the frame instead of re-walked", () => {
        const go = new GameObject("Solo");
        const rt = go.addComponent(RectTransform);

        const spy = vi.spyOn(go, "getComponent");
        void rt.canvas;
        const afterFirst = spy.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        void rt.canvas;
        void rt.canvas;
        expect(spy.mock.calls.length).toBe(afterFirst);

        spy.mockRestore();
    });

    test("invalidateLayoutCache forces the walk to run again", () => {
        const go = new GameObject("Solo");
        const rt = go.addComponent(RectTransform);
        void rt.canvas;

        const spy = vi.spyOn(go, "getComponent");
        rt.invalidateLayoutCache();
        void rt.canvas;

        expect(spy.mock.calls.length).toBeGreaterThan(0);
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// RectTransform resolved-rect cache
//
// The cache must never be observable in a rect's *value* — only in how much
// work producing it costs. Each recomputed level writes its local rect and its
// bounds (2 Rect.set calls); resolving a root-level element always restamps the
// shared root scratch (1 more). So for Canvas -> Panel -> Label:
//   both cached          -> 1 set
//   label alone recomputes -> 3 sets
//   both recompute         -> 5 sets
// ---------------------------------------------------------------------------

describe("RectTransform rect cache", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => {
        vi.restoreAllMocks();
        Canvas._reset();
    });

    /** Canvas(800x600) ─ Panel ─ Label, both stretched to their parent. */
    function makeChain() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const panel = child("Panel", canvasGO).addComponent(RectTransform);
        panel.anchorMin.set(0, 0);
        panel.anchorMax.set(1, 1);
        panel.sizeDelta.set(0, 0);
        panel.pivot.set(0, 0);
        panel.anchoredPosition.set(0, 0);

        const label = child("Label", panel.gameObject).addComponent(RectTransform);
        label.anchorMin.set(0, 0);
        label.anchorMax.set(0, 0);
        label.pivot.set(0, 0);
        label.anchoredPosition.set(10, 20);
        label.sizeDelta.set(100, 40);

        return { canvas, panel, label };
    }

    test("moving a parent is visible to the child immediately", () => {
        const { panel, label } = makeChain();
        const before = label.getScreenRect(new Rect());

        // The critical case: nothing about the label changed, and its own cache
        // is warm. Only the walk up to the panel can reveal the move.
        panel.anchoredPosition.set(50, 30);
        const after = label.getScreenRect(new Rect());

        expect(after.x).toBeCloseTo(before.x + 50);
        expect(after.y).toBeCloseTo(before.y + 30);
    });

    test("resizing a parent is visible to the child immediately", () => {
        const { panel, label } = makeChain();
        label.anchorMin.set(1, 1);
        label.anchorMax.set(1, 1);
        const before = label.getScreenRect(new Rect());

        panel.sizeDelta.set(-200, 0);
        const after = label.getScreenRect(new Rect());

        expect(after.x).toBeCloseTo(before.x - 200);
    });

    test("a canvas resize is visible without any element changing", () => {
        const { canvas, label } = makeChain();
        label.anchorMin.set(1, 1);
        label.anchorMax.set(1, 1);

        // Panel stretches to fill the canvas: origin 0, far edge 800. The label
        // anchors to that far edge, 10 beyond it.
        expect(label.getScreenRect(new Rect()).x).toBeCloseTo(810);

        vi.spyOn(canvas, "width", "get").mockReturnValue(1600);

        // Nothing on either element changed — only the root the chain resolves
        // against. The panel's far edge moves to 1600.
        expect(label.getScreenRect(new Rect()).x).toBeCloseTo(1610);
    });

    test("an unchanged chain recomputes nothing on a second read", () => {
        const { label } = makeChain();
        const out = new Rect();
        label.getScreenRect(out);

        const sets = vi.spyOn(Rect.prototype, "set");
        label.getScreenRect(out);

        // Only the root scratch restamp; neither level recomputed.
        expect(sets.mock.calls.length).toBe(1);
    });

    test("changing the element itself recomputes exactly its own level", () => {
        const { label } = makeChain();
        const out = new Rect();
        label.getScreenRect(out);

        const sets = vi.spyOn(Rect.prototype, "set");
        label.anchoredPosition.set(99, 99);
        label.getScreenRect(out);

        // The label recomputes; the panel above it does not.
        expect(sets.mock.calls.length).toBe(3);
    });

    test("changing a parent recomputes both levels", () => {
        const { panel, label } = makeChain();
        const out = new Rect();
        label.getScreenRect(out);

        const sets = vi.spyOn(Rect.prototype, "set");
        panel.sizeDelta.set(-100, -100);
        label.getScreenRect(out);

        expect(sets.mock.calls.length).toBe(5);
    });

    test("the cached rect is never handed out to callers", () => {
        const { label } = makeChain();
        const a = label.getScreenRect(new Rect());
        const b = label.getScreenRect(new Rect());
        expect(a).not.toBe(b);

        // Mutating a returned rect must not corrupt the cache.
        a.x = -12345;
        expect(label.getScreenRect(new Rect()).x).toBe(b.x);
    });

    test("screenRect and getScreenRect agree", () => {
        const { label } = makeChain();
        const viaOut = label.getScreenRect(new Rect());
        const viaProp = label.screenRect;
        expect(viaProp.x).toBeCloseTo(viaOut.x);
        expect(viaProp.y).toBeCloseTo(viaOut.y);
        expect(viaProp.width).toBeCloseTo(viaOut.width);
        expect(viaProp.height).toBeCloseTo(viaOut.height);
    });
});

// ---------------------------------------------------------------------------
// RectTransform layout API (offsets, insets, sizing)
// ---------------------------------------------------------------------------

describe("RectTransform layout API", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => {
        vi.restoreAllMocks();
        Canvas._reset();
    });

    /** A RectTransform under an 800x600 canvas. */
    function makeUnder(): RectTransform {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);
        return child("El", canvasGO).addComponent(RectTransform);
    }

    test("the anchor reference point is sampled at the pivot, not the centre", () => {
        const rt = makeUnder();
        // Stretched horizontally with a left pivot: the two definitions differ
        // here, and only here.
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 0);
        rt.pivot.set(0, 0);
        rt.sizeDelta.set(0, 50);
        rt.anchoredPosition.set(0, 0);

        // Unity's rule puts the pivot at anchorMin + pivot * anchorSize = 0,
        // so a zero-sizeDelta stretch exactly fills the parent.
        const r = rt.getScreenRect(new Rect());
        expect(r.x).toBeCloseTo(0);
        expect(r.width).toBeCloseTo(800);
    });

    test("offsetMin and offsetMax describe a stretched element's margins", () => {
        const rt = makeUnder();
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 1);
        rt.pivot.set(0.5, 0.5);
        rt.sizeDelta.set(-40, -20);
        rt.anchoredPosition.set(0, 0);

        expect(rt.offsetMin.x).toBeCloseTo(20);
        expect(rt.offsetMin.y).toBeCloseTo(10);
        expect(rt.offsetMax.x).toBeCloseTo(-20);
        expect(rt.offsetMax.y).toBeCloseTo(-10);
    });

    test("assigning offsetMin resizes without moving the opposite corner", () => {
        const rt = makeUnder();
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 1);
        rt.sizeDelta.set(0, 0);
        rt.anchoredPosition.set(0, 0);

        const maxBefore = rt.getOffsetMax(new Vector2()).clone();
        rt.offsetMin = new Vector2(30, 15);

        expect(rt.getOffsetMin(new Vector2()).x).toBeCloseTo(30);
        expect(rt.getOffsetMin(new Vector2()).y).toBeCloseTo(15);
        expect(rt.getOffsetMax(new Vector2()).x).toBeCloseTo(maxBefore.x);
        expect(rt.getOffsetMax(new Vector2()).y).toBeCloseTo(maxBefore.y);

        const r = rt.getScreenRect(new Rect());
        expect(r.x).toBeCloseTo(30);
        expect(r.width).toBeCloseTo(770);
    });

    test("assigning offsetMax resizes without moving the opposite corner", () => {
        const rt = makeUnder();
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 1);
        rt.sizeDelta.set(0, 0);
        rt.anchoredPosition.set(0, 0);

        const minBefore = rt.getOffsetMin(new Vector2()).clone();
        rt.offsetMax = new Vector2(-50, -25);

        expect(rt.getOffsetMin(new Vector2()).x).toBeCloseTo(minBefore.x);
        expect(rt.getOffsetMax(new Vector2()).x).toBeCloseTo(-50);

        const r = rt.getScreenRect(new Rect());
        expect(r.width).toBeCloseTo(750);
        expect(r.height).toBeCloseTo(575);
    });

    test("setSizeWithCurrentAnchors yields the final size under a stretch", () => {
        const rt = makeUnder();
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 1);
        rt.pivot.set(0.5, 0.5);
        rt.anchoredPosition.set(0, 0);

        rt.setSizeWithCurrentAnchors(RectTransformAxis.Horizontal, 300);
        rt.setSizeWithCurrentAnchors(RectTransformAxis.Vertical, 200);

        const r = rt.getScreenRect(new Rect());
        expect(r.width).toBeCloseTo(300);
        expect(r.height).toBeCloseTo(200);
    });

    test("setInsetAndSizeFromParentEdge pins to the Top edge, which is low Y", () => {
        const rt = makeUnder();
        rt.pivot.set(0.5, 0.5);
        rt.setInsetAndSizeFromParentEdge(RectTransformEdge.Top, 10, 60);

        const r = rt.getScreenRect(new Rect());
        expect(r.y).toBeCloseTo(10);
        expect(r.height).toBeCloseTo(60);
        expect(rt.anchorMin.y).toBe(0);
        expect(rt.anchorMax.y).toBe(0);
    });

    test("setInsetAndSizeFromParentEdge pins to the Bottom edge, which is high Y", () => {
        const rt = makeUnder();
        rt.pivot.set(0.5, 0.5);
        rt.setInsetAndSizeFromParentEdge(RectTransformEdge.Bottom, 10, 60);

        const r = rt.getScreenRect(new Rect());
        expect(r.y + r.height).toBeCloseTo(600 - 10);
        expect(rt.anchorMin.y).toBe(1);
    });

    test("setInsetAndSizeFromParentEdge survives a pivot that is not centred", () => {
        const rt = makeUnder();
        rt.pivot.set(0, 0);
        rt.setInsetAndSizeFromParentEdge(RectTransformEdge.Right, 25, 120);

        const r = rt.getScreenRect(new Rect());
        expect(r.x + r.width).toBeCloseTo(800 - 25);
        expect(r.width).toBeCloseTo(120);
    });

    test("local corners run through the transform to give the world corners", () => {
        const rt = makeUnder();
        rt.anchorMin.set(0.5, 0.5);
        rt.anchorMax.set(0.5, 0.5);
        rt.pivot.set(0.5, 0.5);
        rt.sizeDelta.set(100, 100);
        rt.anchoredPosition.set(0, 0);

        const local = rt.getLocalCorners();
        expect(local[0].x).toBeCloseTo(-50);
        expect(local[2].x).toBeCloseTo(50);

        const world = rt.getWorldCorners();
        expect(world[0].x).toBeCloseTo(350);
        expect(world[2].x).toBeCloseTo(450);
    });
});

// ---------------------------------------------------------------------------
// RectTransform rotation and scale
// ---------------------------------------------------------------------------

describe("RectTransform rotation and scale", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => {
        vi.restoreAllMocks();
        Canvas._reset();
    });

    /** A centred 100x100 element on an 800x600 canvas. */
    function makeElement() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const rt = child("El", canvasGO).addComponent(RectTransform);
        rt.anchorMin.set(0.5, 0.5);
        rt.anchorMax.set(0.5, 0.5);
        rt.pivot.set(0.5, 0.5);
        rt.anchoredPosition.set(0, 0);
        rt.sizeDelta.set(100, 100);
        return { canvas, rt };
    }

    test("the local rect puts the pivot at the origin", () => {
        const { rt } = makeElement();
        const local = rt.getLocalRect(new Rect());
        expect(local.x).toBeCloseTo(-50);
        expect(local.y).toBeCloseTo(-50);
        expect(local.width).toBeCloseTo(100);
        expect(local.height).toBeCloseTo(100);

        rt.pivot.set(0, 0);
        const topLeft = rt.getLocalRect(new Rect());
        expect(topLeft.x).toBeCloseTo(0);
        expect(topLeft.y).toBeCloseTo(0);
    });

    test("an unrotated element still reports the same screen rect as before", () => {
        const { rt } = makeElement();
        const r = rt.getScreenRect(new Rect());
        expect(r.x).toBeCloseTo(350);
        expect(r.y).toBeCloseTo(250);
        expect(r.width).toBeCloseTo(100);
        expect(r.height).toBeCloseTo(100);
    });

    test("a positive angle turns clockwise on screen", () => {
        const { rt } = makeElement();
        rt.localRotation = 90;

        const corners = rt.getWorldCorners();
        // The element's own top-left corner ends up on the screen's top-right.
        expect(corners[0].x).toBeCloseTo(450);
        expect(corners[0].y).toBeCloseTo(250);
    });

    test("rotation leaves the local rect alone and only moves the bounds", () => {
        const { rt } = makeElement();
        const before = rt.getLocalRect(new Rect());

        rt.localRotation = 45;

        const after = rt.getLocalRect(new Rect());
        expect(after.width).toBeCloseTo(before.width);
        expect(after.height).toBeCloseTo(before.height);

        // A 45-degree square's bounds grow to its diagonal, still centred.
        const bounds = rt.getScreenRect(new Rect());
        expect(bounds.width).toBeCloseTo(Math.SQRT2 * 100);
        expect(bounds.height).toBeCloseTo(Math.SQRT2 * 100);
        expect(bounds.x + bounds.width * 0.5).toBeCloseTo(400);
        expect(bounds.y + bounds.height * 0.5).toBeCloseTo(300);
    });

    test("scale grows the element about its pivot", () => {
        const { rt } = makeElement();
        rt.localScale.set(2, 3);

        const bounds = rt.getScreenRect(new Rect());
        expect(bounds.width).toBeCloseTo(200);
        expect(bounds.height).toBeCloseTo(300);
        expect(bounds.x + bounds.width * 0.5).toBeCloseTo(400);
        expect(bounds.y + bounds.height * 0.5).toBeCloseTo(300);
    });

    test("scale about a corner pivot keeps that corner pinned", () => {
        const { rt } = makeElement();
        rt.pivot.set(0, 0);
        const before = rt.getScreenRect(new Rect());

        rt.localScale.set(2, 2);
        const after = rt.getScreenRect(new Rect());

        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
        expect(after.width).toBeCloseTo(200);
    });

    test("a parent's rotation composes into the child", () => {
        const { canvas, rt } = makeElement();
        const childRT = child("Child", rt.gameObject).addComponent(RectTransform);
        childRT.anchorMin.set(0.5, 0.5);
        childRT.anchorMax.set(0.5, 0.5);
        childRT.pivot.set(0.5, 0.5);
        childRT.anchoredPosition.set(50, 0);   // 50 to the right of the parent
        childRT.sizeDelta.set(10, 10);

        expect(childRT.getScreenRect(new Rect()).x + 5).toBeCloseTo(450);

        // Turning the parent a quarter turn clockwise swings the child below it.
        rt.localRotation = 90;
        const swung = childRT.getScreenRect(new Rect());
        expect(swung.x + 5).toBeCloseTo(400);
        expect(swung.y + 5).toBeCloseTo(350);

        expect(canvas).toBeTruthy();
    });

    test("canvasToLocalPoint inverts the transform", () => {
        const { rt } = makeElement();
        rt.localRotation = 30;
        rt.localScale.set(2, 2);

        const corners = rt.getWorldCorners();
        const local = new Vector2();

        expect(rt.canvasToLocalPoint(corners[0].x, corners[0].y, local)).toBe(true);
        expect(local.x).toBeCloseTo(-50);
        expect(local.y).toBeCloseTo(-50);
    });

    test("a degenerate scale reports no local point rather than NaN", () => {
        const { rt } = makeElement();
        rt.localScale.set(0, 0);
        expect(rt.canvasToLocalPoint(400, 300, new Vector2())).toBe(false);
    });

    test("a pure rotation still marks the canvas for repaint", () => {
        const { canvas, rt } = makeElement();
        rt.gameObject.addComponent(UIImage);

        canvas._prepare();
        expect(canvas._prepare()).toBe(false);

        // Bounds barely move for a square turned 90 degrees; the transform must
        // be part of the change hash or the repaint would be skipped.
        rt.localRotation = 90;
        expect(canvas._prepare()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// EventSystem — multi-pointer routing
//
// Buttons with no Canvas ancestor are hit-tested in screen space against the
// 800x600 viewport fallback, which keeps these tests free of a 2D context.
// ---------------------------------------------------------------------------

describe("EventSystem multi-touch", () => {
    let touches: TouchInfo[] = [];

    function makeButton(x: number, y: number): Button {
        const btn = new GameObject("Btn").addComponent(Button);
        const rt = btn.rectTransform;
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.anchoredPosition.set(x, y);
        rt.sizeDelta.set(100, 50);
        return btn;
    }

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];

        // `_update` and the RectTransform viewport fallback both need a window.
        (globalThis as unknown as { window: unknown }).window = {
            innerWidth: 800,
            innerHeight: 600,
        };

        vi.spyOn(Touch, "touches", "get").mockImplementation(() => touches);
        vi.spyOn(Input, "getMouseButton").mockReturnValue(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as unknown as { window?: unknown }).window;
        EventSystem._reset();
        Canvas._reset();
    });

    test("two fingers press two buttons at once", () => {
        const a = makeButton(0, 0);       // covers   0..100 x 0..50
        const b = makeButton(200, 0);     // covers 200..300 x 0..50

        touches = [
            touch(1, 50, 25, TouchPhase.Began),
            touch(2, 250, 25, TouchPhase.Began),
        ];
        EventSystem._update();

        expect(a.state).toBe(ButtonState.Pressed);
        expect(b.state).toBe(ButtonState.Pressed);
    });

    test("each finger fires the click on the button it pressed", () => {
        const a = makeButton(0, 0);
        const b = makeButton(200, 0);

        let clickedA = 0;
        let clickedB = 0;
        a.onClick = () => { clickedA++; };
        b.onClick = () => { clickedB++; };

        touches = [
            touch(1, 50, 25, TouchPhase.Began),
            touch(2, 250, 25, TouchPhase.Began),
        ];
        EventSystem._update();
        expect(clickedA).toBe(0);
        expect(clickedB).toBe(0);

        touches = [
            touch(1, 50, 25, TouchPhase.Ended),
            touch(2, 250, 25, TouchPhase.Ended),
        ];
        EventSystem._update();

        expect(clickedA).toBe(1);
        expect(clickedB).toBe(1);
    });

    test("a finger released off the button it pressed fires nothing", () => {
        const a = makeButton(0, 0);
        let clicked = 0;
        a.onClick = () => { clicked++; };

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();

        // Dragged off the button before lifting.
        touches = [touch(1, 500, 400, TouchPhase.Ended)];
        EventSystem._update();

        expect(clicked).toBe(0);
    });

    test("a press dropped without a release frame does not click later", () => {
        const a = makeButton(0, 0);
        let clicked = 0;
        a.onClick = () => { clicked++; };

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();

        // The finger vanishes outright, as a canceled touch does.
        touches = [];
        EventSystem._update();

        // A later, unrelated press-and-release must not resurrect the first one.
        touches = [touch(1, 500, 400, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 500, 400, TouchPhase.Ended)];
        EventSystem._update();

        expect(clicked).toBe(0);
    });

    test("isPointerOverUI is a union across pointers", () => {
        makeButton(0, 0);

        touches = [touch(1, 700, 500, TouchPhase.Began)];
        EventSystem._update();
        expect(EventSystem.isPointerOverUI).toBe(false);

        // Second finger lands on the button; the first is still off it.
        touches = [
            touch(1, 700, 500, TouchPhase.Moved),
            touch(2, 50, 25, TouchPhase.Began),
        ];
        EventSystem._update();
        expect(EventSystem.isPointerOverUI).toBe(true);
    });

    test("a non-interactable button reports Disabled and never clicks", () => {
        const a = makeButton(0, 0);
        a.interactable = false;
        let clicked = 0;
        a.onClick = () => { clicked++; };

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();
        expect(a.state).toBe(ButtonState.Disabled);

        touches = [touch(1, 50, 25, TouchPhase.Ended)];
        EventSystem._update();
        expect(clicked).toBe(0);
    });

    test("the mouse still drives buttons when no finger is down", () => {
        const a = makeButton(0, 0);
        let clicked = 0;
        a.onClick = () => { clicked++; };

        vi.spyOn(Input, "mousePosition", "get")
            .mockReturnValue(new Vector2(50, 25));
        const button = vi.spyOn(Input, "getMouseButton").mockReturnValue(true);

        EventSystem._update();
        expect(a.state).toBe(ButtonState.Pressed);

        button.mockReturnValue(false);
        EventSystem._update();
        expect(clicked).toBe(1);
    });

    test("hit-testing follows a rotated button, not its bounding box", () => {
        const bar = new GameObject("Bar").addComponent(Button);
        const rt = bar.rectTransform;
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0.5, 0.5);
        rt.anchoredPosition.set(400, 300);
        rt.sizeDelta.set(200, 20);          // a wide, thin horizontal bar

        // Lying flat, a point out along its length hits.
        touches = [touch(1, 480, 300, TouchPhase.Began)];
        EventSystem._update();
        expect(bar.state).toBe(ButtonState.Pressed);

        // 45 degrees, deliberately not a quarter turn: a rectangle rotated by a
        // multiple of 90 stays axis-aligned, so its bounding box still matches
        // it exactly and a bounds-only hit-test would pass by luck.
        rt.localRotation = 45;

        // Well inside the (now much larger) bounding box, but off the bar's
        // narrow diagonal band. Only the inverse transform rejects this.
        touches = [touch(2, 470, 230, TouchPhase.Began)];
        EventSystem._update();
        expect(bar.state).toBe(ButtonState.Normal);

        // On the band, out along its new diagonal.
        touches = [touch(3, 456, 356, TouchPhase.Began)];
        EventSystem._update();
        expect(bar.state).toBe(ButtonState.Pressed);
    });

    test("getPointerPosition writes into the supplied vector", () => {
        makeButton(0, 0);
        touches = [touch(1, 120, 45, TouchPhase.Began)];
        EventSystem._update();

        const out = new Vector2();
        expect(EventSystem.getPointerPosition(out)).toBe(out);
        expect(out.x).toBeCloseTo(120);
        expect(out.y).toBeCloseTo(45);
    });
});
