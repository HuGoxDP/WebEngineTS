import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Canvas, CanvasRenderMode, CanvasRepaintMode } from "../src/engine/core/ui/Canvas";
import { EventSystem } from "../src/engine/core/ui/EventSystem";
import { UIEvent } from "../src/engine/core/ui/UIEvent";
import { PointerEventData } from "../src/engine/core/ui/PointerEventData";
import { Slider, SliderDirection } from "../src/engine/core/ui/Slider";
import { Toggle } from "../src/engine/core/ui/Toggle";
import { ToggleGroup } from "../src/engine/core/ui/ToggleGroup";
import { LayoutElement } from "../src/engine/core/ui/LayoutElement";
import {
    LayoutGroup, LayoutAnchor,
    HorizontalLayoutGroup, VerticalLayoutGroup,
} from "../src/engine/core/ui/LayoutGroup";
import { ContentSizeFitter, FitMode } from "../src/engine/core/ui/ContentSizeFitter";
import { CanvasGroup } from "../src/engine/core/ui/CanvasGroup";
import { RectMask2D } from "../src/engine/core/ui/RectMask2D";
import { ScrollRect, ScrollMovementType } from "../src/engine/core/ui/ScrollRect";
import { Time } from "../src/engine/core/Time";
import {
    GridLayoutGroup, GridStartCorner, GridStartAxis, GridConstraint,
} from "../src/engine/core/ui/GridLayoutGroup";
import { Input } from "../src/engine/core/Input";
import { Touch, TouchInfo, TouchPhase } from "../src/engine/core/input/Touch";
import { Button, ButtonState } from "../src/engine/core/ui/Button";
import { SelectableState } from "../src/engine/core/ui/Selectable";
import { TextAlignment, TextOverflow, UIText, VerticalAlignment } from "../src/engine/core/ui/UIText";
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
        setTransform: () => { ops.push("setTransform"); },
        transform: () => { ops.push("transform"); },
        clearRect: () => { ops.push("clearRect"); },
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

        // State is derived from pointer events rather than assigned, so it is
        // driven the way the EventSystem drives it.
        btn.onPointerDown.invoke(new PointerEventData());
        expect(btn.state).toBe(ButtonState.Pressed);
        expect(btn._visualHash()).not.toBe(normal);

        btn.onPointerUp.invoke(new PointerEventData());
        expect(btn.state).toBe(ButtonState.Normal);
        expect(btn._visualHash()).toBe(normal);
    });

    test("a disabled button reports the disabled color regardless of state", () => {
        const btn = new GameObject("Btn").addComponent(Button);
        btn.onPointerDown.invoke(new PointerEventData());
        const enabledHash = btn._visualHash();

        btn.interactable = false;
        expect(btn.state).toBe(ButtonState.Disabled);
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

    test("a click still fires through the assignable onClick", () => {
        const btn = makeButton(0, 0);
        let clicked = 0;
        btn.onClick = () => { clicked++; };

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 50, 25, TouchPhase.Ended)];
        EventSystem._update();

        expect(clicked).toBe(1);
    });

    test("assigning onClick does not drop addListener subscribers", () => {
        const btn = makeButton(0, 0);
        const seen: string[] = [];
        btn.onClick.addListener(() => seen.push("listener"));
        btn.onClick = () => seen.push("assigned");

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 50, 25, TouchPhase.Ended)];
        EventSystem._update();

        expect(seen).toEqual(["assigned", "listener"]);
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

// ---------------------------------------------------------------------------
// UIEvent
// ---------------------------------------------------------------------------

