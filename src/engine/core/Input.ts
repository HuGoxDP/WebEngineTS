// path: src/engine/core/Input.ts

import { Vector2 } from "./math/Vector2.ts";
import { KeyCode } from "./KeyCode.ts";

/**
 * Provides a static interface for reading player input (keyboard, mouse).
 *
 * Input state is updated by the engine's main loop. User scripts should
 * read from Input during `update()` or `lateUpdate()`.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Input`.
 *
 * **Keyboard:**
 * - {@link getKey} — true while held
 * - {@link getKeyDown} — true on the frame it was pressed
 * - {@link getKeyUp} — true on the frame it was released
 * - {@link anyKey} — true if any key is currently held
 * - {@link anyKeyDown} — true if any key was pressed this frame
 *
 * **Mouse:**
 * - {@link getMouseButton} / {@link getMouseButtonDown} / {@link getMouseButtonUp}
 * - {@link mousePosition} — pixel coordinates relative to canvas
 * - {@link mouseScrollDelta} — scroll wheel delta (vertical in y)
 *
 * **Axes:**
 * - {@link getAxis} — smoothed input (-1 to +1)
 * - {@link getAxisRaw} — instant input (-1, 0, or +1)
 *
 * @example
 * ```ts
 * if (Input.getKeyDown(KeyCode.Space)) {
 *     player.jump();
 * }
 *
 * const h = Input.getAxis("Horizontal");
 * const v = Input.getAxis("Vertical");
 * this.transform.translate(new Vector3(h, 0, v).scale(speed * Time.deltaTime));
 * ```
 */
export class Input {


    // ==================== KEYBOARD STATE ====================

    /** Keys currently held down. */
    private static _currentKeys: Set<string> = new Set();

    /** Keys pressed this frame. */
    private static _downKeys: Set<string> = new Set();

    /** Keys released this frame. */
    private static _upKeys: Set<string> = new Set();

    // ==================== MOUSE STATE ====================

    /** Mouse button held state [Left=0, Middle=1, Right=2]. */
    private static _mouseButtons: boolean[] = [false, false, false];

    /** Mouse button pressed this frame. */
    private static _mouseDowns: boolean[] = [false, false, false];

    /** Mouse button released this frame. */
    private static _mouseUps: boolean[] = [false, false, false];

    /** Internal mouse position (canvas-relative pixels). */
    private static _mousePosition: Vector2 = new Vector2(0, 0);

    /** Internal scroll delta accumulated this frame. */
    private static _mouseScrollDelta: Vector2 = new Vector2(0, 0);

    // ==================== AXIS SMOOTHING ====================

    /** Current smoothed axis values. */
    private static _axisValues: Map<string, number> = new Map([
        ["Horizontal", 0],
        ["Vertical", 0],
    ]);

    /**
     * Speed at which smoothed axes move toward their target.
     * Higher = more responsive, lower = smoother.
     */
    private static readonly _AXIS_SENSITIVITY: number = 3.0;

    /**
     * Speed at which smoothed axes return to zero when no input.
     */
    private static readonly _AXIS_GRAVITY: number = 3.0;

    // ==================== INTERNAL REFERENCES ====================

    /** Reference to the canvas for cleanup. */
    private static _canvas: HTMLCanvasElement | null = null;

    /** Cached bounding rect, updated on resize. */
    private static _canvasRect: DOMRect | null = null;

    /** Bound event handlers for proper cleanup. */
    private static _handlers: {
        keydown: (e: KeyboardEvent) => void;
        keyup: (e: KeyboardEvent) => void;
        mousedown: (e: MouseEvent) => void;
        mouseup: (e: MouseEvent) => void;
        mousemove: (e: MouseEvent) => void;
        wheel: (e: WheelEvent) => void;
        contextmenu: (e: Event) => void;
        resize: () => void;
    } | null = null;

    // ==================== INITIALIZATION ====================

