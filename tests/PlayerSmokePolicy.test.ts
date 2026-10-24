// tests/PlayerSmokePolicy.test.ts
// ============================================================
// scripts/player-smoke/policy.mjs holds the player's CSP and sandbox tokens as
// data, so the smoke's dirty run can remove one piece at a time. The dirty run is
// only evidence if each removal removes exactly the piece it names and leaves the
// rest intact, and if the base policy is never edited in place. That is what
// these tests pin (Phase 1 of the player-isolation plan, DW-1.2).
// ============================================================

import { describe, expect, test } from "vitest";
import {
    ablations, allowAttribute, basePolicy, cspHeader, sandboxAttribute, withSandbox, withSelfForOrigin,
    withoutAllow, withoutDirective, withoutSandbox, withoutSandboxAttribute, withoutSandboxHeader, withoutToken,
} from "../scripts/player-smoke/policy.mjs";

const ORIGIN = "http://127.0.0.1:8080";
const base = () => basePolicy(ORIGIN);
const directive = (header: string, name: string) => header.split("; ").find(d => d.startsWith(`${name} `));

describe("cspHeader", () => {
    test("names the origin explicitly and never uses 'self' for script or connect sources", () => {
        const header = cspHeader(base());

        expect(directive(header, "script-src")).toContain(ORIGIN);
        expect(directive(header, "connect-src")).toContain(ORIGIN);
        expect(directive(header, "script-src")).not.toContain("'self'");
        expect(directive(header, "connect-src")).not.toContain("'self'");
    });

    test("is deny-by-default, frame-ancestors 'self', and ends with the sandbox directive", () => {
        const header = cspHeader(base());

        expect(header.startsWith("default-src 'none'; ")).toBe(true);
        expect(directive(header, "frame-ancestors")).toBe("frame-ancestors 'self'");
        expect(header.endsWith("; sandbox allow-scripts allow-pointer-lock")).toBe(true);
    });

    test("never grants allow-same-origin", () => {
        expect(cspHeader(base())).not.toContain("allow-same-origin");
        expect(sandboxAttribute(base())).not.toContain("allow-same-origin");
    });
});

describe("attributes", () => {
    test("the iframe sandbox attribute is the header's tokens, and allow is joined with semicolons", () => {
        expect(sandboxAttribute(base())).toBe("allow-scripts allow-pointer-lock");
        expect(allowAttribute({ ...base(), allow: ["autoplay", "fullscreen"] })).toBe("autoplay; fullscreen");
    });
});

describe("removals", () => {
    test("withoutDirective drops that directive and only that one", () => {
        const next = withoutDirective(base(), "img-src");

        expect(next.csp.map(([name]) => name)).toEqual(base().csp.map(([name]) => name).filter(name => name !== "img-src"));
        expect(next.sandbox).toEqual(base().sandbox);
    });

    test("withoutToken drops one token and keeps the directive while tokens remain", () => {
        const next = withoutToken(base(), "script-src", "blob:");

        expect(directive(cspHeader(next), "script-src")).toBe(`script-src ${ORIGIN} 'unsafe-eval' 'wasm-unsafe-eval'`);
    });

    test("withoutToken on a directive's last token removes the directive, which would otherwise be empty and meaningless", () => {
        const next = withoutToken(base(), "style-src", "'unsafe-inline'");

        expect(directive(cspHeader(next), "style-src")).toBeUndefined();
    });

    test("withoutSandbox removes the token from the header and the attribute together", () => {
        const next = withoutSandbox(base(), "allow-pointer-lock");

        expect(cspHeader(next).endsWith("sandbox allow-scripts")).toBe(true);
        expect(sandboxAttribute(next)).toBe("allow-scripts");
    });

    test("withoutSandboxHeader keeps the attribute's tokens and drops the directive", () => {
        const next = withoutSandboxHeader(base());

        expect(cspHeader(next)).not.toContain("sandbox");
        expect(sandboxAttribute(next)).toBe("allow-scripts allow-pointer-lock");
    });

    test("withoutSandboxAttribute omits the attribute and keeps the header", () => {
        const next = withoutSandboxAttribute(base());

        expect(sandboxAttribute(next)).toBeNull();
        expect(cspHeader(next)).toContain("sandbox allow-scripts allow-pointer-lock");
    });

    test("withoutAllow removes the feature", () => {
        expect(allowAttribute(withoutAllow(base(), "autoplay"))).toBe("");
    });

    test("no removal edits the base policy in place", () => {
        const policy = base();
        const before = JSON.stringify(policy);

        ablations(policy);
        withoutDirective(policy, "default-src");
        withoutSandbox(policy, "allow-scripts");
        withSandbox(policy, "allow-same-origin");

        expect(JSON.stringify(policy)).toBe(before);
    });
});

describe("controls", () => {
    test("withSandbox adds the token to both sides, or to the attribute alone", () => {
        const both = withSandbox(base(), "allow-same-origin");
        const attributeOnly = withSandbox(base(), "allow-same-origin", "attribute");

        expect(cspHeader(both)).toContain("allow-same-origin");
        expect(sandboxAttribute(both)).toContain("allow-same-origin");
        expect(cspHeader(attributeOnly)).not.toContain("allow-same-origin");
        expect(sandboxAttribute(attributeOnly)).toContain("allow-same-origin");
    });

    test("withSelfForOrigin swaps the origin for 'self' in every directive that named it", () => {
        const header = cspHeader(withSelfForOrigin(base()));

        expect(header).not.toContain(ORIGIN);
        expect(directive(header, "script-src")).toContain("'self'");
        expect(directive(header, "connect-src")).toContain("'self'");
    });
});

describe("ablations", () => {
    const all = ablations(base());
    const ids = all.map(a => a.id);

    test("has a removal for every directive and every token of a multi-token directive", () => {
        for (const [name, tokens] of base().csp) {
            expect(ids).toContain(`-${name}`);
            if (tokens.length > 1) for (const token of tokens) expect(ids).toContain(`-${name}:${token}`);
        }
    });

    test("covers each sandbox token, the header and attribute separately, and the allow feature", () => {
        expect(ids).toEqual(expect.arrayContaining([
            "-sandbox:allow-scripts", "-sandbox:allow-pointer-lock", "-sandbox:header", "-sandbox:attribute", "-allow:autoplay",
        ]));
    });

    test("every ablation differs from the base and has a unique id", () => {
        expect(new Set(ids).size).toBe(ids.length);
        for (const a of all) expect(JSON.stringify(a.policy)).not.toBe(JSON.stringify(base()));
    });

    test("only the sandbox-affecting ablations ask for a top-level open, and only frame-ancestors for a foreign embed", () => {
        expect(all.filter(a => a.direct).every(a => a.id.includes("sandbox"))).toBe(true);
        expect(all.filter(a => a.foreign).map(a => a.id)).toEqual(["-frame-ancestors"]);
    });

    test("controls are marked, so their results are read as a hardening check and not as a removal", () => {
        expect(all.filter(a => a.control).map(a => a.id).sort()).toEqual([
            "+sandbox:allow-same-origin(attribute)", "+sandbox:allow-same-origin(both)", "~'self' for the origin",
        ]);
    });
});