describe("UIEvent", () => {
    test("calls every listener in subscription order", () => {
        const ev = new UIEvent<number>();
        const seen: string[] = [];
        ev.addListener(n => seen.push(`a${n}`));
        ev.addListener(n => seen.push(`b${n}`));

        ev.invoke(1);
        expect(seen).toEqual(["a1", "b1"]);
    });

    test("removeListener drops one subscription and leaves the rest", () => {
        const ev = new UIEvent<void>();
        let a = 0;
        let b = 0;
        const first = () => { a++; };
        ev.addListener(first);
        ev.addListener(() => { b++; });

        ev.removeListener(first);
        ev.invoke(undefined);

        expect(a).toBe(0);
        expect(b).toBe(1);
    });

    test("removing a listener that was never added is a no-op", () => {
        const ev = new UIEvent<void>();
        let calls = 0;
        ev.addListener(() => { calls++; });
        ev.removeListener(() => { /* a different function object */ });

        ev.invoke(undefined);
        expect(calls).toBe(1);
    });

    test("a throwing listener does not stop the others", () => {
        const ev = new UIEvent<void>();
        const errors = vi.spyOn(console, "error").mockImplementation(() => { /* quiet */ });
        let reached = 0;

        ev.addListener(() => { throw new Error("boom"); });
        ev.addListener(() => { reached++; });
        ev.invoke(undefined);

        expect(reached).toBe(1);
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();
    });

    test("a listener may unsubscribe itself mid-dispatch", () => {
        const ev = new UIEvent<void>();
        let calls = 0;
        const once = () => {
            calls++;
            ev.removeListener(once);
        };
        ev.addListener(once);
        ev.addListener(() => { /* keeps the list above length 1 */ });

        ev.invoke(undefined);
        ev.invoke(undefined);

        expect(calls).toBe(1);
    });

    test("removeAllListeners clears the assigned handler too", () => {
        const ev = new UIEvent<void>();
        let calls = 0;
        ev.addListener(() => { calls++; });
        ev._setAssigned(() => { calls++; });

        expect(ev.listenerCount).toBe(2);
        ev.removeAllListeners();
        ev.invoke(undefined);

        expect(calls).toBe(0);
        expect(ev.hasListeners).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Pointer and drag events on any graphic
// ---------------------------------------------------------------------------

describe("UIBehaviour pointer events", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    /** An 800x600 canvas holding one 200x100 image at the top-left. */
    function makeScene() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const panelGO = child("Panel", canvasGO);
        const panel = panelGO.addComponent(UIImage);
        const prt = panel.rectTransform;
        prt.anchorMin.set(0, 0);
        prt.anchorMax.set(0, 0);
        prt.pivot.set(0, 0);
        prt.anchoredPosition.set(0, 0);
        prt.sizeDelta.set(200, 100);

        return { canvas, panel, panelGO };
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];
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

    test("down, up and click fire on a plain graphic", () => {
        const { panel } = makeScene();
        const seen: string[] = [];
        panel.onPointerDown.addListener(() => seen.push("down"));
        panel.onPointerUp.addListener(() => seen.push("up"));
        panel.onPointerClick.addListener(() => seen.push("click"));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        expect(seen).toEqual(["down"]);

        touches = [touch(1, 50, 50, TouchPhase.Ended)];
        EventSystem._update();
        expect(seen).toEqual(["down", "up", "click"]);
    });

    test("releasing off the element gives up without a click", () => {
        const { panel } = makeScene();
        const seen: string[] = [];
        panel.onPointerUp.addListener(() => seen.push("up"));
        panel.onPointerClick.addListener(() => seen.push("click"));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 700, 500, TouchPhase.Ended)];
        EventSystem._update();

        expect(seen).toEqual(["up"]);
    });

    test("enter and exit follow the pointer on and off the element", () => {
        const { panel } = makeScene();
        const seen: string[] = [];
        panel.onPointerEnter.addListener(() => seen.push("enter"));
        panel.onPointerExit.addListener(() => seen.push("exit"));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        expect(seen).toEqual(["enter"]);

        // Still inside: no repeat.
        touches = [touch(1, 60, 60, TouchPhase.Moved)];
        EventSystem._update();
        expect(seen).toEqual(["enter"]);

        touches = [touch(1, 700, 500, TouchPhase.Moved)];
        EventSystem._update();
        expect(seen).toEqual(["enter", "exit"]);
    });

    test("a press shorter than the drag threshold never becomes a drag", () => {
        const { panel } = makeScene();
        const seen: string[] = [];
        panel.onBeginDrag.addListener(() => seen.push("begin"));
        panel.onPointerClick.addListener(() => seen.push("click"));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 53, 50, TouchPhase.Moved)];   // 3 < threshold of 5
        EventSystem._update();
        touches = [touch(1, 53, 50, TouchPhase.Ended)];
        EventSystem._update();

        expect(seen).toEqual(["click"]);
    });

    test("moving past the threshold begins a drag and suppresses the click", () => {
        const { panel } = makeScene();
        const seen: string[] = [];
        panel.onBeginDrag.addListener(() => seen.push("begin"));
        panel.onDrag.addListener(() => seen.push("drag"));
        panel.onEndDrag.addListener(() => seen.push("end"));
        panel.onPointerClick.addListener(() => seen.push("click"));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        expect(seen).toEqual([]);

        touches = [touch(1, 90, 50, TouchPhase.Moved)];
        EventSystem._update();
        expect(seen).toEqual(["begin", "drag"]);

        touches = [touch(1, 120, 50, TouchPhase.Moved)];
        EventSystem._update();
        expect(seen).toEqual(["begin", "drag", "drag"]);

        touches = [touch(1, 120, 50, TouchPhase.Ended)];
        EventSystem._update();
        // A drag is not a click, matching Unity.
        expect(seen).toEqual(["begin", "drag", "drag", "end"]);
    });

    test("drag delta reports movement since the previous frame", () => {
        const { panel } = makeScene();
        const deltas: number[] = [];
        panel.onDrag.addListener(e => deltas.push(e.delta.x));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 90, 50, TouchPhase.Moved)];
        EventSystem._update();
        touches = [touch(1, 105, 50, TouchPhase.Moved)];
        EventSystem._update();

        expect(deltas[0]).toBeCloseTo(40);
        expect(deltas[1]).toBeCloseTo(15);
    });

    test("a drag continues once started even when the pointer leaves", () => {
        const { panel } = makeScene();
        let drags = 0;
        panel.onDrag.addListener(() => { drags++; });

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 90, 50, TouchPhase.Moved)];
        EventSystem._update();
        touches = [touch(1, 700, 500, TouchPhase.Moved)];   // far outside
        EventSystem._update();

        expect(drags).toBe(2);
    });

    test("an event with no listener on the hit element goes to its ancestor", () => {
        const { panel, panelGO } = makeScene();
        const label = child("Label", panelGO).addComponent(UIText);
        const lrt = label.rectTransform;
        lrt.anchorMin.set(0, 0);
        lrt.anchorMax.set(1, 1);
        lrt.pivot.set(0, 0);
        lrt.anchoredPosition.set(0, 0);
        lrt.sizeDelta.set(0, 0);

        let onPanel = 0;
        panel.onPointerClick.addListener(() => { onPanel++; });

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 50, 50, TouchPhase.Ended)];
        EventSystem._update();

        expect(onPanel).toBe(1);
    });

    test("localPosition arrives in the element's own space", () => {
        const { panel } = makeScene();
        let local = new Vector2();
        panel.onPointerDown.addListener(e => { local = e.localPosition.clone(); });

        touches = [touch(1, 50, 30, TouchPhase.Began)];
        EventSystem._update();

        // Pivot (0,0) puts the element's origin at its top-left corner, which is
        // also the canvas origin here.
        expect(local.x).toBeCloseTo(50);
        expect(local.y).toBeCloseTo(30);
    });

    test("a pointer that vanishes mid-drag still ends the drag", () => {
        const { panel } = makeScene();
        const seen: string[] = [];
        panel.onEndDrag.addListener(() => seen.push("end"));
        panel.onPointerExit.addListener(() => seen.push("exit"));

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 90, 50, TouchPhase.Moved)];
        EventSystem._update();

        touches = [];   // the finger is simply gone
        EventSystem._update();

        expect(seen).toContain("end");
        expect(seen).toContain("exit");
    });

    test("two fingers drag two elements independently", () => {
        const { canvas, panel } = makeScene();
        const other = child("Other", canvas.gameObject).addComponent(UIImage);
        const ort = other.rectTransform;
        ort.anchorMin.set(0, 0);
        ort.anchorMax.set(0, 0);
        ort.pivot.set(0, 0);
        ort.anchoredPosition.set(400, 0);
        ort.sizeDelta.set(200, 100);

        let dragsA = 0;
        let dragsB = 0;
        panel.onDrag.addListener(() => { dragsA++; });
        other.onDrag.addListener(() => { dragsB++; });

        touches = [
            touch(1, 50, 50, TouchPhase.Began),
            touch(2, 450, 50, TouchPhase.Began),
        ];
        EventSystem._update();

        touches = [
            touch(1, 100, 50, TouchPhase.Moved),
            touch(2, 500, 50, TouchPhase.Moved),
        ];
        EventSystem._update();

        expect(dragsA).toBe(1);
        expect(dragsB).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Slider and Toggle
// ---------------------------------------------------------------------------

describe("Slider", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    /**
     * A 200x40 slider at the canvas origin. With handleSize 20 the usable track
     * runs from local x=10 to x=190, so 180 units span the whole range.
     */
    function makeSlider() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const slider = child("Slider", canvasGO).addComponent(Slider);
        const rt = slider.rectTransform;
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.anchoredPosition.set(0, 0);
        rt.sizeDelta.set(200, 40);
        return { canvas, slider };
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];
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

    test("value clamps into the range", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 10;

        slider.value = 20;
        expect(slider.value).toBe(10);

        slider.value = -5;
        expect(slider.value).toBe(0);
    });

    test("onValueChanged fires only on a real change", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 10;

        const seen: number[] = [];
        slider.onValueChanged.addListener(v => seen.push(v));

        slider.value = 5;
        slider.value = 5;
        slider.value = 7;

        expect(seen).toEqual([5, 7]);
    });

    test("wholeNumbers snaps assigned values to integers", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 10;
        slider.wholeNumbers = true;

        slider.value = 3.6;
        expect(slider.value).toBe(4);
    });

    test("normalizedValue maps across the range", () => {
        const { slider } = makeSlider();
        slider.minValue = 20;
        slider.maxValue = 40;

        slider.normalizedValue = 0.5;
        expect(slider.value).toBeCloseTo(30);
        expect(slider.normalizedValue).toBeCloseTo(0.5);
    });

    test("pressing the track jumps the value to that point", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 100;

        // Track spans local x 10..190; x=100 is the midpoint.
        touches = [touch(1, 100, 20, TouchPhase.Began)];
        EventSystem._update();

        expect(slider.normalizedValue).toBeCloseTo(0.5);
        expect(slider.isPressed).toBe(true);
    });

    test("dragging past the ends clamps rather than overshoots", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 100;

        touches = [touch(1, 100, 20, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 5000, 20, TouchPhase.Moved)];
        EventSystem._update();
        expect(slider.value).toBe(100);

        touches = [touch(1, -5000, 20, TouchPhase.Moved)];
        EventSystem._update();
        expect(slider.value).toBe(0);
    });

    test("RightToLeft mirrors the mapping", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 100;
        slider.direction = SliderDirection.RightToLeft;

        // The low end is now on the right, so the far left reads as maximum.
        touches = [touch(1, 10, 20, TouchPhase.Began)];
        EventSystem._update();
        expect(slider.value).toBeCloseTo(100);
    });

    test("a vertical slider reads along Y, with TopToBottom increasing", () => {
        const { slider } = makeSlider();
        slider.rectTransform.sizeDelta.set(40, 200);
        slider.direction = SliderDirection.TopToBottom;
        slider.minValue = 0;
        slider.maxValue = 100;
        expect(slider.isVertical).toBe(true);

        touches = [touch(1, 20, 10, TouchPhase.Began)];
        EventSystem._update();
        const atTop = slider.value;

        touches = [touch(1, 20, 190, TouchPhase.Moved)];
        EventSystem._update();
        const atBottom = slider.value;

        expect(atTop).toBeCloseTo(0);
        expect(atBottom).toBeCloseTo(100);
    });

    test("a non-interactable slider ignores the pointer", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 100;
        slider.value = 25;
        slider.interactable = false;

        touches = [touch(1, 190, 20, TouchPhase.Began)];
        EventSystem._update();

        expect(slider.value).toBe(25);
    });

    test("dragging marks the event consumed so an outer scroller stays put", () => {
        const { slider } = makeSlider();
        let sawConsumed = false;
        slider.onPointerDown.addListener(e => { sawConsumed = e.consumed; });

        touches = [touch(1, 100, 20, TouchPhase.Began)];
        EventSystem._update();

        // The slider's own listener runs first and sets the flag.
        expect(sawConsumed).toBe(true);
    });

    test("the visual hash tracks the value", () => {
        const { slider } = makeSlider();
        slider.minValue = 0;
        slider.maxValue = 10;
        const before = slider._visualHash();
        slider.value = 8;
        expect(slider._visualHash()).not.toBe(before);
    });
});

