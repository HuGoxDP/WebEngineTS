import { describe, test, expect, afterEach } from "vitest";
import { ScrollRect } from "../src/engine/core/ui/ScrollRect";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Time } from "../src/engine/core/Time";

/**
 * A scroll view holds its content by reference, and rebuilding a list destroys
 * that object. Nothing told the scroll view, so its per-frame driver went on
 * pinning anchors and writing positions on a destroyed component — and held it
 * alive while doing so. Audit part 7, F44.
 */

const made: GameObject[] = [];

function scrollView() {
    const viewGO = new GameObject("View");
    made.push(viewGO);
    viewGO.addComponent(RectTransform).sizeDelta.set(100, 100);
    const scroll = viewGO.addComponent(ScrollRect);

    const contentGO = new GameObject("Content");
    made.push(contentGO);
    contentGO.transform.parent = viewGO.transform;
    const content = contentGO.addComponent(RectTransform);
    content.sizeDelta.set(300, 300);
    scroll.content = content;

    return { scroll, contentGO, content };
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A scroll view whose content is destroyed", () => {
    test("lets go of it", () => {
        const { scroll, contentGO } = scrollView();

        contentGO.destroyImmediate();
        ScrollRect._updateAll();

        expect(scroll.content).toBeNull();
    });

    test("does not throw while ticking", () => {
        const { contentGO } = scrollView();

        contentGO.destroyImmediate();
        Time._update(1 / 60);

        expect(() => ScrollRect._updateAll()).not.toThrow();
    });

    test("reports nothing scrollable afterwards", () => {
        const { scroll, contentGO } = scrollView();
        expect(scroll.getScrollableSize(new Vector2()).x).toBeGreaterThan(0);

        contentGO.destroyImmediate();

        expect(scroll.getScrollableSize(new Vector2()).x).toBe(0);
    });

    test("a live content is left alone", () => {
        const { scroll, content } = scrollView();

        Time._update(1 / 60);
        ScrollRect._updateAll();

        expect(scroll.content).toBe(content);
    });

    test("a replacement content works as before", () => {
        // The usual sequence: destroy the old list, build a new one.
        const { scroll, contentGO } = scrollView();
        contentGO.destroyImmediate();
        ScrollRect._updateAll();

        const freshGO = new GameObject("Content 2");
        made.push(freshGO);
        freshGO.transform.parent = scroll.gameObject.transform;
        const fresh = freshGO.addComponent(RectTransform);
        fresh.sizeDelta.set(400, 400);
        scroll.content = fresh;

        Time._update(1 / 60);
        ScrollRect._updateAll();

        expect(scroll.content).toBe(fresh);
        expect(scroll.getScrollableSize(new Vector2()).x).toBeGreaterThan(0);
    });
});
