import { Component } from "../Component";
import { Vector2 } from "../math/Vector2";
import { Rect } from "../math/Rect";
import { Time } from "../Time";
import type { Canvas } from "./Canvas";
import type { Component as ComponentType } from "../Component";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";
import { Transform } from "../Transform";

/** @internal Canvas constructor type for lazy lookups. */
type CanvasCtor = new (...args: any[]) => ComponentType & { width: number; height: number };

/** @internal Registered by Canvas at module-load to avoid circular imports. */
let _CanvasCtor: CanvasCtor | null = null;

/** Depth cap for the ancestor walk — guards against pathological hierarchies. */
const MAX_RECT_DEPTH = 64;

const DEG_TO_RAD = Math.PI / 180;

/** Axis selector for {@link RectTransform.setSizeWithCurrentAnchors}. */
export enum RectTransformAxis {
    Horizontal = "Horizontal",
    Vertical = "Vertical",
}

/**
 * Parent edge for {@link RectTransform.setInsetAndSizeFromParentEdge}.
 *
 * @remarks
 * Because Y points down, **`Top` is the low-Y edge (anchor 0)** and `Bottom` the
 * high-Y one (anchor 1) — the inverse of Unity, where `Top` is the anchor-1 side.
 */
export enum RectTransformEdge {
    Left = "Left",
    Right = "Right",
    Top = "Top",
    Bottom = "Bottom",
}

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
@Serializable({ typeName: "RectTransform", category: "UI" })
export class RectTransform extends Component {

    /** Offset of the rect's pivot from the anchor reference point, in canvas units. */
    @SerializedField({ type: FieldType.Vector2 })
    public anchoredPosition: Vector2 = new Vector2(0, 0);

    /**
     * Size adjustment in canvas units.
     * When anchors are a point (min === max) this is the absolute size.
     * When anchors are stretched, this is the delta added to the anchor area.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public sizeDelta: Vector2 = new Vector2(100, 100);

    /**
     * Normalized anchor corner with the *lower* coordinates (0–1 of parent rect).
     *
     * @remarks
     * Because Y points down, this is the **top**-left corner of the anchor
     * rectangle — the opposite of Unity, where `anchorMin` is bottom-left.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public anchorMin: Vector2 = new Vector2(0.5, 0.5);

    /**
     * Normalized anchor corner with the *upper* coordinates (0–1 of parent rect).
     *
     * @remarks
     * Because Y points down, this is the **bottom**-right corner of the anchor
     * rectangle — the opposite of Unity, where `anchorMax` is top-right.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public anchorMax: Vector2 = new Vector2(0.5, 0.5);

    /**
     * The pivot point (0–1), the point the element is positioned and sized about.
     *
     * @remarks
     * `(0.5, 0.5)` = center, `(0, 0)` = top-left, `(1, 1)` = bottom-right.
     * The Y axis is inverted relative to Unity, where `(0, 0)` is bottom-left.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public pivot: Vector2 = new Vector2(0.5, 0.5);

    /**
     * Rotation about the {@link pivot}, in degrees.
     *
     * @remarks
     * Because Y points down, a **positive angle turns clockwise** on screen —
     * the inverse of Unity, and the same direction the 2D canvas context uses.
     *
     * Rotation and scale live here rather than on the sibling {@link Transform}
     * for two reasons: a UI element's 3D transform is meaningless (nothing reads
     * it), and `Transform.localRotation` / `localScale` return clones, so
     * reading them once per element per frame would allocate in the draw path.
     */
    @SerializedField()
    public localRotation: number = 0;

    /**
     * Scale about the {@link pivot}, per axis. `(1, 1)` is unscaled.
     *
     * @remarks
     * Scales the element and everything under it. Negative values mirror.
     * See {@link localRotation} for why this is not `Transform.localScale`.
     */
    @SerializedField({ type: FieldType.Vector2 })
    public localScale: Vector2 = new Vector2(1, 1);

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
    private _canvasHierarchy: number = -1;
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

    /**
     * The element's rect in its own local space, where the pivot sits at the
     * origin: `(-pivot.x * w, -pivot.y * h, w, h)`.
     */
    private readonly _localRect: Rect = new Rect();

