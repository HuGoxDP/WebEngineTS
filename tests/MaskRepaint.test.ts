import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Canvas } from "../src/engine/core/ui/Canvas";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { RectMask2D } from "../src/engine/core/ui/RectMask2D";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * A canvas in OnDemand mode repaints when something it hashes changes. What
 * *clips* an element is not part of the element: a mask's padding, or a mask
 * being switched off, changed the picture while every graphic beneath it hashed
 * exactly as before — so the clip on screen stayed as it was until something
 * else happened to change. Audit part 6, F33.
 */

const made: GameObject[] = [];

function child(name: string, parent: GameObject): GameObject {
    const go = new GameObject(name);
    go.transform.parent = parent.transform;
    made.push(go);
    return go;
}

/** A canvas holding a masked panel with one image inside it. */
function setup() {
    const canvasGO = new GameObject("Canvas");
    made.push(canvasGO);
    const canvas = canvasGO.addComponent(Canvas);
    vi.spyOn(canvas, "width", "get").mockReturnValue(800);
    vi.spyOn(canvas, "height", "get").mockReturnValue(600);
    const internals = canvas as unknown as Record<string, number>;
    internals._cssWidth = 800;
    internals._cssHeight = 600;
    internals._backingWidth = 800;
    internals._backingHeight = 600;

    const viewGO = child("View", canvasGO);
    const viewRT = viewGO.addComponent(RectTransform);
    viewRT.anchorMin.set(0, 0);
    viewRT.anchorMax.set(0, 0);
    viewRT.pivot.set(0, 0);
    viewRT.anchoredPosition.set(0, 0);
    viewRT.sizeDelta.set(200, 200);
    const mask = viewGO.addComponent(RectMask2D);

    const imageGO = child("Content", viewGO);
    const imageRT = imageGO.addComponent(RectTransform);
    imageRT.anchorMin.set(0, 0);
    imageRT.anchorMax.set(0, 0);
    imageRT.pivot.set(0, 0);
    imageRT.anchoredPosition.set(0, 0);
    imageRT.sizeDelta.set(400, 400);
    imageGO.addComponent(UIImage);

    // First prepare establishes the baseline; the second settles it.
    canvas._prepare();
    canvas._prepare();
    return { canvas, mask, viewRT };
}

beforeEach(() => Canvas._reset());

afterEach(() => {
    vi.restoreAllMocks();
    Canvas._reset();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A mask change repaints what it clips", () => {
    test("nothing changing still repaints nothing", () => {
        const { canvas } = setup();

        expect(canvas._prepare()).toBe(false);
    });

    test("padding is a visual change", () => {
        const { canvas, mask } = setup();

        mask.padding.setAll(20);

        expect(canvas._prepare()).toBe(true);
    });

    test("one edge of padding is enough", () => {
        const { canvas, mask } = setup();

        mask.padding.left = 12;

        expect(canvas._prepare()).toBe(true);
    });

    test("switching the mask off repaints what it stopped clipping", () => {
        const { canvas, mask } = setup();

        mask.enabled = false;

        expect(canvas._prepare()).toBe(true);
    });

    test("and switching it back on repaints again", () => {
        const { canvas, mask } = setup();
        mask.enabled = false;
        canvas._prepare();
        canvas._prepare();

        mask.enabled = true;

        expect(canvas._prepare()).toBe(true);
    });

    test("resizing the mask's own rect counts", () => {
        // The mask element here draws nothing of its own, so its rect reaches
        // the canvas only through what it clips.
        const { canvas, viewRT } = setup();

        viewRT.sizeDelta.set(100, 100);

        expect(canvas._prepare()).toBe(true);
    });
});
