import { Vector2 } from "../math/Vector2";

/**
 * Standard-mapped gamepad buttons (HTML5 Gamepad API standard layout).
 *
 * @remarks
 * Button indices match the W3C Standard Gamepad spec used by Chrome/Firefox.
 * XInput (Xbox) and DualShock pads are normalized to this layout.
 */
export enum GamepadButton {
    /** Bottom face button (Xbox A / PS Cross). */
    A = 0,
    /** Right face button (Xbox B / PS Circle). */
    B = 1,
    /** Left face button (Xbox X / PS Square). */
    X = 2,
    /** Top face button (Xbox Y / PS Triangle). */
    Y = 3,
    /** Top-left shoulder (L1 / LB). */
    LeftShoulder = 4,
    /** Top-right shoulder (R1 / RB). */
    RightShoulder = 5,
    /** Left trigger as digital button (L2 / LT). Use {@link GamepadState.leftTrigger} for analog. */
    LeftTrigger = 6,
    /** Right trigger as digital button (R2 / RT). */
    RightTrigger = 7,
    /** Back / Select / Share. */
    Select = 8,
    /** Start / Menu / Options. */
    Start = 9,
    /** Left stick pressed in (L3). */
    LeftStickClick = 10,
    /** Right stick pressed in (R3). */
    RightStickClick = 11,
    DPadUp = 12,
    DPadDown = 13,
    DPadLeft = 14,
    DPadRight = 15,
    /** Guide / Home (not always reported). */
    Home = 16,
}

const MAX_BUTTONS = 20;

/**
 * Snapshot of a single gamepad's state for the current frame.
 *
 * @remarks
 * Obtained via {@link Gamepad.get} / {@link Gamepad.current} / {@link Gamepad.all}.
 * State is updated once per frame by the engine; external code should only read.
 */
export class GamepadState {

    /** 0-based slot index this state corresponds to. */
    public readonly index: number;

    /** Whether a gamepad is currently connected in this slot. */
    public connected: boolean = false;

    /** Gamepad identifier string from the browser. */
    public id: string = "";

    /** @internal Current-frame button pressed states. */
    public readonly _pressed: boolean[] = new Array(MAX_BUTTONS).fill(false);

    /** @internal Current-frame analog button values (0–1, triggers mainly). */
    public readonly _values: number[] = new Array(MAX_BUTTONS).fill(0);

    /** @internal Previous-frame pressed states (for edge detection). */
    public readonly _prev: boolean[] = new Array(MAX_BUTTONS).fill(false);

    /** @internal Raw axis values, zero-filled so missing pads return 0. */
    public readonly _axes: number[] = new Array(8).fill(0);

    private readonly _leftStick = new Vector2(0, 0);
    private readonly _rightStick = new Vector2(0, 0);

    /** @internal */
    constructor(index: number) {
        this.index = index;
    }

    /** True while the button is held down. */
    public getButton(btn: GamepadButton): boolean {
        return this._pressed[btn] ?? false;
    }

    /** True for the one frame the button transitioned from released to pressed. */
    public getButtonDown(btn: GamepadButton): boolean {
        return (this._pressed[btn] ?? false) && !(this._prev[btn] ?? false);
    }

    /** True for the one frame the button transitioned from pressed to released. */
    public getButtonUp(btn: GamepadButton): boolean {
        return !(this._pressed[btn] ?? false) && (this._prev[btn] ?? false);
    }

    /** Analog value of a button (0–1). Useful for triggers. */
    public getButtonValue(btn: GamepadButton): number {
        return this._values[btn] ?? 0;
    }

    /**
     * Left analog stick direction (-1..1 per axis).
     * Returns a reused Vector2 — do not store the reference.
     */
    public get leftStick(): Vector2 {
        this._leftStick.set(this._axes[0] ?? 0, this._axes[1] ?? 0);
        return Gamepad._applyDeadzone(this._leftStick);
    }

    /** Right analog stick direction (-1..1 per axis). */
    public get rightStick(): Vector2 {
        this._rightStick.set(this._axes[2] ?? 0, this._axes[3] ?? 0);
        return Gamepad._applyDeadzone(this._rightStick);
    }

    /** Left trigger pressure (0–1). */
    public get leftTrigger(): number { return this._values[GamepadButton.LeftTrigger] ?? 0; }

    /** Right trigger pressure (0–1). */
    public get rightTrigger(): number { return this._values[GamepadButton.RightTrigger] ?? 0; }