describe("Toggle", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    function makeScene() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);
        return { canvasGO, canvas };
    }

    function addToggle(canvasGO: GameObject, x: number): Toggle {
        const toggle = child(`Toggle${x}`, canvasGO).addComponent(Toggle);
        const rt = toggle.rectTransform;
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.anchoredPosition.set(x, 0);
        rt.sizeDelta.set(100, 30);
        return toggle;
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];
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

    test("clicking flips the state and notifies", () => {
        const { canvasGO } = makeScene();
        const toggle = addToggle(canvasGO, 0);
        const seen: boolean[] = [];
        toggle.onValueChanged.addListener(v => seen.push(v));

        touches = [touch(1, 10, 10, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 10, 10, TouchPhase.Ended)];
        EventSystem._update();
        expect(toggle.isOn).toBe(true);

        touches = [touch(2, 10, 10, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(2, 10, 10, TouchPhase.Ended)];
        EventSystem._update();
        expect(toggle.isOn).toBe(false);

        expect(seen).toEqual([true, false]);
    });

    test("setIsOnWithoutNotify changes state silently", () => {
        const { canvasGO } = makeScene();
        const toggle = addToggle(canvasGO, 0);
        let calls = 0;
        toggle.onValueChanged.addListener(() => { calls++; });

        toggle.setIsOnWithoutNotify(true);

        expect(toggle.isOn).toBe(true);
        expect(calls).toBe(0);
    });

    test("assigning the same state notifies nobody", () => {
        const { canvasGO } = makeScene();
        const toggle = addToggle(canvasGO, 0);
        toggle.isOn = true;

        let calls = 0;
        toggle.onValueChanged.addListener(() => { calls++; });
        toggle.isOn = true;

        expect(calls).toBe(0);
    });

    test("a non-interactable toggle ignores clicks", () => {
        const { canvasGO } = makeScene();
        const toggle = addToggle(canvasGO, 0);
        toggle.interactable = false;

        touches = [touch(1, 10, 10, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 10, 10, TouchPhase.Ended)];
        EventSystem._update();

        expect(toggle.isOn).toBe(false);
    });

    test("the visual hash tracks the checked state", () => {
        const { canvasGO } = makeScene();
        const toggle = addToggle(canvasGO, 0);
        const before = toggle._visualHash();
        toggle.isOn = true;
        expect(toggle._visualHash()).not.toBe(before);
    });
});

describe("ToggleGroup", () => {
    function makeGroup() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const group = canvasGO.addComponent(ToggleGroup);
        const a = child("A", canvasGO).addComponent(Toggle);
        const b = child("B", canvasGO).addComponent(Toggle);
        const c = child("C", canvasGO).addComponent(Toggle);
        a.group = group;
        b.group = group;
        c.group = group;
        return { group, a, b, c };
    }

    beforeEach(() => Canvas._reset());
    afterEach(() => {
        vi.restoreAllMocks();
        Canvas._reset();
    });

    test("turning one on turns the others off", () => {
        const { group, a, b, c } = makeGroup();

        a.isOn = true;
        expect(group.active).toBe(a);

        b.isOn = true;
        expect(a.isOn).toBe(false);
        expect(b.isOn).toBe(true);
        expect(c.isOn).toBe(false);
        expect(group.active).toBe(b);
    });

    test("siblings switched off by the group still notify", () => {
        const { a, b } = makeGroup();
        const seen: boolean[] = [];
        a.onValueChanged.addListener(v => seen.push(v));

        a.isOn = true;
        b.isOn = true;

        expect(seen).toEqual([true, false]);
    });

    test("the last selection cannot be cleared by default", () => {
        const { group, a } = makeGroup();
        a.isOn = true;

        a.isOn = false;

        expect(a.isOn).toBe(true);
        expect(group.anyTogglesOn()).toBe(true);
    });

    test("allowSwitchOff lets the active one be turned off", () => {
        const { group, a } = makeGroup();
        group.allowSwitchOff = true;
        a.isOn = true;

        a.isOn = false;

        expect(a.isOn).toBe(false);
        expect(group.active).toBeNull();
    });

    test("setAllTogglesOff clears the group regardless", () => {
        const { group, a } = makeGroup();
        a.isOn = true;

        group.setAllTogglesOff();

        expect(group.anyTogglesOn()).toBe(false);
    });

    test("leaving the group drops the toggle from it", () => {
        const { group, a, b } = makeGroup();
        a.isOn = true;

        a.group = null;
        b.isOn = true;

        // No longer a member, so the group cannot switch it off.
        expect(a.isOn).toBe(true);
        expect(group.members).not.toContain(a);
    });
});

// ---------------------------------------------------------------------------
// UIText measurement and overflow
//
// The mock context measures 10 units per character, so widths are exact and
// readable: "abc" is 30 wide.
// ---------------------------------------------------------------------------

describe("UIText measurement", () => {
    beforeEach(() => Canvas._reset());
    afterEach(() => {
        UIText._setMeasureContext(undefined);
        vi.restoreAllMocks();
        Canvas._reset();
    });

    function makeLabel(): UIText {
        return new GameObject("Label").addComponent(UIText);
    }

    test("preferredWidth is the widest unwrapped line", () => {
        UIText._setMeasureContext(makeContext().ctx);
        const t = makeLabel();
        t.text = "abc\nabcdefgh\nab";

        expect(t.preferredWidth).toBeCloseTo(80);
    });

    test("preferredWidth is zero without a measuring context", () => {
        UIText._setMeasureContext(null);
        const t = makeLabel();
        t.text = "abcdef";

        expect(t.preferredWidth).toBe(0);
    });

    test("getPreferredHeight grows as the width shrinks", () => {
        UIText._setMeasureContext(makeContext().ctx);
        const t = makeLabel();
        t.text = "aaa bbb ccc ddd";
        t.fontSize = 10;
        t.lineHeight = 1;
        t.wordWrap = true;

        const wide = t.getPreferredHeight(1000);
        const narrow = t.getPreferredHeight(70);

        expect(wide).toBeCloseTo(10);
        expect(narrow).toBeGreaterThan(wide);
    });

    test("an empty label prefers nothing", () => {
        UIText._setMeasureContext(makeContext().ctx);
        const t = makeLabel();
        t.text = "";

        expect(t.preferredWidth).toBe(0);
        expect(t.getPreferredHeight(100)).toBe(0);
    });
});

describe("UIText overflow", () => {
    function makeLabel(): UIText {
        const t = new GameObject("Label").addComponent(UIText);
        t.fontSize = 10;
        t.lineHeight = 1;
        return t;
    }

    test("a word wider than the rect is broken between characters", () => {
        const m = makeContext();
        const t = makeLabel();
        t.text = "aaaaaaaaaa";      // 100 wide against a 50-wide rect
        t.wordWrap = true;

        t._draw(m.ctx, new Rect(0, 0, 50, 200));

        expect(m.texts.length).toBeGreaterThan(1);
        expect(m.texts.join("")).toBe("aaaaaaaaaa");
    });

    test("Clip stops at the last line that fits", () => {
        const m = makeContext();
        const t = makeLabel();
        t.text = "one\ntwo\nthree\nfour";
        t.wordWrap = false;
        t.overflow = TextOverflow.Clip;

        // Room for two 10-unit lines.
        t._draw(m.ctx, new Rect(0, 0, 200, 20));

        expect(m.texts).toEqual(["one", "two"]);
    });

    test("Overflow draws every line regardless of the rect", () => {
        const m = makeContext();
        const t = makeLabel();
        t.text = "one\ntwo\nthree\nfour";
        t.wordWrap = false;
        t.overflow = TextOverflow.Overflow;

        t._draw(m.ctx, new Rect(0, 0, 200, 20));

        expect(m.texts).toEqual(["one", "two", "three", "four"]);
    });

    test("Ellipsis marks the last visible line when more follow", () => {
        const m = makeContext();
        const t = makeLabel();
        t.text = "one\ntwo\nthree\nfour";
        t.wordWrap = false;
        t.overflow = TextOverflow.Ellipsis;

        t._draw(m.ctx, new Rect(0, 0, 200, 20));

        expect(m.texts.length).toBe(2);
        expect(m.texts[0]).toBe("one");
        expect(m.texts[1].endsWith("…")).toBe(true);
    });

    test("Ellipsis leaves fully visible text untouched", () => {
        const m = makeContext();
        const t = makeLabel();
        t.text = "one\ntwo";
        t.wordWrap = false;
        t.overflow = TextOverflow.Ellipsis;

        t._draw(m.ctx, new Rect(0, 0, 200, 100));

        expect(m.texts).toEqual(["one", "two"]);
    });

    test("Ellipsis truncates a too-wide line when wrapping is off", () => {
        const m = makeContext();
        const t = makeLabel();
        t.text = "abcdefghij";        // 100 wide
        t.wordWrap = false;
        t.overflow = TextOverflow.Ellipsis;

        t._draw(m.ctx, new Rect(0, 0, 50, 100));

        expect(m.texts.length).toBe(1);
        expect(m.texts[0].endsWith("…")).toBe(true);
        expect(m.texts[0].length).toBeLessThan(t.text.length);
    });

    test("the visual hash tracks the overflow mode", () => {
        const t = makeLabel();
        const before = t._visualHash();
        t.overflow = TextOverflow.Ellipsis;
        expect(t._visualHash()).not.toBe(before);
    });
});

