import { Behaviour } from "../Behaviour";
import { RectTransform } from "./RectTransform";
import { LayoutUtility } from "./LayoutElement";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * Where a layout group parks its children along an axis it does not stretch.
 *
 * @remarks
 * Because Y points down, **`Upper` is the low-Y edge** and `Lower` the high-Y
 * one — the inverse of Unity's `TextAnchor`, whose names read the same but map
 * the other way round.
 */
export enum LayoutAnchor {
    UpperLeft = "UpperLeft",
    UpperCenter = "UpperCenter",
    UpperRight = "UpperRight",
    MiddleLeft = "MiddleLeft",
    MiddleCenter = "MiddleCenter",
    MiddleRight = "MiddleRight",
    LowerLeft = "LowerLeft",
    LowerCenter = "LowerCenter",
    LowerRight = "LowerRight",
}

/**
 * Arranges child elements in a row or a column.
 *
 * @remarks
 * Equivalent to Unity's `HorizontalOrVerticalLayoutGroup`. Use
 * {@link HorizontalLayoutGroup} or {@link VerticalLayoutGroup}.
 *
 * **The group drives its children.** It writes `anchorMin`, `anchorMax`,
 * `pivot`, `anchoredPosition` and `sizeDelta` on every child it manages, so
 * setting those by hand has no lasting effect. Add a {@link LayoutElement} with
 * `ignoreLayout` to opt a child out.
 *
 * Layout runs once per frame from `Application._loop`, before pointer events,
 * so a click always hit-tests against the positions that will be drawn.
 *
 * ```ts
 * const list = panel.addComponent(VerticalLayoutGroup);
 * list.spacing = 8;
 * list.padding.set(12, 12, 12, 12);
 * list.childForceExpandWidth = true;
 * ```
 */
export abstract class LayoutGroup extends Behaviour {

    private static _instances: LayoutGroup[] = [];

    /**
     * @internal
     * Re-runs every active layout group. Called from Application._loop before
     * the UI input pass.
     */
    public static _updateAll(): void {
        const groups = LayoutGroup._instances;
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (g.isActiveAndEnabled) g._rebuild();
        }
    }

    /** @internal */
    public static _reset(): void {
        LayoutGroup._instances.length = 0;
    }

    /** Inner margins, in canvas units. */
    @SerializedField({ type: FieldType.Object })
    public readonly padding: LayoutPadding = new LayoutPadding();

    /** Where the arranged block sits when it does not fill the group. */
    @SerializedField({ type: FieldType.Enum })
    public childAlignment: LayoutAnchor = LayoutAnchor.UpperLeft;

    /** Scratch reused across rebuilds; a group lays out one child list at a time. */
    private readonly _children: RectTransform[] = [];
    protected readonly _sizes: number[] = [];
    private _rectTransform: RectTransform | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The RectTransform this group arranges children inside (auto-added). */
    public get rectTransform(): RectTransform {
        if (!this._rectTransform) {
            this._rectTransform = this.gameObject.getComponent(RectTransform)
                ?? this.gameObject.addComponent(RectTransform);
        }
        return this._rectTransform;
    }

    /** Whether this group stacks along Y rather than X. */
    /** Repositions this group's children. Called once per frame. */
    protected abstract _rebuild(): void;

    protected override onEnable(): void {
        if (!LayoutGroup._instances.includes(this)) LayoutGroup._instances.push(this);
    }

    protected override onDisable(): void {
        const idx = LayoutGroup._instances.indexOf(this);
        if (idx >= 0) LayoutGroup._instances.splice(idx, 1);
    }

    protected override onDestroy(): void {
        this.onDisable();
    }

    // ── private ──────────────────────────────────────────────────────

    /** Children this group manages, in hierarchy order. */
    protected _collect(): readonly RectTransform[] {
        const out = this._children;
        out.length = 0;

        const transform = this.gameObject.transform;
        for (let i = 0; i < transform.childCount; i++) {
            const go = transform.getChild(i).gameObject;
            if (!go.activeInHierarchy) continue;

            const rt = go.getComponent(RectTransform);
            if (!rt || LayoutUtility.ignoresLayout(rt)) continue;

            out.push(rt);
        }
        return out;
    }

    /** Offset of the whole block along the layout axis, from the alignment. */
    protected _mainOffset(spare: number, vertical: boolean): number {
        if (spare <= 0) return 0;
        const t = vertical
            ? LayoutGroup._verticalFactor(this.childAlignment)
            : LayoutGroup._horizontalFactor(this.childAlignment);
        return spare * t;
    }

    /** Offset of one child across the layout axis, from the alignment. */
    protected _crossOffset(spare: number, vertical: boolean): number {
        if (spare <= 0) return 0;
        const t = vertical
            ? LayoutGroup._horizontalFactor(this.childAlignment)
            : LayoutGroup._verticalFactor(this.childAlignment);
        return spare * t;
    }

    protected static _horizontalFactor(anchor: LayoutAnchor): number {
        switch (anchor) {
            case LayoutAnchor.UpperCenter:
            case LayoutAnchor.MiddleCenter:
            case LayoutAnchor.LowerCenter:
                return 0.5;
            case LayoutAnchor.UpperRight:
            case LayoutAnchor.MiddleRight:
            case LayoutAnchor.LowerRight:
                return 1;
            default:
                return 0;
        }
    }

    protected static _verticalFactor(anchor: LayoutAnchor): number {
        switch (anchor) {
            case LayoutAnchor.MiddleLeft:
            case LayoutAnchor.MiddleCenter:
            case LayoutAnchor.MiddleRight:
                return 0.5;
            case LayoutAnchor.LowerLeft:
            case LayoutAnchor.LowerCenter:
            case LayoutAnchor.LowerRight:
                return 1;
            default:
                return 0;
        }
    }

    /**
     * Pins a child to its parent's top-left and places it by offset and size.
     *
     * @remarks
     * Writing the same numbers each frame leaves the RectTransform's change
     * snapshot untouched, so a settled layout still hits its rect cache.
     */
    protected static _place(
        rt: RectTransform,
        x: number,
        y: number,
        width: number,
        height: number,
    ): void {
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(0, 0);
        rt.pivot.set(0, 0);
        rt.sizeDelta.set(width, height);

        // The parent's local rect starts at -pivot * size, so a child offset is
        // measured from there rather than from zero.
        rt.anchoredPosition.set(x, y);
    }
}