    /**
     * Local-to-canvas affine transform as `[a, b, c, d, e, f]`, applying
     * `x' = a·x + c·y + e`, `y' = b·x + d·y + f` — the same layout the 2D
     * context's `setTransform` takes.
     */
    private readonly _matrix: Float64Array = new Float64Array([1, 0, 0, 1, 0, 0]);

    /** Axis-aligned bounds of the transformed rect, in canvas units. */
    private readonly _aabb: Rect = new Rect();

    private readonly _snapshot: Float64Array = new Float64Array(13);

    /** Parent local rect (4) plus parent matrix (6), as last resolved against. */
    private readonly _cachedParentState: Float64Array = new Float64Array(10);
    private _cacheValid: boolean = false;

    /**
     * Scratch for the one root rect in a resolve chain.
     *
     * @remarks
     * Only the deepest frame of the recursion reaches the canvas/viewport root
     * — every shallower frame gets its parent's own local rect — and it reads
     * the scratch before returning, so one instance is enough.
     */
    private static readonly _rootScratch: Rect = new Rect();

    /** The root's local-to-canvas transform: the canvas is the identity frame. */
    private static readonly _identity: Float64Array = new Float64Array([1, 0, 0, 1, 0, 0]);

    /** Scratch for corner transforms, so the AABB pass allocates nothing. */
    private static readonly _corners: Float64Array = new Float64Array(8);

