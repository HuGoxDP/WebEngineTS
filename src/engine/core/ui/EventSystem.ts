import { Input } from "../Input";
import { Vector2 } from "../math/Vector2";
import { Button, ButtonState } from "./Button";

/**
 * Processes pointer events and routes them to interactive UI elements.
 *
 * @remarks
 * Equivalent to Unity's `EventSystem`. A static-only class — no component
 * attachment required. {@link _update} is called once per frame from
 * `Application._loop` after the 3D render pass.
 *
 * **Hit-test coordinate system:** uses `Input.mousePosition`, which is
 * canvas-relative (top-left = origin). Assumes the UI overlay canvas
 * occupies the same coordinate space as the WebGL canvas.
 */
export class EventSystem {

    private static _buttons: Set<Button> = new Set();
    private static _wasDown: boolean = false;

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
    }

    /**
     * @internal
     * Processes pointer input for all registered buttons.
     * Called once per frame from Application._loop.
     */
    public static _update(): void {
        if (typeof window === "undefined") return;

        const mouse = Input.mousePosition;
        const isDown = Input.getMouseButton(0);
        const wasDown = EventSystem._wasDown;
        const justDown = isDown && !wasDown;
        const justUp   = !isDown && wasDown;
        EventSystem._wasDown = isDown;

        for (const btn of EventSystem._buttons) {
            if (!btn.isActiveAndEnabled || !btn.interactable) {
                btn._state = ButtonState.Disabled;
                continue;
            }

            const rect = btn.rectTransform.screenRect;
            const inside = rect.contains(mouse);

            if (inside && justDown) {
                btn._state = ButtonState.Pressed;
            } else if (inside && isDown && btn._state === ButtonState.Pressed) {
                btn._state = ButtonState.Pressed;
            } else if (inside) {
                btn._state = ButtonState.Highlighted;
            } else {
                btn._state = ButtonState.Normal;
            }

            // Fire onClick when the button is released inside its rect.
            if (justUp && inside && btn.onClick) {
                btn.onClick();
            }
        }
    }

    /** @internal */
    public static _reset(): void {
        EventSystem._buttons.clear();
        EventSystem._wasDown = false;
    }

    private constructor() {}
}