// ---------------------------------------------------------------------------
// Layout groups and ContentSizeFitter
// ---------------------------------------------------------------------------

describe("LayoutGroup", () => {
    beforeEach(() => {
        Canvas._reset();
        LayoutGroup._reset();
        ContentSizeFitter._reset();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Canvas._reset();
        LayoutGroup._reset();
        ContentSizeFitter._reset();
    });

    /** A 400x300 panel under an 800x600 canvas, ready to host a group. */
    function makePanel() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const panelGO = child("Panel", canvasGO);
        const prt = panelGO.addComponent(RectTransform);
        prt.anchorMin.set(0, 0);
        prt.anchorMax.set(0, 0);
        prt.pivot.set(0, 0);
        prt.anchoredPosition.set(0, 0);
        prt.sizeDelta.set(400, 300);
        return { canvasGO, panelGO, prt };
    }

    /** A fixed-size child row. */
    function addRow(parent: GameObject, name: string, w: number, h: number): RectTransform {
        const go = child(name, parent);
        const rt = go.addComponent(RectTransform);
        rt.sizeDelta.set(w, h);
        const el = go.addComponent(LayoutElement);
        el.preferredWidth = w;
        el.preferredHeight = h;
        return rt;
    }

    test("a vertical group stacks children downward with spacing", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.spacing = 10;
        group.childForceExpandCross = false;

        const a = addRow(panelGO, "A", 100, 40);
        const b = addRow(panelGO, "B", 100, 60);

        LayoutGroup._updateAll();

        expect(a.getScreenRect(new Rect()).y).toBeCloseTo(0);
        expect(a.getScreenRect(new Rect()).height).toBeCloseTo(40);
        expect(b.getScreenRect(new Rect()).y).toBeCloseTo(50);
        expect(b.getScreenRect(new Rect()).height).toBeCloseTo(60);
    });

    test("a horizontal group stacks children rightward", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(HorizontalLayoutGroup);
        group.spacing = 5;
        group.childForceExpandCross = false;

        const a = addRow(panelGO, "A", 80, 30);
        const b = addRow(panelGO, "B", 120, 30);

        LayoutGroup._updateAll();

        expect(a.getScreenRect(new Rect()).x).toBeCloseTo(0);
        expect(b.getScreenRect(new Rect()).x).toBeCloseTo(85);
        expect(b.getScreenRect(new Rect()).width).toBeCloseTo(120);
    });

    test("padding insets the whole block", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.padding.set(12, 8, 20, 0);
        group.childForceExpandCross = false;

        const a = addRow(panelGO, "A", 100, 40);
        LayoutGroup._updateAll();

        const r = a.getScreenRect(new Rect());
        expect(r.x).toBeCloseTo(12);
        expect(r.y).toBeCloseTo(20);
    });

    test("childForceExpandCross stretches children across the other axis", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.padding.set(10, 10, 0, 0);
        group.childForceExpandCross = true;

        const a = addRow(panelGO, "A", 50, 40);
        LayoutGroup._updateAll();

        // 400 wide minus 10 padding on each side.
        expect(a.getScreenRect(new Rect()).width).toBeCloseTo(380);
    });

    test("reverseArrangement stacks the other way", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.childForceExpandCross = false;
        group.reverseArrangement = true;

        const a = addRow(panelGO, "A", 100, 40);
        const b = addRow(panelGO, "B", 100, 40);

        LayoutGroup._updateAll();

        // B is laid out first, so A ends up below it.
        expect(b.getScreenRect(new Rect()).y).toBeCloseTo(0);
        expect(a.getScreenRect(new Rect()).y).toBeCloseTo(40);
    });

    test("flexible children absorb the leftover space", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(HorizontalLayoutGroup);
        group.childForceExpandCross = false;

        const a = addRow(panelGO, "A", 100, 30);
        const b = addRow(panelGO, "B", 100, 30);
        b.gameObject.getComponent(LayoutElement)!.flexibleWidth = 1;

        LayoutGroup._updateAll();

        // 400 available, 200 used: B takes all 200 spare.
        expect(a.getScreenRect(new Rect()).width).toBeCloseTo(100);
        expect(b.getScreenRect(new Rect()).width).toBeCloseTo(300);
    });

    test("childForceExpandWidth splits spare space evenly when nobody claims it", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(HorizontalLayoutGroup);
        group.childForceExpandCross = false;
        group.childForceExpandWidth = true;

        const a = addRow(panelGO, "A", 100, 30);
        const b = addRow(panelGO, "B", 100, 30);

        LayoutGroup._updateAll();

        expect(a.getScreenRect(new Rect()).width).toBeCloseTo(200);
        expect(b.getScreenRect(new Rect()).width).toBeCloseTo(200);
    });

    test("alignment parks a short block at the far edge", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.childForceExpandCross = false;
        group.childAlignment = LayoutAnchor.LowerLeft;

        const a = addRow(panelGO, "A", 100, 40);
        LayoutGroup._updateAll();

        // LowerLeft is the high-Y edge in this Y-down system.
        expect(a.getScreenRect(new Rect()).y).toBeCloseTo(260);
    });

    test("ignoreLayout leaves a child where it was put", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.childForceExpandCross = false;

        const floating = addRow(panelGO, "Floating", 50, 50);
        floating.gameObject.getComponent(LayoutElement)!.ignoreLayout = true;
        floating.anchorMin.set(0, 0);
        floating.anchorMax.set(0, 0);
        floating.pivot.set(0, 0);
        floating.anchoredPosition.set(333, 222);

        const a = addRow(panelGO, "A", 100, 40);
        LayoutGroup._updateAll();

        expect(floating.getScreenRect(new Rect()).x).toBeCloseTo(333);
        // The managed child still starts at the top, unaffected by the skipped one.
        expect(a.getScreenRect(new Rect()).y).toBeCloseTo(0);
    });

    test("an inactive child is left out of the arrangement", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.childForceExpandCross = false;

        const a = addRow(panelGO, "A", 100, 40);
        const b = addRow(panelGO, "B", 100, 40);
        a.gameObject.setActive(false);

        LayoutGroup._updateAll();

        expect(b.getScreenRect(new Rect()).y).toBeCloseTo(0);
    });

    test("a settled layout writes the same numbers, so the rect cache still hits", () => {
        const { panelGO } = makePanel();
        const group = panelGO.addComponent(VerticalLayoutGroup);
        group.childForceExpandCross = false;
        const a = addRow(panelGO, "A", 100, 40);

        LayoutGroup._updateAll();
        a.getScreenRect(new Rect());

        // Re-running the layout must not disturb the snapshot, or every frame
        // would recompute every rect in the group.
        LayoutGroup._updateAll();
        const sets = vi.spyOn(Rect.prototype, "set");
        a.getScreenRect(new Rect());

        expect(sets.mock.calls.length).toBe(1);
    });
});

