import { describe, test, expect, afterEach } from "vitest";
import { InputField, InputFieldContentType } from "../src/engine/core/ui/InputField";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * Slider, Toggle, Dropdown and Scrollbar each offer a "without notify" setter,
 * and each documents why: a scenario echoing state back into the control would
 * drive its own listener in a loop. InputField was the one control in that
 * family without one. Audit part 7, F45.
 */

const made: GameObject[] = [];

function field(): InputField {
    const go = new GameObject("Field");
    made.push(go);
    go.addComponent(RectTransform).sizeDelta.set(200, 30);
    return go.addComponent(InputField);
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("InputField.setTextWithoutNotify", () => {
    test("stores the value", () => {
        const input = field();

        input.setTextWithoutNotify("hello");

        expect(input.text).toBe("hello");
    });

    test("does not raise onValueChanged", () => {
        const input = field();
        let changes = 0;
        input.onValueChanged.addListener(() => { changes++; });

        input.setTextWithoutNotify("hello");

        expect(changes).toBe(0);
    });

    test("assigning text still does raise it", () => {
        const input = field();
        const seen: string[] = [];
        input.onValueChanged.addListener(v => seen.push(v));

        input.text = "typed";

        expect(seen).toEqual(["typed"]);
    });

    test("filters the value the same way assigning does", () => {
        const input = field();
        input.contentType = InputFieldContentType.IntegerNumber;

        input.setTextWithoutNotify("12a3");

        expect(input.text).toBe(input.text.replace(/[^0-9-]/g, ""));
        expect(input.text).not.toContain("a");
    });

    test("honours the character limit", () => {
        const input = field();
        input.characterLimit = 3;

        input.setTextWithoutNotify("abcdef");

        expect(input.text).toBe("abc");
    });

    test("leaves the caret at the end, as assigning does", () => {
        const input = field();

        input.setTextWithoutNotify("abcd");

        expect(input.caretPosition).toBe(4);
    });

    test("a listener that writes back cannot loop", () => {
        // The reason the family exists: reflecting state into the control has
        // to be able to not come back out of it.
        const input = field();
        let calls = 0;
        input.onValueChanged.addListener(value => {
            calls++;
            input.setTextWithoutNotify(value.toUpperCase());
        });

        input.text = "abc";

        expect(calls).toBe(1);
        expect(input.text).toBe("ABC");
    });
});
