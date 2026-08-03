import { Input } from "../Input";
import { Vector2 } from "../math/Vector2";
import { Rect } from "../math/Rect";
import { Touch, TouchPhase } from "../input/Touch";
import { Canvas } from "./Canvas";
import { Button, ButtonState } from "./Button";
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
 * reacts. The hit element's Button — or the nearest Button above it in the
 * hierarchy, which is how a label forwards clicks to its button — receives the
 * event. A click fires only when press and release land on the same button with
 * the same pointer.
 *
 * A graphic with `raycastTarget` set blocks pointers from whatever is behind it
 * even when it is not itself interactive, matching Unity. Clear `raycastTarget`
 * on decorative elements that should let clicks through.
 */
export class EventSystem {

    /** Pointer id standing in for the mouse, which carries no touch identifier. */
    private static readonly MOUSE_POINTER_ID = -1;

    private static _buttons: Set<Button> = new Set();
    private static _joysticks: Set<IPointerSampler> = new Set();
    private static _pointerOverUI: boolean = false;

    /** The button each currently-pressed pointer went down on. */
    private static readonly _pressedByPointer: Map<number, Button> = new Map();

    /** Pointer ids that were down at the end of the previous frame. */
    private static readonly _downLastFrame: Set<number> = new Set();

    // Per-frame scratch. Cleared rather than reallocated — this runs every frame.
    private static readonly _downThisFrame: Set<number> = new Set();
    private static readonly _hovered: Set<Button> = new Set();
    private static readonly _held: Set<Button> = new Set();

    private static readonly _scratchRect: Rect = new Rect();
    private static readonly _canvasPoint: Vector2 = new Vector2();
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
     * Registers a button for pointer event processing.
     * Called automatically by Button.onEnable.
     */
    public static _registerButton(btn: Button): void {
        EventSystem._buttons.add(btn);
    }

    /**
     * @internal
     * Unregisters a button.
     * Called automatically by Button.onDisable / onDestroy.
     */
    public static _unregisterButton(btn: Button): void {
        EventSystem._buttons.delete(btn);

        for (const [id, pressed] of EventSystem._pressedByPointer) {
            if (pressed === btn) EventSystem._pressedByPointer.delete(id);
        }
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

        EventSystem._downThisFrame.clear();
        EventSystem._hovered.clear();
        EventSystem._held.clear();
        EventSystem._pointerOverUI = false;

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

        // A pointer can vanish without ever reporting a release (a canceled
        // touch, a mouse leaving the window); its press must not survive.
        for (const id of EventSystem._downLastFrame) {
            if (!EventSystem._downThisFrame.has(id)) EventSystem._pressedByPointer.delete(id);
        }
        EventSystem._downLastFrame.clear();
        for (const id of EventSystem._downThisFrame) EventSystem._downLastFrame.add(id);

        for (const btn of EventSystem._buttons) {
            if (!btn.isActiveAndEnabled)        btn._state = ButtonState.Normal;
            else if (!btn.interactable)         btn._state = ButtonState.Disabled;
            else if (EventSystem._held.has(btn)) btn._state = ButtonState.Pressed;
            else if (EventSystem._hovered.has(btn)) btn._state = ButtonState.Highlighted;
            else                                btn._state = ButtonState.Normal;
        }
    }

    /** @internal */
    public static _reset(): void {
        EventSystem._buttons.clear();
        EventSystem._joysticks.clear();
        EventSystem._pressedByPointer.clear();
        EventSystem._downLastFrame.clear();
        EventSystem._downThisFrame.clear();
        EventSystem._hovered.clear();
        EventSystem._held.clear();
        EventSystem._pointerOverUI = false;
    }

    private constructor() {}

    // ── private ──────────────────────────────────────────────────────

    /**
     * Routes one pointer for this frame: resolves what it is over, tracks its
     * press across frames, and fires the click when it releases on the button it
     * pressed.
     *
     * @param id - stable pointer identity (touch id, or the mouse sentinel).
     * @param position - pointer position in CSS pixels, canvas-relative.
     * @param isDown - whether this pointer is pressed this frame.
     */
    private static _processPointer(id: number, position: Vector2, isDown: boolean): void {
        const hit = EventSystem._hitTest(position);
        const wasDown = EventSystem._downLastFrame.has(id);

        if (isDown) EventSystem._downThisFrame.add(id);

        if (isDown && !wasDown) {
            if (hit && hit.interactable) EventSystem._pressedByPointer.set(id, hit);
            else EventSystem._pressedByPointer.delete(id);
        }

        const pressed = EventSystem._pressedByPointer.get(id) ?? null;

        if (hit && hit.interactable) {
            // Held wins over hover, and both are unions across pointers: a button
            // under two fingers reads as pressed, not as pressed-and-hovered.
            if (isDown && pressed === hit) EventSystem._held.add(hit);
            else EventSystem._hovered.add(hit);
        }

        if (!isDown && wasDown) {
            EventSystem._pressedByPointer.delete(id);
            if (pressed && pressed === hit && pressed.interactable && pressed.onClick) {
                pressed.onClick();
            }
        }
    }

    /**
     * Finds the topmost UI element under the pointer and the Button that should
     * receive its events. Sets {@link isPointerOverUI} when this pointer is over
     * a raycast target — never clears it, since it is a union across pointers
     * that `_update` resets once per frame.
     */
    private static _hitTest(screen: Vector2): Button | null {
        const canvases = Canvas._sortedInstances();
        for (let ci = canvases.length - 1; ci >= 0; ci--) {
            const canvas = canvases[ci];
            if (!canvas.isActiveAndEnabled || canvas.alpha <= 0) continue;

            canvas.screenToCanvasPoint(screen, EventSystem._canvasPoint);

            const graphics = canvas._graphicList;
            for (let gi = graphics.length - 1; gi >= 0; gi--) {
                const g = graphics[gi];
                if (!g.isActiveAndEnabled || !g.raycastTarget) continue;

                g.rectTransform.getScreenRect(EventSystem._scratchRect);
                const p = EventSystem._canvasPoint;
                if (!g._hitTest(p.x, p.y, EventSystem._scratchRect)) continue;

                EventSystem._pointerOverUI = true;
                return EventSystem._findButton(g.gameObject);
            }
        }

        // Buttons with no Canvas ancestor are still hit-tested in screen space.
        for (const btn of EventSystem._buttons) {
            if (!btn.isActiveAndEnabled || btn.canvas !== null) continue;
            btn.rectTransform.getScreenRect(EventSystem._scratchRect);
            if (EventSystem._scratchRect.contains(screen)) {
                EventSystem._pointerOverUI = true;
                return btn;
            }
        }

        return null;
    }

    /** Walks up the hierarchy for the Button that owns the hit element. */
    private static _findButton(from: GameObject): Button | null {
        let go: GameObject | null = from;
        for (let depth = 0; go && depth < 64; depth++) {
            const btn = go.getComponent(Button);
            if (btn && btn.isActiveAndEnabled) return btn;
            go = go.transform.parent?.gameObject ?? null;
        }
        return null;
    }
}