describe("ContentSizeFitter", () => {
    beforeEach(() => {
        Canvas._reset();
        LayoutGroup._reset();
        ContentSizeFitter._reset();
    });
    afterEach(() => {
        UIText._setMeasureContext(undefined);
        vi.restoreAllMocks();
        Canvas._reset();
        LayoutGroup._reset();
        ContentSizeFitter._reset();
    });

    function makeCanvas(): GameObject {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);
        return canvasGO;
    }

    test("PreferredSize sizes a label to its text", () => {
        UIText._setMeasureContext(makeContext().ctx);
        const canvasGO = makeCanvas();

        const go = child("Label", canvasGO);
        const rt = go.addComponent(RectTransform);
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.sizeDelta.set(10, 10);

        const label = go.addComponent(UIText);
        label.text = "abcde";      // 50 wide in the mock
        label.fontSize = 10;
        label.lineHeight = 1;

        const fitter = go.addComponent(ContentSizeFitter);
        fitter.horizontalFit = FitMode.PreferredSize;
        fitter.verticalFit = FitMode.PreferredSize;

        ContentSizeFitter._updateAll();

        expect(rt.getScreenRect(new Rect()).width).toBeCloseTo(50);
        expect(rt.getScreenRect(new Rect()).height).toBeCloseTo(10);
    });

    test("Unconstrained leaves the axis alone", () => {
        UIText._setMeasureContext(makeContext().ctx);
        const canvasGO = makeCanvas();

        const go = child("Label", canvasGO);
        const rt = go.addComponent(RectTransform);
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.sizeDelta.set(123, 45);

        const label = go.addComponent(UIText);
        label.text = "abcde";

        const fitter = go.addComponent(ContentSizeFitter);
        fitter.horizontalFit = FitMode.Unconstrained;
        fitter.verticalFit = FitMode.Unconstrained;

        ContentSizeFitter._updateAll();

        expect(rt.getScreenRect(new Rect()).width).toBeCloseTo(123);
        expect(rt.getScreenRect(new Rect()).height).toBeCloseTo(45);
    });

    test("a fitter on a layout group sizes to the arranged children", () => {
        const canvasGO = makeCanvas();

        const listGO = child("List", canvasGO);
        const lrt = listGO.addComponent(RectTransform);
        lrt.anchorMin.set(0, 0);
        lrt.anchorMax.set(0, 0);
        lrt.pivot.set(0, 0);
        lrt.anchoredPosition.set(0, 0);
        lrt.sizeDelta.set(200, 10);

        const group = listGO.addComponent(VerticalLayoutGroup);
        group.spacing = 5;
        group.childForceExpandCross = false;

        for (const name of ["A", "B", "C"]) {
            const go = child(name, listGO);
            go.addComponent(RectTransform);
            const el = go.addComponent(LayoutElement);
            el.preferredWidth = 100;
            el.preferredHeight = 30;
        }

        const fitter = listGO.addComponent(ContentSizeFitter);
        fitter.verticalFit = FitMode.PreferredSize;

        LayoutGroup._updateAll();
        ContentSizeFitter._updateAll();

        // Three 30-tall rows with two 5-unit gaps.
        expect(lrt.getScreenRect(new Rect()).height).toBeCloseTo(100);
    });

    test("a stretched element subtracts its anchor span", () => {
        const canvasGO = makeCanvas();

        const go = child("Stretched", canvasGO);
        const rt = go.addComponent(RectTransform);
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 0);     // full canvas width
        rt.pivot.set(0, 0);

        const el = go.addComponent(LayoutElement);
        el.preferredWidth = 300;

        const fitter = go.addComponent(ContentSizeFitter);
        fitter.horizontalFit = FitMode.PreferredSize;

        ContentSizeFitter._updateAll();

        // Assigning 300 straight into sizeDelta would have given 800 + 300.
        expect(rt.getScreenRect(new Rect()).width).toBeCloseTo(300);
    });
});

// ---------------------------------------------------------------------------
// CanvasGroup
// ---------------------------------------------------------------------------