/** Inner margins of a {@link LayoutGroup}, in canvas units. */
export class LayoutPadding {

    /** Margin on the low-X edge. */
    public left: number = 0;

    /** Margin on the high-X edge. */
    public right: number = 0;

    /** Margin on the low-Y edge, which is the **top** in this Y-down system. */
    public top: number = 0;

    /** Margin on the high-Y edge, which is the **bottom**. */
    public bottom: number = 0;

    /**
     * Sets all four margins.
     *
     * @param left - low-X margin.
     * @param right - high-X margin.
     * @param top - low-Y (visually top) margin.
     * @param bottom - high-Y (visually bottom) margin.
     * @returns this, for chaining.
     */
    public set(left: number, right: number, top: number, bottom: number): this {
        this.left = left;
        this.right = right;
        this.top = top;
        this.bottom = bottom;
        return this;
    }

    /** Sets every margin to the same value. */
    public setAll(value: number): this {
        return this.set(value, value, value, value);
    }
}

/**
 * Shared behaviour of the row and column groups.
 *
 * @remarks
 * Equivalent to Unity's `HorizontalOrVerticalLayoutGroup`. Use
 * {@link HorizontalLayoutGroup} or {@link VerticalLayoutGroup}; the grid is a
 * sibling of this tier, not a subclass, because it sizes on both axes at once.
 */
export abstract class LinearLayoutGroup extends LayoutGroup {

    /** Gap between adjacent children, in canvas units. */
    @SerializedField()
    public spacing: number = 0;

    /**
     * Whether children are stretched across the axis the group does not lay
     * out along — the width of a vertical list, the height of a row.
     */
    @SerializedField()
    public childForceExpandCross: boolean = true;

    /** Whether spare width along the layout axis is handed to the children. */
    @SerializedField()
    public childForceExpandWidth: boolean = false;

    /** Whether spare height along the layout axis is handed to the children. */
    @SerializedField()
    public childForceExpandHeight: boolean = false;

    /** Lay children out last-to-first. */
    @SerializedField()
    public reverseArrangement: boolean = false;

    /** Whether this group stacks along Y rather than X. */
    protected abstract get isVertical(): boolean;

    /**
     * The size this group needs along its layout axis to fit its children.
     *
     * @remarks
     * Read by a {@link ContentSizeFitter} on the same GameObject, which is how
     * a list grows to its content instead of the other way round.
     */
    public get preferredWidth(): number {
        return this.isVertical
            ? this._maxCross(false) + this.padding.left + this.padding.right
            : this._totalMain(false) + this.padding.left + this.padding.right;
    }

    /** The size this group needs along Y to fit its children. */
    public get preferredHeight(): number {
        return this.isVertical
            ? this._totalMain(true) + this.padding.top + this.padding.bottom
            : this._maxCross(true) + this.padding.top + this.padding.bottom;
    }

    protected override _rebuild(): void {
        this._rebuildLinear();
    }

