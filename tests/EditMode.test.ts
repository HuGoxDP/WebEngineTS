import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Application } from "../src/engine/core/Application";
import { Time } from "../src/engine/core/Time";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import {
    Serializable,
    ExecuteAlways,
    ExecuteInEditMode,
    _executesInEditMode,
} from "../src/engine/core/reflection/Decorators";
import type { AnyConstructor } from "../src/engine/core/reflection/TypeRegistry";

/**
 * C2 Phase 1: the mode exists, can be switched and read, and classes can opt
 * in — nothing consults it yet (the gate is Phase 2). Play mode is the
 * default, so a host that never switches is unaffected.
 */

afterEach(() => {
    // Every test starts from a known mode, whatever a failing test left.
    Application.enterPlayMode();
});

describe("the play-mode flag", () => {
    test("play mode is the default, with no Application constructed", () => {
        expect(Application.isPlaying).toBe(true);
    });

    test("entering and leaving edit mode flips it", () => {
        Application.enterEditMode();
        expect(Application.isPlaying).toBe(false);
        Application.enterPlayMode();
        expect(Application.isPlaying).toBe(true);
    });

    test("switching to the mode already in does nothing — the clock is untouched", () => {
        Application.enterEditMode();
        Application.enterPlayMode();
        const frameCount = Time.frameCount;
        Application.enterPlayMode();
        expect(Time.frameCount).toBe(frameCount);
        Application.enterEditMode();
        Application.enterEditMode();
        expect(Time.frameCount).toBe(frameCount);
    });

    test("entering play mode from edit mode resets the clock", () => {
        Application.enterEditMode();
        Time.timeScale = 0.5;
        Time._update(16);                    // the clock runs in edit mode too
        expect(Time.time).toBeGreaterThan(0);

        Application.enterPlayMode();

        expect(Time.timeScale).toBe(1);
        expect(Time.time).toBe(0);
    });
});

describe("the edit-mode opt-in decorators", () => {

    @Serializable({ typeName: "EditModeSpec.Always" })
    @ExecuteAlways()
    class AlwaysRunner extends ScriptableBehaviour {}

    @Serializable({ typeName: "EditModeSpec.InEditMode" })
    @ExecuteInEditMode()
    class InEditModeRunner extends ScriptableBehaviour {}

    @Serializable({ typeName: "EditModeSpec.Plain" })
    class PlainRunner extends ScriptableBehaviour {}

    @Serializable({ typeName: "EditModeSpec.Subclass" })
    class SubclassRunner extends AlwaysRunner {}

    test("both decorators opt the class in, and nothing else is opted in", () => {
        expect(_executesInEditMode(AlwaysRunner)).toBe(true);
        expect(_executesInEditMode(InEditModeRunner)).toBe(true);
        expect(_executesInEditMode(PlainRunner)).toBe(false);
    });

    test("a subclass does not inherit the opt-in, and a decorated base does not opt its subclass in", () => {
        expect(_executesInEditMode(SubclassRunner)).toBe(false);
        // The base itself stays opted in whatever the subclass does.
        expect(_executesInEditMode(AlwaysRunner)).toBe(true);
    });

    test("an instance is asked about its own class", () => {
        const plain = new GameObject("Holder").addComponent(PlainRunner);
        expect(_executesInEditMode(plain.constructor as AnyConstructor)).toBe(false);
        const always = new GameObject("Holder2").addComponent(AlwaysRunner);
        expect(_executesInEditMode(always.constructor as AnyConstructor)).toBe(true);
    });
});
