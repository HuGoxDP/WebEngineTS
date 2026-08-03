import { Input } from "../Input";
import { KeyCode } from "../KeyCode";
import { NavigationDirection } from "./Navigation";
import { Vector2 } from "../math/Vector2";
import { Touch, TouchPhase } from "../input/Touch";
import { Canvas } from "./Canvas";
import { PointerEventData } from "./PointerEventData";
import { PointerEventKind, UIBehaviour } from "./UIBehaviour";
import type { Selectable } from "./Selectable";
import type { GameObject } from "../GameObject";

/**
 * @internal
 * A control that samples the pointer itself once per frame, such as
 * `VirtualJoystick`. Kept structural so the EventSystem does not depend on the
 * concrete control types it drives.
 */
export interface IPointerSampler {
    readonly isActiveAndEnabled: boolean;
    _pollPointer(): void;
}

/** Depth cap for handler resolution, matching the RectTransform ancestor walk. */
const MAX_HANDLER_DEPTH = 64;

/**
 * `getComponents` takes a construct signature and `UIBehaviour` is abstract, so
 * the handler walk needs a concrete-looking view of it.
 */
const UI_BEHAVIOUR_TYPE = UIBehaviour as unknown as new (...args: never[]) => UIBehaviour;

/** Everything one pointer needs remembered between frames. */
class PointerState {
    public readonly data: PointerEventData = new PointerEventData();
    public readonly pressPos: Vector2 = new Vector2();
    public readonly lastPos: Vector2 = new Vector2();

    /** Nearest self-or-ancestor of the hit element that handles enter/exit. */
    public hoverOwner: UIBehaviour | null = null;
    public pressedGraphic: UIBehaviour | null = null;
    public dragTarget: UIBehaviour | null = null;

    public down: boolean = false;
    public hasLast: boolean = false;
    public seenThisFrame: boolean = false;
}

/**
 * Processes pointer events and routes them to interactive UI elements.
 *
 * @remarks
 * Equivalent to Unity's `EventSystem`. A static-only class — no component
 * attachment required. {@link _update} is called once per frame from
 * `Application._loop` before the UI render pass.
 *
 * **Pointer sources:** every active finger is routed independently, and the
 * mouse is treated as one more pointer when no finger is down. Two thumbs can
 * therefore press two buttons at once — the layout every mobile scenario uses,
 * with a stick under one thumb and actions under the other. Buttons work on
 * phones without relying on the browser's synthetic mouse events.
 *
 * **Hit-testing:** canvases are walked front-to-back (by `Canvas.sortingOrder`)
 * and their graphics likewise, so only the topmost element under a pointer
 * reacts. A graphic with `raycastTarget` set blocks pointers from whatever is
 * behind it even when it is not itself interactive, matching Unity — clear
 * `raycastTarget` on decorative elements that should let clicks through.
 *
 * **Event delivery:** an event goes to the nearest element at or above the hit
 * one that actually subscribes to it, which is how a label forwards a click to
 * its button. See {@link UIBehaviour.onPointerDown} and friends.
 */
export class EventSystem {

    /** Pointer id standing in for the mouse, which carries no touch identifier. */
    private static readonly MOUSE_POINTER_ID = -1;

    /**
     * How far a pointer must move from where it was pressed, in canvas units,
     * before the press becomes a drag.
     *
     * @remarks
     * Equivalent to Unity's `EventSystem.pixelDragThreshold`. Raise it for
     * touch-heavy scenarios where a tap tends to smear.
     */
    public static dragThreshold: number = 5;

    /**
     * Whether the arrow keys, Tab and the submit keys move and activate focus.
     *
     * @remarks
     * On by default: it costs a handful of key checks per frame and is what
     * makes the UI usable without a pointer. Turn it off in a scenario that
     * binds those keys to gameplay.
     */
    public static keyboardNavigation: boolean = true;

    private static _selectables: Set<Selectable> = new Set();
    private static _selected: Selectable | null = null;
    private static _joysticks: Set<IPointerSampler> = new Set();
    private static _pointerOverUI: boolean = false;

    private static readonly _pointers: Map<number, PointerState> = new Map();

    // Per-frame scratch. Cleared rather than reallocated — this runs every frame.
    private static readonly _stale: number[] = [];

    private static readonly _canvasPoint: Vector2 = new Vector2();
    private static readonly _localPoint: Vector2 = new Vector2();
    private static readonly _screenPoint: Vector2 = new Vector2();
    private static readonly _pointerPoint: Vector2 = new Vector2();

