import { describe, test, expect, afterEach } from "vitest";
import { PostProcessing } from "../src/engine/core/postprocessing/PostProcessing";
import { PostEffect } from "../src/engine/core/postprocessing/PostEffect";

/**
 * `removeEffect` disposes an effect's pass *and* drops it from the pass map.
 * `clear` disposed and kept it. The map is a WeakMap, so nothing leaks — but
 * `_buildPipeline` reuses whatever it finds there, so re-adding a cleared
 * effect handed it back its own disposed pass. Audit part 10, F61.
 */

/** An effect that records how many passes it has been asked to build and free. */
class CountingEffect extends PostEffect {
    public created = 0;
    public disposed = 0;

    public _createPass(): unknown {
        this.created++;
        return { name: `pass-${this.created}`, dispose: () => {} };
    }

    public _dispose(): void {
        this.disposed++;
    }
}

/** The pass currently mapped to an effect, or undefined. */
function passOf(effect: PostEffect): unknown {
    const passes = (PostProcessing as unknown as {
        _passes: WeakMap<PostEffect, unknown>;
    })._passes;
    return passes.get(effect);
}

/**
 * Builds a pass the way `_buildPipeline` does — reusing whatever the map
 * already holds. Reproducing that branch is the point: a helper that always
 * creates a fresh pass would pass with or without the fix.
 */
function buildPassFor(effect: CountingEffect): void {
    const passes = (PostProcessing as unknown as {
        _passes: WeakMap<PostEffect, unknown>;
    })._passes;
    let pass = passes.get(effect);
    if (!pass) {
        pass = effect._createPass();
        passes.set(effect, pass);
    }
}

afterEach(() => {
    PostProcessing.clear();
});

describe("PostProcessing.clear", () => {
    test("disposes each effect's pass", () => {
        const effect = new CountingEffect();
        PostProcessing.addEffect(effect);
        buildPassFor(effect);

        PostProcessing.clear();

        expect(effect.disposed).toBe(1);
    });

    test("and forgets it, so nothing hands back a disposed pass", () => {
        const effect = new CountingEffect();
        PostProcessing.addEffect(effect);
        buildPassFor(effect);

        PostProcessing.clear();

        expect(passOf(effect)).toBeUndefined();
    });

    test("re-adding a cleared effect builds a fresh pass", () => {
        const effect = new CountingEffect();
        PostProcessing.addEffect(effect);
        buildPassFor(effect);
        const first = passOf(effect);
        PostProcessing.clear();

        PostProcessing.addEffect(effect);
        buildPassFor(effect);

        expect(passOf(effect)).not.toBe(first);
        expect(effect.created).toBe(2);
    });

    test("empties the effect list", () => {
        PostProcessing.addEffect(new CountingEffect());
        PostProcessing.addEffect(new CountingEffect());

        PostProcessing.clear();

        expect(PostProcessing.effects).toHaveLength(0);
    });

    test("removeEffect does the same for one", () => {
        const effect = new CountingEffect();
        PostProcessing.addEffect(effect);
        buildPassFor(effect);

        expect(PostProcessing.removeEffect(effect)).toBe(true);

        expect(effect.disposed).toBe(1);
        expect(passOf(effect)).toBeUndefined();
    });

    test("clearing an empty pipeline is harmless", () => {
        expect(() => PostProcessing.clear()).not.toThrow();
        expect(PostProcessing.effects).toHaveLength(0);
    });
});