    /**
     * @internal
     * Initializes input event listeners. Called once by Application.
     *
     * @param canvas — the rendering canvas to attach mouse events to.
     */
    public static _init(canvas: HTMLCanvasElement): void {
        Input._canvas = canvas;
        Input._canvasRect = canvas.getBoundingClientRect();

        // Create bound handlers for proper removal later
        const handlers = {
            keydown: (e: KeyboardEvent) => {
                if (e.repeat) return; // Ignore auto-repeat
                Input._currentKeys.add(e.code);
                Input._downKeys.add(e.code);
            },
            keyup: (e: KeyboardEvent) => {
                Input._currentKeys.delete(e.code);
                Input._upKeys.add(e.code);
            },
            mousedown: (e: MouseEvent) => {
                if (e.button >= 0 && e.button <= 2) {
                    Input._mouseButtons[e.button] = true;
                    Input._mouseDowns[e.button] = true;
                }
            },
            mouseup: (e: MouseEvent) => {
                if (e.button >= 0 && e.button <= 2) {
                    Input._mouseButtons[e.button] = false;
                    Input._mouseUps[e.button] = true;
                }
            },
            mousemove: (e: MouseEvent) => {
                const rect = Input._canvasRect!;
                Input._mousePosition.set(
                    e.clientX - rect.left,
                    e.clientY - rect.top
                );
            },
            wheel: (e: WheelEvent) => {
                // Accumulate scroll delta for this frame.
                // Unity convention: positive y = scroll up.
                // DOM convention: positive deltaY = scroll down.
                // We invert to match Unity.
                Input._mouseScrollDelta.set(
                    Input._mouseScrollDelta.x + e.deltaX,
                    Input._mouseScrollDelta.y + (-e.deltaY)
                );
            },
            contextmenu: (e: Event) => e.preventDefault(),
            resize: () => {
                Input._canvasRect = canvas.getBoundingClientRect();
            },
        };

        Input._handlers = handlers;

        // Attach keyboard to window (global capture)
        window.addEventListener("keydown", handlers.keydown);
        window.addEventListener("keyup", handlers.keyup);
        window.addEventListener("resize", handlers.resize);

        // Attach mouse to canvas
        canvas.addEventListener("mousedown", handlers.mousedown);
        canvas.addEventListener("mouseup", handlers.mouseup);
        canvas.addEventListener("mousemove", handlers.mousemove);
        canvas.addEventListener("wheel", handlers.wheel, { passive: true });
        canvas.addEventListener("contextmenu", handlers.contextmenu);
    }

    /**
     * @internal
     * Removes all event listeners. Called when Application shuts down.
     */
    public static _dispose(): void {
        if (!Input._handlers || !Input._canvas) return;

        const h = Input._handlers;
        const canvas = Input._canvas;

        window.removeEventListener("keydown", h.keydown);
        window.removeEventListener("keyup", h.keyup);
        window.removeEventListener("resize", h.resize);

        canvas.removeEventListener("mousedown", h.mousedown);
        canvas.removeEventListener("mouseup", h.mouseup);
        canvas.removeEventListener("mousemove", h.mousemove);
        canvas.removeEventListener("wheel", h.wheel);
        canvas.removeEventListener("contextmenu", h.contextmenu);

        Input._handlers = null;
        Input._canvas = null;
        Input._canvasRect = null;
    }

    /**
     * @internal
     * Clears per-frame input buffers (down/up events, scroll).
     * Must be called at the **end** of each frame by Application.
     */
    public static _resetFrame(): void {
        Input._downKeys.clear();
        Input._upKeys.clear();

        for (let i = 0; i < 3; i++) {
            Input._mouseDowns[i] = false;
            Input._mouseUps[i] = false;
        }

        Input._mouseScrollDelta.set(0, 0);
    }

    /**
     * @internal
     * Updates smoothed axis values. Called once per frame by Application
     * with the current unscaled delta time.
     *
     * @param dt — unscaled delta time for this frame (seconds).
     */
    public static _updateAxes(dt: number): void {
        Input._smoothAxis("Horizontal", dt);
        Input._smoothAxis("Vertical", dt);
    }

    // ==================== KEYBOARD API ====================

    /**
     * Returns `true` while the specified key is held down.
     *
     * @remarks
     * Equivalent to Unity's `Input.GetKey()`.
     */
    public static getKey(keyCode: KeyCode | string): boolean {
        return Input._currentKeys.has(keyCode);
    }

    /**
     * Returns `true` during the frame the key was pressed.
     *
     * @remarks
     * Equivalent to Unity's `Input.GetKeyDown()`.
     */
    public static getKeyDown(keyCode: KeyCode | string): boolean {
        return Input._downKeys.has(keyCode);
    }

    /**
     * Returns `true` during the frame the key was released.
     *
     * @remarks
     * Equivalent to Unity's `Input.GetKeyUp()`.
     */
    public static getKeyUp(keyCode: KeyCode | string): boolean {
        return Input._upKeys.has(keyCode);
    }

    /**
     * Returns `true` if any key is currently held down.
     *
     * @remarks
     * Equivalent to Unity's `Input.anyKey`.
     */
    public static get anyKey(): boolean {
        return Input._currentKeys.size > 0;
    }

    /**
     * Returns `true` if any key was pressed this frame.
     *
     * @remarks
     * Equivalent to Unity's `Input.anyKeyDown`.
     */
    public static get anyKeyDown(): boolean {
        return Input._downKeys.size > 0;
    }