    /**
     * Whether the pointer is currently over a UI element that blocks raycasts.
     *
     * @remarks
     * Equivalent to Unity's `EventSystem.current.IsPointerOverGameObject()`.
     * Check it before acting on a click in scenario code, so a press on the HUD
     * does not also hit the 3D scene:
     *
     * ```ts
     * if (Input.getMouseButtonDown(0) && !EventSystem.isPointerOverUI) {
     *     Physics.raycast(...);
     * }
     * ```
     */
    public static get isPointerOverUI(): boolean {
        return EventSystem._pointerOverUI;
    }

    /**
     * Screen position (CSS pixels, canvas-relative) of the primary pointer —
     * the first active finger, or the mouse when no finger is down.
     *
     * WARNING: allocates. Use {@link getPointerPosition} in hot paths.
     */
    public static get pointerPosition(): Vector2 {
        return EventSystem._screenPoint.clone();
    }

    /**
     * Writes the primary pointer position into `out` without allocating.
     *
     * @param out - vector to receive the result.
     * @returns `out` for chaining.
     */
    public static getPointerPosition(out: Vector2): Vector2 {
        return out.copy(EventSystem._screenPoint);
    }

    /**
     * @internal
     * Registers a control so it can be hit-tested even with no Canvas ancestor.
     * Called automatically by Selectable.onEnable.
     */
    public static _registerSelectable(control: Selectable): void {
        EventSystem._selectables.add(control);
    }

    /** @internal Called automatically by Selectable.onDisable / onDestroy. */
    public static _unregisterSelectable(control: Selectable): void {
        EventSystem._selectables.delete(control);
        if (EventSystem._selected === control) EventSystem._selected = null;
    }

    /**
     * The control that currently holds focus, or null.
     *
     * @remarks
     * Equivalent to Unity EventSystem.currentSelectedGameObject. Set by
     * pressing a control, or explicitly through Selectable.select().
     */
    public static get currentSelected(): Selectable | null {
        return EventSystem._selected;
    }

    /** @internal Moves focus. Called by Selectable.select(). */
    public static _setSelected(control: Selectable | null): void {
        EventSystem._selected = control;
    }

    /** @internal Every registered control, for the navigation search. */
    public static _allSelectables(): ReadonlySet<Selectable> {
        return EventSystem._selectables;
    }

    /** @internal Registers an on-screen stick for per-frame pointer sampling. */
    public static _registerJoystick(stick: IPointerSampler): void {
        EventSystem._joysticks.add(stick);
    }

    /** @internal */
    public static _unregisterJoystick(stick: IPointerSampler): void {
        EventSystem._joysticks.delete(stick);
    }

    /**
     * @internal
     * Processes pointer input for all registered UI elements.
     * Called once per frame from Application._loop.
     */
    public static _update(): void {
        if (typeof window === "undefined") return;

        for (const stick of EventSystem._joysticks) {
            if (stick.isActiveAndEnabled) stick._pollPointer();
        }

        EventSystem._pointerOverUI = false;

        for (const state of EventSystem._pointers.values()) state.seenThisFrame = false;

        const touches = Touch.touches;
        for (let i = 0; i < touches.length; i++) {
            const t = touches[i];
            // A finger lifted this frame still reports its last position, which
            // is what the release must be hit-tested against.
            const isDown = t.phase !== TouchPhase.Ended && t.phase !== TouchPhase.Canceled;
            if (i === 0) EventSystem._screenPoint.copy(t.position);
            EventSystem._processPointer(t.id, t.position, isDown);
        }

        // The browser also synthesizes mouse events from touches; handling the
        // mouse only when no finger is present keeps one tap from counting twice.
        if (touches.length === 0) {
            const mouse = Input.mousePosition;
            EventSystem._screenPoint.set(mouse.x, mouse.y);
            EventSystem._pointerPoint.set(mouse.x, mouse.y);
            EventSystem._processPointer(
                EventSystem.MOUSE_POINTER_ID,
                EventSystem._pointerPoint,
                Input.getMouseButton(0),
            );
        }

        EventSystem._retireVanishedPointers();
        if (EventSystem.keyboardNavigation) EventSystem._processKeyboard();
    }

