// path: src/engine/core/assets/TextureStreaming.ts

import { Resources } from "./Resources.ts";
import { StreamingAssetSource } from "./StreamingAssetSource.ts";
import { Texture2D } from "../graphics/Texture2D.ts";

/** What one pass decided to do, for diagnostics and tests. */
export interface ITextureStreamingPass {
    /** The path whose level changed, or null when nothing was worth changing. */
    path: string | null;
    /** The level it moved to. `-1` when nothing changed. */
    level: number;
    /** Whether the pass was lowering quality (over budget) or raising it. */
    direction: "lower" | "raise" | "none";
    /** Estimated texture VRAM when the pass began. */
    vramBytesBefore: number;
}

/**
 * Keeps streamed texture detail inside the VRAM budget.
 *
 * @remarks
 * The policy half of `design/asset-streaming-proposal.md` Stage 3: the
 * mechanism — per-asset levels on `StreamingAssetSource`, in-place reload
 * through {@link Resources.reload}, and propagation to every material holding
 * the texture — exists, and this decides when to use it.
 *
 * **The rule, stated plainly.** Over {@link Resources.vramBudgetBytes}, the
 * most expensive streamed texture that still has a coarser level drops one
 * step. Below {@link restoreHeadroom} of the budget, the cheapest texture that
 * is not yet at its best gains one step back. One texture per pass, because
 * each change costs a fetch and a decode, and because a pass that moved
 * everything at once could not observe the effect of any single move.
 *
 * **What it does not know.** Nothing here consults on-screen size — degrading
 * by *cost* is not the same as degrading what the camera cannot see. Doing that
 * properly needs a material→renderer index the engine does not keep, so this
 * is deliberately the budget half of Stage 3 and not the whole of it. A scene
 * whose expensive textures are all close to the camera will be degraded in the
 * wrong order, and that is a real limitation rather than a rounding error.
 *
 * Off by default: a budget is a device-specific decision, and an engine that
 * silently started re-fetching textures would be worse than one that stays
 * predictable.
 *
 * @example
 * ```ts
 * Resources.vramBudgetBytes = 256 * 1024 * 1024;
 * TextureStreaming.enabled = true;   // now driven from the game loop
 * ```
 */
export class TextureStreaming {

    /**
     * Whether the game loop drives {@link evaluate}.
     *
     * @remarks
     * Requires a finite {@link Resources.vramBudgetBytes} and a streaming
     * source; with either missing every pass is a no-op.
     */
    public static enabled: boolean = false;

    /**
     * Minimum milliseconds between passes.
     *
     * @remarks
     * A pass issues a fetch, so running one per frame would saturate the
     * request queue with quality changes and starve the reads a scene is
     * actually waiting on.
     */
    public static intervalMs: number = 500;

    /**
     * Fraction of the budget below which quality is raised again.
     *
     * @remarks
     * Hysteresis. Restoring the moment usage dips under the budget would
     * re-fetch a texture only to drop it again on the next pass, so quality
     * comes back only when there is real headroom. `1` would oscillate.
     */
    public static restoreHeadroom: number = 0.8;

    /** Timestamp of the last pass. */
    private static _lastPassTime: number = 0;

    /** Whether a pass is mid-flight; passes never overlap. */
    private static _busy: boolean = false;

    /**
     * @internal
     * Called once per frame by `Application._loop`.
     *
     * Rate-limited and non-overlapping, and it never awaits — the loop must not
     * wait on a fetch.
     *
     * **NEVER use in user-facing code.**
     */
    public static _update(): void {
        if (!TextureStreaming.enabled || TextureStreaming._busy) return;

        const now = performance.now();
        if (now - TextureStreaming._lastPassTime < TextureStreaming.intervalMs) return;
        TextureStreaming._lastPassTime = now;

        void TextureStreaming.evaluate().catch(error => {
            console.warn("[TextureStreaming] Pass failed:", error);
        });
    }

