import { describe, test, expect } from "vitest";
import { WebGLRenderBackend } from "../src/engine/core/rendering/WebGLRenderBackend";
import { RenderTextureFormat } from "../src/engine/core/graphics/RenderTexture";
import type { RenderTexture } from "../src/engine/core/graphics/RenderTexture";

/**
 * C6r9 phase 2 (DW-2.1..DW-2.3): the backend converts the engine's top-down
 * read rectangle into the GL bottom-up row three.js asks for.
 *
 * The real `THREE.WebGLRenderer` cannot exist in a unit test, so the backend is
 * built without its constructor and handed a fake renderer that records the GL
 * arguments and fills a bottom-up pattern (row index in red, column in green).
 */

interface GlCall { x: number; y: number; width: number; height: number }

function makeBackend() {
    const calls: GlCall[] = [];
    const renderer = {
        readRenderTargetPixels(
            _rt: unknown, x: number, y: number, width: number, height: number, out: Uint8Array
        ): void {
            calls.push({ x, y, width, height });
            for (let row = 0; row < height; row++) {
                for (let column = 0; column < width; column++) {
                    const i = (row * width + column) * 4;
                    out[i + 0] = row + 1; // GL row 0 is the bottom
                    out[i + 1] = column;
                    out[i + 2] = 0;
                    out[i + 3] = 255;
                }
            }
        },
    };
    // Bypass the WebGL-context constructor; `readPixels` only touches `_renderer`.
    const backend = Object.create(WebGLRenderBackend.prototype) as WebGLRenderBackend;
    Object.defineProperty(backend, "_renderer", { value: renderer, configurable: true });
    return { backend, calls };
}

/** The target is only read for `exists`, `format`, `height` and its internal RT. */
function target(width: number, height: number, format: RenderTextureFormat = RenderTextureFormat.ARGB32): RenderTexture {
    return {
        exists: () => true,
        format,
        width,
        height,
        _internalThreeRenderTarget: {},
    } as unknown as RenderTexture;
}

const pixel = (out: Uint8Array, width: number, row: number, column: number) => {
    const i = (row * width + column) * 4;
    return [out[i], out[i + 1]];
};

describe("WebGLRenderBackend.readPixels GL row origin", () => {
    test("DW-2.1 a full-target read still asks for GL row 0", () => {
        const { backend, calls } = makeBackend();
        const out = new Uint8Array(256 * 256 * 4);

        expect(backend.readPixels(target(256, 256), 0, 0, 256, 256, out)).toBe(true);
        expect(calls).toEqual([{ x: 0, y: 0, width: 256, height: 256 }]);
    });

    test("DW-2.1 a sub-rect asks for height - y - height, bottom-up", () => {
        const { backend, calls } = makeBackend();
        const out = new Uint8Array(10 * 20 * 4);

        expect(backend.readPixels(target(256, 256), 3, 7, 10, 20, out)).toBe(true);
        expect(calls).toEqual([{ x: 3, y: 256 - 7 - 20, width: 10, height: 20 }]);
        expect(calls[0].y).toBe(229);
    });

    test("DW-2.2 the returned rows are top-first after the flip", () => {
        const { backend } = makeBackend();
        const out = new Uint8Array(2 * 4 * 4);

        expect(backend.readPixels(target(2, 4), 0, 0, 2, 4, out)).toBe(true);
        // The fake wrote GL rows 1..4 bottom-up; the backend flipped them, so
        // the engine's first row is the top one (red = 4) and the last is red = 1.
        expect(pixel(out, 2, 0, 0)).toEqual([4, 0]);
        expect(pixel(out, 2, 0, 1)).toEqual([4, 1]);
        expect(pixel(out, 2, 3, 0)).toEqual([1, 0]);
        expect(pixel(out, 2, 3, 1)).toEqual([1, 1]);
    });

    test("DW-2.3 a half-float target still returns false without reading", () => {
        const { backend, calls } = makeBackend();
        const out = new Uint8Array(16);

        expect(backend.readPixels(target(2, 2, RenderTextureFormat.ARGBHalf), 0, 0, 2, 2, out)).toBe(false);
        expect(calls).toHaveLength(0);
    });

    test("DW-2.3 an out buffer that is too short still returns false without reading", () => {
        const { backend, calls } = makeBackend();
        const out = new Uint8Array(15); // one byte short of 2*2*4

        expect(backend.readPixels(target(2, 2), 0, 0, 2, 2, out)).toBe(false);
        expect(calls).toHaveLength(0);
    });
});
