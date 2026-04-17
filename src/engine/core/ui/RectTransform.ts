import { Component } from "../Component";
import { Vector2 } from "../math/Vector2";
import { Rect } from "../math/Rect";
import type { Canvas } from "./Canvas";
import type { GameObject } from "../GameObject";

/**
 * Defines the 2D layout rectangle for a UI element.
 *
 * @remarks
 * Equivalent to Unity's `RectTransform`. Every UI element needs one.
 * Adding an Image/Text/Button component to a GameObject automatically
 * adds a RectTransform sibling if one does not already exist.
 *
 * **Coordinate system:** origin at top-left, X right, Y down (CSS convention).
 * This differs from Unity's bottom-left origin for the purpose of direct
 * mapping to the browser 2D canvas.
 *
 * **Anchor system:**
 * - `anchorMin` / `anchorMax` define a rectangle inside the parent (0–1 normalized).
 * - When they are equal (default `(0.5, 0.5)`) the anchor is a single point.
 * - `anchoredPosition` is the pixel offset of the pivot from the anchor center.
 * - `sizeDelta` is added on top of the stretched anchor area to get the final size.
 */
export class RectTransform extends Component {

    /** Offset of the rect's pivot from the anchor reference point, in pixels. */
    public anchoredPosition: Vector2 = new Vector2(0, 0);

    /**
     * Size adjustment in pixels.
     * When anchors are a point (min === max) this is the absolute size.
     * When anchors are stretched, this is the delta added to the anchor area.
     */
    public sizeDelta: Vector2 = new Vector2(100, 100);

    /** Normalized lower-left anchor corner (0–1 of parent rect). */
    public anchorMin: Vector2 = new Vector2(0.5, 0.5);

    /** Normalized upper-right anchor corner (0–1 of parent rect). */
    public anchorMax: Vector2 = new Vector2(0.5, 0.5);

    /**
     * The pivot point (0–1).
     * `(0.5, 0.5)` = center, `(0, 0)` = top-left, `(1, 1)` = bottom-right.
     */
    public pivot: Vector2 = new Vector2(0.5, 0.5);

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The parent RectTransform, or null if this is the root. */
    public get parentRectTransform(): RectTransform | null {
        const parentGO = this.transform.parent?.gameObject ?? null;
        return parentGO ? (parentGO.getComponent(RectTransform) ?? null) : null;
    }

    /** The nearest Canvas ancestor, or null. */
    public get canvas(): Canvas | null {
        // Lazy import to avoid circular dependency at module load time.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Canvas } = require("./Canvas") as typeof import("./Canvas");
        let go: GameObject | null = this.gameObject;
        while (go) {
            const c = go.getComponent(Canvas);
            if (c) return c;
            go = go.transform.parent?.gameObject ?? null;
        }
        return null;
    }

    /**
     * The computed screen-space rectangle of this element, in pixels.
     * Origin is the top-left of the viewport / parent Canvas.
     */
    public get screenRect(): Rect {
        const parentRect = this._parentRect();
        const pw = parentRect.width;
        const ph = parentRect.height;

        const aLeft   = parentRect.x + this.anchorMin.x * pw;
        const aTop    = parentRect.y + this.anchorMin.y * ph;
        const aRight  = parentRect.x + this.anchorMax.x * pw;
        const aBottom = parentRect.y + this.anchorMax.y * ph;

        const aW = aRight - aLeft;
        const aH = aBottom - aTop;
        const aCx = aLeft + aW * 0.5;
        const aCy = aTop  + aH * 0.5;

        const w = aW + this.sizeDelta.x;
        const h = aH + this.sizeDelta.y;

        const x = aCx + this.anchoredPosition.x - this.pivot.x * w;
        const y = aCy + this.anchoredPosition.y - this.pivot.y * h;

        return new Rect(x, y, w, h);
    }

    // ── private ──────────────────────────────────────────────────────

    private _parentRect(): Rect {
        const prt = this.parentRectTransform;
        if (prt) return prt.screenRect;

        const { Canvas } = require("./Canvas") as typeof import("./Canvas");
        const c = this.gameObject.getComponent(Canvas);
        if (c) return new Rect(0, 0, c.width, c.height);

        // Fallback: entire viewport
        return new Rect(0, 0,
            typeof window !== "undefined" ? window.innerWidth  : 800,
            typeof window !== "undefined" ? window.innerHeight : 600,
        );
    }
}