    /** Raw axis array (0,1 = left stick X,Y; 2,3 = right stick X,Y). */
    public get axes(): readonly number[] { return this._axes; }
}

/**
 * Static interface to connected gamepads.
 *
 * @remarks
 * Polls `navigator.getGamepads()` once per frame from `Application._loop`.
 * Up to 4 pads are tracked by default. Buttons and axes are normalized to
 * the W3C Standard Gamepad layout.
 *
 * ```ts
 * const pad = Gamepad.current;
 * if (pad?.connected && pad.getButtonDown(GamepadButton.A)) {
 *     player.jump();
 * }
 * const move = pad?.leftStick ?? Vector2.zero;
 * ```
 */
export class Gamepad {

    private static readonly _MAX_PADS = 4;
    private static _states: GamepadState[] = [];
    private static _deadzone: number = 0.15;

    /**
     * Stick deadzone — values below this magnitude are zeroed out.
     * Applied radially to both analog sticks. Default `0.15`.
     */
    public static get deadzone(): number { return Gamepad._deadzone; }
    public static set deadzone(value: number) { Gamepad._deadzone = Math.max(0, Math.min(1, value)); }

    /** The first connected gamepad, or `null`. */
    public static get current(): GamepadState | null {
        for (const s of Gamepad._states) if (s.connected) return s;
        return null;
    }

    /** All 4 slots (connected or not). Use `.connected` to filter. */
    public static get all(): readonly GamepadState[] {
        Gamepad._ensureStates();
        return Gamepad._states;
    }

    /** Count of currently connected gamepads. */
    public static get count(): number {
        Gamepad._ensureStates();
        let n = 0;
        for (const s of Gamepad._states) if (s.connected) n++;
        return n;
    }

    /** Returns the state for slot `index` (0–3), or `null`. */
    public static get(index: number): GamepadState | null {
        Gamepad._ensureStates();
        return Gamepad._states[index] ?? null;
    }

    /**
     * @internal
     * Polls browser gamepads. Called once per frame from Application._loop
     * at the start of Update (before any user code reads input).
     */
    public static _update(): void {
        if (typeof navigator === "undefined" || !navigator.getGamepads) return;
        Gamepad._ensureStates();

        const pads = navigator.getGamepads();

        for (let i = 0; i < Gamepad._MAX_PADS; i++) {
            const state = Gamepad._states[i];
            const pad = pads[i];

            // Shift this frame → previous frame for edge detection.
            for (let b = 0; b < MAX_BUTTONS; b++) state._prev[b] = state._pressed[b];

            if (!pad) {
                state.connected = false;
                state.id = "";
                for (let b = 0; b < MAX_BUTTONS; b++) {
                    state._pressed[b] = false;
                    state._values[b] = 0;
                }
                for (let a = 0; a < state._axes.length; a++) state._axes[a] = 0;
                continue;
            }

            state.connected = pad.connected;
            state.id = pad.id;

            const btns = pad.buttons;
            const limit = Math.min(btns.length, MAX_BUTTONS);
            for (let b = 0; b < limit; b++) {
                state._pressed[b] = btns[b].pressed;
                state._values[b] = btns[b].value;
            }
            for (let b = limit; b < MAX_BUTTONS; b++) {
                state._pressed[b] = false;
                state._values[b] = 0;
            }

            const axes = pad.axes;
            const aLimit = Math.min(axes.length, state._axes.length);
            for (let a = 0; a < aLimit; a++) state._axes[a] = axes[a];
            for (let a = aLimit; a < state._axes.length; a++) state._axes[a] = 0;
        }
    }

    /** @internal Clears all gamepad state. */
    public static _reset(): void {
        Gamepad._states = [];
    }

    /** @internal Applies the radial deadzone to a stick vector in-place. */
    public static _applyDeadzone(v: Vector2): Vector2 {
        const mag = Math.sqrt(v.x * v.x + v.y * v.y);
        if (mag < Gamepad._deadzone) {
            v.set(0, 0);
        } else {
            // Rescale so that values just outside the deadzone start at 0.
            const t = (mag - Gamepad._deadzone) / (1 - Gamepad._deadzone);
            const scale = Math.min(1, t) / mag;
            v.set(v.x * scale, v.y * scale);
        }
        return v;
    }

    private static _ensureStates(): void {
        if (Gamepad._states.length === 0) {
            for (let i = 0; i < Gamepad._MAX_PADS; i++) {
                Gamepad._states.push(new GamepadState(i));
            }
        }
    }

    private constructor() {}
}