    /** Scratch for the layout API, which never nests or outlives a call. */
    private static readonly _apiScratch: Rect = new Rect();

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
     *
     * The frame is not enough on its own: an element moved to another Canvas
     * mid-frame — a tooltip re-homed to a top-most overlay, an item dragged
     * between two panels — would keep answering with the one it left, and lay
     * itself out against that canvas's size for the rest of the frame. So the
     * hierarchy version is part of the key.
     */
    public get canvas(): Canvas | null {
        if (!_CanvasCtor) return null;

        if (this._canvasResolved
            && this._canvasLookupFrame === Time.frameCount
            && this._canvasHierarchy === Transform._hierarchyVersion) {
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
        this._canvasHierarchy = Transform._hierarchyVersion;
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
     * @remarks
     * When the element (or an ancestor) is rotated, this is the **axis-aligned
     * bounding box** of the rotated rect. Use {@link getWorldCorners} for the
     * true quad.
     *
     * WARNING: allocates a new Rect. Use {@link getScreenRect} in hot paths.
     */
    public get screenRect(): Rect {
        return this.getScreenRect(new Rect());
    }

    /**
     * Writes the computed screen-space rectangle into `out`, without allocating.
     *
     * @remarks
     * Axis-aligned bounds when rotated — see {@link screenRect}.
     *
     * @param out - rect to receive the result; a new one is allocated if omitted.
     * @returns `out` (or the newly allocated rect) for chaining.
     */
    public getScreenRect(out?: Rect): Rect {
        this._resolve(0);
        return (out ?? new Rect()).copy(this._aabb);
    }

    /**
     * Writes this element's rect in its own local space into `out`.
     *
     * @remarks
     * The pivot sits at the local origin, so the rect runs from
     * `-pivot * size` to `(1 - pivot) * size`. This is the space
     * {@link UIBehaviour._draw} draws in.
     *
     * @param out - rect to receive the result; a new one is allocated if omitted.
     * @returns `out` (or the newly allocated rect) for chaining.
     */
    public getLocalRect(out?: Rect): Rect {
        this._resolve(0);
        return (out ?? new Rect()).copy(this._localRect);
    }

    /**
     * Writes the element's four corners in canvas units into `out`.
     *
     * @remarks
     * Order is top-left, top-right, bottom-right, bottom-left *in the element's
     * own space*, so a rotation moves them around the screen accordingly. The
     * Y-down origin makes this the mirror of Unity's corner order.
     *
     * @param out - four vectors to receive the corners; allocated if omitted.
     * @returns `out` (or the newly allocated array) for chaining.
     */
    public getWorldCorners(out?: Vector2[]): Vector2[] {
        const result = out ?? [new Vector2(), new Vector2(), new Vector2(), new Vector2()];
        this._resolve(0);

        const r = this._localRect;
        const x1 = r.x + r.width;
        const y1 = r.y + r.height;

        this._toCanvas(r.x, r.y, result[0]);
        this._toCanvas(x1,  r.y, result[1]);
        this._toCanvas(x1,  y1,  result[2]);
        this._toCanvas(r.x, y1,  result[3]);
        return result;
    }

    /**
     * Converts a point in canvas units into this element's local space.
     *
     * @remarks
     * The inverse of the element's transform, so it accounts for rotation and
     * scale. Returns `false` for a degenerate transform (a zero scale), leaving
     * `out` untouched — nothing can be hit through it.
     *
     * @param x - canvas-space X.
     * @param y - canvas-space Y.
     * @param out - vector to receive the local-space point.
     * @returns whether the conversion was possible.
     */
    public canvasToLocalPoint(x: number, y: number, out: Vector2): boolean {
        this._resolve(0);

        const m = this._matrix;
        const det = m[0] * m[3] - m[1] * m[2];
        if (det === 0 || !Number.isFinite(det)) return false;

        const dx = x - m[4];
        const dy = y - m[5];
        out.x = ( m[3] * dx - m[2] * dy) / det;
        out.y = (-m[1] * dx + m[0] * dy) / det;
        return true;
    }

    /**
     * The element's rect in its own local space, with the pivot at the origin.
     *
     * @remarks
     * Equivalent to Unity's `RectTransform.rect`.
     *
     * WARNING: allocates. Use {@link getLocalRect} in hot paths.
     */
    public get rect(): Rect {
        return this.getLocalRect(new Rect());
    }

    /**
     * Offset of the element's low-coordinate corner from the {@link anchorMin}
     * corner, in canvas units.
     *
     * @remarks
     * Equivalent to Unity's `RectTransform.offsetMin`, and the way a stretched
     * element's margins are usually expressed. Because Y points down, `y` is
     * the offset from the **top** edge, not the bottom.
     *
     * Assigning moves that corner and leaves {@link offsetMax} where it is, so
     * the element resizes rather than moving.
     *
     * WARNING: the getter allocates. Use {@link getOffsetMin} in hot paths.
     */
    public get offsetMin(): Vector2 {
        return this.getOffsetMin(new Vector2());
    }

    public set offsetMin(value: Vector2) {
        const dx = value.x - (this.anchoredPosition.x - this.sizeDelta.x * this.pivot.x);
        const dy = value.y - (this.anchoredPosition.y - this.sizeDelta.y * this.pivot.y);

        this.sizeDelta.set(this.sizeDelta.x - dx, this.sizeDelta.y - dy);
        this.anchoredPosition.set(
            this.anchoredPosition.x + dx * (1 - this.pivot.x),
            this.anchoredPosition.y + dy * (1 - this.pivot.y),
        );
    }

    /**
     * Offset of the element's high-coordinate corner from the {@link anchorMax}
     * corner, in canvas units.
     *
     * @remarks
     * Equivalent to Unity's `RectTransform.offsetMax`. Because Y points down,
     * `y` is the offset from the **bottom** edge. Assigning resizes rather than
     * moves, leaving {@link offsetMin} in place.
     *
     * WARNING: the getter allocates. Use {@link getOffsetMax} in hot paths.
     */
    public get offsetMax(): Vector2 {
        return this.getOffsetMax(new Vector2());
    }

    public set offsetMax(value: Vector2) {
        const dx = value.x - (this.anchoredPosition.x + this.sizeDelta.x * (1 - this.pivot.x));
        const dy = value.y - (this.anchoredPosition.y + this.sizeDelta.y * (1 - this.pivot.y));

        this.sizeDelta.set(this.sizeDelta.x + dx, this.sizeDelta.y + dy);
        this.anchoredPosition.set(
            this.anchoredPosition.x + dx * this.pivot.x,
            this.anchoredPosition.y + dy * this.pivot.y,
        );
    }

    /**
     * Writes {@link offsetMin} into `out` without allocating.
     *
     * @param out - vector to receive the result.
     * @returns `out` for chaining.
     */
    public getOffsetMin(out: Vector2): Vector2 {
        return out.set(
            this.anchoredPosition.x - this.sizeDelta.x * this.pivot.x,
            this.anchoredPosition.y - this.sizeDelta.y * this.pivot.y,
        );
    }

    /**
     * Writes {@link offsetMax} into `out` without allocating.
     *
     * @param out - vector to receive the result.
     * @returns `out` for chaining.
     */
    public getOffsetMax(out: Vector2): Vector2 {
        return out.set(
            this.anchoredPosition.x + this.sizeDelta.x * (1 - this.pivot.x),
            this.anchoredPosition.y + this.sizeDelta.y * (1 - this.pivot.y),
        );
    }

    /**
     * Resizes the element along one axis, keeping its anchors and pivot.
     *
     * @remarks
     * Equivalent to Unity's `RectTransform.SetSizeWithCurrentAnchors`. Use this
     * rather than assigning {@link sizeDelta} when the anchors are stretched:
     * `sizeDelta` is a delta on top of the anchor area, so the size it produces
     * depends on the parent, whereas `size` here is the final size.
     *
     * @param axis - which axis to resize.
     * @param size - the resulting size in canvas units.
     */
    public setSizeWithCurrentAnchors(axis: RectTransformAxis, size: number): void {
        const parent = this._parentLocalRect(RectTransform._apiScratch);

        if (axis === RectTransformAxis.Horizontal) {
            this.sizeDelta.x = size - (this.anchorMax.x - this.anchorMin.x) * parent.width;
        } else {
            this.sizeDelta.y = size - (this.anchorMax.y - this.anchorMin.y) * parent.height;
        }
    }

    /**
     * Anchors the element to one parent edge and places it at a fixed inset and
     * size from it.
     *
     * @remarks
     * Equivalent to Unity's `RectTransform.SetInsetAndSizeFromParentEdge`. This
     * is how a fixed-height header or a fixed-width sidebar is expressed.
     * Collapses the anchors on the affected axis onto that edge, so the element
     * keeps its distance from it however the parent resizes.
     *
     * Note the Y-down edge mapping on {@link RectTransformEdge}: `Top` is the
     * anchor-0 side here, the opposite of Unity.
     *
     * @param edge - the parent edge to anchor against.
     * @param inset - distance from that edge, in canvas units.
     * @param size - size along the affected axis.
     */
    public setInsetAndSizeFromParentEdge(
        edge: RectTransformEdge,
        inset: number,
        size: number,
    ): void {
        const vertical = edge === RectTransformEdge.Top || edge === RectTransformEdge.Bottom;
        // Whether this edge sits at the high end of the axis, i.e. anchor 1.
        const atEnd = edge === RectTransformEdge.Right || edge === RectTransformEdge.Bottom;
        const anchor = atEnd ? 1 : 0;

        if (vertical) {
            this.anchorMin.y = anchor;
            this.anchorMax.y = anchor;
            this.sizeDelta.y = size;
            this.anchoredPosition.y = atEnd
                ? -inset - size * (1 - this.pivot.y)
                : inset + size * this.pivot.y;
        } else {
            this.anchorMin.x = anchor;
            this.anchorMax.x = anchor;
            this.sizeDelta.x = size;
            this.anchoredPosition.x = atEnd
                ? -inset - size * (1 - this.pivot.x)
                : inset + size * this.pivot.x;
        }
    }

    /**
     * Writes the element's four corners in its own local space into `out`.
     *
     * @remarks
     * Equivalent to Unity's `RectTransform.GetLocalCorners`. Same order as
     * {@link getWorldCorners}, which is these corners run through the element's
     * transform.
     *
     * @param out - four vectors to receive the corners; allocated if omitted.
     * @returns `out` (or the newly allocated array) for chaining.
     */
    public getLocalCorners(out?: Vector2[]): Vector2[] {
        const result = out ?? [new Vector2(), new Vector2(), new Vector2(), new Vector2()];
        this._resolve(0);

        const r = this._localRect;
        const x1 = r.x + r.width;
        const y1 = r.y + r.height;

        result[0].set(r.x, r.y);
        result[1].set(x1,  r.y);
        result[2].set(x1,  y1);
        result[3].set(r.x, y1);
        return result;
    }

    /** @internal The local-to-canvas affine transform `[a, b, c, d, e, f]`. */
    public get _canvasMatrix(): Float64Array {
        this._resolve(0);
        return this._matrix;
    }

    /** @internal The local-space rect, resolved. Read it, never mutate it. */
    public get _resolvedLocalRect(): Rect {
        this._resolve(0);
        return this._localRect;
    }

    /**
     * @internal
     * Writes the rect this element is laid out inside into `out`, in the
     * parent's local space — a parent RectTransform's rect, or the owning
     * canvas when this is a root-level element.
     */
    public _getParentRect(out: Rect): Rect {
        return this._parentLocalRect(out);
    }

    /** @internal The canvas-space axis-aligned bounds, resolved. */
    public get _resolvedBounds(): Rect {
        this._resolve(0);
        return this._aabb;
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
     * Resolves this element's local rect, canvas transform and bounds, reusing
     * the cached ones when nothing that feeds them has changed.
     */
    private _resolve(depth: number): void {
        // Both of these run unconditionally. The inputs are public fields
        // mutated in place, so there is no setter to hook: an ancestor that
        // moved is only discoverable by walking up and checking. Skipping the
        // walk on a frame counter would hand a child a stale rect the frame its
        // parent moved.
        const selfChanged = this._syncSnapshot();

        const prt = depth < MAX_RECT_DEPTH ? this.parentRectTransform : null;
        let pRect: Rect;
        let pMat: Float64Array;

        if (prt) {
            prt._resolve(depth + 1);
            pRect = prt._localRect;
            pMat = prt._matrix;
        } else {
            pRect = this._rootRect();
            pMat = RectTransform._identity;
        }

        if (!selfChanged && this._cacheValid && this._parentStateUnchanged(pRect, pMat)) {
            return;
        }
        this._storeParentState(pRect, pMat);

        const pw = pRect.width;
        const ph = pRect.height;

        const aLeft   = pRect.x + this.anchorMin.x * pw;
        const aTop    = pRect.y + this.anchorMin.y * ph;
        const aRight  = pRect.x + this.anchorMax.x * pw;
        const aBottom = pRect.y + this.anchorMax.y * ph;

        const aW = aRight - aLeft;
        const aH = aBottom - aTop;

        const w = aW + this.sizeDelta.x;
        const h = aH + this.sizeDelta.y;

        // The pivot is the element's origin, so the local rect straddles it and
        // rotation and scale act about it for free.
        this._localRect.set(-this.pivot.x * w, -this.pivot.y * h, w, h);

        // Where the pivot lands in the parent's local space. The reference point
        // is the anchor rect sampled *at the pivot*, not its centre — that is
        // Unity's definition, and it is what keeps `offsetMin`/`offsetMax`
        // consistent with `anchoredPosition`. The two only differ for a
        // stretched anchor with an off-centre pivot.
        const px = aLeft + this.pivot.x * aW + this.anchoredPosition.x;
        const py = aTop  + this.pivot.y * aH + this.anchoredPosition.y;

        const rad = this.localRotation * DEG_TO_RAD;
        const cos = rad === 0 ? 1 : Math.cos(rad);
        const sin = rad === 0 ? 0 : Math.sin(rad);
        const sx = this.localScale.x;
        const sy = this.localScale.y;

        // local = T(pivot position) · R(angle) · S(scale)
        const la = cos * sx;
        const lb = sin * sx;
        const lc = -sin * sy;
        const ld = cos * sy;

        // canvas = parent · local
        const m = this._matrix;
        m[0] = pMat[0] * la + pMat[2] * lb;
        m[1] = pMat[1] * la + pMat[3] * lb;
        m[2] = pMat[0] * lc + pMat[2] * ld;
        m[3] = pMat[1] * lc + pMat[3] * ld;
        m[4] = pMat[0] * px + pMat[2] * py + pMat[4];
        m[5] = pMat[1] * px + pMat[3] * py + pMat[5];

        this._updateBounds();
        this._cacheValid = true;
    }

    /** Recomputes the canvas-space AABB from the local rect and the matrix. */
    private _updateBounds(): void {
        const r = this._localRect;
        const m = this._matrix;
        const x1 = r.x + r.width;
        const y1 = r.y + r.height;

        // No rotation and no skew: the transformed rect is still axis-aligned,
        // which is the overwhelmingly common case.
        if (m[1] === 0 && m[2] === 0) {
            const ax = m[0] * r.x + m[4];
            const ay = m[3] * r.y + m[5];
            const bx = m[0] * x1 + m[4];
            const by = m[3] * y1 + m[5];
            this._aabb.set(
                Math.min(ax, bx), Math.min(ay, by),
                Math.abs(bx - ax), Math.abs(by - ay),
            );
            return;
        }

        const c = RectTransform._corners;
        c[0] = m[0] * r.x + m[2] * r.y + m[4]; c[1] = m[1] * r.x + m[3] * r.y + m[5];
        c[2] = m[0] * x1  + m[2] * r.y + m[4]; c[3] = m[1] * x1  + m[3] * r.y + m[5];
        c[4] = m[0] * x1  + m[2] * y1  + m[4]; c[5] = m[1] * x1  + m[3] * y1  + m[5];
        c[6] = m[0] * r.x + m[2] * y1  + m[4]; c[7] = m[1] * r.x + m[3] * y1  + m[5];

        let minX = c[0], maxX = c[0], minY = c[1], maxY = c[1];
        for (let i = 2; i < 8; i += 2) {
            if (c[i] < minX) minX = c[i]; else if (c[i] > maxX) maxX = c[i];
            if (c[i + 1] < minY) minY = c[i + 1]; else if (c[i + 1] > maxY) maxY = c[i + 1];
        }
        this._aabb.set(minX, minY, maxX - minX, maxY - minY);
    }

    /**
     * The rect this element is laid out inside, in the parent's local space.
     * Falls back to the canvas/viewport root when there is no parent.
     */
    private _parentLocalRect(out: Rect): Rect {
        const prt = this.parentRectTransform;
        if (prt) {
            prt._resolve(0);
            return out.copy(prt._localRect);
        }
        return out.copy(this._rootRect());
    }

    /** Maps a local-space point into canvas units. */
    private _toCanvas(x: number, y: number, out: Vector2): void {
        const m = this._matrix;
        out.x = m[0] * x + m[2] * y + m[4];
        out.y = m[1] * x + m[3] * y + m[5];
    }

    private _parentStateUnchanged(pRect: Rect, pMat: Float64Array): boolean {
        const s = this._cachedParentState;
        return s[0] === pRect.x && s[1] === pRect.y
            && s[2] === pRect.width && s[3] === pRect.height
            && s[4] === pMat[0] && s[5] === pMat[1] && s[6] === pMat[2]
            && s[7] === pMat[3] && s[8] === pMat[4] && s[9] === pMat[5];
    }

    private _storeParentState(pRect: Rect, pMat: Float64Array): void {
        const s = this._cachedParentState;
        s[0] = pRect.x; s[1] = pRect.y; s[2] = pRect.width; s[3] = pRect.height;
        s[4] = pMat[0]; s[5] = pMat[1]; s[6] = pMat[2];
        s[7] = pMat[3]; s[8] = pMat[4]; s[9] = pMat[5];
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
            && s[8] === pv.x && s[9] === pv.y
            && s[10] === this.localRotation
            && s[11] === this.localScale.x && s[12] === this.localScale.y) {
            return false;
        }

        s[10] = this.localRotation;
        s[11] = this.localScale.x; s[12] = this.localScale.y;
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
    /**
     * The rect a root-level element is laid out against, in canvas units.
     *
     * @remarks
     * The canvas is the identity frame, so its rect doubles as both the local
     * and the canvas-space one. A resize shows up as a different root rect,
     * which the caller's parent-state comparison catches — no separate
     * invalidation hook is needed.
     */
    private _rootRect(): Rect {
        // Note `canvas` starts its walk at this GameObject, so a Canvas on this
        // very object is picked up too.
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
