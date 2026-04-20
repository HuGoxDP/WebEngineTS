import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Gamepad, GamepadButton } from "../src/engine/core/input/Gamepad";

interface MockButton { pressed: boolean; value: number; }

function makePad(opts: {
    connected?: boolean;
    id?: string;
    buttons?: MockButton[];
    axes?: number[];
}): any {
    return {
        connected: opts.connected ?? true,
        id: opts.id ?? "Mock Gamepad",
        buttons: opts.buttons ?? [],
        axes: opts.axes ?? [0, 0, 0, 0],
    };
}

let _mockPads: (ReturnType<typeof makePad> | null)[] = [null, null, null, null];
function setPads(...pads: (ReturnType<typeof makePad> | null)[]): void {
    _mockPads = [null, null, null, null];
    for (let i = 0; i < pads.length && i < 4; i++) _mockPads[i] = pads[i];
}

describe("Gamepad", () => {
    beforeEach(() => {
        Gamepad._reset();
        setPads();
        vi.stubGlobal("navigator", { getGamepads: () => _mockPads });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("no pads connected → current is null, count is 0", () => {
        Gamepad._update();
        expect(Gamepad.current).toBe(null);
        expect(Gamepad.count).toBe(0);
    });

    test("one pad connected → current is non-null", () => {
        setPads(makePad({ buttons: [{ pressed: false, value: 0 }] }));
        Gamepad._update();
        expect(Gamepad.current).not.toBe(null);
        expect(Gamepad.current!.connected).toBe(true);
        expect(Gamepad.count).toBe(1);
    });

    test("getButton reports current pressed state", () => {
        setPads(makePad({ buttons: [{ pressed: true, value: 1 }] }));
        Gamepad._update();
        expect(Gamepad.current!.getButton(GamepadButton.A)).toBe(true);
        expect(Gamepad.current!.getButton(GamepadButton.B)).toBe(false);
    });

    test("getButtonDown fires only on rising edge", () => {
        const btn: MockButton = { pressed: false, value: 0 };
        setPads(makePad({ buttons: [btn] }));

        Gamepad._update();
        expect(Gamepad.current!.getButtonDown(GamepadButton.A)).toBe(false);

        btn.pressed = true;
        Gamepad._update();
        expect(Gamepad.current!.getButtonDown(GamepadButton.A)).toBe(true);

        Gamepad._update();
        expect(Gamepad.current!.getButtonDown(GamepadButton.A)).toBe(false);
    });

    test("getButtonUp fires only on falling edge", () => {
        const btn: MockButton = { pressed: true, value: 1 };
        setPads(makePad({ buttons: [btn] }));

        Gamepad._update();
        expect(Gamepad.current!.getButtonUp(GamepadButton.A)).toBe(false);

        btn.pressed = false;
        Gamepad._update();
        expect(Gamepad.current!.getButtonUp(GamepadButton.A)).toBe(true);

        Gamepad._update();
        expect(Gamepad.current!.getButtonUp(GamepadButton.A)).toBe(false);
    });

    test("leftStick applies deadzone", () => {
        Gamepad.deadzone = 0.15;
        setPads(makePad({ axes: [0.05, 0.05, 0, 0] }));
        Gamepad._update();
        const s = Gamepad.current!.leftStick;
        expect(s.x).toBe(0);
        expect(s.y).toBe(0);
    });

    test("leftStick returns rescaled values above deadzone", () => {
        Gamepad.deadzone = 0.1;
        setPads(makePad({ axes: [1, 0, 0, 0] }));
        Gamepad._update();
        const s = Gamepad.current!.leftStick;
        expect(s.x).toBeCloseTo(1, 3);
        expect(s.y).toBe(0);
    });

    test("rightStick reads axes 2,3", () => {
        Gamepad.deadzone = 0;
        setPads(makePad({ axes: [0, 0, 0.5, -0.5] }));
        Gamepad._update();
        const s = Gamepad.current!.rightStick;
        expect(s.x).toBeCloseTo(0.5);
        expect(s.y).toBeCloseTo(-0.5);
    });

    test("leftTrigger / rightTrigger return analog values", () => {
        const buttons: MockButton[] = new Array(10).fill(null).map(() => ({ pressed: false, value: 0 }));
        buttons[GamepadButton.LeftTrigger]  = { pressed: true, value: 0.75 };
        buttons[GamepadButton.RightTrigger] = { pressed: false, value: 0.3 };
        setPads(makePad({ buttons }));
        Gamepad._update();
        expect(Gamepad.current!.leftTrigger).toBeCloseTo(0.75);
        expect(Gamepad.current!.rightTrigger).toBeCloseTo(0.3);
    });

    test("deadzone setter clamps to [0, 1]", () => {
        Gamepad.deadzone = -1;
        expect(Gamepad.deadzone).toBe(0);
        Gamepad.deadzone = 2;
        expect(Gamepad.deadzone).toBe(1);
        Gamepad.deadzone = 0.2;
        expect(Gamepad.deadzone).toBeCloseTo(0.2);
    });

    test("disconnect clears state", () => {
        setPads(makePad({ buttons: [{ pressed: true, value: 1 }] }));
        Gamepad._update();
        expect(Gamepad.current!.getButton(GamepadButton.A)).toBe(true);

        setPads();
        Gamepad._update();
        expect(Gamepad.current).toBe(null);
        const s = Gamepad.get(0)!;
        expect(s.connected).toBe(false);
        expect(s.getButton(GamepadButton.A)).toBe(false);
    });

    test("count reflects multiple pads", () => {
        setPads(makePad({}), makePad({}));
        Gamepad._update();
        expect(Gamepad.count).toBe(2);
    });

    test("GamepadButton enum covers standard layout", () => {
        expect(GamepadButton.A).toBe(0);
        expect(GamepadButton.DPadUp).toBe(12);
        expect(GamepadButton.DPadRight).toBe(15);
    });
});
