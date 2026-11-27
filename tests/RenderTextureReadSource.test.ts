import { describe, test, expect, vi, afterEach } from "vitest";
import { Rect } from "../src/engine/core/math/Rect";
import { Texture2D } from "../src/engine/core/graphics/Texture2D";
import { RenderTexture, RenderTextureFormat } from "../src/engine/core/graphics/RenderTexture";

/**
 * C6r9 phase 1 (DW-1.1..DW-1.4): `Texture2D.readPixels` reads from the SOURCE
 * rectangle, not from the destination offset.
 *
 * The hook answers from an (x, y)-addressed pattern: each returned pixel encodes
 * the source coordinate it was asked for (red = x, green = y). A hook that is
 * handed the destination instead of the source, or that ignores its origin,
 * therefore shows up as the wrong number in the texture — no GPU involved.
 */

interface ReadCall { x: number; y: number; width: number; height: number }

/** A 2D context that records the image data written to it and hands back zeros. */
function makeContext(store: { r: number; g: number; b: number; a: number }[]) {
    return {
        putImageData: (image: { data: Uint8ClampedArray }) => {
            for (let i = 0; i < image.data.length / 4; i++) {
                store[i] = {
                    r: image.data[i * 4], g: image.data[i * 4 + 1],
                    b: image.data[i * 4 + 2], a: image.data[i * 4 + 3],
                };
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

/** Install the canvas stub `Texture2D._ensurePixelData` needs, before constructing one. */
function stubCanvas(): () => void {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    const savedCanvasElement = g.HTMLCanvasElement;
    class StubCanvasElement { }
    g.HTMLCanvasElement = StubCanvasElement;
    g.document = {
        createElement: (tag: string) => {
            if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
            const canvas = { width: 0, height: 0, getContext: () => makeContext([]) };
            Object.setPrototypeOf(canvas, StubCanvasElement.prototype);
            return canvas;
        },
    };
    return () => { g.document = savedDocument; g.HTMLCanvasElement = savedCanvasElement; };
}

/** Encodes the requested source coordinate into each returned pixel; records the args. */
function installPatternHook(calls: ReadCall[]): () => void {
    const previous = RenderTexture._readHook;
    RenderTexture._readHook = (_target, x, y, width, height, out) => {
        calls.push({ x, y, width, height });
        for (let row = 0; row < height; row++) {
            for (let column = 0; column < width; column++) {
                const i = (row * width + column) * 4;
                out[i + 0] = (x + column) & 255;
                out[i + 1] = (y + row) & 255;
                out[i + 2] = 0;
                out[i + 3] = 255;
            }
        }
        return true;
    };
    return () => { RenderTexture._readHook = previous; };
}

function activeTarget(width: number, height: number): RenderTexture {
    const target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
    target.create();
    RenderTexture.active = target;
    return target;
}

/** The encoded source coordinate that arrived at a texture pixel. */
const xyAt = (texture: Texture2D, x: number, y: number) => {
    const color = texture.getPixel(x, y);
    return [Math.round(color.r * 255), Math.round(color.g * 255)];
};

afterEach(() => {
    RenderTexture.active = null;
    vi.restoreAllMocks();
});

describe("readPixels reads the source rectangle", () => {
    test("DW-1.1 a sub-rect hands the hook its source origin, never the destination", () => {
        const restoreDom = stubCanvas();
        const calls: ReadCall[] = [];
        const restoreHook = installPatternHook(calls);
        try {
            const target = activeTarget(4, 2);
            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(1, 0, 2, 1), 0, 0);

            expect(calls).toEqual([{ x: 1, y: 0, width: 2, height: 1 }]);
            // The top row's two middle pixels of the target, written at the top
            // left of the texture — encoded as source (1, 0) and (2, 0).
            expect(xyAt(texture, 0, 0)).toEqual([1, 0]);
            expect(xyAt(texture, 1, 0)).toEqual([2, 0]);
            expect(xyAt(texture, 2, 0)).toEqual([0, 0]); // untouched
            target.destroyImmediate();
        } finally {
            restoreHook();
            restoreDom();
        }
    });

    test("DW-1.1 the centre of a 256x256 target is read from (64, 64, 128, 128)", () => {
        const restoreDom = stubCanvas();
        const calls: ReadCall[] = [];
        const restoreHook = installPatternHook(calls);
        try {
            const target = activeTarget(256, 256);
            const texture = new Texture2D(128, 128);
            texture.readPixels(new Rect(64, 64, 128, 128), 0, 0);

            expect(calls).toEqual([{ x: 64, y: 64, width: 128, height: 128 }]);
            expect(xyAt(texture, 0, 0)).toEqual([64, 64]);
            expect(xyAt(texture, 127, 127)).toEqual([191, 191]);
            target.destroyImmediate();
        } finally {
            restoreHook();
            restoreDom();
        }
    });

    test("DW-1.3 destX/destY move only the write position, not the hook's source", () => {
        const restoreDom = stubCanvas();
        const calls: ReadCall[] = [];
        const restoreHook = installPatternHook(calls);
        try {
            const target = activeTarget(256, 256);
            const texture = new Texture2D(300, 300);
            texture.readPixels(new Rect(64, 64, 128, 128), 10, 20);

            expect(calls).toEqual([{ x: 64, y: 64, width: 128, height: 128 }]);
            expect(xyAt(texture, 10, 20)).toEqual([64, 64]);
            expect(xyAt(texture, 9, 20)).toEqual([0, 0]); // nothing written before the offset
            expect(xyAt(texture, 20, 30)).toEqual([74, 74]); // source advanced with the destination
            target.destroyImmediate();
        } finally {
            restoreHook();
            restoreDom();
        }
    });

    test("DW-1.2 a negative destination clips and advances the source", () => {
        const restoreDom = stubCanvas();
        const calls: ReadCall[] = [];
        const restoreHook = installPatternHook(calls);
        try {
            const target = activeTarget(4, 2);
            const texture = new Texture2D(4, 2);
            texture.readPixels(new Rect(0, 0, 4, 2), -2, -1);

            // Two columns and one row were lost off the left/top; the source
            // origin moves by exactly that much and the read shrinks to match.
            expect(calls).toEqual([{ x: 2, y: 1, width: 2, height: 1 }]);
            expect(xyAt(texture, 0, 0)).toEqual([2, 1]);
            expect(xyAt(texture, 2, 0)).toEqual([0, 0]); // nothing beyond the clipped width
            target.destroyImmediate();
        } finally {
            restoreHook();
            restoreDom();
        }
    });
});
