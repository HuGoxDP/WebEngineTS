import { Component } from "../Component";
import { Vector2 } from "../math/Vector2";
import { Rect } from "../math/Rect";
import { Time } from "../Time";
import type { Canvas } from "./Canvas";
import type { Component as ComponentType } from "../Component";
import type { GameObject } from "../GameObject";
import type { Transform } from "../Transform";

/** @internal Canvas constructor type for lazy lookups. */
type CanvasCtor = new (...args: any[]) => ComponentType & { width: number; height: number };

/** @internal Registered by Canvas at module-load to avoid circular imports. */
let _CanvasCtor: CanvasCtor | null = null;

/** Depth cap for the ancestor walk — guards against pathological hierarchies. */
const MAX_RECT_DEPTH = 64;

/**
 * Defines the 2D layout rectangle for a UI element.
 *
 * @remarks
 * Equivalent to Unity's `RectTransform`. Every UI element needs one.
 * Adding an Image/Text/Button component to a GameObject automatically
 * adds a RectTransform sibling if one does not already exist.
 *
 * **Coordinate system — Y points DOWN.** Origin is the top-left corner, X grows
 * right, Y grows down (the CSS / 2D-canvas convention). This is a deliberate,
 * permanent deviation from Unity, whose UI origin is bottom-left with Y up: it
 * removes a coordinate flip from every draw call and every pointer event, since
 * the browser 2D context and DOM pointer events are already Y-down.
 *
 * Consequences to keep in mind — each is the *opposite* of Unity:
 * - `anchorMin` is the **top**-left corner of the anchor rect, `anchorMax` the
 *   **bottom**-right one.
 * - `pivot` `(0, 0)` is the **top**-left of the element, `(1, 1)` the bottom-right.
 * - A larger Y in {@link anchoredPosition} moves an element **down**.
 * - On the resulting {@link Rect}, `yMin` is the top edge and `yMax` the bottom.
 *
 * **Units:** layout is expressed in *canvas units*, not device pixels. Without a
 * `CanvasScaler` one canvas unit is one CSS pixel; with one, the canvas reports a
 * virtual size derived from the reference resolution and the layout is scaled to
 * the real screen on draw.
 *
 * **Anchor system:**
 * - `anchorMin` / `anchorMax` define a rectangle inside the parent (0–1 normalized).
 * - When they are equal (default `(0.5, 0.5)`) the anchor is a single point.
 * - `anchoredPosition` is the pixel offset of the pivot from the anchor center.
 * - `sizeDelta` is added on top of the stretched anchor area to get the final size.
 *
 * ```ts
 * // Pin to the bottom-right corner, 10 units in from each edge.
 * rt.anchorMin.set(1, 1);   // Y=1 is the BOTTOM edge in this system
 * rt.anchorMax.set(1, 1);
 * rt.pivot.set(1, 1);       // (1,1) is the element's bottom-right
 * rt.anchoredPosition.set(-10, -10);
 * ```
 */
export class RectTransform extends Component {

    /** Offset of the rect's pivot from the anchor reference point, in canvas units. */
    public anchoredPosition: Vector2 = new Vector2(0, 0);

    /**
     * Size adjustment in canvas units.
     * When anchors are a point (min === max) this is the absolute size.
     * When anchors are stretched, this is the delta added to the anchor area.
     */
    public sizeDelta: Vector2 = new Vector2(100, 100);

    /**
     * Normalized anchor corner with the *lower* coordinates (0–1 of parent rect).
     *
     * @remarks
     * Because Y points down, this is the **top**-left corner of the anchor
     * rectangle — the opposite of Unity, where `anchorMin` is bottom-left.
     */
    public anchorMin: Vector2 = new Vector2(0.5, 0.5);

    /**
     * Normalized anchor corner with the *upper* coordinates (0–1 of parent rect).
     *
     * @remarks
     * Because Y points down, this is the **bottom**-right corner of the anchor
     * rectangle — the opposite of Unity, where `anchorMax` is top-right.
     */
    public anchorMax: Vector2 = new Vector2(0.5, 0.5);

    /**
     * The pivot point (0–1), the point the element is positioned and sized about.
     *
     * @remarks
     * `(0.5, 0.5)` = center, `(0, 0)` = top-left, `(1, 1)` = bottom-right.
     * The Y axis is inverted relative to Unity, where `(0, 0)` is bottom-left.
     */
    public pivot: Vector2 = new Vector2(0.5, 0.5);

    // ── ancestor-lookup cache ────────────────────────────────────────
    //
    // screenRect is read several times per frame per element (event hit-test,
    // draw, and once more per ancestor for every descendant). Resolving the
    // parent RectTransform / owning Canvas means a component-list scan each
    // time, so results are memoized per frame and invalidated immediately when
    // the element is re-parented.

    private _cachedParentTransform: Transform | null = null;
    private _cachedParentRect: RectTransform | null = null;
    private _parentLookupFrame: number = -1;

    private _cachedCanvas: Canvas | null = null;
    private _canvasLookupFrame: number = -1;
    private _canvasResolved: boolean = false;