describe("CanvasGroup", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    /** Canvas -> Panel(200x100 image) -> Label, with the panel groupable. */
    function makeScene() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const panelGO = child("Panel", canvasGO);
        const panel = panelGO.addComponent(UIImage);
        const prt = panel.rectTransform;
        prt.anchorMin.set(0, 0);
        prt.anchorMax.set(0, 0);
        prt.pivot.set(0, 0);
        prt.anchoredPosition.set(0, 0);
        prt.sizeDelta.set(200, 100);

        const labelGO = child("Label", panelGO);
        const label = labelGO.addComponent(UIImage);
        const lrt = label.rectTransform;
        lrt.anchorMin.set(0, 0);
        lrt.anchorMax.set(1, 1);
        lrt.pivot.set(0, 0);
        lrt.anchoredPosition.set(0, 0);
        lrt.sizeDelta.set(0, 0);

        return { canvas, canvasGO, panel, panelGO, label, labelGO };
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];
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

    test("no group means full opacity", () => {
        const { label } = makeScene();
        expect(label._groupAlpha()).toBeCloseTo(1);
        expect(label._groupInteractable()).toBe(true);
        expect(label._groupBlocksRaycasts()).toBe(true);
    });

    test("alpha applies to the whole branch, including descendants", () => {
        const { panelGO, panel, label } = makeScene();
        const group = panelGO.addComponent(CanvasGroup);
        group.alpha = 0.5;

        expect(panel._groupAlpha()).toBeCloseTo(0.5);
        expect(label._groupAlpha()).toBeCloseTo(0.5);
    });

    test("nested groups multiply", () => {
        const { panelGO, labelGO, label } = makeScene();
        panelGO.addComponent(CanvasGroup).alpha = 0.5;
        labelGO.addComponent(CanvasGroup).alpha = 0.4;

        expect(label._groupAlpha()).toBeCloseTo(0.2);
    });

    test("ignoreParentGroups stops the inheritance", () => {
        const { panelGO, labelGO, label } = makeScene();
        panelGO.addComponent(CanvasGroup).alpha = 0.5;

        const inner = labelGO.addComponent(CanvasGroup);
        inner.alpha = 0.4;
        inner.ignoreParentGroups = true;

        expect(label._groupAlpha()).toBeCloseTo(0.4);
    });

    test("alpha is clamped to 0..1", () => {
        const { panelGO, panel } = makeScene();
        const group = panelGO.addComponent(CanvasGroup);

        group.alpha = 5;
        expect(panel._groupAlpha()).toBe(1);

        group.alpha = -2;
        expect(panel._groupAlpha()).toBe(0);
    });

    test("a group added after the elements is picked up", () => {
        const { panelGO, label } = makeScene();
        expect(label._groupAlpha()).toBeCloseTo(1);

        // Adding the component changes no transform link, so the elements have
        // to be told to look again.
        panelGO.addComponent(CanvasGroup).alpha = 0.25;

        expect(label._groupAlpha()).toBeCloseTo(0.25);
    });

    test("a disabled group stops counting", () => {
        const { panelGO, label } = makeScene();
        const group = panelGO.addComponent(CanvasGroup);
        group.alpha = 0.5;
        expect(label._groupAlpha()).toBeCloseTo(0.5);

        group.enabled = false;
        expect(label._groupAlpha()).toBeCloseTo(1);
    });

    test("interactable false swallows the pointer but delivers nothing", () => {
        const { panelGO, panel } = makeScene();
        const group = panelGO.addComponent(CanvasGroup);
        group.interactable = false;

        let downs = 0;
        panel.onPointerDown.addListener(() => { downs++; });

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();

        expect(downs).toBe(0);
        // Still modal: a click on the greyed-out panel must not reach the scene.
        expect(EventSystem.isPointerOverUI).toBe(true);
    });

    test("blocksRaycasts false lets the pointer through entirely", () => {
        const { panelGO, panel } = makeScene();
        const group = panelGO.addComponent(CanvasGroup);
        group.blocksRaycasts = false;

        let downs = 0;
        panel.onPointerDown.addListener(() => { downs++; });

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();

        expect(downs).toBe(0);
        expect(EventSystem.isPointerOverUI).toBe(false);
    });

    test("a see-through group reveals what sits behind it", () => {
        const { canvasGO, panelGO, panel } = makeScene();
        panelGO.addComponent(CanvasGroup).blocksRaycasts = false;

        // A second panel below the first in the hierarchy, so it draws behind.
        const backGO = child("Back", canvasGO);
        const back = backGO.addComponent(UIImage);
        const brt = back.rectTransform;
        brt.anchorMin.set(0, 0);
        brt.anchorMax.set(0, 0);
        brt.pivot.set(0, 0);
        brt.anchoredPosition.set(0, 0);
        brt.sizeDelta.set(200, 100);

        let backDowns = 0;
        let frontDowns = 0;
        back.onPointerDown.addListener(() => { backDowns++; });
        panel.onPointerDown.addListener(() => { frontDowns++; });

        touches = [touch(1, 50, 50, TouchPhase.Began)];
        EventSystem._update();

        expect(frontDowns).toBe(0);
        expect(backDowns).toBe(1);
    });

    test("a group over a button disables it without hiding it", () => {
        const { canvasGO } = makeScene();
        const btnGO = child("Btn", canvasGO);
        const btn = btnGO.addComponent(Button);
        const rt = btn.rectTransform;
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.anchoredPosition.set(300, 0);
        rt.sizeDelta.set(100, 50);

        let clicks = 0;
        btn.onClick.addListener(() => { clicks++; });

        btnGO.addComponent(CanvasGroup).interactable = false;

        touches = [touch(1, 350, 25, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 350, 25, TouchPhase.Ended)];
        EventSystem._update();

        expect(clicks).toBe(0);
    });

    test("a fading group keeps triggering repaints", () => {
        const { canvas, panelGO } = makeScene();
        const group = panelGO.addComponent(CanvasGroup);

        canvas._prepare();
        expect(canvas._prepare()).toBe(false);

        group.alpha = 0.5;
        expect(canvas._prepare()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// GridLayoutGroup
// ---------------------------------------------------------------------------

describe("GridLayoutGroup", () => {
    beforeEach(() => {
        Canvas._reset();
        LayoutGroup._reset();
        ContentSizeFitter._reset();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Canvas._reset();
        LayoutGroup._reset();
        ContentSizeFitter._reset();
    });

    /** A 400x300 panel with a grid on it, cells 100x50, no spacing. */
    function makeGrid(cellCount: number) {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const panelGO = child("Panel", canvasGO);
        const prt = panelGO.addComponent(RectTransform);
        prt.anchorMin.set(0, 0);
        prt.anchorMax.set(0, 0);
        prt.pivot.set(0, 0);
        prt.anchoredPosition.set(0, 0);
        prt.sizeDelta.set(400, 300);

        const grid = panelGO.addComponent(GridLayoutGroup);
        grid.cellSize.set(100, 50);

        const cells: RectTransform[] = [];
        for (let i = 0; i < cellCount; i++) {
            cells.push(child(`C${i}`, panelGO).addComponent(RectTransform));
        }
        return { grid, cells, prt };
    }

    test("every cell takes the grid cell size, not its own", () => {
        const { grid, cells } = makeGrid(2);
        cells[0].sizeDelta.set(7, 7);

        LayoutGroup._updateAll();

        const r = cells[0].getScreenRect(new Rect());
        expect(r.width).toBeCloseTo(100);
        expect(r.height).toBeCloseTo(50);
        expect(grid.cellSize.x).toBe(100);
    });

    test("FixedColumnCount wraps after the given column count", () => {
        const { grid, cells } = makeGrid(5);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 2;

        LayoutGroup._updateAll();

        expect(cells[0].getScreenRect(new Rect()).x).toBeCloseTo(0);
        expect(cells[1].getScreenRect(new Rect()).x).toBeCloseTo(100);
        // Third cell wraps to the next row.
        expect(cells[2].getScreenRect(new Rect()).x).toBeCloseTo(0);
        expect(cells[2].getScreenRect(new Rect()).y).toBeCloseTo(50);
        expect(cells[4].getScreenRect(new Rect()).y).toBeCloseTo(100);
    });

    test("FixedRowCount derives the column count instead", () => {
        const { grid, cells } = makeGrid(6);
        grid.constraint = GridConstraint.FixedRowCount;
        grid.constraintCount = 2;

        LayoutGroup._updateAll();

        // Six cells in two rows means three columns.
        expect(cells[2].getScreenRect(new Rect()).x).toBeCloseTo(200);
        expect(cells[3].getScreenRect(new Rect()).y).toBeCloseTo(50);
    });

    test("Flexible fits as many columns as the width allows", () => {
        const { cells } = makeGrid(6);

        LayoutGroup._updateAll();

        // 400 wide with 100-wide cells: four columns, so the fifth wraps.
        expect(cells[3].getScreenRect(new Rect()).y).toBeCloseTo(0);
        expect(cells[4].getScreenRect(new Rect()).y).toBeCloseTo(50);
        expect(cells[4].getScreenRect(new Rect()).x).toBeCloseTo(0);
    });

    test("spacing separates the cells on both axes", () => {
        const { grid, cells } = makeGrid(4);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 2;
        grid.spacing.set(10, 20);

        LayoutGroup._updateAll();

        expect(cells[1].getScreenRect(new Rect()).x).toBeCloseTo(110);
        expect(cells[2].getScreenRect(new Rect()).y).toBeCloseTo(70);
    });

    test("padding insets the grid", () => {
        const { grid, cells } = makeGrid(1);
        grid.padding.set(15, 0, 25, 0);

        LayoutGroup._updateAll();

        const r = cells[0].getScreenRect(new Rect());
        expect(r.x).toBeCloseTo(15);
        expect(r.y).toBeCloseTo(25);
    });

    test("startAxis Vertical fills a column before moving across", () => {
        const { grid, cells } = makeGrid(4);
        grid.constraint = GridConstraint.FixedRowCount;
        grid.constraintCount = 2;
        grid.startAxis = GridStartAxis.Vertical;

        LayoutGroup._updateAll();

        expect(cells[0].getScreenRect(new Rect()).y).toBeCloseTo(0);
        expect(cells[1].getScreenRect(new Rect()).y).toBeCloseTo(50);
        expect(cells[1].getScreenRect(new Rect()).x).toBeCloseTo(0);
        expect(cells[2].getScreenRect(new Rect()).x).toBeCloseTo(100);
    });

    test("UpperRight fills leftward from the right edge", () => {
        const { grid, cells } = makeGrid(2);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 2;
        grid.startCorner = GridStartCorner.UpperRight;

        LayoutGroup._updateAll();

        expect(cells[0].getScreenRect(new Rect()).x).toBeCloseTo(100);
        expect(cells[1].getScreenRect(new Rect()).x).toBeCloseTo(0);
    });

    test("LowerLeft fills upward, which is decreasing Y here", () => {
        const { grid, cells } = makeGrid(3);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 1;
        grid.startCorner = GridStartCorner.LowerLeft;

        LayoutGroup._updateAll();

        // Three rows of 50; the first cell lands on the bottom one.
        expect(cells[0].getScreenRect(new Rect()).y).toBeCloseTo(100);
        expect(cells[2].getScreenRect(new Rect()).y).toBeCloseTo(0);
    });

    test("a narrow grid still keeps one column rather than none", () => {
        const { grid, cells, prt } = makeGrid(3);
        prt.sizeDelta.set(10, 300);
        grid.constraint = GridConstraint.Flexible;

        LayoutGroup._updateAll();

        expect(cells[1].getScreenRect(new Rect()).y).toBeCloseTo(50);
    });

    test("preferredHeight reports the rows a fitter should allow for", () => {
        const { grid } = makeGrid(5);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 2;
        grid.spacing.set(0, 10);

        // Three rows of 50 with two 10-unit gaps.
        expect(grid.preferredHeight).toBeCloseTo(170);
    });

    test("an ignored child is left out of the grid", () => {
        const { grid, cells } = makeGrid(3);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 1;

        const el = cells[0].gameObject.addComponent(LayoutElement);
        el.ignoreLayout = true;

        LayoutGroup._updateAll();

        // The second child is now the first cell.
        expect(cells[1].getScreenRect(new Rect()).y).toBeCloseTo(0);
    });
});

// ---------------------------------------------------------------------------
// Selectable
// ---------------------------------------------------------------------------

describe("Selectable", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    function makeButton(x: number): Button {
        const btn = new GameObject("Btn").addComponent(Button);
        const rt = btn.rectTransform;
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.anchoredPosition.set(x, 0);
        rt.sizeDelta.set(100, 50);
        return btn;
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];
        (globalThis as unknown as { window: unknown }).window = {
            innerWidth: 800,
            innerHeight: 600,
        };
        vi.spyOn(Touch, "touches", "get").mockImplementation(() => touches);
        vi.spyOn(Input, "getMouseButton").mockReturnValue(false);
        // Parked well clear of every control: an unmocked mouse sits at (0,0),
        // which is inside them and would read as a hover.
        vi.spyOn(Input, "mousePosition", "get").mockReturnValue(new Vector2(700, 500));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as unknown as { window?: unknown }).window;
        EventSystem._reset();
        Canvas._reset();
    });

    test("state walks Normal to Highlighted to Pressed and back", () => {
        const btn = makeButton(0);
        expect(btn.state).toBe(SelectableState.Normal);

        // A touch that is present but not down reads as a hover.
        touches = [touch(1, 50, 25, TouchPhase.Ended)];
        EventSystem._update();
        expect(btn.state).toBe(SelectableState.Highlighted);

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();
        expect(btn.state).toBe(SelectableState.Pressed);

        touches = [touch(1, 50, 25, TouchPhase.Ended)];
        EventSystem._update();
        expect(btn.state).toBe(SelectableState.Highlighted);
    });

    test("a pointer that vanishes mid-press does not leave it stuck", () => {
        const btn = makeButton(0);

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();
        expect(btn.state).toBe(SelectableState.Pressed);

        // The finger is simply gone — no Ended phase, no release.
        touches = [];
        EventSystem._update();

        expect(btn.isPressed).toBe(false);
        expect(btn.state).toBe(SelectableState.Normal);
    });

    test("two fingers on one control both have to leave before it releases", () => {
        const btn = makeButton(0);

        touches = [
            touch(1, 20, 25, TouchPhase.Began),
            touch(2, 60, 25, TouchPhase.Began),
        ];
        EventSystem._update();
        expect(btn.isPressed).toBe(true);

        touches = [
            touch(1, 20, 25, TouchPhase.Ended),
            touch(2, 60, 25, TouchPhase.Began),
        ];
        EventSystem._update();
        // One released, the other is still holding it.
        expect(btn.isPressed).toBe(true);

        touches = [touch(2, 60, 25, TouchPhase.Ended)];
        EventSystem._update();
        expect(btn.isPressed).toBe(false);
    });

    test("interactable false reports Disabled", () => {
        const btn = makeButton(0);
        btn.interactable = false;
        expect(btn.state).toBe(SelectableState.Disabled);
        expect(btn.isInteractable()).toBe(false);
    });

    test("a CanvasGroup can veto interactivity without touching the flag", () => {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const btnGO = child("Btn", canvasGO);
        const btn = btnGO.addComponent(Button);
        expect(btn.isInteractable()).toBe(true);

        canvasGO.addComponent(CanvasGroup).interactable = false;

        expect(btn.interactable).toBe(true);
        expect(btn.isInteractable()).toBe(false);
        expect(btn.state).toBe(SelectableState.Disabled);
    });

    test("disabling a control clears its press and hover", () => {
        const btn = makeButton(0);

        touches = [touch(1, 50, 25, TouchPhase.Began)];
        EventSystem._update();
        expect(btn.isPressed).toBe(true);

        btn.enabled = false;
        btn.enabled = true;

        expect(btn.isPressed).toBe(false);
        expect(btn.isHovered).toBe(false);
    });

    test("Slider and Toggle share the same state machine", () => {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const slider = child("S", canvasGO).addComponent(Slider);
        const toggle = child("T", canvasGO).addComponent(Toggle);

        expect(slider.state).toBe(SelectableState.Normal);
        expect(toggle.state).toBe(SelectableState.Normal);

        slider.interactable = false;
        toggle.interactable = false;

        expect(slider.state).toBe(SelectableState.Disabled);
        expect(toggle.state).toBe(SelectableState.Disabled);
    });

    test("ButtonState remains usable as the alias it now is", () => {
        expect(ButtonState.Pressed).toBe(SelectableState.Pressed);
        expect(ButtonState.Disabled).toBe(SelectableState.Disabled);
    });
});

