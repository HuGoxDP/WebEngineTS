import { describe, test, expect, afterEach } from "vitest";
import {
    GridLayoutGroup, GridConstraint, GridStartAxis,
} from "../src/engine/core/ui/GridLayoutGroup";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * `FixedRowCount` means exactly that many rows — Unity keeps it as `cellCountY`
 * and derives only the columns. This derived the rows back from the columns, so
 * four children in three fixed rows became a 2×2 grid: precisely what asking
 * for two *columns* would have given, leaving the constraint with no effect.
 * Audit part 6, F38.
 */

const made: GameObject[] = [];

/** A grid of `n` children, `rows` fixed, cells 100×100 with no spacing. */
function grid(n: number, rows: number, axis = GridStartAxis.Horizontal) {
    const go = new GameObject("Grid");
    made.push(go);
    const rt = go.addComponent(RectTransform);
    rt.sizeDelta.set(400, 400);

    const group = go.addComponent(GridLayoutGroup);
    group.constraint = GridConstraint.FixedRowCount;
    group.constraintCount = rows;
    group.startAxis = axis;

    const children: RectTransform[] = [];
    for (let i = 0; i < n; i++) {
        const child = new GameObject(`Cell${i}`);
        made.push(child);
        child.transform.parent = go.transform;
        children.push(child.addComponent(RectTransform));
    }
    return { group, children };
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("GridLayoutGroup with a fixed row count", () => {
    test("reserves the rows it was asked for, not the rows it needs", () => {
        // Four children in three rows: two columns, three rows tall.
        const { group } = grid(4, 3);

        expect(group.preferredHeight).toBe(300);
    });

    test("an exact fit is unchanged", () => {
        const { group } = grid(6, 3);

        expect(group.preferredHeight).toBe(300);
        expect(group.preferredWidth).toBe(200);
    });

    test("one row per child when there are fewer children than rows", () => {
        const { group } = grid(2, 4);

        expect(group.preferredHeight).toBe(400);
    });

    test("filling down columns reserves the same rows", () => {
        // The fill order decides which cell a child lands in; it must not
        // change how many rows the grid is. Vertical fill is where the row
        // count is load-bearing — `row = i % rows` — so a wrong count here
        // stacks children on top of each other rather than merely mis-sizing.
        const { group } = grid(4, 3, GridStartAxis.Vertical);

        expect(group.preferredHeight).toBe(300);
        expect(group.preferredWidth).toBe(200);
    });

    test("a fixed column count still derives its rows", () => {
        const go = new GameObject("Columns");
        made.push(go);
        go.addComponent(RectTransform).sizeDelta.set(400, 400);
        const group = go.addComponent(GridLayoutGroup);
        group.constraint = GridConstraint.FixedColumnCount;
        group.constraintCount = 2;
        for (let i = 0; i < 5; i++) {
            const child = new GameObject(`C${i}`);
            made.push(child);
            child.transform.parent = go.transform;
            child.addComponent(RectTransform);
        }

        // Five children in two columns need three rows.
        expect(group.preferredHeight).toBe(300);
    });

    test("an empty grid needs no rows", () => {
        const { group } = grid(0, 3);

        expect(group.preferredHeight).toBe(0);
    });
});
