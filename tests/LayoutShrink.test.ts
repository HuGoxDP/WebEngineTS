import { describe, test, expect, afterEach } from "vitest";
import { HorizontalLayoutGroup, VerticalLayoutGroup } from "../src/engine/core/ui/LayoutGroup";
import { LayoutElement } from "../src/engine/core/ui/LayoutElement";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * `LayoutElement.minWidth` documents a size an element "may be shrunk to", and
 * nothing ever shrunk one: when the children's preferred sizes did not fit, the
 * group handed out no correction at all and they overflowed. Audit part 6, F39.
 */

const made: GameObject[] = [];

/** Access to the size distribution, which is where the arithmetic lives. */
type Distributor = {
    _distributeSpare(
        children: readonly RectTransform[], sizes: number[],
        spare: number, vertical: boolean,
    ): void;
};

function group(vertical = false) {
    const go = new GameObject("Group");
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(100, 100);
    const g = vertical
        ? go.addComponent(VerticalLayoutGroup)
        : go.addComponent(HorizontalLayoutGroup);
    return { go, group: g as unknown as Distributor };
}

/** A child preferring `preferred`, willing to go down to `min` if given one. */
function child(parent: GameObject, preferred: number, min?: number): RectTransform {
    const go = new GameObject("Child");
    made.push(go);
    go.transform.parent = parent.transform;
    const rt = go.addComponent(RectTransform);
    rt.sizeDelta.set(preferred, preferred);

    const el = go.addComponent(LayoutElement);
    el.preferredWidth = preferred;
    el.preferredHeight = preferred;
    if (min !== undefined) {
        el.minWidth = min;
        el.minHeight = min;
    }
    return rt;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A layout group with too little room", () => {
    test("shrinks children toward their minimums", () => {
        const { go, group: g } = group();
        const children = [child(go, 80, 20), child(go, 80, 20)];
        const sizes = [80, 80];

        // 160 wanted, 100 available.
        g._distributeSpare(children, sizes, -60, false);

        expect(sizes[0]).toBeCloseTo(50);
        expect(sizes[1]).toBeCloseTo(50);
    });

    test("takes more from whoever has more to give", () => {
        const { go, group: g } = group();
        const children = [child(go, 90, 10), child(go, 30, 20)];
        const sizes = [90, 30];

        // Shrinkable: 80 and 10, ninety total; deficit 20 → factor 0.222…
        g._distributeSpare(children, sizes, -20, false);

        expect(sizes[0]).toBeCloseTo(90 - 80 * (20 / 90));
        expect(sizes[1]).toBeCloseTo(30 - 10 * (20 / 90));
        expect(sizes[0] + sizes[1]).toBeCloseTo(100);
    });

    test("never goes below a minimum, even when that still overflows", () => {
        const { go, group: g } = group();
        const children = [child(go, 80, 60), child(go, 80, 60)];
        const sizes = [80, 80];

        // Asked to lose 100, but only 40 is available above the minimums.
        g._distributeSpare(children, sizes, -100, false);

        expect(sizes[0]).toBeCloseTo(60);
        expect(sizes[1]).toBeCloseTo(60);
    });

    test("a child with no minimum set is left alone", () => {
        // Its minimum falls back to its preferred size, so it has nothing to
        // give — which keeps every existing layout behaving as it did.
        const { go, group: g } = group();
        const children = [child(go, 80), child(go, 80)];
        const sizes = [80, 80];

        g._distributeSpare(children, sizes, -60, false);

        expect(sizes[0]).toBe(80);
        expect(sizes[1]).toBe(80);
    });

    test("only the one that can give does", () => {
        const { go, group: g } = group();
        const children = [child(go, 80), child(go, 80, 20)];
        const sizes = [80, 80];

        g._distributeSpare(children, sizes, -60, false);

        expect(sizes[0]).toBe(80);
        expect(sizes[1]).toBeCloseTo(20);
    });

    test("the vertical axis does the same", () => {
        const { go, group: g } = group(true);
        const children = [child(go, 80, 20), child(go, 80, 20)];
        const sizes = [80, 80];

        g._distributeSpare(children, sizes, -60, true);

        expect(sizes[0]).toBeCloseTo(50);
        expect(sizes[1]).toBeCloseTo(50);
    });

    test("spare room is still shared out as before", () => {
        const { go, group: g } = group();
        const children = [child(go, 20, 10), child(go, 20, 10)];
        const el = children[0].gameObject.getComponent(LayoutElement)!;
        el.flexibleWidth = 1;
        const sizes = [20, 20];

        g._distributeSpare(children, sizes, 60, false);

        expect(sizes[0]).toBeCloseTo(80);
        expect(sizes[1]).toBe(20);
    });
});
