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
 * **Pointer sources:** the primary pointer is the first active finger when the
 * device reports touches, otherwise the mouse. Buttons therefore work on phones
 * without relying on the browser's synthetic mouse events.
 *
 * **Hit-testing:** canvases are walked front-to-back (by `Canvas.sortingOrder`)
 * and their graphics likewise, so only the topmost element under the pointer
 * reacts. The hit element's Button — or the nearest Button above it in the
 * hierarchy, which is how a label forwards clicks to its button — receives the
 * event. A click fires only when press and release land on the same button.
 */
export class EventSystem {

    private static _buttons: Set<Button> = new Set();
    private static _joysticks: Set<IPointerSampler> = new Set();
    private static _wasDown: boolean = false;
    private static _pressedButton: Button | null = null;
    private static _pointerOverUI: boolean = false;

    private static readonly _scratchRect: Rect = new Rect();
    private static readonly _canvasPoint: Vector2 = new Vector2();
    private static readonly _screenPoint: Vector2 = new Vector2();

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

    /** Screen position (CSS pixels, canvas-relative) of the primary pointer. */
    public static get pointerPosition(): Vector2 {
        return EventSystem._screenPoint.clone();
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
        if (EventSystem._pressedButton === btn) EventSystem._pressedButton = null;
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

        const isDown = EventSystem._resolvePointer(EventSystem._screenPoint);
        const wasDown = EventSystem._wasDown;
        const justDown = isDown && !wasDown;
        const justUp   = !isDown && wasDown;
        EventSystem._wasDown = isDown;

        for (const stick of EventSystem._joysticks) {
            if (stick.isActiveAndEnabled) stick._pollPointer();
        }

        const hit = EventSystem._hitTest(EventSystem._screenPoint);

        if (justDown) {
            EventSystem._pressedButton = hit && hit.interactable ? hit : null;
        }

        for (const btn of EventSystem._buttons) {
            if (!btn.isActiveAndEnabled) {
                btn._state = ButtonState.Normal;
            } else if (!btn.interactable) {
                btn._state = ButtonState.Disabled;
            } else if (btn !== hit) {
                btn._state = ButtonState.Normal;
            } else {
                btn._state = isDown && EventSystem._pressedButton === btn
                    ? ButtonState.Pressed
                    : ButtonState.Highlighted;
            }
        }

        if (justUp) {
            const pressed = EventSystem._pressedButton;
            EventSystem._pressedButton = null;
            if (pressed && pressed === hit && pressed.interactable && pressed.onClick) {
                pressed.onClick();
            }
        }
    }

    /** @internal */
    public static _reset(): void {
        EventSystem._buttons.clear();
        EventSystem._joysticks.clear();
        EventSystem._wasDown = false;
        EventSystem._pressedButton = null;
        EventSystem._pointerOverUI = false;
    }

    private constructor() {}

    // ── private ──────────────────────────────────────────────────────

    /**
     * Writes the primary pointer position into `out`.
     * @returns whether the pointer is pressed this frame.
     */
    private static _resolvePointer(out: Vector2): boolean {
        const touches = Touch.touches;
        if (touches.length > 0) {
            // A finger lifted this frame still reports its last position, which
            // is what the release must be hit-tested against.
            const t = touches[0];
            out.copy(t.position);
            return t.phase !== TouchPhase.Ended && t.phase !== TouchPhase.Canceled;
        }

        const mouse = Input.mousePosition;
        out.set(mouse.x, mouse.y);
        return Input.getMouseButton(0);
    }

    /**
     * Finds the topmost UI element under the pointer and the Button that should
     * receive its events. Also refreshes {@link isPointerOverUI}.
     */
    private static _hitTest(screen: Vector2): Button | null {
        EventSystem._pointerOverUI = false;

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