    /**
     * Runs one pass now, whatever {@link enabled} says.
     *
     * @returns what the pass decided.
     *
     * @remarks
     * Adjusts at most one texture. Call it directly to drive quality from a
     * host's own schedule, or to make a measurement deterministic.
     */
    public static async evaluate(): Promise<ITextureStreamingPass> {
        const source = Resources._activeSource;
        const budget = Resources.vramBudgetBytes;
        const before = Resources.estimatedVramBytes;
        const idle: ITextureStreamingPass = {
            path: null, level: -1, direction: "none", vramBytesBefore: before,
        };

        if (!(source instanceof StreamingAssetSource)) return idle;
        if (!Number.isFinite(budget) || budget <= 0) return idle;

        // `_update` checks this too, but a host driving passes from its own
        // schedule reaches this method directly, and two passes in flight would
        // both reload the same texture and pick their next target from VRAM
        // figures the other is about to invalidate.
        if (TextureStreaming._busy) return idle;

        const lower = before > budget;
        const raise = before < budget * TextureStreaming.restoreHeadroom;
        if (!lower && !raise) return idle;

        const target = lower
            ? TextureStreaming._pickToLower(source)
            : TextureStreaming._pickToRaise(source);
        if (!target) return idle;

        // Nothing above awaits, so the flag is set before any other caller can
        // observe the pass — keep it that way if this method grows.
        const previous = source.getLodLevel(target.path);
        TextureStreaming._busy = true;
        try {
            source.setLodLevel(target.path, target.level);
            await Resources.reload(Texture2D, target.path);
        } catch (error) {
            // The fetch or the decode failed, so the texture still holds the
            // content of the level it had. Leaving the request where it failed
            // would make the source claim a detail level nothing ever decoded,
            // and the next pass would plan against that fiction.
            if (previous === null) source.clearLodLevel(target.path);
            else source.setLodLevel(target.path, previous);
            throw error;
        } finally {
            TextureStreaming._busy = false;
        }

        return {
            path: target.path,
            level: target.level,
            direction: lower ? "lower" : "raise",
            vramBytesBefore: before,
        };
    }

    /**
     * Forgets the rate limit, so the next {@link _update} runs immediately.
     *
     * @remarks
     * For a host that just changed the budget and wants the effect now rather
     * than up to {@link intervalMs} later.
     */
    public static reset(): void {
        TextureStreaming._lastPassTime = 0;
        TextureStreaming._busy = false;
    }

    // ==================== PRIVATE ====================

    /** The costliest cached texture that still has a coarser level. */
    private static _pickToLower(
        source: StreamingAssetSource,
    ): { path: string; level: number } | null {
        let best: { path: string; level: number; vramBytes: number } | null = null;

        for (const cached of Resources._cachedTextures()) {
            const level = source.getLodLevel(cached.path);
            if (level === null || level <= 0) continue;
            if (best === null || cached.vramBytes > best.vramBytes) {
                best = { path: cached.path, level: level - 1, vramBytes: cached.vramBytes };
            }
        }

        return best ? { path: best.path, level: best.level } : null;
    }

    /** The cheapest cached texture not yet at the best level it could have. */
    private static _pickToRaise(
        source: StreamingAssetSource,
    ): { path: string; level: number } | null {
        let best: { path: string; level: number; vramBytes: number } | null = null;

        for (const cached of Resources._cachedTextures()) {
            const level = source.getLodLevel(cached.path);
            if (level === null) continue;

            // Ask for one step up and see whether the source can actually serve
            // it: a level already at the asset's best, or at the global
            // ceiling, resolves back to itself and is not worth a fetch.
            const wanted = level + 1;
            if (!TextureStreaming._canServe(source, cached.path, wanted)) continue;

            if (best === null || cached.vramBytes < best.vramBytes) {
                best = { path: cached.path, level: wanted, vramBytes: cached.vramBytes };
            }
        }

        return best ? { path: best.path, level: best.level } : null;
    }

    /**
     * Whether requesting `level` would actually change what the source serves.
     *
     * Restores the previous request either way — this is a question, not a
     * change.
     */
    private static _canServe(
        source: StreamingAssetSource,
        path: string,
        level: number,
    ): boolean {
        const current = source.getLodLevel(path);
        source.setLodLevel(path, level);
        const resolved = source.getLodLevel(path);

        if (current === null) {
            source.clearLodLevel(path);
        } else {
            source.setLodLevel(path, current);
        }
        return resolved !== null && resolved > (current ?? -1);
    }
}
