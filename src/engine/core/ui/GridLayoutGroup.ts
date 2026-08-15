import { LayoutGroup } from "./LayoutGroup";
import { Vector2 } from "../math/Vector2";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * Which corner a {@link GridLayoutGroup} fills from.
 *
 * @remarks
 * Because Y points down, **`Upper` is the low-Y edge** — the same inversion
 * {@link LayoutAnchor} carries.
 */
export enum GridStartCorner {
    UpperLeft = "UpperLeft",
    UpperRight = "UpperRight",
    LowerLeft = "LowerLeft",
    LowerRight = "LowerRight",
}

/** Which way a {@link GridLayoutGroup} advances before wrapping. */
export enum GridStartAxis {
    /** Fill a row, then move to the next one. */
    Horizontal = "Horizontal",
    /** Fill a column, then move to the next one. */
    Vertical = "Vertical",
}

/** How a {@link GridLayoutGroup} decides its row and column counts. */
export enum GridConstraint {
    /** Fit as many columns as the width allows. */
    Flexible = "Flexible",
    /** Use exactly {@link GridLayoutGroup.constraintCount} columns. */
    FixedColumnCount = "FixedColumnCount",
    /** Use exactly {@link GridLayoutGroup.constraintCount} rows. */
    FixedRowCount = "FixedRowCount",
}

/**
 * Arranges children on a fixed-cell grid.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.GridLayoutGroup`. Unlike the row and
 * column groups, every cell is the same size — {@link cellSize} — so a child's
 * own preferred size is ignored. That is what makes an inventory, a palette or
 * an answer grid line up.
 *
 * ```ts
 * const grid = panel.addComponent(GridLayoutGroup);
 * grid.cellSize.set(64, 64);
 * grid.spacing.set(8, 8);
 * grid.constraint = GridConstraint.FixedColumnCount;
 * grid.constraintCount = 4;
 * ```
 */
@Serializable({ typeName: "GridLayoutGroup", category: "UI" })
export class GridLayoutGroup extends LayoutGroup {

    /** Size of every cell, in canvas units. */
    @SerializedField({ type: FieldType.Vector2 })
    public readonly cellSize: Vector2 = new Vector2(100, 100);

    /** Gap between cells on each axis, in canvas units. */
    @SerializedField({ type: FieldType.Vector2 })
    public readonly spacing: Vector2 = new Vector2(0, 0);

    /** The corner filling starts from. */
    @SerializedField({ type: FieldType.Enum })
    public startCorner: GridStartCorner = GridStartCorner.UpperLeft;

    /** Whether filling advances along rows or down columns. */
    @SerializedField({ type: FieldType.Enum })
    public startAxis: GridStartAxis = GridStartAxis.Horizontal;

    /** How the row and column counts are decided. */
    @SerializedField({ type: FieldType.Enum })
    public constraint: GridConstraint = GridConstraint.Flexible;

    /** Row or column count for the fixed constraints. Clamped to at least 1. */
    @SerializedField()
    public constraintCount: number = 2;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Width this grid needs for its current cell and column counts. */
    public get preferredWidth(): number {
        const columns = this._columnCount(this._collect().length, this._innerWidth());
        return this.padding.left + this.padding.right
            + columns * this.cellSize.x
            + Math.max(0, columns - 1) * this.spacing.x;
    }

    /** Height this grid needs for its current cell and row counts. */
    public get preferredHeight(): number {
        const count = this._collect().length;
        const columns = this._columnCount(count, this._innerWidth());
        const rows = this._rowCount(count, columns);
        return this.padding.top + this.padding.bottom
            + rows * this.cellSize.y
            + Math.max(0, rows - 1) * this.spacing.y;
    }

    // ── private ──────────────────────────────────────────────────────

    protected override _rebuild(): void {
        const children = this._collect();
        if (children.length === 0) return;

        const rect = this.rectTransform._resolvedLocalRect;
        const innerX = rect.x + this.padding.left;
        const innerY = rect.y + this.padding.top;
        const innerW = Math.max(0, rect.width - this.padding.left - this.padding.right);
        const innerH = Math.max(0, rect.height - this.padding.top - this.padding.bottom);

        const columns = this._columnCount(children.length, innerW);
        const rows = this._rowCount(children.length, columns);

        const gridW = columns * this.cellSize.x + (columns - 1) * this.spacing.x;
        const gridH = rows * this.cellSize.y + (rows - 1) * this.spacing.y;

        const originX = innerX + this._crossOffset(innerW - gridW, true);
        const originY = innerY + this._mainOffset(innerH - gridH, true);

        const fromRight = this.startCorner === GridStartCorner.UpperRight
            || this.startCorner === GridStartCorner.LowerRight;
        const fromBottom = this.startCorner === GridStartCorner.LowerLeft
            || this.startCorner === GridStartCorner.LowerRight;

        for (let i = 0; i < children.length; i++) {
            let col: number;
            let row: number;

            if (this.startAxis === GridStartAxis.Horizontal) {
                col = i % columns;
                row = Math.floor(i / columns);
            } else {
                row = i % rows;
                col = Math.floor(i / rows);
            }

            if (fromRight) col = columns - 1 - col;
            if (fromBottom) row = rows - 1 - row;

            LayoutGroup._place(
                children[i],
                originX + col * (this.cellSize.x + this.spacing.x),
                originY + row * (this.cellSize.y + this.spacing.y),
                this.cellSize.x,
                this.cellSize.y,
            );
        }
    }

    /** Columns to use for `count` children inside `innerWidth`. */
    private _columnCount(count: number, innerWidth: number): number {
        if (count === 0) return 1;

        switch (this.constraint) {
            case GridConstraint.FixedColumnCount:
                return Math.max(1, Math.floor(this.constraintCount));

            case GridConstraint.FixedRowCount: {
                const rows = Math.max(1, Math.floor(this.constraintCount));
                return Math.max(1, Math.ceil(count / rows));
            }

            default: {
                // One cell always fits, however narrow the group is — wrapping
                // to zero columns would divide by zero downstream.
                const stride = this.cellSize.x + this.spacing.x;
                if (stride <= 0) return count;
                const fits = Math.floor((innerWidth + this.spacing.x) / stride);
                return Math.max(1, Math.min(count, fits));
            }
        }
    }

    /**
     * Rows to use for `count` children across `columns`.
     *
     * @remarks
     * `FixedRowCount` means exactly that many rows, as Unity's `cellCountY`
     * does. Deriving it back from the column count instead — `ceil(count /
     * columns)` — quietly collapsed the grid: four children in three fixed rows
     * became a 2×2 grid, which is what asking for two *columns* would have
     * given, leaving the constraint with no effect at all.
     */
    private _rowCount(count: number, columns: number): number {
        if (count === 0) return 0;

        if (this.constraint === GridConstraint.FixedRowCount) {
            return Math.max(1, Math.floor(this.constraintCount));
        }
        return Math.ceil(count / columns);
    }

    private _innerWidth(): number {
        const rect = this.rectTransform._resolvedLocalRect;
        return Math.max(0, rect.width - this.padding.left - this.padding.right);
    }
}
