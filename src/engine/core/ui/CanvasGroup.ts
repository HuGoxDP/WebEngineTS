import { Behaviour } from "../Behaviour";
import type { GameObject } from "../GameObject";

/**
 * Controls the opacity and interactivity of a whole branch of the UI at once.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.CanvasGroup`. `Canvas.alpha` already
 * fades an entire canvas; this fades one panel inside it without giving that
 * panel a canvas of its own — which would cost a second full-screen backing
 * store.
 *
 * The three switches are independent, and each is the answer to a different
 * question:
 * - {@link alpha} — how visible is this branch?
 * - {@link interactable} — does it respond? A greyed-out dialog sets this
 *   `false` while still swallowing clicks aimed at what is behind it.
 * - {@link blocksRaycasts} — does it swallow them at all? A pass-through
 *   overlay sets this `false` so pointers reach the scene underneath.
 *
 * Nested groups multiply their alphas and AND their flags, up to the nearest
 * ancestor with {@link ignoreParentGroups} set.
 *
 * ```ts
 * const group = panel.addComponent(CanvasGroup);
 * group.alpha = 0.5;          // half-faded
 * group.interactable = false; // and inert while it fades
 * ```
 */
export class CanvasGroup extends Behaviour {

    /**
     * Bumped whenever a group appears or disappears.
     *
     * @remarks
     * Elements cache which groups are above them, since finding out means a
     * component scan per ancestor. A group being added to an existing parent
     * changes no transform link, so nothing else would tell them to look again.
     */
    private static _version: number = 0;

    /** @internal Counter elements compare their cached group chain against. */
    public static get _structureVersion(): number {
        return CanvasGroup._version;
    }

    /** @internal */
    public static _invalidate(): void {
        CanvasGroup._version++;
    }

    private _alpha: number = 1;

    /**
     * Opacity applied to everything in this branch, `0`–`1`.
     *
     * @remarks
     * Multiplies with any group above it and with `Canvas.alpha`.
     */
    public get alpha(): number { return this._alpha; }

    public set alpha(value: number) {
        this._alpha = value < 0 ? 0 : value > 1 ? 1 : value;
    }

    /**
     * Whether elements in this branch respond to pointer events.
     *
     * @remarks
     * `false` still blocks the pointer from reaching what is behind — see
     * {@link blocksRaycasts} to let it through instead.
     */
    public interactable: boolean = true;

    /** Whether elements in this branch are hit-tested at all. */
    public blocksRaycasts: boolean = true;

    /** Whether to stop inheriting from groups further up the hierarchy. */
    public ignoreParentGroups: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    protected override onEnable(): void {
        CanvasGroup._invalidate();
    }

    protected override onDisable(): void {
        CanvasGroup._invalidate();
    }

    protected override onDestroy(): void {
        CanvasGroup._invalidate();
    }
}
