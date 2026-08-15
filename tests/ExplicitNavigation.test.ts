import { describe, test, expect, afterEach } from "vitest";
import { Button } from "../src/engine/core/ui/Button";
import { EventSystem } from "../src/engine/core/ui/EventSystem";
import { NavigationDirection, NavigationMode } from "../src/engine/core/ui/Navigation";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * An explicit navigation link is a reference a scenario set once, and the
 * control it names can since have been destroyed or switched off. The automatic
 * search cannot hit that — it walks the EventSystem's registry, which enable
 * and destroy maintain — but the explicit path took the reference as given and
 * moved focus onto a control that was gone. Audit part 7, F46.
 */

const made: GameObject[] = [];

function button(name: string): Button {
    const go = new GameObject(name);
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(80, 24);
    return go.addComponent(Button);
}

/** `from` navigates right to `to`, explicitly. */
function link(from: Button, to: Button): void {
    from.navigation.mode = NavigationMode.Explicit;
    from.navigation.selectOnRight = to;
}

afterEach(() => {
    EventSystem._reset();
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("An explicit navigation link", () => {
    test("moves focus to a healthy target", () => {
        const from = button("From");
        const to = button("To");
        link(from, to);
        from.select();

        expect(from.navigate(NavigationDirection.Right)).toBe(true);
        expect(EventSystem.currentSelected).toBe(to);
    });

    test("is not followed to a destroyed control", () => {
        const from = button("From");
        const to = button("To");
        link(from, to);
        from.select();

        to.gameObject.destroyImmediate();

        expect(from.navigate(NavigationDirection.Right)).toBe(false);
        expect(EventSystem.currentSelected).toBe(from);
    });

    test("is not followed to a deactivated control", () => {
        const from = button("From");
        const to = button("To");
        link(from, to);
        from.select();

        to.gameObject.setActive(false);

        expect(from.navigate(NavigationDirection.Right)).toBe(false);
        expect(EventSystem.currentSelected).toBe(from);
    });

    test("is not followed to a disabled component", () => {
        const from = button("From");
        const to = button("To");
        link(from, to);
        from.select();

        to.enabled = false;

        expect(from.navigate(NavigationDirection.Right)).toBe(false);
    });

    test("is not followed to a non-interactable control", () => {
        // Already true before this fix; kept so the pair stays a pair.
        const from = button("From");
        const to = button("To");
        link(from, to);

        to.interactable = false;

        expect(from.navigate(NavigationDirection.Right)).toBe(false);
    });

    test("works again once the target comes back", () => {
        const from = button("From");
        const to = button("To");
        link(from, to);
        to.gameObject.setActive(false);
        expect(from.navigate(NavigationDirection.Right)).toBe(false);

        to.gameObject.setActive(true);

        expect(from.navigate(NavigationDirection.Right)).toBe(true);
        expect(EventSystem.currentSelected).toBe(to);
    });
});
