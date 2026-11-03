import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Canvas } from "../src/engine/core/ui/Canvas";

/**
 * `Canvas._overlaySurfaces()` is what a frame capture composites over the 3D image: the 2D surfaces of the
 * active, enabled canvases, back-to-front by sortingOrder. A disabled or inactive canvas must not appear.
 */

const made: GameObject[] = [];
const saved = { window: (globalThis as any).window, document: (globalThis as any).document };

function fakeSurface(): HTMLCanvasElement {
    return {
        style: {}, width: 0, height: 0, parentElement: null,
        getContext: () => ({}),
    } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
    const g = globalThis as any;
    g.window = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
    g.document = { createElement: () => fakeSurface(), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} };
});

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    Canvas._reset();
    (globalThis as any).window = saved.window;
    (globalThis as any).document = saved.document;
});

function canvasAt(order: number): { go: GameObject; canvas: Canvas } {
    const go = new GameObject(`Canvas${order}`);
    made.push(go);
    const canvas = go.addComponent(Canvas);
    canvas.sortingOrder = order;
    return { go, canvas };
}

const surfaceOf = (c: Canvas): HTMLCanvasElement => (c as unknown as { _htmlCanvas: HTMLCanvasElement })._htmlCanvas;

describe("Canvas._overlaySurfaces", () => {
    test("is empty with no canvas", () => {
        expect(Canvas._overlaySurfaces()).toEqual([]);
    });

    test("returns the active canvases' surfaces back-to-front, whatever the creation order", () => {
        const high = canvasAt(5);
        const low = canvasAt(-2);
        const mid = canvasAt(1);

        const surfaces = Canvas._overlaySurfaces();

        expect(surfaces).toHaveLength(3);
        expect(surfaces).toEqual([surfaceOf(low.canvas), surfaceOf(mid.canvas), surfaceOf(high.canvas)]);
        expect(surfaces[2]).toBe(surfaceOf(high.canvas));
    });

    test("leaves out a disabled canvas and one on an inactive GameObject, keeping the order of the rest", () => {
        const a = canvasAt(0);
        const disabled = canvasAt(1);
        const inactive = canvasAt(2);
        const d = canvasAt(3);
        disabled.canvas.enabled = false;
        inactive.go.setActive(false);

        const surfaces = Canvas._overlaySurfaces();

        expect(surfaces).toEqual([surfaceOf(a.canvas), surfaceOf(d.canvas)]);
        expect(surfaces).not.toContain(surfaceOf(disabled.canvas));
        expect(surfaces).not.toContain(surfaceOf(inactive.canvas));
    });

    test("a re-enabled canvas comes back in its sorted place; a destroyed one is gone", () => {
        const a = canvasAt(0);
        const b = canvasAt(1);
        b.canvas.enabled = false;
        expect(Canvas._overlaySurfaces()).toEqual([surfaceOf(a.canvas)]);
        b.canvas.enabled = true;
        expect(Canvas._overlaySurfaces()).toEqual([surfaceOf(a.canvas), surfaceOf(b.canvas)]);
        a.go.destroyImmediate();
        expect(Canvas._overlaySurfaces()).toEqual([surfaceOf(b.canvas)]);
    });
});
