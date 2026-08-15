import { describe, test, expect, afterEach } from "vitest";
import { EventSystem } from "../src/engine/core/ui/EventSystem";
import { PointerEventData } from "../src/engine/core/ui/PointerEventData";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";
import type { UIBehaviour } from "../src/engine/core/ui/UIBehaviour";

/**
 * A release delivers Up and then Click. Up is user code, and the ordinary thing
 * for it to do is close what was pressed — a dialog dismissing itself, a button
 * disabling itself against a double submit. The Click went out anyway, to a
 * component that was by then destroyed or switched off. Audit part 6, F42.
 */

const made: GameObject[] = [];

/** The private release path, which is where the ordering lives. */
type Internals = {
    _stateFor(id: number): { pressedGraphic: UIBehaviour | null; dragTarget: UIBehaviour | null };
    _release(state: unknown, hit: UIBehaviour | null, data: PointerEventData): void;
};

const internals = EventSystem as unknown as Internals;

function button(name = "Btn"): UIImage {
    const go = new GameObject(name);
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(50, 50);
    return go.addComponent(UIImage);
}

/** Presses and releases `target`, as the pointer plumbing would. */
function release(target: UIImage): void {
    const state = internals._stateFor(7);
    state.pressedGraphic = target;
    state.dragTarget = null;
    internals._release(state, target, new PointerEventData());
}

afterEach(() => {
    EventSystem._reset();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("The click that follows a pointer up", () => {
    test("is not delivered when Up destroyed the element", () => {
        const btn = button();
        let clicks = 0;
        btn.onPointerUp.addListener(() => btn.gameObject.destroyImmediate());
        btn.onPointerClick.addListener(() => { clicks++; });

        release(btn);

        expect(clicks).toBe(0);
    });

    test("is not delivered when Up disabled the element", () => {
        const btn = button();
        let clicks = 0;
        btn.onPointerUp.addListener(() => { btn.enabled = false; });
        btn.onPointerClick.addListener(() => { clicks++; });

        release(btn);

        expect(clicks).toBe(0);
    });

    test("is not delivered when Up deactivated the GameObject", () => {
        const btn = button();
        let clicks = 0;
        btn.onPointerUp.addListener(() => btn.gameObject.setActive(false));
        btn.onPointerClick.addListener(() => { clicks++; });

        release(btn);

        expect(clicks).toBe(0);
    });

    test("still arrives in the ordinary case", () => {
        const btn = button();
        const order: string[] = [];
        btn.onPointerUp.addListener(() => order.push("up"));
        btn.onPointerClick.addListener(() => order.push("click"));

        release(btn);

        expect(order).toEqual(["up", "click"]);
    });

    test("Up itself still runs before anything is checked", () => {
        // The guard is between the two, not before both: a control must always
        // hear that the press it is holding ended.
        const btn = button();
        let ups = 0;
        btn.onPointerUp.addListener(() => { ups++; btn.gameObject.destroyImmediate(); });

        release(btn);

        expect(ups).toBe(1);
    });

    test("releasing over something else was never a click anyway", () => {
        const pressed = button("Pressed");
        const other = button("Other");
        let clicks = 0;
        pressed.onPointerClick.addListener(() => { clicks++; });

        const state = internals._stateFor(7);
        state.pressedGraphic = pressed;
        state.dragTarget = null;
        internals._release(state, other, new PointerEventData());

        expect(clicks).toBe(0);
    });
});
