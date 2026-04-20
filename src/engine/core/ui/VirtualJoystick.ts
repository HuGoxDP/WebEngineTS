import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { Vector2 } from "../math/Vector2";
import { Input } from "../Input";
import { Touch, TouchPhase } from "../input/Touch";
import type { GameObject } from "../GameObject";

/**
 * On-screen analog joystick for touch/mouse input.
 *
 * @remarks
 * Equivalent to a Unity on-screen-stick UI control.
 *
 * Reads {@link Touch} for mobile fingers and falls back to {@link Input}
 * mouse events on desktop. Exposes a {@link value} Vector2 in range
 * `[-1, +1]` per axis that game code can poll like a gamepad stick.
 *
 * ```ts
 * const stickGO = scene.createGameObject("MoveStick");
 * const stick = stickGO.addComponent(VirtualJoystick);
 * stick.rectTransform.anchoredPosition = new Vector2(-200, -200);
 * // each frame:
 * const move = stick.value;
 * ```
 */
export class VirtualJoystick extends UIBehaviour {

    /** Outer ring color. */
    public baseColor: Color = new Color(0, 0, 0, 0.35);

    /** Inner stick color. */
    public stickColor: Color = new Color(1, 1, 1, 0.85);

    /** Ratio (0–1) of stick radius to joystick radius. */
    public stickRadiusRatio: number = 0.45;

    /** Deadzone (0–1 radial). Values below this magnitude are zeroed. */
    public deadzone: number = 0.1;

    /** Snap back to center when released. */
    public snapBackOnRelease: boolean = true;

    private readonly _value: Vector2 = new Vector2(0, 0);
    private _pressed: boolean = false;
    private _activeTouchId: number = -1;
    private _center: Vector2 = new Vector2(0, 0);
    private _stickPos: Vector2 = new Vector2(0, 0);

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Stick value, range `[-1, +1]` per axis. Read each frame from game code. */
    public get value(): Vector2 { return this._value; }

    /** Whether the joystick is currently being touched/clicked. */
    public get isPressed(): boolean { return this._pressed; }

    public override _draw(ctx: CanvasRenderingContext2D): void {
        const rect = this.rectTransform.screenRect;
        const cx = rect.x + rect.width  * 0.5;
        const cy = rect.y + rect.height * 0.5;
        const baseR = Math.min(rect.width, rect.height) * 0.5;
        const stickR = baseR * this.stickRadiusRatio;

        this._center.set(cx, cy);
        this._pollInput(cx, cy, baseR);

        // Base ring
        ctx.fillStyle = this._css(this.baseColor);
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.fill();

        // Stick
        ctx.fillStyle = this._css(this.stickColor);
        ctx.beginPath();
        ctx.arc(this._stickPos.x, this._stickPos.y, stickR, 0, Math.PI * 2);
        ctx.fill();
    }

    private _pollInput(cx: number, cy: number, baseR: number): void {
        const [px, py, active] = this._firstActivePointer(cx, cy, baseR);

        if (active) {
            let dx = px - cx;
            let dy = py - cy;
            const mag = Math.sqrt(dx * dx + dy * dy);
            if (mag > baseR) {
                dx *= baseR / mag;
                dy *= baseR / mag;
            }
            this._stickPos.set(cx + dx, cy + dy);

            let vx = dx / baseR;
            let vy = dy / baseR;
            const vm = Math.sqrt(vx * vx + vy * vy);
            if (vm < this.deadzone) {
                vx = 0; vy = 0;
            } else {
                const t = (vm - this.deadzone) / (1 - this.deadzone);
                const scale = Math.min(1, t) / vm;
                vx *= scale; vy *= scale;
            }
            this._value.set(vx, vy);
            this._pressed = true;
        } else {
            if (this.snapBackOnRelease) {
                this._stickPos.set(cx, cy);
                this._value.set(0, 0);
            }
            this._pressed = false;
            this._activeTouchId = -1;
        }
    }

    /** Finds the first pointer (touch or mouse) interacting with the base circle. */
    private _firstActivePointer(cx: number, cy: number, baseR: number): [number, number, boolean] {
        // If we already own a touch id, try to track it.
        if (this._activeTouchId !== -1) {
            const t = Touch.touches.find(x => x.id === this._activeTouchId);
            if (t && t.phase !== TouchPhase.Ended && t.phase !== TouchPhase.Canceled) {
                return [t.position.x, t.position.y, true];
            }
            this._activeTouchId = -1;
        }

        // New touch inside the base?
        for (const t of Touch.touches) {
            if (t.phase !== TouchPhase.Began) continue;
            const dx = t.position.x - cx;
            const dy = t.position.y - cy;
            if (dx * dx + dy * dy <= baseR * baseR) {
                this._activeTouchId = t.id;
                return [t.position.x, t.position.y, true];
            }
        }

        // Mouse fallback (desktop).
        if (Input.getMouseButton(0)) {
            const m = Input.mousePosition;
            const dx = m.x - cx;
            const dy = m.y - cy;
            if (dx * dx + dy * dy <= baseR * baseR || this._pressed) {
                return [m.x, m.y, true];
            }
        }

        return [0, 0, false];
    }

    private _css(c: Color): string {
        return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
    }
}