    /**
     * Moves and activates focus from the keyboard.
     *
     * @remarks
     * Tab walks the controls in registration order, which is the closest thing
     * to document order here; the arrows use each control's own navigation
     * rules. Both are no-ops when nothing holds focus and nothing is
     * registered.
     */
    private static _processKeyboard(): void {
        const selected = EventSystem._selected;

        if (Input.getKeyDown(KeyCode.Tab)) {
            EventSystem._focusNext();
            return;
        }

        if (!selected) return;

        if (Input.getKeyDown(KeyCode.Enter)
            || Input.getKeyDown(KeyCode.NumpadEnter)
            || Input.getKeyDown(KeyCode.Space)) {
            selected._submit();
            return;
        }

        if (Input.getKeyDown(KeyCode.Escape)) {
            EventSystem._setSelected(null);
            return;
        }

        if (Input.getKeyDown(KeyCode.ArrowLeft)) selected.navigate(NavigationDirection.Left);
        else if (Input.getKeyDown(KeyCode.ArrowRight)) selected.navigate(NavigationDirection.Right);
        else if (Input.getKeyDown(KeyCode.ArrowUp)) selected.navigate(NavigationDirection.Up);
        else if (Input.getKeyDown(KeyCode.ArrowDown)) selected.navigate(NavigationDirection.Down);
    }

    /** Advances focus to the next registered control, wrapping at the end. */
    private static _focusNext(): void {
        const usable: Selectable[] = [];
        for (const control of EventSystem._selectables) {
            if (control.isInteractable()) usable.push(control);
        }
        if (usable.length === 0) return;

        const current = EventSystem._selected;
        const index = current ? usable.indexOf(current) : -1;
        usable[(index + 1) % usable.length].select();
    }

    /** @internal */
    public static _reset(): void {
        EventSystem._selectables.clear();
        EventSystem._selected = null;
        EventSystem._joysticks.clear();
        EventSystem._pointers.clear();
        EventSystem._stale.length = 0;
        EventSystem._pointerOverUI = false;
    }

    private constructor() {}

    // ── private ──────────────────────────────────────────────────────

    /**
     * Routes one pointer for this frame: resolves what it is over, raises the
     * enter/exit, press, drag and click events that follow, and remembers the
     * state the next frame needs.
     *
     * @param id - stable pointer identity (touch id, or the mouse sentinel).
     * @param position - pointer position in CSS pixels, canvas-relative.
     * @param isDown - whether this pointer is pressed this frame.
     */
    private static _processPointer(id: number, position: Vector2, isDown: boolean): void {
        const state = EventSystem._stateFor(id);
        state.seenThisFrame = true;

        const hit = EventSystem._hitGraphic(position);
        const data = EventSystem._fillData(state, id, hit);

        EventSystem._updateHover(state, hit, data);

        if (isDown && !state.down) {
            state.pressPos.copy(data.position);
            data.pressPosition.copy(state.pressPos);
            state.pressedGraphic = hit;
            data.pressed = hit;
            if (hit) EventSystem._raiseUp(hit, PointerEventKind.Down, data);
        }

        if (isDown) EventSystem._updateDrag(state, data);

        if (!isDown && state.down) {
            EventSystem._release(state, hit, data);
        }

        state.down = isDown;
        state.lastPos.copy(data.position);
        state.hasLast = true;
    }

    /** Prepares the shared payload for this pointer's dispatches this frame. */
    private static _fillData(
        state: PointerState,
        id: number,
        hit: UIBehaviour | null,
    ): PointerEventData {
        const data = state.data;
        data.pointerId = id;
        data.position.copy(EventSystem._canvasPoint);

        // A default only; every dispatch re-derives it for its own receiver.
        if (hit) data.localPosition.copy(EventSystem._localPoint);
        else data.localPosition.set(0, 0);

        if (state.hasLast) {
            data.delta.set(
                data.position.x - state.lastPos.x,
                data.position.y - state.lastPos.y,
            );
        } else {
            data.delta.set(0, 0);
        }

        data.pressPosition.copy(state.pressPos);
        data.hovered = hit;
        data.pressed = state.pressedGraphic;
        data.dragging = state.dragTarget !== null;
        data.consumed = false;
        return data;
    }

    /** Fires enter/exit when the element owning hover changed for this pointer. */
    private static _updateHover(
        state: PointerState,
        hit: UIBehaviour | null,
        data: PointerEventData,
    ): void {
        // Resolved to the nearest ancestor that cares, so moving between two
        // plain children of one listening panel is not an exit and re-enter.
        const owner = hit ? EventSystem._findHoverOwner(hit) : null;
        if (state.hoverOwner && !state.hoverOwner.isActiveAndEnabled) state.hoverOwner = null;
        if (owner === state.hoverOwner) return;

        const previous = state.hoverOwner;
        state.hoverOwner = owner;

        if (previous && previous.isActiveAndEnabled) {
            EventSystem._deliver(previous, PointerEventKind.Exit, data);
        }
        if (owner) EventSystem._deliver(owner, PointerEventKind.Enter, data);
    }