    // ==================== MOUSE API ====================

    /**
     * Returns `true` while the specified mouse button is held.
     *
     * @param button — `0` = Left, `1` = Middle, `2` = Right
     *
     * @remarks
     * Equivalent to Unity's `Input.GetMouseButton()`.
     */
    public static getMouseButton(button: number): boolean {
        return Input._mouseButtons[button] ?? false;
    }

    /**
     * Returns `true` during the frame the mouse button was pressed.
     *
     * @param button — `0` = Left, `1` = Middle, `2` = Right
     *
     * @remarks
     * Equivalent to Unity's `Input.GetMouseButtonDown()`.
     */
    public static getMouseButtonDown(button: number): boolean {
        return Input._mouseDowns[button] ?? false;
    }

    /**
     * Returns `true` during the frame the mouse button was released.
     *
     * @param button — `0` = Left, `1` = Middle, `2` = Right
     *
     * @remarks
     * Equivalent to Unity's `Input.GetMouseButtonUp()`.
     */
    public static getMouseButtonUp(button: number): boolean {
        return Input._mouseUps[button] ?? false;
    }

    /**
     * The current mouse position in pixel coordinates relative to the canvas.
     *
     * Returns a **copy** — modifications do not affect internal state.
     *
     * @remarks
     * Equivalent to Unity's `Input.mousePosition`.
     * Note: Unity uses bottom-left origin; we use top-left (CSS convention).
     */
    public static get mousePosition(): Vector2 {
        return Input._mousePosition.clone();
    }

    /**
     * The mouse scroll delta accumulated during this frame.
     *
     * - `y > 0` — scrolled up
     * - `y < 0` — scrolled down
     * - `x` — horizontal scroll (if available)
     *
     * Returns a **copy** — modifications do not affect internal state.
     *
     * @remarks
     * Equivalent to Unity's `Input.mouseScrollDelta`.
     */
    public static get mouseScrollDelta(): Vector2 {
        return Input._mouseScrollDelta.clone();
    }

    // ==================== AXIS API ====================

    /**
     * Returns a smoothed value between `-1` and `1` for the named axis.
     *
     * The value accelerates toward the target and decelerates back to zero,
     * providing smooth, natural-feeling movement.
     *
     * Supported axes: `"Horizontal"`, `"Vertical"`.
     *
     * @remarks
     * Equivalent to Unity's `Input.GetAxis()`.
     * For raw (instant) values, use {@link getAxisRaw}.
     */
    public static getAxis(axisName: "Horizontal" | "Vertical"): number {
        return Input._axisValues.get(axisName) ?? 0;
    }

    /**
     * Returns the raw (un-smoothed) input for the named axis.
     *
     * Returns `-1`, `0`, or `1` instantly based on current key state.
     *
     * @remarks
     * Equivalent to Unity's `Input.GetAxisRaw()`.
     */
    public static getAxisRaw(axisName: "Horizontal" | "Vertical"): number {
        let value = 0;

        if (axisName === "Horizontal") {
            if (Input.getKey(KeyCode.KeyD) || Input.getKey(KeyCode.ArrowRight)) value += 1;
            if (Input.getKey(KeyCode.KeyA) || Input.getKey(KeyCode.ArrowLeft)) value -= 1;
        } else if (axisName === "Vertical") {
            if (Input.getKey(KeyCode.KeyW) || Input.getKey(KeyCode.ArrowUp)) value += 1;
            if (Input.getKey(KeyCode.KeyS) || Input.getKey(KeyCode.ArrowDown)) value -= 1;
        }

        return value;
    }


    // ==================== PRIVATE HELPERS ====================

    /**
     * Smooths a single axis value toward its target using sensitivity/gravity.
     * @internal
     */
    private static _smoothAxis(axisName: string, dt: number): void {
        const raw = Input.getAxisRaw(axisName as "Horizontal" | "Vertical");
        const current = Input._axisValues.get(axisName) ?? 0;
        let next: number;

        if (raw !== 0) {
            // Move toward target at sensitivity rate
            next = current + raw * Input._AXIS_SENSITIVITY * dt;
            // Clamp to [-1, 1] and don't overshoot target
            next = Math.max(-1, Math.min(1, next));
            // Don't overshoot past the raw target
            if (raw > 0 && next > raw) next = raw;
            if (raw < 0 && next < raw) next = raw;
        } else {
            // No input — decay back toward zero at gravity rate
            if (current > 0) {
                next = Math.max(0, current - Input._AXIS_GRAVITY * dt);
            } else if (current < 0) {
                next = Math.min(0, current + Input._AXIS_GRAVITY * dt);
            } else {
                next = 0;
            }
        }

        Input._axisValues.set(axisName, next);
    }
}