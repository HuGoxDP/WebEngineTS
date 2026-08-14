import { describe, test, expect } from "vitest";
import { Material } from "../src/engine/core/graphics/Material";
import { StandardMaterial } from "../src/engine/core/graphics/StandardMaterial";
import { Color } from "../src/engine/core/math/Color";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Vector4 } from "../src/engine/core/math/Vector4";

/**
 * `Color.white`, `Vector3.zero` and friends are shared instances — their own
 * JSDoc says "do not mutate". Sixteen public getters across the engine handed
 * one straight back on their miss path, while cloning on the hit path. So the
 * read-modify-write the engine's own docs teach —
 *
 *     const c = material.color; c.r = 0.5; material.color = c;
 *
 * — corrupted the global constant when the property happened to be unset, and
 * every later reader of Color.white saw the change. Audit part 2, finding F10.
 */

describe("Shared math constants never escape through a getter", () => {
    test("an unset colour does not hand out the global white", () => {
        const material = new Material(new StandardMaterial().shader);

        const c = material.getColor("_NeverSet");

        expect(c).not.toBe(Color.white);
        expect(c.r).toBe(Color.white.r);
    });

    test("mutating what a getter returned leaves the constant alone", () => {
        const material = new Material(new StandardMaterial().shader);
        const before = Color.white.r;

        const c = material.getColor("_NeverSet");
        c.r = 0.25;

        expect(Color.white.r).toBe(before);
    });

    test("the same holds for vectors and matrices", () => {
        const material = new Material(new StandardMaterial().shader);

        expect(material.getVector("_NeverSet")).not.toBe(Vector4.zero);
        expect(material.getTextureOffset("_NeverSet")).not.toBe(Vector2.zero);
        expect(material.getTextureScale("_NeverSet")).not.toBe(Vector2.one);
    });

    test("two reads of an unset property are independent", () => {
        // They used to be the same object, so writing through one changed the
        // other — the surprise that makes this class of bug hard to trace.
        const material = new Material(new StandardMaterial().shader);

        const a = material.getColor("_NeverSet");
        const b = material.getColor("_NeverSet");
        a.g = 0.1;

        expect(b.g).not.toBe(0.1);
    });

    test("the documented read-modify-write round-trips", () => {
        const material = new Material(new StandardMaterial().shader);

        const c = material.color;
        c.r = 0.5;
        material.color = c;

        expect(material.color.r).toBeCloseTo(0.5, 6);
        expect(Color.white.r).toBe(1);
    });
});
