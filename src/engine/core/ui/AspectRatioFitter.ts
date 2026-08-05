import { Behaviour } from "../Behaviour";
import { Rect } from "../math/Rect";
import { RectTransform, RectTransformAxis } from "./RectTransform";
import type { GameObject } from "../GameObject";

/** How an {@link AspectRatioFitter} derives the element's size. */
export enum AspectMode {
    /** Leave the element alone. */
    None = "None",
    /** Keep the width, derive the height from it. */
    WidthControlsHeight = "WidthControlsHeight",
    /** Keep the height, derive the width from it. */
    HeightControlsWidth = "HeightControlsWidth",
    /**
     * Fill the parent as far as the ratio allows, staying **inside** it.
     * Leaves empty bars on one axis — letterboxing.
     */
    FitInParent = "FitInParent",
    /**
     * Cover the parent completely, overflowing on one axis — the
     * background-image behaviour.
     */
    EnvelopeParent = "EnvelopeParent",
}

/**
 * Forces a RectTransform to keep a fixed width-to-height ratio.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.AspectRatioFitter`. This is what keeps a
 * video frame, a diagram or a photo from being stretched when the panel around
 * it changes shape — the case a {@link ContentSizeFitter} cannot express,
 * because the constraint is between the two axes rather than on the content.
 *
 * ```ts
 * const fitter = imageGO.addComponent(AspectRatioFitter);
 * fitter.aspectRatio = 16 / 9;
 * fitter.aspectMode = AspectMode.FitInParent;   // letterbox inside the panel
 * ```
 *
 * Runs once per frame from `Application._loop`, after the layout groups and
 * {@link ContentSizeFitter} — so the parent size it measures is the settled one.
 *
 * **Coordinate system:** the fitter is symmetric in Y, so the Y-down convention
 * changes none of the arithmetic. It does change *where the spare space lands*
 * in {@link AspectMode.FitInParent}: the element is aligned by its
 * {@link RectTransform.pivot}, and pivot `(0, 0)` is the **top**-left here, so a
 * top-pivoted element letterboxes at the bottom. A centred pivot — the default —
 * splits the bars evenly and needs no thought.
 *
 * **Conflicts:** `FitInParent` and `EnvelopeParent` drive the anchors, the
 * anchored position and both axes of `sizeDelta`, so they overrule a layout
 * group's placement. Put the fitter on a child of the laid-out element, not on
 * the element itself, when both are wanted.
 */
export class AspectRatioFitter extends Behaviour {

    private static _instances: AspectRatioFitter[] = [];

    /**
     * @internal
     * Re-runs every active fitter. Called from Application._loop after the
     * layout groups and content-size fitters have settled.
     */
    public static _updateAll(): void {
        const fitters = AspectRatioFitter._instances;
        for (let i = 0; i < fitters.length; i++) {
            const f = fitters[i];
            if (f.isActiveAndEnabled) f._fit();
        }
    }

    /** @internal */
    public static _reset(): void {
        AspectRatioFitter._instances.length = 0;
    }

    /** Scratch for the parent-rect lookup; never live across a call. */
    private static readonly _scratch: Rect = new Rect();

    /** How the size is derived. Defaults to {@link AspectMode.None}. */
    public aspectMode: AspectMode = AspectMode.None;

    private _aspectRatio: number = 1;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * Width divided by height. `1` is square, `16 / 9` is widescreen.
     *
     * @remarks
     * Clamped to a small positive number: a zero or negative ratio would make
     * the derived axis zero-sized or inside-out, and Unity clamps it the same way.
     */
    public get aspectRatio(): number { return this._aspectRatio; }

    public set aspectRatio(value: number) {
        this._aspectRatio = Number.isFinite(value)
            ? Math.max(1e-5, Math.min(1e5, value))
            : 1;
    }

    /**
     * Sets {@link aspectRatio} from a pair of dimensions.
     *
     * @remarks
     * The convenience form for "match this image": pass the source's pixel size
     * and the ratio follows, without the caller dividing by zero on an asset
     * that has not loaded yet.
     *
     * @param width - source width; ignored when either dimension is not positive.
     * @param height - source height.
     */
    public setAspectFromSize(width: number, height: number): void {
        if (width > 0 && height > 0) this.aspectRatio = width / height;
    }

    /**
     * Applies the ratio immediately instead of waiting for the next frame.
     *
     * @remarks
     * Needed when a script sizes an element and reads the result in the same
     * frame — the per-frame pass runs late in the loop, after `LateUpdate`.
     */
    public setLayoutDirty(): void {
        this._fit();
    }

    protected override onEnable(): void {
        if (!AspectRatioFitter._instances.includes(this)) {
            AspectRatioFitter._instances.push(this);
        }
    }

    protected override onDisable(): void {
        const idx = AspectRatioFitter._instances.indexOf(this);
        if (idx >= 0) AspectRatioFitter._instances.splice(idx, 1);
    }

    protected override onDestroy(): void {
        this.onDisable();
    }

    // ── private ──────────────────────────────────────────────────────

    private _fit(): void {
        if (this.aspectMode === AspectMode.None) return;

        const rt = this.gameObject.getComponent(RectTransform);
        if (!rt) return;

        const ratio = this._aspectRatio;

        switch (this.aspectMode) {
            case AspectMode.WidthControlsHeight:
                rt.setSizeWithCurrentAnchors(
                    RectTransformAxis.Vertical,
                    rt._resolvedLocalRect.width / ratio,
                );
                break;

            case AspectMode.HeightControlsWidth:
                rt.setSizeWithCurrentAnchors(
                    RectTransformAxis.Horizontal,
                    rt._resolvedLocalRect.height * ratio,
                );
                break;

            case AspectMode.FitInParent:
            case AspectMode.EnvelopeParent:
                this._fitToParent(rt, ratio);
                break;
        }
    }

    /**
     * Stretches to the parent, then shrinks (fit) or grows (envelope) the one
     * axis the ratio does not allow to fill it.
     */
    private _fitToParent(rt: RectTransform, ratio: number): void {
        // Stretch first, so "the parent size" is what both axes start from and
        // the element re-fits by itself whenever the parent changes shape.
        rt.anchorMin.set(0, 0);
        rt.anchorMax.set(1, 1);
        rt.anchoredPosition.set(0, 0);
        rt.sizeDelta.set(0, 0);

        const parent = rt._getParentRect(AspectRatioFitter._scratch);
        const parentW = parent.width;
        const parentH = parent.height;
        if (parentW <= 0 || parentH <= 0) return;

        // The parent is wider than the ratio wants when `parentH * ratio <
        // parentW`. Fitting inside then means the *height* is the binding
        // constraint (the width must shrink); enveloping inverts the choice,
        // which is what the XOR against the mode expresses.
        const parentIsWider = parentH * ratio < parentW;
        const heightBinds = parentIsWider === (this.aspectMode === AspectMode.FitInParent);

        // Anchors are a full stretch, so sizeDelta is the signed difference
        // from the parent size on that axis.
        if (heightBinds) rt.sizeDelta.x = parentH * ratio - parentW;
        else rt.sizeDelta.y = parentW / ratio - parentH;
    }
}
