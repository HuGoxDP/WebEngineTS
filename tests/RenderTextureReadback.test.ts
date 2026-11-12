import { describe, test, expect, vi, afterEach } from "vitest";
import { Rect } from "../src/engine/core/math/Rect";

/**
 * C6, phase 5 (DW-5.1..DW-5.3): a target's pixels reach a `Texture2D`.
 *
 * The Canvas UI cannot draw a GPU texture, so a preview or a thumbnail reads the
 * pixels out and then `apply()`s them. Everything interesting is at the seam:
 * which rows land in which order, what is clipped away when the rectangles
 * overhang, and the three cases that must leave the texture alone (no active
 * target, a half-float target, a texture made non-readable).
 *
 * The pixel source is a stubbed read hook producing a known 4×2 pattern, so the
 * GPU is not involved and the pattern says which row went where — a
 * top-first-vs-bottom-first mistake would swap the two rows and fail here.
 */

interface Stored { r: number; g: number; b: number; a: number }

/** A 2D context that records the image data written to it and hands it back. */
function makeContext(store: Stored[]) {
    return {
        putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) => {
            for (let i = 0; i < image.data.length / 4; i++) {
                store[i] = { r: image.data[i * 4], g: image.data[i * 4 + 1], b: image.data[i * 4 + 2], a: image.data[i * 4 + 3] };
            }
        },
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4).fill(0), width: w, height: h,
        }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        fillRect: () => {},
        drawImage: () => {},
    };
}

/**
 * `document.createElement("canvas")` backed by `store`, for the whole file.
 *
 * `HTMLCanvasElement` is stubbed as well, because `Texture2D._ensurePixelData`
 * tests `image instanceof HTMLCanvasElement` before touching it — a class whose
 * prototype every stub canvas claims, so the instanceof holds.
 */
function stubCanvas(store: Stored[]): () => void {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    const savedCanvasElement = g.HTMLCanvasElement;
    const canvases: unknown[] = [];
    class StubCanvasElement { }
    g.HTMLCanvasElement = StubCanvasElement;
    g.document = {
        createElement: (tag: string) => {
            if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
            const canvas = { width: 0, height: 0, getContext: () => makeContext(store) };
            Object.setPrototypeOf(canvas, StubCanvasElement.prototype);
            canvases.push(canvas);
            return canvas;
        },
    };
    return () => { g.document = savedDocument; g.HTMLCanvasElement = savedCanvasElement; };
}

const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { RenderTexture, RenderTextureFormat } = await import("../src/engine/core/graphics/RenderTexture");

/** The 4×2 pattern a stubbed read hook hands back, top row first: red, green / blue, white. */
const PATTERN = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],     // row 0, top first
    [0, 255, 255], [255, 0, 255], [255, 255, 255], [0, 0, 0], // row 1
];

/** Installs a read hook that answers with `PATTERN` for a 4×2 target. */
function stubReadPattern(): () => void {
    const previous = RenderTexture._readHook;
    RenderTexture._readHook = (_target, _x, _y, width, height, out) => {
        for (let row = 0; row < height; row++) {
            for (let column = 0; column < width; column++) {
                const source = PATTERN[row * 4 + column];
                const to = (row * width + column) * 4;
                out[to + 0] = source[0];
                out[to + 1] = source[1];
                out[to + 2] = source[2];
                out[to + 3] = 255;
            }
        }
        return true;
    };
    return () => { RenderTexture._readHook = previous; };
}

/** A live ARGB32 4×2 target, made active, with the restore of both. */
function activeTarget() {
    const target = new RenderTexture(4, 2, 24, RenderTextureFormat.ARGB32);
    target.create();
    RenderTexture.active = target;
    return target;
}

const rgbAt = (store: Stored[], x: number, y: number) =>
    [store[y * 4 + x].r, store[y * 4 + x].g, store[y * 4 + x].b];

afterEach(() => {
    RenderTexture.active = null;
    vi.restoreAllMocks();
});

