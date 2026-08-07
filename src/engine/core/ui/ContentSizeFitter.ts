import { Behaviour } from "../Behaviour";
import { Rect } from "../math/Rect";
import { RectTransform } from "./RectTransform";
import { LayoutUtility } from "./LayoutElement";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/** How a {@link ContentSizeFitter} sizes one axis. */
export enum FitMode {
    /** Leave the axis alone. */
    Unconstrained = "Unconstrained",
    /** Shrink the axis to the smallest size the content accepts. */
    MinSize = "MinSize",
    /** Size the axis to what the content asks for. */
    PreferredSize = "PreferredSize",
}

/**
 * Resizes a RectTransform to fit whatever it contains.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.ContentSizeFitter`. This is the piece
 * that makes a panel grow to its text or a list grow to its rows, rather than
 * the content being squeezed into a fixed box.
 *
 * Reads the size from the same sources a layout group does: an explicit
 * {@link LayoutElement}, then any component reporting a preferred size (a
 * {@link UIText}, or a {@link LayoutGroup} on this same object), then the
 * current size.
 *
 * Runs once per frame from `Application._loop` alongside the layout groups, and
 * **after** them — so a fitter on a list sees the rows the list just arranged.
 *
 * ```ts
 * const fitter = tooltip.addComponent(ContentSizeFitter);
 * fitter.verticalFit = FitMode.PreferredSize;   // as tall as the text needs
 * ```
 */
@Serializable({ typeName: "ContentSizeFitter", category: "UI" })
export class ContentSizeFitter extends Behaviour {

    private static _instances: ContentSizeFitter[] = [];

    /**
     * @internal
     * Re-runs every active fitter. Called from Application._loop after the
     * layout groups have arranged their children.
     */
    public static _updateAll(): void {
        const fitters = ContentSizeFitter._instances;
        for (let i = 0; i < fitters.length; i++) {
            const f = fitters[i];
            if (f.isActiveAndEnabled) f._fit();
        }
    }

    /** @internal */
    public static _reset(): void {
        ContentSizeFitter._instances.length = 0;
    }

    /** Scratch for the parent-rect lookup; never live across a call. */
    private static readonly _scratch: Rect = new Rect();

    /** How the width is derived from the content. */
    @SerializedField({ type: FieldType.Enum })
    public horizontalFit: FitMode = FitMode.Unconstrained;

    /** How the height is derived from the content. */
    @SerializedField({ type: FieldType.Enum })
    public verticalFit: FitMode = FitMode.Unconstrained;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    protected override onEnable(): void {
        if (!ContentSizeFitter._instances.includes(this)) {
            ContentSizeFitter._instances.push(this);
        }
    }

    protected override onDisable(): void {
        const idx = ContentSizeFitter._instances.indexOf(this);
        if (idx >= 0) ContentSizeFitter._instances.splice(idx, 1);
    }

    protected override onDestroy(): void {
        this.onDisable();
    }

    // ── private ──────────────────────────────────────────────────────

    private _fit(): void {
        const rt = this.gameObject.getComponent(RectTransform);
        if (!rt) return;

        if (this.horizontalFit !== FitMode.Unconstrained) {
            const width = this.horizontalFit === FitMode.MinSize
                ? LayoutUtility.minWidth(rt)
                : LayoutUtility.preferredWidth(rt);
            ContentSizeFitter._setAxis(rt, width, false);
        }

        if (this.verticalFit !== FitMode.Unconstrained) {
            const height = this.verticalFit === FitMode.MinSize
                ? LayoutUtility.minHeight(rt)
                : LayoutUtility.preferredHeight(rt);
            ContentSizeFitter._setAxis(rt, height, true);
        }
    }

    /**
     * Writes one axis of `sizeDelta` so the resolved size comes out at `size`.
     *
     * @remarks
     * `sizeDelta` is a delta on top of the anchor span, so a stretched element
     * needs that span subtracted — assigning the size directly would double it.
     */
    private static _setAxis(rt: RectTransform, size: number, vertical: boolean): void {
        const span = vertical
            ? (rt.anchorMax.y - rt.anchorMin.y)
            : (rt.anchorMax.x - rt.anchorMin.x);

        // A point anchor has no span, which is the common case and needs no
        // parent lookup at all.
        if (span === 0) {
            if (vertical) rt.sizeDelta.y = size;
            else rt.sizeDelta.x = size;
            return;
        }

        // Not `parentRectTransform`: a root-level element is laid out against
        // its Canvas, which is not a RectTransform at all, and treating that as
        // a zero-sized parent would leave the anchor span uncancelled.
        const parent = rt._getParentRect(ContentSizeFitter._scratch);
        const parentSize = vertical ? parent.height : parent.width;

        if (vertical) rt.sizeDelta.y = size - span * parentSize;
        else rt.sizeDelta.x = size - span * parentSize;
    }
}
