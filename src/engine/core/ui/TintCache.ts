import { profilerHooks } from "../diagnostics/ProfilerHooks";
import { HASH_SEED, hashNumber } from "./UIUtils";

/** One tinted copy of a source bitmap, shared by every element that wants it. */
interface TintEntry {
    canvas: HTMLCanvasElement;
    /** Identity of the entry, re-checked on every hit so a hash collision cannot serve the wrong bitmap. */
    textureId: number;
    version: number;
    rgb: number;
    bytes: number;
    lastUsed: number;
}

/** 32 MB — roughly two 2048² tinted atlases, and well under a texture budget. */
const DEFAULT_LIMIT_BYTES = 32 * 1024 * 1024;

/**
 * @internal
 * Process-wide store of tinted sprite copies, keyed by source texture and tint.
 *
 * @remarks
 * Tinting has to happen off-screen — the 2D context cannot multiply a bitmap by
 * a color while drawing it — and the result is a full-resolution buffer. Holding
 * one *per element* meant twenty tinted copies of one icon cost twenty
 * full-resolution buffers, kept alive until each element was destroyed.
 *
 * Sharing them collapses that to one buffer per (texture, version, tint), which
 * also makes atlases pay off properly: every sprite drawn from one atlas with
 * one tint shares a single tinted atlas.
 *
 * Bounded by {@link limitBytes} with least-recently-used eviction, so a scenario
 * that cycles through many tints cannot grow it without limit. Eviction scans
 * for the oldest entry rather than reordering on every hit, keeping the lookup
 * itself free of writes.
 */
export class TintCache {

    private static readonly _entries: Map<number, TintEntry> = new Map();
    private static _bytes: number = 0;
    private static _limitBytes: number = DEFAULT_LIMIT_BYTES;
    private static _clock: number = 0;

    private constructor() {}

    /** Bytes currently held, counting each buffer as RGBA8. */
    public static get bytes(): number { return TintCache._bytes; }

    /** Number of tinted buffers currently held. */
    public static get count(): number { return TintCache._entries.size; }

    /** Upper bound on {@link bytes}. Lowering it evicts immediately. */
    public static get limitBytes(): number { return TintCache._limitBytes; }

    public static set limitBytes(value: number) {
        TintCache._limitBytes = Math.max(0, value);
        TintCache._evictToLimit();
    }

    /** Drops every cached buffer. */
    public static clear(): void {
        TintCache._entries.clear();
        TintCache._bytes = 0;
    }

    /**
     * Looks up the tinted copy of `textureId` at `version` in `rgb`.
     *
     * @param textureId - source texture instance id.
     * @param version - source upload counter, so `Texture2D.apply()` invalidates.
     * @param rgb - tint packed as `0xRRGGBB`; alpha is applied at draw time and
     *              is deliberately not part of the identity.
     * @returns the cached buffer, or `null` when it must be built.
     */
    public static get(textureId: number, version: number, rgb: number): HTMLCanvasElement | null {
        const entry = TintCache._entries.get(TintCache._key(textureId, version, rgb));
        if (!entry) return null;

        // The key is a hash, so identity is confirmed rather than assumed.
        if (entry.textureId !== textureId || entry.version !== version || entry.rgb !== rgb) {
            return null;
        }

        entry.lastUsed = ++TintCache._clock;
        return entry.canvas;
    }

    /**
     * Stores a freshly built tinted copy, evicting older ones if needed.
     *
     * @param textureId - source texture instance id.
     * @param version - source upload counter.
     * @param rgb - tint packed as `0xRRGGBB`.
     * @param canvas - the tinted buffer.
     */
    public static put(
        textureId: number,
        version: number,
        rgb: number,
        canvas: HTMLCanvasElement,
    ): void {
        const key = TintCache._key(textureId, version, rgb);
        const previous = TintCache._entries.get(key);
        if (previous) TintCache._bytes -= previous.bytes;

        const bytes = canvas.width * canvas.height * 4;
        TintCache._entries.set(key, {
            canvas,
            textureId,
            version,
            rgb,
            bytes,
            lastUsed: ++TintCache._clock,
        });
        TintCache._bytes += bytes;

        TintCache._evictToLimit();
    }

    /** @internal Resets to a pristine state, for tests. */
    public static _reset(): void {
        TintCache.clear();
        TintCache._limitBytes = DEFAULT_LIMIT_BYTES;
        TintCache._clock = 0;
    }

    private static _key(textureId: number, version: number, rgb: number): number {
        let h = hashNumber(HASH_SEED, textureId);
        h = hashNumber(h, version);
        return hashNumber(h, rgb);
    }

    /**
     * Drops least-recently-used entries until the budget is met.
     *
     * @remarks
     * The entry inserted last is never the oldest, so a single buffer larger
     * than the whole budget survives rather than being evicted the moment it is
     * built — the alternative rebuilds it on every repaint forever.
     */
    private static _evictToLimit(): void {
        while (TintCache._bytes > TintCache._limitBytes && TintCache._entries.size > 1) {
            let oldestKey = -1;
            let oldestUse = Infinity;

            for (const [key, entry] of TintCache._entries) {
                if (entry.lastUsed < oldestUse) {
                    oldestUse = entry.lastUsed;
                    oldestKey = key;
                }
            }

            const victim = TintCache._entries.get(oldestKey);
            if (!victim) break;
            TintCache._entries.delete(oldestKey);
            TintCache._bytes -= victim.bytes;
        }
    }
}

profilerHooks.uiTintCacheBytes = () => TintCache.bytes;