    // ── private ──────────────────────────────────────────────────────

    /** Positions and sizes every managed child. */
    protected _rebuildLinear(): void {
        const children = this._collect();
        if (children.length === 0) return;

        const vertical = this.isVertical;
        const rect = this.rectTransform._resolvedLocalRect;

        const innerX = rect.x + this.padding.left;
        const innerY = rect.y + this.padding.top;
        const innerW = Math.max(0, rect.width - this.padding.left - this.padding.right);
        const innerH = Math.max(0, rect.height - this.padding.top - this.padding.bottom);

        const available = vertical ? innerH : innerW;
        const crossSize = vertical ? innerW : innerH;

        const sizes = this._sizes;
        sizes.length = 0;
        let total = this.spacing * (children.length - 1);
        for (let i = 0; i < children.length; i++) {
            const size = vertical
                ? LayoutUtility.preferredHeight(children[i])
                : LayoutUtility.preferredWidth(children[i]);
            sizes.push(size);
            total += size;
        }

        this._distributeSpare(children, sizes, available - total, vertical);

        let used = this.spacing * (children.length - 1);
        for (let i = 0; i < sizes.length; i++) used += sizes[i];

        let cursor = (vertical ? innerY : innerX) + this._mainOffset(available - used, vertical);

        for (let i = 0; i < children.length; i++) {
            const index = this.reverseArrangement ? children.length - 1 - i : i;
            const child = children[index];
            const main = sizes[index];

            const cross = this.childForceExpandCross
                ? crossSize
                : (vertical
                    ? LayoutUtility.preferredWidth(child)
                    : LayoutUtility.preferredHeight(child));

            const crossStart = (vertical ? innerX : innerY)
                + this._crossOffset(crossSize - cross, vertical);

            LayoutGroup._place(
                child,
                vertical ? crossStart : cursor,
                vertical ? cursor : crossStart,
                vertical ? cross : main,
                vertical ? main : cross,
            );

            cursor += main + this.spacing;
        }
    }

    /** Hands leftover space to the children that asked for a share of it. */
    protected _distributeSpare(
        children: readonly RectTransform[],
        sizes: number[],
        spare: number,
        vertical: boolean,
    ): void {
        if (spare <= 0) return;

        const forceExpand = vertical ? this.childForceExpandHeight : this.childForceExpandWidth;

        let totalFlex = 0;
        for (let i = 0; i < children.length; i++) {
            totalFlex += vertical
                ? LayoutUtility.flexibleHeight(children[i])
                : LayoutUtility.flexibleWidth(children[i]);
        }

        // With nothing claiming a share, forcing expansion splits it evenly —
        // that is what makes a row of equal buttons fill its bar.
        if (totalFlex <= 0) {
            if (!forceExpand) return;
            const each = spare / children.length;
            for (let i = 0; i < sizes.length; i++) sizes[i] += each;
            return;
        }

        for (let i = 0; i < children.length; i++) {
            const flex = vertical
                ? LayoutUtility.flexibleHeight(children[i])
                : LayoutUtility.flexibleWidth(children[i]);
            if (flex > 0) sizes[i] += spare * (flex / totalFlex);
        }
    }

    protected _totalMain(vertical: boolean): number {
        const children = this._collect();
        if (children.length === 0) return 0;

        let total = this.spacing * (children.length - 1);
        for (let i = 0; i < children.length; i++) {
            total += vertical
                ? LayoutUtility.preferredHeight(children[i])
                : LayoutUtility.preferredWidth(children[i]);
        }
        return total;
    }

    protected _maxCross(vertical: boolean): number {
        const children = this._collect();
        let widest = 0;
        for (let i = 0; i < children.length; i++) {
            const size = vertical
                ? LayoutUtility.preferredHeight(children[i])
                : LayoutUtility.preferredWidth(children[i]);
            if (size > widest) widest = size;
        }
        return widest;
    }
}

/**
 * Arranges children left to right.
 *
 * @remarks Equivalent to Unity's `HorizontalLayoutGroup`.
 */
@Serializable({ typeName: "HorizontalLayoutGroup", category: "UI" })
export class HorizontalLayoutGroup extends LinearLayoutGroup {
    protected override get isVertical(): boolean { return false; }
}

/**
 * Arranges children top to bottom.
 *
 * @remarks
 * Equivalent to Unity's `VerticalLayoutGroup`. "Top to bottom" is increasing Y
 * here; {@link LinearLayoutGroup.reverseArrangement} stacks the other way.
 */
@Serializable({ typeName: "VerticalLayoutGroup", category: "UI" })
export class VerticalLayoutGroup extends LinearLayoutGroup {
    protected override get isVertical(): boolean { return true; }
}
