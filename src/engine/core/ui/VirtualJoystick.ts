import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { Vector2 } from "../math/Vector2";
import { Input } from "../Input";
import { Touch, TouchPhase } from "../input/Touch";
import { EventSystem } from "./EventSystem";
import { Rect } from "../math/Rect";
import { HASH_SEED, cssColor, hashColor, hashNumber } from "./UIUtils";
import type { Canvas } from "./Canvas";
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
 * Pointer state is sampled by {@link EventSystem} during the UI input pass, not
 * while drawing — so the value is available even on a frame the canvas does not
 * repaint.
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
    private readonly _stickPos: Vector2 = new Vector2(0, 0);
    private _hasLayout: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** Stick value, range `[-1, +1]` per axis. Read each frame from game code. */
    public get value(): Vector2 { return this._value; }

    /** Whether the joystick is currently being touched/clicked. */
    public get isPressed(): boolean { return this._pressed; }

    protected override onEnable(): void {
        super.onEnable();
        EventSystem._registerJoystick(this);
    }

    protected override onDisable(): void {
        super.onDisable();
        EventSystem._unregisterJoystick(this);
        this._release();
    }

    protected override onDestroy(): void {
        super.onDestroy();
        EventSystem._unregisterJoystick(this);
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        const cx = rect.x + rect.width  * 0.5;
        const cy = rect.y + rect.height * 0.5;
        const baseR = Math.min(rect.width, rect.height) * 0.5;
        if (baseR <= 0) return;

        ctx.fillStyle = cssColor(this.baseColor);
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = cssColor(this.stickColor);
        ctx.beginPath();
        ctx.arc(this._stickPos.x, this._stickPos.y, baseR * this.stickRadiusRatio, 0, Math.PI * 2);
        ctx.fill();
    }

    public override _visualHash(): number {
        let h = hashColor(HASH_SEED, this.baseColor);
        h = hashColor(h, this.stickColor);
        h = hashNumber(h, this.stickRadiusRatio);
        h = hashNumber(h, this._stickPos.x);
        return hashNumber(h, this._stickPos.y);
    }

    /**
     * @internal
     * Samples touch/mouse state. Called once per frame by the EventSystem,
     * before the canvas repaints.
     */
    public _pollPointer(): void {
        const canvas = this.canvas;
        if (!canvas) return;

        // Layout is resolved here rather than at draw time so the stick keeps
        // tracking on frames where the canvas skips its repaint.
        const rect = this.rectTransform.getScreenRect(VirtualJoystick._scratch);
        const cx = rect.x + rect.width  * 0.5;
        const cy = rect.y + rect.height * 0.5;
        const baseR = Math.min(rect.width, rect.height) * 0.5;

        if (!this._hasLayout) {
            this._stickPos.set(cx, cy);
            this._hasLayout = true;
        }
        if (baseR <= 0) return;

        const active = this._firstActivePointer(canvas, cx, cy, baseR);
        if (!active) {
            this._release();
            if (this.snapBackOnRelease) this._stickPos.set(cx, cy);
            return;
        }

        let dx = VirtualJoystick._pointer.x - cx;
        let dy = VirtualJoystick._pointer.y - cy;
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
    }

    /**
     * @internal
     * The base is a circle, so the square layout rect would swallow pointer
     * events in its corners that the control never reacts to.
     */
    public override _hitTest(x: number, y: number, rect: Rect): boolean {
        const baseR = Math.min(rect.width, rect.height) * 0.5;
        if (baseR <= 0) return false;

        const dx = x - (rect.x + rect.width  * 0.5);
        const dy = y - (rect.y + rect.height * 0.5);
        return dx * dx + dy * dy <= baseR * baseR;
    }

    // ── private ──────────────────────────────────────────────────────

    /** Shared scratch, reused across joysticks — only live within one call. */
    private static readonly _scratch: Rect = new Rect();
    private static readonly _pointer: Vector2 = new Vector2(0, 0);

    private _release(): void {
        if (this.snapBackOnRelease) this._value.set(0, 0);
        this._pressed = false;
        this._activeTouchId = -1;
    }

    /**
     * Finds the pointer driving this joystick and writes it into
     * {@link VirtualJoystick._pointer} in canvas units.
     */
    private _firstActivePointer(canvas: Canvas, cx: number, cy: number, baseR: number): boolean {
        const out = VirtualJoystick._pointer;

        // Keep tracking the finger we already own, even outside the base.
        if (this._activeTouchId !== -1) {
            const t = Touch.touches.find(x => x.id === this._activeTouchId);
            if (t && t.phase !== TouchPhase.Ended && t.phase !== TouchPhase.Canceled) {
                canvas.screenToCanvasPoint(t.position, out);
                return true;
            }
            this._activeTouchId = -1;
        }

        for (const t of Touch.touches) {
            if (t.phase !== TouchPhase.Began) continue;
            canvas.screenToCanvasPoint(t.position, out);
            const dx = out.x - cx;
            const dy = out.y - cy;
            if (dx * dx + dy * dy <= baseR * baseR) {
                this._activeTouchId = t.id;
                return true;
            }
        }

        if (Input.getMouseButton(0)) {
            canvas.screenToCanvasPoint(Input.mousePosition, out);
            const dx = out.x - cx;
            const dy = out.y - cy;
            if (dx * dx + dy * dy <= baseR * baseR || this._pressed) return true;
        }

        return false;
    }
}
