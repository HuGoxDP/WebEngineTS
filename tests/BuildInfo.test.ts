import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BuildInfo } from "../src/engine/core/BuildInfo";
import { Application } from "../src/engine/core/Application";

/**
 * These run against the *sources*, so they see an unstamped BuildInfo — which
 * is the case worth pinning down, because it is the one that must not pretend
 * to be a build. That stamping itself works is checked by the build: the
 * rollup plugin fails the build when it cannot find the placeholders.
 */

describe("BuildInfo — running from source", () => {
    test("it says so rather than claiming a version it does not have", () => {
        expect(BuildInfo.isBuild).toBe(false);
        expect(BuildInfo.version).toBe("0.0.0-source");
        expect(BuildInfo.builtAt).toBeNull();
    });

    test("no placeholder leaks into the reported values", () => {
        // An unstamped build reporting "__WEBENGINE_VERSION__" would be worse
        // than one reporting nothing: it looks like a version.
        expect(BuildInfo.version).not.toContain("__WEBENGINE");
    });

    test("it cannot be rewritten by a host", () => {
        expect(Object.isFrozen(BuildInfo)).toBe(true);
    });

    test("Application.version is the same value, not a second copy", () => {
        // The hardcoded literal it replaced was free to drift from package.json.
        expect(Application.version).toBe(BuildInfo.version);
        expect(Application.buildInfo).toBe(BuildInfo);
    });
});

describe("BuildInfo — the contract the build plugin depends on", () => {
    const source = readFileSync(
        new URL("../src/engine/core/BuildInfo.ts", import.meta.url),
        "utf8",
    );

    test.each([
        ['"__WEBENGINE_VERSION__"'],
        ['"__WEBENGINE_BUILT_AT__"'],
    ])("%s appears exactly once", (token) => {
        // `stamp-build-info` replaces the first occurrence only, and checks
        // presence but not count — a second one would silently stay unstamped
        // and the bundle would carry a placeholder as a real value.
        const occurrences = source.split(token).length - 1;
        expect(occurrences).toBe(1);
    });

    test("the stamped-ness test matches a prefix, not a whole token", () => {
        // Comparing against the whole token would make the check itself a third
        // occurrence, and stamping would rewrite the comparison too.
        expect(source).toContain('startsWith("__WEBENGINE_")');
    });
});