describe("reading a target into a texture", () => {
    test("DW-5.1 the pattern arrives with the top row first", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const restoreRead = stubReadPattern();
        try {
            const target = activeTarget();
            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);

            expect(rgbAt(store, 0, 0)).toEqual(PATTERN[0]);   // red, top left
            expect(rgbAt(store, 1, 0)).toEqual(PATTERN[1]);   // green
            expect(rgbAt(store, 2, 0)).toEqual(PATTERN[2]);   // blue
            expect(rgbAt(store, 3, 0)).toEqual(PATTERN[3]);   // yellow
            expect(rgbAt(store, 0, 1)).toEqual(PATTERN[4]);   // cyan, second row
            expect(rgbAt(store, 3, 1)).toEqual(PATTERN[7]);   // black, bottom right

            // `getPixel` sees the same bytes, so a caller that reads the CPU
            // copy and one that uploads it agree.
            const pixel = texture.getPixel(0, 1);
            expect([Math.round(pixel.r * 255), Math.round(pixel.g * 255), Math.round(pixel.b * 255)])
                .toEqual(PATTERN[4]);
            target.destroyImmediate();
        } finally {
            restoreRead();
            restoreDom();
        }
    });

    test("DW-5.2 a source that overhangs the target is clipped", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const restoreRead = stubReadPattern();
        try {
            activeTarget();
            new Texture2D(4, 2).readPixels(new Rect(2, 1, 8, 8), 0, 0);

            // Only a 2×1 rectangle survived the clip, and it lands at the
            // destination's top-left: the read hook answers in its own order, so
            // what matters is that two pixels were written and nothing else was.
            expect(rgbAt(store, 0, 0)).toEqual(PATTERN[0]);   // red
            expect(rgbAt(store, 1, 0)).toEqual(PATTERN[1]);   // green
            expect(store[2].r).toBe(0);                       // and nothing beyond it
            expect(store[2].g).toBe(0);
            expect(store[3].b).toBe(0);
            expect(rgbAt(store, 0, 1)).toEqual([0, 0, 0]);   // the untouched row stays untouched
        } finally {
            restoreRead();
            restoreDom();
        }
    });

    test("DW-5.2 a destination offset lands inside the texture, clipping the rest", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const restoreRead = stubReadPattern();
        try {
            activeTarget();
            new Texture2D(4, 2).readPixels(new Rect(0, 0, 4, 2), 2, 1);

            // The rectangle's first row lands at y=1, the second would land at
            // y=2 — outside — so only one row is written.
            expect(rgbAt(store, 2, 1)).toEqual(PATTERN[0]);
            expect(rgbAt(store, 3, 1)).toEqual(PATTERN[1]);
            // …and the destination's own bounds clip the columns at x=4.
            expect(store[4].r).toBe(0);
        } finally {
            restoreRead();
            restoreDom();
        }
    });
});

describe("the cases that leave the texture unchanged", () => {
    test("DW-5.3 no active target: one warning, nothing written", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            RenderTexture.active = null;
            const texture = new Texture2D(4, 2);
            texture.setPixel(0, 0, { r: 0.5, g: 0.5, b: 0.5, a: 1 } as never);
            texture.setPixel(0, 0, { r: 0.5, g: 0.5, b: 0.5, a: 1 } as never);

            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);
            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);

            expect(warn.mock.calls.filter(c => String(c[0]).includes("active")).length).toBe(2);
            const pixel = texture.getPixel(0, 0);
            expect(Math.round(pixel.r * 255)).toBe(128);
        } finally {
            warn.mockRestore();
            restoreDom();
        }
    });

    test("DW-5.3 a half-float target: one warning, nothing written", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const restoreRead = stubReadPattern();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const hdr = new RenderTexture(4, 2, 24, RenderTextureFormat.DefaultHDR);
            hdr.create();
            RenderTexture.active = hdr;

            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);

            expect(warn.mock.calls.filter(c => String(c[0]).includes("half-float")).length).toBe(1);
            // Nothing was copied: the pattern's red never reached the texture.
            const pixel = texture.getPixel(0, 0);
            expect(Math.round(pixel.r * 255)).toBe(0);
            hdr.destroyImmediate();
        } finally {
            warn.mockRestore();
            restoreRead();
            restoreDom();
        }
    });

    test("a texture made non-readable is left alone, and says so once", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const restoreRead = stubReadPattern();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            activeTarget();
            const texture = new Texture2D(4, 2);
            texture.setPixel(0, 0, { r: 0.25, g: 0.25, b: 0.25, a: 1 } as never);
            texture.apply(false, true);          // makeNoLongerReadable
            const afterApply = store.length;

            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);
            expect(warn.mock.calls.filter(c => String(c[0]).includes("not readable")).length).toBe(1);
            expect(store.length).toBe(afterApply);   // nothing new was written
        } finally {
            warn.mockRestore();
            restoreRead();
            restoreDom();
        }
    });

    test("no Application: the hook is null and the call warns without throwing", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const previous = RenderTexture._readHook;
        RenderTexture._readHook = null;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            activeTarget();
            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);
            expect(warn.mock.calls.filter(c => String(c[0]).includes("backend could not read")).length).toBe(1);
            expect(store.length).toBe(0);
        } finally {
            RenderTexture._readHook = previous;
            warn.mockRestore();
            restoreDom();
        }
    });

    test("an active target that was destroyed reads back nothing", () => {
        const store: Stored[] = [];
        const restoreDom = stubCanvas(store);
        const restoreRead = stubReadPattern();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const target = activeTarget();
            target.destroyImmediate();
            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(0, 0, 4, 2), 0, 0);
            expect(warn.mock.calls.filter(c => String(c[0]).includes("active is null")).length).toBe(1);
            expect(store.length).toBe(0);
        } finally {
            warn.mockRestore();
            restoreRead();
            restoreDom();
        }
    });
});
