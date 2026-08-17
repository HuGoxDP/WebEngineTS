import { describe, test, expect, afterEach } from "vitest";
import { ScriptableObject } from "../src/engine/core/ScriptableObject";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import { Color } from "../src/engine/core/math/Color";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";

/**
 * `ScriptableObject`'s constructor was `protected`, which is not assignable to
 * `new () => T` — so `ScriptableObject.create(Sub)` and `@Serializable` on any
 * subclass were both type errors. Every line of the class's own usage example
 * failed to compile, and nothing noticed, because the test suite was not
 * type-checked. Audit part 10, F70 (found by F69).
 *
 * The regression guard here is that this file *compiles*: `npm run typecheck`
 * now covers `tests/`. The assertions below are the runtime half.
 */

// Verbatim from the class docstring — the example is the test.
@Serializable({ typeName: "Test.F70.ExperimentSettings" })
class ExperimentSettings extends ScriptableObject {
    @SerializedField() public gravity = 9.81;
    @SerializedField() public sampleCount = 20;
    @SerializedField({ type: FieldType.Color }) public plotColor = new Color(1, 1, 1, 1);
}

afterEach(() => AssetDatabase.clear());

describe("A ScriptableObject subclass", () => {
    test("can be created through create(), which is what the docs show", () => {
        const settings = ScriptableObject.create(ExperimentSettings, "Earth");

        expect(settings).toBeInstanceOf(ExperimentSettings);
        expect(settings.name).toBe("Earth");
        expect(settings.gravity).toBeCloseTo(9.81);
    });

    test("can be created with plain new, which the docs also promise", () => {
        // "A plain `new` works too" — it did at runtime and not in TypeScript,
        // because a protected constructor is only reachable from inside the
        // class body.
        const settings = new ExperimentSettings();

        expect(settings.sampleCount).toBe(20);
    });

    test("carries the name of its class when none is given", () => {
        const settings = ScriptableObject.create(ExperimentSettings);

        expect(settings.name).toBe("ExperimentSettings");
    });

    test("the decorator that makes it serializable applies to it", () => {
        // @Serializable returns the constructor it was given, so applying it to
        // a class with a protected constructor was rejected outright: the
        // decorator's public return type cannot be assigned back to it.
        const settings = ScriptableObject.create(ExperimentSettings, "Mars");
        settings.gravity = 3.72;

        const json = settings.toJSON();

        expect(json.type).toBe("Test.F70.ExperimentSettings");
        expect(json.fields.gravity).toBeCloseTo(3.72);
    });

    test("round-trips through its JSON form", () => {
        const settings = ScriptableObject.create(ExperimentSettings, "Mars");
        settings.gravity = 3.72;
        settings.sampleCount = 5;
        settings.plotColor = new Color(1, 0, 0, 1);

        const back = ScriptableObject.fromJSON(settings.toJSON()) as ExperimentSettings;

        expect(back.name).toBe("Mars");
        expect(back.gravity).toBeCloseTo(3.72);
        expect(back.sampleCount).toBe(5);
        expect(back.plotColor.r).toBe(1);
    });

    test("nothing at runtime ever depended on the constructor's visibility", () => {
        // Worth stating plainly, since it is the whole argument for the change:
        // `protected` and `abstract` are both erased. Neither stops `new
        // ScriptableObject()` in JavaScript — `abstract` stops it in
        // TypeScript, which is the only place either of them exists, and it
        // was already doing so. What does guard at runtime is unchanged: an
        // undecorated class refuses to serialize.
        const base = ScriptableObject as unknown as new () => ScriptableObject;

        const loose = new base();

        expect(loose).toBeInstanceOf(ScriptableObject);
        expect(() => loose.toJSON()).toThrow(/@Serializable/);
    });
});
