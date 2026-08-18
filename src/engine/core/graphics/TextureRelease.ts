// path: src/engine/core/graphics/TextureRelease.ts

import type * as THREE from "three";

/**
 * @internal
 * A texture whose CPU-side pixels can be freed once the GPU has them.
 *
 * @remarks
 * An interface rather than a base class because the two implementers do not
 * share one: `Texture2D` extends `Texture`, `Cubemap` extends `EngineObject`.
 * That mismatch is why the deferral lives in this module instead of on either
 * of them.
 */
export interface DeferredRelease {
    /** The Three.js texture whose upload state decides when it is safe. */
    _threeTextureForUpload(): THREE.Texture | null;
    /** Frees the CPU copy. Called only once the GPU is known to have it. */
    _releaseSourceImageNow(): void;
}

/** Tells whether Three.js has uploaded a texture, or `null` if it cannot say. */
export type UploadProbe = (texture: THREE.Texture) => boolean;

interface Pending {
    target: DeferredRelease;
    framesLeft: number;
}

/**
 * Frames to wait when the upload state cannot be read.
 *
 * @remarks
 * Two, the number the workaround in scenario content arrived at independently
 * and the number `CLAUDE.md` has been promising. It is a guess, and it is only
 * ever used when {@link TextureRelease._tick} is given no probe — with one, the
 * wait is not a guess at all.
 */
const BLIND_FRAMES = 2;

/**
 * @internal
 * Defers freeing a texture's CPU pixels until the GPU has them.
 *
 * @remarks
 * Three.js uploads a texture during the first `render()` that draws with it.
 * Freeing the source image before that leaves the texture blank for the rest of
 * the run — and nothing stopped it, while `CLAUDE.md` claimed a guard that did
 * not exist and one scenario carried its own countdown to work around the gap.
 *
 * Given a probe, this is not a countdown at all: a texture is released on the
 * first frame after the renderer actually has it, however many frames that
 * takes, and a texture that is never drawn is never released — which costs the
 * memory the caller wanted back but is what they would have had anyway, and is
 * far better than a blank texture.
 */
export class TextureRelease {

    private static readonly _pending: Pending[] = [];

    /**
     * Queues a texture's CPU pixels for release.
     *
     * @param target - the texture to free once it is safe.
     */
    public static schedule(target: DeferredRelease): void {
        for (const entry of TextureRelease._pending) {
            if (entry.target === target) return;
        }
        TextureRelease._pending.push({ target, framesLeft: BLIND_FRAMES });
    }

    /** Whether anything is waiting. */
    public static get pendingCount(): number {
        return TextureRelease._pending.length;
    }

    /**
     * Releases everything the GPU has taken. Called once per rendered frame,
     * after the render.
     *
     * @param isUploaded - reads a texture's upload state, or `null` when it
     *        cannot be read — a backend that is not WebGL, or no renderer yet.
     */
    public static _tick(isUploaded: UploadProbe | null): void {
        const pending = TextureRelease._pending;
        if (pending.length === 0) return;

        for (let i = pending.length - 1; i >= 0; i--) {
            const entry = pending[i];
            const texture = entry.target._threeTextureForUpload();

            if (isUploaded && texture) {
                // The real signal. Wait as long as it takes; a texture nobody
                // draws simply keeps its pixels.
                if (!isUploaded(texture)) continue;
            } else if (--entry.framesLeft > 0) {
                // No probe: fall back to the countdown, which is a guess.
                continue;
            }

            pending.splice(i, 1);
            entry.target._releaseSourceImageNow();
        }
    }

    /** @internal Drops every pending release, without freeing anything. */
    public static _clear(): void {
        TextureRelease._pending.length = 0;
    }
}
