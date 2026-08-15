import type { Color } from "../math/Color";

/**
 * @internal
 * Shared drawing helpers for the Canvas UI components.
 *
 * @remarks
 * These exist to keep the per-frame UI draw path allocation-free. Building an
 * `rgba(...)` string costs a heap allocation, and every UI component used to
 * build one (or several) per element per frame.
 */

/** Maximum number of memoized CSS color strings before the cache is dropped. */
const MAX_CACHED_COLORS = 512;

const _colorCache: Map<number, string> = new Map();

/**
 * @internal
 * Converts an engine {@link Color} to a CSS `rgba()` string, memoized.
 *
 * @remarks
 * UI colors are almost always constant across frames, so the same handful of
 * strings is reused instead of being rebuilt 60 times per second. Alpha is
 * quantized to 1/1000 for the cache key — finer steps are not representable
 * by the 2D context anyway.
 */
export function cssColor(c: Color): string {
    const r = c.r <= 0 ? 0 : c.r >= 1 ? 255 : (c.r * 255) | 0;
    const g = c.g <= 0 ? 0 : c.g >= 1 ? 255 : (c.g * 255) | 0;
    const b = c.b <= 0 ? 0 : c.b >= 1 ? 255 : (c.b * 255) | 0;
    const a = c.a <= 0 ? 0 : c.a >= 1 ? 1000 : (c.a * 1000) | 0;

    const key = (((r * 256 + g) * 256 + b) * 1001) + a;
    const cached = _colorCache.get(key);
    if (cached !== undefined) return cached;

    if (_colorCache.size >= MAX_CACHED_COLORS) _colorCache.clear();

    const css = a >= 1000
        ? `rgb(${r},${g},${b})`
        : `rgba(${r},${g},${b},${a / 1000})`;
    _colorCache.set(key, css);
    return css;
}

/**
 * @internal
 * Folds a {@link Color} into a running hash used for repaint change detection.
 */
export function hashColor(seed: number, c: Color): number {
    let h = seed;
    h = hashNumber(h, c.r);
    h = hashNumber(h, c.g);
    h = hashNumber(h, c.b);
    return hashNumber(h, c.a);
}

/**
 * @internal
 * Folds a number into a running 32-bit hash (FNV-1a over the value's bits).
 *
 * @remarks
 * Floats are quantized to 1/256 before hashing so that sub-pixel jitter which
 * cannot change the rasterized result does not force a repaint.
 */
export function hashNumber(seed: number, value: number): number {
    const q = Math.round(value * 256) | 0;
    let h = (seed ^ q) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    return h;
}

/**
 * @internal
 * Folds a string into a running 32-bit hash (FNV-1a).
 */
export function hashString(seed: number, value: string): number {
    let h = seed >>> 0;
    for (let i = 0; i < value.length; i++) {
        h = (h ^ value.charCodeAt(i)) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

/**
 * @internal
 * Folds a boolean into a running 32-bit hash.
 */
export function hashBool(seed: number, value: boolean): number {
    return hashNumber(seed, value ? 1 : 0);
}

/**
 * @internal
 * Builds a (optionally rounded) rectangle path on the context.
 *
 * @remarks
 * Always starts with `beginPath()`, so the caller can immediately `fill()`,
 * `stroke()` or `clip()` without inheriting a stale path.
 *
 * @param radius - corner radius in pixels; clamped to half the shorter side.
 */
export function roundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    radius: number,
): void {
    ctx.beginPath();

    const r = Math.min(radius, w * 0.5, h * 0.5);
    if (r <= 0) {
        ctx.rect(x, y, w, h);
        return;
    }

    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

/** @internal Seed for the FNV-1a hash chain. */
export const HASH_SEED = 2166136261;

let _fontGeneration = 0;

/**
 * @internal
 * Counter bumped whenever the document finishes loading web fonts.
 *
 * @remarks
 * Text measured against a fallback font must be re-measured (and repainted)
 * once the real font arrives; folding this into text caches and visual hashes
 * makes that happen without every label polling `document.fonts`.
 */
export function fontGeneration(): number {
    return _fontGeneration;
}

if (typeof document !== "undefined" && document.fonts?.addEventListener) {
    document.fonts.addEventListener("loadingdone", () => { _fontGeneration++; });
}

/**
 * Copies `source` into `buffer` and returns it, for a per-frame driver that
 * must survive its own list changing underneath it.
 *
 * @remarks
 * Every `_updateAll` here walks an array of components that splice themselves
 * out in `onDisable`. A component — or a listener it raises — that disables
 * something during the pass shifts the array, and an index loop then skips
 * whatever followed. Iterating a copy fixes that while keeping the order
 * exactly as it was, which reversing the loop would not.
 *
 * The buffer is reused rather than allocated: these run once per frame each,
 * and after the first call this is a length assignment and N index writes.
 * `UIEvent.invoke` and `PluginManager` take the same precaution.
 *
 * @param source - the live list.
 * @param buffer - a scratch array owned by the caller.
 * @returns `buffer`, filled with `source`'s current contents.
 */
export function snapshotInto<T>(source: readonly T[], buffer: T[]): readonly T[] {
    buffer.length = source.length;
    for (let i = 0; i < source.length; i++) buffer[i] = source[i];
    return buffer;
}