    /** Scratch rects for the ancestor walk, one per hierarchy depth. */
    private static readonly _scratch: Rect[] = [];

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The parent RectTransform, or null if this is the root. */
    public get parentRectTransform(): RectTransform | null {
        const parent = this.transform.parent ?? null;

        if (this._parentLookupFrame === Time.frameCount && this._cachedParentTransform === parent) {
            return this._cachedParentRect;
        }

        this._cachedParentTransform = parent;
        this._parentLookupFrame = Time.frameCount;
        this._cachedParentRect = parent
            ? (parent.gameObject.getComponent(RectTransform) ?? null)
            : null;

        return this._cachedParentRect;
    }

    /**
     * The nearest Canvas ancestor, or null.
     *
     * @remarks
     * "No canvas" is cached for the rest of the frame just like a hit is —
     * otherwise every access re-walks the whole ancestor chain, and this is read
     * once per element per ancestor per frame. A Canvas appearing on an ancestor
     * later invalidates the cache through {@link invalidateLayoutCache}, which
     * `Canvas.onEnable` drives across its subtree.
     */
    public get canvas(): Canvas | null {
        if (!_CanvasCtor) return null;

        if (this._canvasResolved && this._canvasLookupFrame === Time.frameCount) {
            return this._cachedCanvas;
        }

        let go: GameObject | null = this.gameObject;
        let found: Canvas | null = null;
        for (let depth = 0; go && depth < MAX_RECT_DEPTH; depth++) {
            const c = go.getComponent(_CanvasCtor) as Canvas | null;
            if (c) { found = c; break; }
            go = go.transform.parent?.gameObject ?? null;
        }

        this._cachedCanvas = found;
        this._canvasLookupFrame = Time.frameCount;
        this._canvasResolved = true;
        return found;
    }

    /** @internal Called once by Canvas.ts at module load to break the cycle. */
    public static _registerCanvasCtor(ctor: CanvasCtor): void {
        _CanvasCtor = ctor;
    }

    /**
     * The computed screen-space rectangle of this element, in canvas units.
     * Origin is the top-left of the viewport / parent Canvas.
     *
     * WARNING: allocates a new Rect. Use {@link getScreenRect} in hot paths.
     */
    public get screenRect(): Rect {
        return this._computeRect(new Rect(), 0);
    }

    /**
     * Writes the computed screen-space rectangle into `out`, without allocating.
     *
     * @param out - rect to receive the result; a new one is allocated if omitted.
     * @returns `out` (or the newly allocated rect) for chaining.
     */
    public getScreenRect(out?: Rect): Rect {
        return this._computeRect(out ?? new Rect(), 0);
    }

    /**
     * Invalidates the cached parent / canvas lookups.
     *
     * @remarks
     * Only needed when a RectTransform or Canvas is added to an ancestor during
     * the same frame the layout is read; re-parenting is detected automatically.
     */
    public invalidateLayoutCache(): void {
        this._parentLookupFrame = -1;
        this._canvasLookupFrame = -1;
        this._canvasResolved = false;
        this._cachedParentRect = null;
        this._cachedCanvas = null;
    }

    // ── private ──────────────────────────────────────────────────────

    private _computeRect(out: Rect, depth: number): Rect {
        const parentRect = this._parentRect(depth);
        const pw = parentRect.width;
        const ph = parentRect.height;

        const aLeft   = parentRect.x + this.anchorMin.x * pw;
        const aTop    = parentRect.y + this.anchorMin.y * ph;
        const aRight  = parentRect.x + this.anchorMax.x * pw;
        const aBottom = parentRect.y + this.anchorMax.y * ph;

        const aW = aRight - aLeft;
        const aH = aBottom - aTop;

        const w = aW + this.sizeDelta.x;
        const h = aH + this.sizeDelta.y;

        out.x = aLeft + aW * 0.5 + this.anchoredPosition.x - this.pivot.x * w;
        out.y = aTop  + aH * 0.5 + this.anchoredPosition.y - this.pivot.y * h;
        out.width  = w;
        out.height = h;
        return out;
    }

    /**
     * Resolves the reference rect this element is laid out against.
     * The result lives in the scratch slot for `depth` and stays valid only
     * until the next call at the same depth.
     */
    private _parentRect(depth: number): Rect {
        const scratch = RectTransform._scratchAt(depth);

        if (depth < MAX_RECT_DEPTH) {
            const prt = this.parentRectTransform;
            if (prt) return prt._computeRect(scratch, depth + 1);
        }

        // The owning canvas defines the root rect. Note `canvas` starts its walk
        // at this GameObject, so a Canvas on this very object is picked up too.
        const canvas = this.canvas;
        if (canvas) return scratch.set(0, 0, canvas.width, canvas.height);

        // Fallback: entire viewport
        return scratch.set(0, 0,
            typeof window !== "undefined" ? window.innerWidth  : 800,
            typeof window !== "undefined" ? window.innerHeight : 600,
        );
    }

    private static _scratchAt(depth: number): Rect {
        let r = RectTransform._scratch[depth];
        if (!r) {
            r = new Rect();
            RectTransform._scratch[depth] = r;
        }
        return r;
    }
}