    /** Promotes a held press into a drag once it moves far enough, then feeds it. */
    private static _updateDrag(state: PointerState, data: PointerEventData): void {
        // References are dropped as soon as the element goes away rather than
        // through a callback from it, so no reverse dependency on the
        // EventSystem is needed and a destroyed target cannot be retained.
        if (state.dragTarget && !state.dragTarget.isActiveAndEnabled) state.dragTarget = null;
        if (state.pressedGraphic && !state.pressedGraphic.isActiveAndEnabled) {
            state.pressedGraphic = null;
        }

        if (state.dragTarget) {
            data.dragging = true;
            EventSystem._deliver(state.dragTarget, PointerEventKind.Drag, data);
            return;
        }

        if (!state.pressedGraphic) return;

        const dx = data.position.x - state.pressPos.x;
        const dy = data.position.y - state.pressPos.y;
        const threshold = EventSystem.dragThreshold;
        if (dx * dx + dy * dy < threshold * threshold) return;

        // Subscribing to any of the three is enough to become the drag target.
        // Requiring `onDrag` specifically (as Unity's IDragHandler does) would
        // silently drop a control that only wants to know when a drag finished.
        const target = EventSystem._findHandler(state.pressedGraphic, PointerEventKind.Drag)
            ?? EventSystem._findHandler(state.pressedGraphic, PointerEventKind.BeginDrag)
            ?? EventSystem._findHandler(state.pressedGraphic, PointerEventKind.EndDrag);
        if (!target) return;

        state.dragTarget = target;
        data.dragging = true;
        EventSystem._deliver(target, PointerEventKind.BeginDrag, data);
        EventSystem._deliver(target, PointerEventKind.Drag, data);
    }

    /** Handles the frame a pointer comes up: up, end-drag or click, then reset. */
    private static _release(
        state: PointerState,
        hit: UIBehaviour | null,
        data: PointerEventData,
    ): void {
        const pressedGraphic = state.pressedGraphic;
        const dragTarget = state.dragTarget;

        state.pressedGraphic = null;
        state.dragTarget = null;

        if (pressedGraphic && pressedGraphic.isActiveAndEnabled) {
            EventSystem._raiseUp(pressedGraphic, PointerEventKind.Up, data);
        }

        if (dragTarget) {
            data.dragging = false;
            if (dragTarget.isActiveAndEnabled) {
                EventSystem._deliver(dragTarget, PointerEventKind.EndDrag, data);
            }
            // A drag is not a click, matching Unity: releasing after dragging a
            // slider handle must not also activate whatever is under it.
            return;
        }

        if (!pressedGraphic || pressedGraphic !== hit) return;

        EventSystem._raiseUp(pressedGraphic, PointerEventKind.Click, data);
    }

    /**
     * Ends the interactions of pointers that disappeared without a release —
     * a canceled touch, or a finger lifted off-screen.
     */
    private static _retireVanishedPointers(): void {
        const stale = EventSystem._stale;
        stale.length = 0;

        for (const [id, state] of EventSystem._pointers) {
            if (state.seenThisFrame) continue;
            stale.push(id);

            const data = state.data;
            data.dragging = false;
            data.consumed = false;

            // The press ended, just not with a clean release. Up still has to
            // fire or a control that counts presses stays stuck holding one —
            // no click, though, since the pointer never released on it.
            if (state.pressedGraphic?.isActiveAndEnabled) {
                EventSystem._raiseUp(state.pressedGraphic, PointerEventKind.Up, data);
            }
            state.pressedGraphic = null;

            if (state.dragTarget?.isActiveAndEnabled) {
                EventSystem._deliver(state.dragTarget, PointerEventKind.EndDrag, data);
            }
            if (state.hoverOwner?.isActiveAndEnabled) {
                EventSystem._deliver(state.hoverOwner, PointerEventKind.Exit, data);
            }
        }

        for (let i = 0; i < stale.length; i++) EventSystem._pointers.delete(stale[i]);
        stale.length = 0;
    }

    private static _stateFor(id: number): PointerState {
        let state = EventSystem._pointers.get(id);
        if (!state) {
            state = new PointerState();
            EventSystem._pointers.set(id, state);
        }
        return state;
    }

