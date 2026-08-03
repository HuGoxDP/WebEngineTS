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

    // ── resolved-rect cache ──────────────────────────────────────────
    //
    // Resolving a rect walks every ancestor, so a tree of n elements at depth d
    // costs O(n·d) rect computations per frame — paid even by a HUD that has not
    // moved since it was built, because change detection had to compute the
    // geometry to discover it was the same.
    //
    // The layout inputs are public Vector2 fields mutated in place
    // (`rt.anchoredPosition.set(...)`), so there is no setter to hook. They are
    // therefore snapshotted: ten scalar comparisons detect any change, which is
    // far cheaper than the walk it avoids and keeps the public API untouched.
    //
    // Memoizing on the frame number would be wrong — a script that moves an
    // element in Update and reads screenRect immediately must see the new value,
    // and an ancestor's in-place mutation is invisible until something checks
    // it. So the walk itself always happens; what the cache saves is the
    // arithmetic at each level, and a rect is reused only when neither its own
    // inputs nor its parent's resolved rect moved.

    private readonly _cachedRect: Rect = new Rect();
    private readonly _cachedParent: Rect = new Rect();
    private readonly _snapshot: Float64Array = new Float64Array(10);
    private _cacheValid: boolean = false;

    /**
     * Scratch for the one root rect in a resolve chain.
     *
     * @remarks
     * Only the deepest frame of the recursion reaches the canvas/viewport root
     * — every shallower frame gets its parent's own cached rect — and it reads
     * the scratch before returning, so one instance is enough.
     */
    private static readonly _rootScratch: Rect = new Rect();

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
        return new Rect().copy(this._resolve(0));
    }

    /**
     * Writes the computed screen-space rectangle into `out`, without allocating.
     *
     * @param out - rect to receive the result; a new one is allocated if omitted.
     * @returns `out` (or the newly allocated rect) for chaining.
     */
    public getScreenRect(out?: Rect): Rect {
        return (out ?? new Rect()).copy(this._resolve(0));
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
        this._cacheValid = false;
    }

    // ── private ──────────────────────────────────────────────────────

    /**
     * Resolves this element's screen rect, reusing the cached one when nothing
     * that feeds it has changed.
     *
     * @returns the internal cached rect — callers copy out of it, never keep it.
     */
    private _resolve(depth: number): Rect {
        // Both of these run unconditionally. The inputs are public Vector2
        // fields mutated in place, so there is no setter to hook: an ancestor
        // that moved is only discoverable by walking up and checking. Skipping
        // the walk on a frame counter would hand a child a stale rect the frame
        // its parent moved.
        const selfChanged = this._syncSnapshot();
        const parentRect = this._parentRect(depth);

        if (!selfChanged
            && this._cacheValid
            && this._cachedParent.x === parentRect.x
            && this._cachedParent.y === parentRect.y
            && this._cachedParent.width === parentRect.width
            && this._cachedParent.height === parentRect.height) {
            return this._cachedRect;
        }

        this._cachedParent.copy(parentRect);

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

        const out = this._cachedRect;
        out.x = aLeft + aW * 0.5 + this.anchoredPosition.x - this.pivot.x * w;
        out.y = aTop  + aH * 0.5 + this.anchoredPosition.y - this.pivot.y * h;
        out.width  = w;
        out.height = h;

        this._cacheValid = true;
        return out;
    }

    /**
     * Folds the layout inputs into the snapshot.
     *
     * @returns whether any of them moved since the last resolve.
     */
    private _syncSnapshot(): boolean {
        const s = this._snapshot;
        const ap = this.anchoredPosition;
        const sd = this.sizeDelta;
        const lo = this.anchorMin;
        const hi = this.anchorMax;
        const pv = this.pivot;

        if (s[0] === ap.x && s[1] === ap.y
            && s[2] === sd.x && s[3] === sd.y
            && s[4] === lo.x && s[5] === lo.y
            && s[6] === hi.x && s[7] === hi.y
            && s[8] === pv.x && s[9] === pv.y) {
            return false;
        }

        s[0] = ap.x; s[1] = ap.y;
        s[2] = sd.x; s[3] = sd.y;
        s[4] = lo.x; s[5] = lo.y;
        s[6] = hi.x; s[7] = hi.y;
        s[8] = pv.x; s[9] = pv.y;
        return true;
    }

    /**
     * Resolves the reference rect this element is laid out against.
     *
     * @remarks
     * A RectTransform parent returns its own cached rect, which is stable. Only
     * the canvas/viewport root needs scratch, and only the deepest frame of a
     * resolve chain ever reaches it.
     */
    private _parentRect(depth: number): Rect {
        if (depth < MAX_RECT_DEPTH) {
            const prt = this.parentRectTransform;
            if (prt) return prt._resolve(depth + 1);
        }

        // The owning canvas defines the root rect. Note `canvas` starts its walk
        // at this GameObject, so a Canvas on this very object is picked up too.
        // A resize shows up as a different root rect, which the caller's
        // `_cachedParent` comparison catches — no separate invalidation needed.
        const canvas = this.canvas;
        if (canvas) {
            return RectTransform._rootScratch.set(0, 0, canvas.width, canvas.height);
        }

        // Fallback: the entire viewport, for elements with no Canvas at all.
        return RectTransform._rootScratch.set(0, 0,
            typeof window !== "undefined" ? window.innerWidth  : 800,
            typeof window !== "undefined" ? window.innerHeight : 600,
        );
    }
}
