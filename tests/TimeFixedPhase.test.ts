import { describe, test, expect, afterEach } from "vitest";
import { Time } from "../src/engine/core/Time";

/**
 * Unity: "Time.deltaTime — the interval in seconds from the last frame to the
 * current one. **When called from inside MonoBehaviour.FixedUpdate, returns
 * Time.fixedDeltaTime.**"
 *
 * The engine reported the frame delta everywhere, so code integrating inside
 * fixedUpdate used both the wrong step size and a step count the frame does
 * not imply — the fixed loop runs zero or more times per frame. Audit part 1,
 * finding F6.
 */

function setFrameDelta(dt: number): void {
    (Time as unknown as { _deltaTime: number })._deltaTime = dt;
}

afterEach(() => {
    Time._endFixedUpdate();
    setFrameDelta(0);
});

describe("Time.deltaTime — the fixed-phase rule", () => {
    test("outside the fixed phase it is the frame delta", () => {
        setFrameDelta(1 / 60);

        expect(Time.deltaTime).toBeCloseTo(1 / 60, 6);
    });

    test("inside the fixed phase it is the fixed step", () => {
        setFrameDelta(1 / 60);
        Time.fixedDeltaTime = 1 / 50;

        Time._beginFixedUpdate();

        expect(Time.deltaTime).toBeCloseTo(1 / 50, 6);
        expect(Time.deltaTime).not.toBeCloseTo(1 / 60, 6);
    });

    test("leaving the phase restores the frame delta", () => {
        setFrameDelta(1 / 60);
        Time._beginFixedUpdate();
        Time._endFixedUpdate();

        expect(Time.deltaTime).toBeCloseTo(1 / 60, 6);
    });

    test("unscaledDeltaTime is untouched by the phase", () => {
        // Only deltaTime carries the rule; the unscaled clock keeps meaning
        // real frame time, which is what a profiler reads.
        (Time as unknown as { _unscaledDeltaTime: number })._unscaledDeltaTime = 1 / 30;

        Time._beginFixedUpdate();

        expect(Time.unscaledDeltaTime).toBeCloseTo(1 / 30, 6);
    });

    test("fixedDeltaTime itself reads the same either way", () => {
        Time.fixedDeltaTime = 1 / 50;

        const outside = Time.fixedDeltaTime;
        Time._beginFixedUpdate();

        expect(Time.fixedDeltaTime).toBeCloseTo(outside, 6);
    });
});
