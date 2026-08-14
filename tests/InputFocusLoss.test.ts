import { describe, test, expect, afterEach } from "vitest";
import { Input } from "../src/engine/core/Input";
import { KeyCode } from "../src/engine/core/KeyCode";

/**
 * A browser delivers keydown and then no keyup when the window loses focus,
 * and no mouseup when a button is released outside the canvas. Held state was
 * therefore stuck for the rest of the session — the classic "character keeps
 * walking after Alt-Tab". Audit part 1, finding F8.
 *
 * The listeners are wired in _init, which needs a canvas; these drive
 * _clearHeldState directly, which is what both handlers call.
 */

function press(code: string): void {
    (Input as unknown as { _currentKeys: Set<string> })._currentKeys.add(code);
}

function holdMouse(button: number): void {
    (Input as unknown as { _mouseButtons: boolean[] })._mouseButtons[button] = true;
}

afterEach(() => {
    Input._clearHeldState();
    Input._resetFrame();
});

describe("Input — focus loss releases what is held", () => {
    test("a key held across focus loss is no longer down", () => {
        press(KeyCode.W);
        expect(Input.getKey(KeyCode.W)).toBe(true);

        Input._clearHeldState();

        expect(Input.getKey(KeyCode.W)).toBe(false);
    });

    test("a mouse button released off-canvas is no longer down", () => {
        holdMouse(0);
        expect(Input.getMouseButton(0)).toBe(true);

        Input._clearHeldState();

        expect(Input.getMouseButton(0)).toBe(false);
    });

    test("every button is cleared, not just the first", () => {
        holdMouse(0); holdMouse(1); holdMouse(2);

        Input._clearHeldState();

        expect(Input.getMouseButton(0)).toBe(false);
        expect(Input.getMouseButton(1)).toBe(false);
        expect(Input.getMouseButton(2)).toBe(false);
    });

    test("no synthetic release is raised", () => {
        // Polling reports the truth at once; code waiting for a *release* is
        // not handed one the user never performed.
        press(KeyCode.Space);

        Input._clearHeldState();

        expect(Input.getKeyUp(KeyCode.Space)).toBe(false);
        expect(Input.anyKey).toBe(false);
    });

    test("input works again after focus returns", () => {
        press(KeyCode.A);
        Input._clearHeldState();

        press(KeyCode.A);

        expect(Input.getKey(KeyCode.A)).toBe(true);
    });
});
