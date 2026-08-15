import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { UITween, UIEase } from "../src/engine/core/ui/UITween";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { CanvasGroup } from "../src/engine/core/ui/CanvasGroup";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Time } from "../src/engine/core/Time";

/**
 * A tween is held in a static list and applied every frame. Nothing checked
 * that its target still existed, so a panel destroyed mid-animation kept being
 * written to — and kept alive by the list that was writing to it. The only way
 * out was `UITween.cancelAll()`, which the class asks the *caller* to remember.
 * Audit part 6, F35.
 */

const made: GameObject[] = [];

function element(name = "Panel"): GameObject {
    const go = new GameObject(name);
    made.push(go);
    go.addComponent(RectTransform);
    return go;
}

beforeEach(() => UITween._reset());

afterEach(() => {
    UITween._reset();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A tween whose target is destroyed", () => {
    test("stops instead of writing to a dead component", () => {
        const go = element();
        const rt = go.getComponent(RectTransform)!;
        UITween.move(rt, new Vector2(100, 0), 1);
        expect(UITween.activeCount).toBe(1);

        go.destroyImmediate();
        UITween._updateAll();

        expect(UITween.activeCount).toBe(0);
    });

    test("reports itself as no longer playing", () => {
        const go = element();
        const handle = UITween.move(go.getComponent(RectTransform)!, new Vector2(50, 50), 1);

        go.destroyImmediate();
        UITween._updateAll();

        expect(handle.isPlaying).toBe(false);
    });

    test("does not raise onComplete — the motion did not finish", () => {
        const go = element();
        const handle = UITween.scale(go.getComponent(RectTransform)!, new Vector2(2, 2), 1);
        let completed = 0;
        handle.onComplete.addListener(() => { completed++; });

        go.destroyImmediate();
        UITween._updateAll();

        expect(completed).toBe(0);
    });

    test("leaves other tweens running", () => {
        const doomed = element("Doomed");
        const kept = element("Kept");
        UITween.move(doomed.getComponent(RectTransform)!, new Vector2(10, 0), 1);
        UITween.move(kept.getComponent(RectTransform)!, new Vector2(10, 0), 1);

        doomed.destroyImmediate();
        UITween._updateAll();

        expect(UITween.activeCount).toBe(1);
    });

    test("a live target keeps animating", () => {
        const go = element();
        const rt = go.getComponent(RectTransform)!;
        UITween.move(rt, new Vector2(100, 0), 1, UIEase.Linear);

        // A tween advances by the frame's delta, which is zero until a frame
        // has been timed.
        Time._update(0.1);
        UITween._updateAll();

        expect(UITween.activeCount).toBe(1);
        expect(rt.anchoredPosition.x).toBeGreaterThan(0);
    });

    test("a fade on a destroyed CanvasGroup stops too", () => {
        const go = element("Group");
        const group = go.addComponent(CanvasGroup);
        UITween.fade(group, 0, 1);

        go.destroyImmediate();
        UITween._updateAll();

        expect(UITween.activeCount).toBe(0);
    });

    test("a target that is not an engine object still animates", () => {
        // `fade` accepts anything with an `alpha`; a plain object has no
        // `exists()` and must not be treated as dead.
        const plain = { alpha: 1 };
        UITween.fade(plain, 0, 1, UIEase.Linear);

        Time._update(0.1);
        UITween._updateAll();

        expect(UITween.activeCount).toBe(1);
        expect(plain.alpha).toBeLessThan(1);
    });
});
