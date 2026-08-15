import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Canvas } from "../src/engine/core/ui/Canvas";
import { CanvasGroup } from "../src/engine/core/ui/CanvasGroup";
import { RectMask2D } from "../src/engine/core/ui/RectMask2D";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * An element caches which masks and groups sit above it, keyed on counters that
 * change when one is added or removed, plus a per-element check for the element
 * itself being re-parented. Moving a node *higher up* changes the ancestry of
 * everything beneath it and touches neither, so those elements went on
 * resolving through the masks and groups they used to sit under. Audit part 6,
 * F40.
 */

const made: GameObject[] = [];

function child(name: string, parent: GameObject): GameObject {
    const go = new GameObject(name);
    go.transform.parent = parent.transform;
    made.push(go);
    return go;
}

function rect(go: GameObject, w = 100, h = 100): RectTransform {
    const rt = go.addComponent(RectTransform);
    rt.sizeDelta.set(w, h);
    return rt;
}

/**
 * canvas ─ masked (RectMask2D, CanvasGroup α .5) ─ holder ─ leaf (UIImage)
 *        └ plain
 *
 * Moving `holder` from `masked` to `plain` changes the leaf's ancestry without
 * changing the leaf's own parent.
 */
function setup() {
    const canvasGO = new GameObject("Canvas");
    made.push(canvasGO);
    const canvas = canvasGO.addComponent(Canvas);
    vi.spyOn(canvas, "width", "get").mockReturnValue(800);
    vi.spyOn(canvas, "height", "get").mockReturnValue(600);

    const masked = child("Masked", canvasGO);
    rect(masked);
    masked.addComponent(RectMask2D);
    const group = masked.addComponent(CanvasGroup);
    group.alpha = 0.5;

    const plain = child("Plain", canvasGO);
    rect(plain);

    const holder = child("Holder", masked);
    rect(holder);

    const leafGO = child("Leaf", holder);
    rect(leafGO);
    const leaf = leafGO.addComponent(UIImage);

    canvas._prepare();
    return { canvas, masked, plain, holder, leaf };
}

beforeEach(() => Canvas._reset());

afterEach(() => {
    vi.restoreAllMocks();
    Canvas._reset();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Re-parenting a node above an element", () => {
    test("drops the mask that no longer clips it", () => {
        const { canvas, plain, holder, leaf } = setup();
        expect(leaf._maskChain()).toHaveLength(1);

        holder.transform.parent = plain.transform;
        canvas._prepare();

        expect(leaf._maskChain()).toHaveLength(0);
    });

    test("drops the group that no longer fades it", () => {
        const { canvas, plain, holder, leaf } = setup();
        expect(leaf._groupAlpha()).toBeCloseTo(0.5);

        holder.transform.parent = plain.transform;
        canvas._prepare();

        expect(leaf._groupAlpha()).toBe(1);
    });

    test("picks up a mask it has moved under", () => {
        const { canvas, masked, plain, holder, leaf } = setup();
        holder.transform.parent = plain.transform;
        canvas._prepare();
        expect(leaf._maskChain()).toHaveLength(0);

        holder.transform.parent = masked.transform;
        canvas._prepare();

        expect(leaf._maskChain()).toHaveLength(1);
    });

    test("an element whose own parent changed still works", () => {
        // The case that was already handled — it must keep working.
        const { canvas, plain, leaf } = setup();

        leaf.gameObject.transform.parent = plain.transform;
        canvas._prepare();

        expect(leaf._maskChain()).toHaveLength(0);
        expect(leaf._groupAlpha()).toBe(1);
    });

    test("an element moved to another canvas belongs to it at once", () => {
        // Time.frameCount does not advance here, which is exactly the situation
        // a scenario creates by re-homing an element inside one Update: the
        // per-frame lookup would answer with the canvas it left.
        const { canvas, leaf } = setup();
        expect(leaf.rectTransform.canvas).toBe(canvas);

        const otherGO = new GameObject("Other Canvas");
        made.push(otherGO);
        const other = otherGO.addComponent(Canvas);
        vi.spyOn(other, "width", "get").mockReturnValue(400);
        vi.spyOn(other, "height", "get").mockReturnValue(300);

        leaf.gameObject.transform.parent = otherGO.transform;

        expect(leaf.rectTransform.canvas).toBe(other);
    });

    test("and a move higher up re-homes what is below it", () => {
        const { canvas, holder, leaf } = setup();
        expect(leaf.rectTransform.canvas).toBe(canvas);

        const otherGO = new GameObject("Other Canvas");
        made.push(otherGO);
        const other = otherGO.addComponent(Canvas);
        vi.spyOn(other, "width", "get").mockReturnValue(400);
        vi.spyOn(other, "height", "get").mockReturnValue(300);

        holder.transform.parent = otherGO.transform;

        expect(leaf.rectTransform.canvas).toBe(other);
    });

    test("nothing moving leaves the chains cached", () => {
        const { canvas, leaf } = setup();
        const first = leaf._maskChain();

        canvas._prepare();

        expect(leaf._maskChain()).toBe(first);
    });
});