    /**
     * Finds the topmost element under the pointer, writing its canvas-space
     * position into {@link _canvasPoint} and its element-local one into
     * {@link _localPoint}.
     *
     * Sets {@link isPointerOverUI} when this pointer is over a raycast target —
     * never clears it, since it is a union across pointers that `_update`
     * resets once per frame.
     */
    private static _hitGraphic(screen: Vector2): UIBehaviour | null {
        const canvases = Canvas._sortedInstances();
        for (let ci = canvases.length - 1; ci >= 0; ci--) {
            const canvas = canvases[ci];
            if (!canvas.isActiveAndEnabled || canvas.alpha <= 0) continue;

            canvas.screenToCanvasPoint(screen, EventSystem._canvasPoint);

            const graphics = canvas._graphicList;
            for (let gi = graphics.length - 1; gi >= 0; gi--) {
                const g = graphics[gi];
                if (!g.isActiveAndEnabled || !g.raycastTarget) continue;

                // A group with blocksRaycasts off is see-through to the pointer,
                // so the search carries on to whatever is behind it.
                if (!g._groupBlocksRaycasts()) continue;

                const rt = g.rectTransform;
                const p = EventSystem._canvasPoint;

                // Bounds first: a cheap reject for the many elements the pointer
                // is nowhere near, before inverting the transform. Controls that
                // reach outside their own rect opt out and rely on _hitTest.
                if (!g._expandsHitArea && !rt._resolvedBounds.contains(p)) continue;

                // The pointer moves into the element's own space, so a rotated
                // or scaled element is hit exactly where it is drawn.
                const local = EventSystem._localPoint;
                if (!rt.canvasToLocalPoint(p.x, p.y, local)) continue;
                if (!g._hitTest(local.x, local.y, rt._resolvedLocalRect)) continue;

                // Clipped away by a mask above it: a button scrolled out of the
                // window is not there to be clicked, so the search continues to
                // whatever else is under the pointer.
                if (!g._passesMasks(p.x, p.y)) continue;

                EventSystem._pointerOverUI = true;

                // A non-interactable group still swallows the pointer — that is
                // what makes a greyed-out dialog modal — but nothing under it
                // receives events, so the search stops here rather than
                // continuing to whatever is behind.
                return g._groupInteractable() ? g : null;
            }
        }

        // Controls with no Canvas ancestor are still hit-tested in screen space.
        EventSystem._canvasPoint.copy(screen);
        for (const control of EventSystem._selectables) {
            if (!control.isActiveAndEnabled || control.canvas !== null) continue;
            if (!control._groupBlocksRaycasts()) continue;

            const rt = control.rectTransform;
            if (!control._expandsHitArea && !rt._resolvedBounds.contains(screen)) continue;

            const local = EventSystem._localPoint;
            if (!rt.canvasToLocalPoint(screen.x, screen.y, local)) continue;
            if (!control._hitTest(local.x, local.y, rt._resolvedLocalRect)) continue;

            EventSystem._pointerOverUI = true;
            return control._groupInteractable() ? control : null;
        }

        return null;
    }

    /** Dispatches `kind` to the nearest element at or above `from` handling it. */
    private static _raiseUp(
        from: UIBehaviour,
        kind: PointerEventKind,
        data: PointerEventData,
    ): void {
        const target = EventSystem._findHandler(from, kind);
        if (target) EventSystem._deliver(target, kind, data);
    }

    /**
     * Raises `kind` on `target`, re-deriving `localPosition` in *its* space.
     *
     * @remarks
     * The receiver is often not the element the pointer is over: a drag keeps
     * running once the pointer has left, and an event can bubble to an ancestor.
     * Reporting the hit element's local coordinates — or none at all when the
     * pointer is over nothing — would leave a dragging control reading a
     * position it never moved to.
     */
    private static _deliver(
        target: UIBehaviour,
        kind: PointerEventKind,
        data: PointerEventData,
    ): void {
        const ok = target.rectTransform.canvasToLocalPoint(
            data.position.x, data.position.y, data.localPosition,
        );
        if (!ok) data.localPosition.set(0, 0);
        target._raise(kind, data);
    }

    /** The nearest self-or-ancestor UIBehaviour subscribed to `kind`. */
    private static _findHandler(
        from: UIBehaviour,
        kind: PointerEventKind,
    ): UIBehaviour | null {
        if (from._hasListeners(kind)) return from;

        let go: GameObject | null = from.transform.parent?.gameObject ?? null;
        for (let depth = 0; go && depth < MAX_HANDLER_DEPTH; depth++) {
            const graphics = go.getComponents(UI_BEHAVIOUR_TYPE);
            for (let i = 0; i < graphics.length; i++) {
                const g = graphics[i];
                if (g.isActiveAndEnabled && g._hasListeners(kind)) return g;
            }
            go = go.transform.parent?.gameObject ?? null;
        }
        return null;
    }

    /** The nearest self-or-ancestor that cares about hover at all. */
    private static _findHoverOwner(from: UIBehaviour): UIBehaviour | null {
        return EventSystem._findHandler(from, PointerEventKind.Enter)
            ?? EventSystem._findHandler(from, PointerEventKind.Exit);
    }

}
