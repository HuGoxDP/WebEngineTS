import { describe, test, expect, afterEach } from "vitest";
import { TextureRelease } from "../src/engine/core/graphics/TextureRelease";
import type { DeferredRelease } from "../src/engine/core/graphics/TextureRelease";

/**
 * `releaseSourceImage` nulled a texture's pixels the moment it was called.
 * Three.js uploads during the first `render()` that draws with the texture, so
 * calling it any earlier left the texture blank for the rest of the run — and
 * `CLAUDE.md` claimed a two-frame countdown that existed only in scenario
 * content, reinvented by whoever hit the bug. Audit F9, open since part 2.
 */

/** A stand-in with the two members the queue needs. */
class FakeTexture implements DeferredRelease {
    public released = 0;
    public uploaded = false;
    private readonly _three = {} as never;

    public _threeTextureForUpload() { return this._three; }
    public _releaseSourceImageNow(): void { this.released++; }
}

/** A probe that answers from each texture's own flag. */
function probeOf(...textures: FakeTexture[]) {
    return (three: unknown) => {
        for (const t of textures) if (t._threeTextureForUpload() === three) return t.uploaded;
        return false;
    };
}

afterEach(() => TextureRelease._clear());

describe("A scheduled release", () => {
    test("does not happen on the frame it is asked for", () => {
        const tex = new FakeTexture();

        TextureRelease.schedule(tex);

        expect(tex.released).toBe(0);
        expect(TextureRelease.pendingCount).toBe(1);
    });

    test("waits for the upload however long it takes", () => {
        // The whole finding: a texture released before its upload is blank for
        // the rest of the run, and a frame count cannot know when that is.
        const tex = new FakeTexture();
        TextureRelease.schedule(tex);
        const probe = probeOf(tex);

        for (let i = 0; i < 50; i++) TextureRelease._tick(probe);
        expect(tex.released).toBe(0);

        tex.uploaded = true;
        TextureRelease._tick(probe);

        expect(tex.released).toBe(1);
    });

    test("happens once, not once per frame after", () => {
        const tex = new FakeTexture();
        tex.uploaded = true;
        TextureRelease.schedule(tex);
        const probe = probeOf(tex);

        TextureRelease._tick(probe);
        TextureRelease._tick(probe);
        TextureRelease._tick(probe);

        expect(tex.released).toBe(1);
        expect(TextureRelease.pendingCount).toBe(0);
    });

    test("a texture nobody draws keeps its pixels rather than losing them", () => {
        // The safe end of the trade: holding the memory is what the caller
        // would have had anyway. A blank texture is not.
        const tex = new FakeTexture();
        TextureRelease.schedule(tex);
        const probe = probeOf(tex);

        for (let i = 0; i < 1000; i++) TextureRelease._tick(probe);

        expect(tex.released).toBe(0);
        expect(TextureRelease.pendingCount).toBe(1);
    });

    test("scheduling twice queues one release, not two", () => {
        const tex = new FakeTexture();
        tex.uploaded = true;

        TextureRelease.schedule(tex);
        TextureRelease.schedule(tex);
        expect(TextureRelease.pendingCount).toBe(1);

        TextureRelease._tick(probeOf(tex));

        expect(tex.released).toBe(1);
    });

    test("several textures are judged one at a time", () => {
        const early = new FakeTexture();
        const late = new FakeTexture();
        TextureRelease.schedule(early);
        TextureRelease.schedule(late);
        const probe = probeOf(early, late);

        early.uploaded = true;
        TextureRelease._tick(probe);

        expect(early.released).toBe(1);
        expect(late.released).toBe(0);

        late.uploaded = true;
        TextureRelease._tick(probe);

        expect(late.released).toBe(1);
    });
});

describe("With no probe", () => {
    test("it falls back to the two-frame countdown", () => {
        // A backend that is not WebGL cannot be asked. Two frames is the number
        // the scenario workaround arrived at, and it is a guess — which is why
        // it is only ever reached when there is nothing better.
        const tex = new FakeTexture();
        TextureRelease.schedule(tex);

        TextureRelease._tick(null);
        expect(tex.released).toBe(0);

        TextureRelease._tick(null);
        expect(tex.released).toBe(1);
    });

    test("and still releases only once", () => {
        const tex = new FakeTexture();
        TextureRelease.schedule(tex);

        for (let i = 0; i < 10; i++) TextureRelease._tick(null);

        expect(tex.released).toBe(1);
    });
});

describe("Clearing the queue", () => {
    test("drops the pending releases without performing them", () => {
        const tex = new FakeTexture();
        tex.uploaded = true;
        TextureRelease.schedule(tex);

        TextureRelease._clear();
        TextureRelease._tick(probeOf(tex));

        expect(tex.released).toBe(0);
        expect(TextureRelease.pendingCount).toBe(0);
    });

    test("an empty queue costs nothing to tick", () => {
        expect(() => TextureRelease._tick(null)).not.toThrow();
        expect(TextureRelease.pendingCount).toBe(0);
    });
});
