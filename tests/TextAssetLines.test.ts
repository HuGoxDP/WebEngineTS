import { describe, test, expect } from "vitest";
import { TextAsset } from "../src/engine/core/assets/AssetTypes";

/**
 * `.txt` and `.csv` decode to TextAsset, and scenario content is authored on
 * Windows. Splitting on "\n" alone left a carriage return on the end of every
 * line, so a comparison against the value in the file failed. Audit part 4, F18.
 */

describe("TextAsset.lines", () => {
    test("does not leave a carriage return on Windows line endings", () => {
        const asset = new TextAsset("id,name\r\n1,Earth\r\n2,Mars");

        expect(asset.lines).toEqual(["id,name", "1,Earth", "2,Mars"]);
    });

    test("splits Unix line endings as before", () => {
        const asset = new TextAsset("alpha\nbeta\ngamma");

        expect(asset.lines).toEqual(["alpha", "beta", "gamma"]);
    });

    test("splits a lone carriage return", () => {
        const asset = new TextAsset("alpha\rbeta");

        expect(asset.lines).toEqual(["alpha", "beta"]);
    });

    test("a trailing newline still yields a final empty line", () => {
        // Documented, and left alone: dropping it would make the count depend on
        // whether the author's editor ends files with a newline.
        expect(new TextAsset("a\r\nb\r\n").lines).toEqual(["a", "b", ""]);
    });

    test("text with no line break is a single line", () => {
        expect(new TextAsset("only").lines).toEqual(["only"]);
        expect(new TextAsset("").lines).toEqual([""]);
    });
});
