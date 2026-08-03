import { Vector2 } from "../math/Vector2";
import type { UIBehaviour } from "./UIBehaviour";

/**
 * State of one pointer at the moment a UI event fired.
 *
 * @remarks
 * Equivalent to Unity's `PointerEventData`.
 *
 * **Coordinates are canvas units with Y pointing down**, the same space
 * `RectTransform` lays out in — see {@link RectTransform} for the convention.
 * {@link localPosition} is in the receiving element's own space, where the
 * pivot is the origin and any rotation or scale has already been undone.
 *
 * **Lifetime:** the EventSystem reuses one instance per pointer, so this object
 * is only valid for the duration of the callback. Copy anything you need to
 * keep:
 *
 * ```ts
 * image.onDrag.addListener(e => {
 *     rt.anchoredPosition.set(
 *         rt.anchoredPosition.x + e.delta.x,
 *         rt.anchoredPosition.y + e.delta.y,
 *     );
 * });
 * ```
 */
export class PointerEventData {

    /**
     * Stable identity of the pointer: a touch id, or `-1` for the mouse.
     *
     * @remarks
     * Distinguishes fingers when several are down at once.
     */
    public pointerId: number = -1;

    /** Pointer position in canvas units. */
    public readonly position: Vector2 = new Vector2();

    /** Pointer position in the receiving element's local space. */
    public readonly localPosition: Vector2 = new Vector2();

    /** Movement in canvas units since the previous frame. */
    public readonly delta: Vector2 = new Vector2();

    /** Where in canvas units this pointer was first pressed. */
    public readonly pressPosition: Vector2 = new Vector2();

    /** Whether this pointer is currently past the drag threshold. */
    public dragging: boolean = false;

    /** The element under the pointer, or null when it is over nothing. */
    public hovered: UIBehaviour | null = null;

    /** The element this pointer was pressed on, or null. */
    public pressed: UIBehaviour | null = null;

    /**
     * Set by a listener to stop the engine acting on this event itself.
     *
     * @remarks
     * Currently consulted for drags: a control that handles its own dragging
     * (a slider, a scroll view) sets this so an outer scroll view does not also
     * react. Reset before every dispatch.
     */
    public consumed: boolean = false;
}