// ---------------------------------------------------------------------------
// RectMask2D
// ---------------------------------------------------------------------------

describe("RectMask2D", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    /**
     * Canvas -> Viewport(200x100, masked) -> Content(200x400).
     * The content is far taller than the window it sits in.
     */
    function makeScrollish() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const viewGO = child("Viewport", canvasGO);
        const view = viewGO.addComponent(UIImage);
        const vrt = view.rectTransform;
        vrt.anchorMin.set(0, 0);
        vrt.anchorMax.set(0, 0);
        vrt.pivot.set(0, 0);
        vrt.anchoredPosition.set(0, 0);
        vrt.sizeDelta.set(200, 100);
        const mask = viewGO.addComponent(RectMask2D);

        const contentGO = child("Content", viewGO);
        const content = contentGO.addComponent(UIImage);
        const crt = content.rectTransform;
        crt.anchorMin.set(0, 0);
        crt.anchorMax.set(0, 0);
        crt.pivot.set(0, 0);
        crt.anchoredPosition.set(0, 0);
        crt.sizeDelta.set(200, 400);

        return { canvas, canvasGO, view, viewGO, mask, content, crt };
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        touches = [];
        (globalThis as unknown as { window: unknown }).window = {
            innerWidth: 800,
            innerHeight: 600,
        };
        vi.spyOn(Touch, "touches", "get").mockImplementation(() => touches);
        vi.spyOn(Input, "getMouseButton").mockReturnValue(false);
        vi.spyOn(Input, "mousePosition", "get").mockReturnValue(new Vector2(700, 500));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as unknown as { window?: unknown }).window;
        EventSystem._reset();
        Canvas._reset();
    });

    test("a mask clips its descendants but not itself", () => {
        const { view, content } = makeScrollish();

        expect(view._maskChain().length).toBe(0);
        expect(content._maskChain().length).toBe(1);
    });

    test("padding shrinks the clipping window", () => {
        const { mask } = makeScrollish();
        mask.padding.set(5, 10, 15, 20);

        const clip = mask._clipRect();
        expect(clip.x).toBeCloseTo(5);
        expect(clip.y).toBeCloseTo(15);
        expect(clip.width).toBeCloseTo(200 - 5 - 10);
        expect(clip.height).toBeCloseTo(100 - 15 - 20);
    });

    test("a mask added after the elements is picked up", () => {
        const { canvasGO } = makeScrollish();

        const plainGO = child("Plain", canvasGO);
        const plain = plainGO.addComponent(UIImage);
        expect(plain._maskChain().length).toBe(0);

        const holderGO = child("Holder", canvasGO);
        plainGO.transform.parent = holderGO.transform;
        plain._invalidateGroupChain();
        holderGO.addComponent(RectMask2D);

        expect(plain._maskChain().length).toBe(1);
    });

    test("a point inside the window passes, one below it does not", () => {
        const { mask } = makeScrollish();

        expect(mask._containsCanvasPoint(100, 50)).toBe(true);
        expect(mask._containsCanvasPoint(100, 250)).toBe(false);
    });

    test("clipped-away content cannot be clicked", () => {
        const { content } = makeScrollish();
        let downs = 0;
        content.onPointerDown.addListener(() => { downs++; });

        // Inside the window: the content is there to be hit.
        touches = [touch(1, 100, 50, TouchPhase.Began)];
        EventSystem._update();
        expect(downs).toBe(1);

        // Below the window, still inside the content's own 400-tall rect.
        touches = [touch(2, 100, 250, TouchPhase.Began)];
        EventSystem._update();
        expect(downs).toBe(1);
        expect(EventSystem.isPointerOverUI).toBe(false);
    });

    test("scrolling an item into the window makes it clickable", () => {
        const { content, crt } = makeScrollish();

        // An item far down the content, well past the 100-tall window.
        const itemGO = child("Item", content.gameObject);
        const item = itemGO.addComponent(UIImage);
        const irt = item.rectTransform;
        irt.anchorMin.set(0, 0);
        irt.anchorMax.set(0, 0);
        irt.pivot.set(0, 0);
        irt.anchoredPosition.set(0, 300);
        irt.sizeDelta.set(200, 50);

        let downs = 0;
        item.onPointerDown.addListener(() => { downs++; });

        // At rest the item sits at canvas y 300–350, outside the window.
        touches = [touch(1, 100, 50, TouchPhase.Began)];
        EventSystem._update();
        expect(downs).toBe(0);

        // Scroll the content up so the item lands at y 25–75, inside it.
        crt.anchoredPosition.set(0, -275);
        touches = [touch(2, 100, 50, TouchPhase.Began)];
        EventSystem._update();
        expect(downs).toBe(1);
    });

    test("a rotated mask clips to its quad, not its bounding box", () => {
        const { mask, viewGO } = makeScrollish();
        viewGO.getComponent(RectTransform)!.pivot.set(0.5, 0.5);
        viewGO.getComponent(RectTransform)!.anchoredPosition.set(100, 50);
        viewGO.getComponent(RectTransform)!.localRotation = 45;

        // The window's own centre survives any rotation.
        expect(mask._containsCanvasPoint(100, 50)).toBe(true);

        // Turned 45 degrees about (100,50), the 200x100 window spans roughly
        // x -6..206 and y -56..156 as a bounding box. This point sits inside
        // that box but well outside the quad itself.
        expect(mask._containsCanvasPoint(0, -40)).toBe(false);
    });

    test("the paint pass installs one clip per mask above the element", () => {
        const { canvas } = makeScrollish();
        const m = makeContext();

        canvas._prepare();
        canvas._paint(m.ctx);

        // The viewport draws unclipped; the content draws behind one clip.
        expect(m.ops.filter(o => o === "clip").length).toBe(1);
    });

    test("nested masks each contribute a clip", () => {
        const { canvas, content } = makeScrollish();
        content.gameObject.addComponent(RectMask2D);

        const innerGO = child("Inner", content.gameObject);
        innerGO.addComponent(UIImage);

        const m = makeContext();
        canvas._prepare();
        canvas._paint(m.ctx);

        // Content sits behind one mask, the inner element behind two.
        expect(m.ops.filter(o => o === "clip").length).toBe(3);
    });

    test("a disabled mask stops clipping", () => {
        const { mask, content } = makeScrollish();
        expect(content._maskChain().length).toBe(1);

        mask.enabled = false;
        expect(content._maskChain().length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// ScrollRect
// ---------------------------------------------------------------------------

describe("ScrollRect", () => {
    let touches: TouchInfo[] = [];

    function touch(id: number, x: number, y: number, phase: TouchPhase): TouchInfo {
        const t = new TouchInfo(id);
        t.position.set(x, y);
        t.phase = phase;
        return t;
    }

    /**
     * Canvas -> Viewport(200x100, masked, ScrollRect) -> Content(200x400).
     * 300 units of vertical travel, none horizontal.
     */
    function makeScroll() {
        const canvasGO = new GameObject("Canvas");
        const canvas = canvasGO.addComponent(Canvas);
        vi.spyOn(canvas, "width", "get").mockReturnValue(800);
        vi.spyOn(canvas, "height", "get").mockReturnValue(600);

        const viewGO = child("Viewport", canvasGO);
        const view = viewGO.addComponent(UIImage);
        const vrt = view.rectTransform;
        vrt.anchorMin.set(0, 0);
        vrt.anchorMax.set(0, 0);
        vrt.pivot.set(0, 0);
        vrt.anchoredPosition.set(0, 0);
        vrt.sizeDelta.set(200, 100);
        viewGO.addComponent(RectMask2D);

        const scroll = viewGO.addComponent(ScrollRect);
        scroll.horizontal = false;
        scroll.inertia = false;
        scroll.movementType = ScrollMovementType.Clamped;

        const contentGO = child("Content", viewGO);
        contentGO.addComponent(UIImage);
        const crt = contentGO.getComponent(RectTransform)!;
        crt.sizeDelta.set(200, 400);
        scroll.content = crt;

        return { canvas, scroll, crt, viewGO };
    }

    beforeEach(() => {
        Canvas._reset();
        EventSystem._reset();
        ScrollRect._reset();
        touches = [];
        (globalThis as unknown as { window: unknown }).window = {
            innerWidth: 800,
            innerHeight: 600,
        };
        vi.spyOn(Touch, "touches", "get").mockImplementation(() => touches);
        vi.spyOn(Input, "getMouseButton").mockReturnValue(false);
        vi.spyOn(Input, "mousePosition", "get").mockReturnValue(new Vector2(700, 500));
        vi.spyOn(Input, "mouseScrollDelta", "get").mockReturnValue(new Vector2(0, 0));
        vi.spyOn(Time, "deltaTime", "get").mockReturnValue(1 / 60);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as unknown as { window?: unknown }).window;
        EventSystem._reset();
        ScrollRect._reset();
        Canvas._reset();
    });

    test("scrollable size is the overhang past the window", () => {
        const { scroll } = makeScroll();
        const size = scroll.getScrollableSize(new Vector2());

        expect(size.x).toBeCloseTo(0);
        expect(size.y).toBeCloseTo(300);
    });

    test("the content is pinned to the window's top-left corner", () => {
        const { scroll, crt } = makeScroll();
        crt.anchorMin.set(0.5, 0.5);
        crt.pivot.set(1, 1);

        ScrollRect._updateAll();

        expect(crt.anchorMin.x).toBe(0);
        expect(crt.anchorMin.y).toBe(0);
        expect(crt.pivot.x).toBe(0);
        expect(scroll.content).toBe(crt);
    });

    test("normalized position runs 0 at the top to 1 at the bottom", () => {
        const { scroll, crt } = makeScroll();

        expect(scroll.verticalNormalizedPosition).toBeCloseTo(0);

        crt.anchoredPosition.set(0, -150);
        expect(scroll.verticalNormalizedPosition).toBeCloseTo(0.5);

        crt.anchoredPosition.set(0, -300);
        expect(scroll.verticalNormalizedPosition).toBeCloseTo(1);
    });

    test("assigning the normalized position moves the content", () => {
        const { scroll, crt } = makeScroll();

        scroll.verticalNormalizedPosition = 1;
        expect(crt.anchoredPosition.y).toBeCloseTo(-300);

        scroll.verticalNormalizedPosition = 0.25;
        expect(crt.anchoredPosition.y).toBeCloseTo(-75);
    });

    test("an axis with nothing to scroll reports 0", () => {
        const { scroll } = makeScroll();
        expect(scroll.horizontalNormalizedPosition).toBe(0);
    });

    test("dragging moves the content and stops at the ends when clamped", () => {
        const { scroll, crt } = makeScroll();

        touches = [touch(1, 100, 80, TouchPhase.Began)];
        EventSystem._update();

        // The frame that crosses the threshold only *starts* the drag: the
        // gesture anchors here, so the threshold distance is not a jump.
        touches = [touch(1, 100, 20, TouchPhase.Moved)];
        EventSystem._update();
        expect(scroll.isDragging).toBe(true);
        expect(crt.anchoredPosition.y).toBeCloseTo(0);

        touches = [touch(1, 100, -40, TouchPhase.Moved)];
        EventSystem._update();
        expect(crt.anchoredPosition.y).toBeCloseTo(-60);

        // Far past the end: clamped movement refuses to overshoot.
        touches = [touch(1, 100, -5000, TouchPhase.Moved)];
        EventSystem._update();
        expect(crt.anchoredPosition.y).toBeCloseTo(-300);
    });

    test("a locked axis does not move", () => {
        const { scroll, crt } = makeScroll();
        scroll.vertical = false;

        touches = [touch(1, 100, 80, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 100, 20, TouchPhase.Moved)];
        EventSystem._update();

        expect(crt.anchoredPosition.y).toBeCloseTo(0);
    });

    test("elastic movement allows overshoot and springs back", () => {
        const { scroll, crt } = makeScroll();
        scroll.movementType = ScrollMovementType.Elastic;

        touches = [touch(1, 100, 20, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 100, 100, TouchPhase.Moved)];   // starts the drag
        EventSystem._update();
        touches = [touch(1, 100, 280, TouchPhase.Moved)];   // 180 past the top
        EventSystem._update();

        // Rubber-banded: it moved, but far less than the raw 180 units.
        const overshoot = crt.anchoredPosition.y;
        expect(overshoot).toBeGreaterThan(0);
        expect(overshoot).toBeLessThan(180);

        touches = [touch(1, 100, 280, TouchPhase.Ended)];
        EventSystem._update();

        // Released: the spring pulls it back toward the limit.
        for (let i = 0; i < 60; i++) ScrollRect._updateAll();
        expect(crt.anchoredPosition.y).toBeCloseTo(0);
    });

    test("inertia keeps the content moving after release, then settles", () => {
        const { scroll, crt } = makeScroll();
        scroll.inertia = true;

        touches = [touch(1, 100, 80, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 100, 60, TouchPhase.Moved)];   // starts the drag
        EventSystem._update();
        touches = [touch(1, 100, 40, TouchPhase.Moved)];   // builds velocity
        EventSystem._update();
        touches = [touch(1, 100, 40, TouchPhase.Ended)];
        EventSystem._update();

        const atRelease = crt.anchoredPosition.y;
        ScrollRect._updateAll();
        expect(crt.anchoredPosition.y).toBeLessThan(atRelease);

        for (let i = 0; i < 120; i++) ScrollRect._updateAll();
        expect(scroll.velocity.y).toBeCloseTo(0);
    });

    test("stopMovement kills the coast immediately", () => {
        const { scroll } = makeScroll();
        scroll.inertia = true;

        touches = [touch(1, 100, 80, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 100, 60, TouchPhase.Moved)];
        EventSystem._update();
        touches = [touch(1, 100, 40, TouchPhase.Moved)];
        EventSystem._update();

        scroll.stopMovement();
        expect(scroll.velocity.y).toBe(0);
    });

    test("the wheel scrolls when the pointer is over the view", () => {
        const { crt } = makeScroll();

        vi.spyOn(Input, "mouseScrollDelta", "get").mockReturnValue(new Vector2(0, 1));
        vi.spyOn(EventSystem, "getPointerPosition").mockImplementation(
            out => out.set(100, 50),
        );

        ScrollRect._updateAll();
        expect(crt.anchoredPosition.y).toBeLessThan(0);
    });

    test("the wheel is ignored when the pointer is elsewhere", () => {
        const { crt } = makeScroll();

        vi.spyOn(Input, "mouseScrollDelta", "get").mockReturnValue(new Vector2(0, 1));
        vi.spyOn(EventSystem, "getPointerPosition").mockImplementation(
            out => out.set(700, 500),
        );

        ScrollRect._updateAll();
        expect(crt.anchoredPosition.y).toBe(0);
    });

    test("onValueChanged reports movement once per change", () => {
        const { scroll } = makeScroll();
        const seen: number[] = [];
        scroll.onValueChanged.addListener(v => seen.push(v.y));

        scroll.verticalNormalizedPosition = 0.5;
        scroll.verticalNormalizedPosition = 0.5;
        scroll.verticalNormalizedPosition = 1;

        expect(seen.length).toBe(2);
        expect(seen[0]).toBeCloseTo(0.5);
        expect(seen[1]).toBeCloseTo(1);
    });

    test("a scroll view with no content is inert rather than broken", () => {
        const { scroll } = makeScroll();
        scroll.content = null;

        expect(() => ScrollRect._updateAll()).not.toThrow();
        expect(scroll.verticalNormalizedPosition).toBe(0);
        expect(scroll.getScrollableSize(new Vector2()).y).toBe(0);
    });

    test("dragging the view consumes the event", () => {
        const { scroll } = makeScroll();
        let consumed = false;
        scroll.onDrag.addListener(e => { consumed = e.consumed; });

        touches = [touch(1, 100, 80, TouchPhase.Began)];
        EventSystem._update();
        touches = [touch(1, 100, 20, TouchPhase.Moved)];
        EventSystem._update();

        expect(consumed).toBe(true);
    });
});
