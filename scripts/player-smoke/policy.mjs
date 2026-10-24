// scripts/player-smoke/policy.mjs
// ============================================================
// The player's policy as DATA: CSP directives, the sandbox tokens (stated twice,
// as the `sandbox` attribute on the iframe and as a `sandbox` directive in the
// page's CSP header, which is what keeps a directly opened player opaque), and
// the iframe `allow` attribute.
//
// Held as data so that "remove each piece in turn and see what breaks" is a list
// edit rather than string surgery. The BASE policy is deliberately a SUPERSET of
// what the player needs: the dirty run (`--dirty`) removes every piece, and what
// no capability notices is not in the minimal policy documented in
// design/player-sandbox.md.
// ============================================================

/** The player's CSP for a given server origin. Names the origin; never `'self'` (WebKit does not match it for connect-src in an opaque document). */
export function basePolicy(origin) {
    return {
        csp: [
            ["default-src", ["'none'"]],
            ["script-src", [origin, "blob:", "'unsafe-eval'", "'wasm-unsafe-eval'"]],
            ["connect-src", [origin, "blob:"]],
            ["worker-src", ["blob:"]],
            ["img-src", ["blob:", "data:"]],
            ["media-src", ["blob:"]],
            ["style-src", ["'unsafe-inline'"]],
            ["font-src", ["data:"]],
            ["base-uri", ["'none'"]],
            ["form-action", ["'none'"]],
            ["frame-ancestors", ["'self'"]],
        ],
        sandbox: ["allow-scripts", "allow-pointer-lock"],
        allow: ["autoplay"],
    };
}

/** The `Content-Security-Policy` header value, `sandbox` included. */
export function cspHeader(policy) {
    const directives = policy.csp.map(([name, tokens]) => `${name} ${tokens.join(" ")}`.trim());
    if (policy.sandbox !== null) directives.push(`sandbox ${policy.sandbox.join(" ")}`.trim());
    return directives.join("; ");
}

/** The iframe's `sandbox` attribute: the header's tokens unless a control gives it its own, or null to omit it. */
export function sandboxAttribute(policy) {
    const tokens = policy.attr === undefined ? policy.sandbox : policy.attr;
    return tokens === null ? null : tokens.join(" ");
}

/** The iframe's `allow` attribute. */
export function allowAttribute(policy) {
    return policy.allow.join("; ");
}

const clone = policy => structuredClone(policy);

/** Policy with a CSP directive removed entirely. */
export function withoutDirective(policy, name) {
    const next = clone(policy);
    next.csp = next.csp.filter(([n]) => n !== name);
    return next;
}

/** Policy with one token removed from a CSP directive (the directive goes with its last token). */
export function withoutToken(policy, name, token) {
    const next = clone(policy);
    const entry = next.csp.find(([n]) => n === name);
    entry[1] = entry[1].filter(t => t !== token);
    if (entry[1].length === 0) return withoutDirective(next, name);
    return next;
}

/** Policy without the `sandbox` directive in the header; the iframe attribute keeps the tokens. */
export function withoutSandboxHeader(policy) {
    const next = clone(policy);
    next.attr = [...policy.sandbox];
    next.sandbox = null;
    return next;
}

/** Policy without the iframe `sandbox` attribute; the header keeps the tokens. */
export function withoutSandboxAttribute(policy) {
    const next = clone(policy);
    next.attr = null;
    return next;
}

/** Policy with a sandbox token removed from the header and the attribute. */
export function withoutSandbox(policy, token) {
    const next = clone(policy);
    next.sandbox = next.sandbox.filter(t => t !== token);
    return next;
}

/** Policy with an `allow` feature removed. */
export function withoutAllow(policy, feature) {
    const next = clone(policy);
    next.allow = next.allow.filter(f => f !== feature);
    return next;
}

/** Policy that says `'self'` where the base names the server's origin (the plan forbids it; WebKit is the reason). */
export function withSelfForOrigin(policy) {
    const origin = policy.csp.find(([name]) => name === "script-src")[1][0];
    const next = clone(policy);
    for (const entry of next.csp) entry[1] = entry[1].map(token => (token === origin ? "'self'" : token));
    return next;
}

/** Policy whose sandbox gains a token, on both sides or on the attribute alone. */
export function withSandbox(policy, token, where = "both") {
    const next = clone(policy);
    if (where === "attribute") next.attr = [...policy.sandbox, token];
    else next.sandbox = [...policy.sandbox, token];
    return next;
}

/**
 * Every single-piece removal of the base policy, plus negative controls.
 * @returns {{ id: string, label: string, policy: object, alsoStream?: boolean, control?: boolean, direct?: boolean, foreign?: boolean }[]}
 */
export function ablations(base) {
    const out = [];
    for (const [name, tokens] of base.csp) {
        out.push({ id: `-${name}`, label: `remove directive \`${name}\``, policy: withoutDirective(base, name), alsoStream: name === "connect-src", foreign: name === "frame-ancestors" });
        if (tokens.length > 1) {
            for (const token of tokens) {
                out.push({
                    id: `-${name}:${token}`, label: `remove \`${token}\` from \`${name}\``,
                    policy: withoutToken(base, name, token), alsoStream: name === "connect-src" || (name === "script-src" && token === tokens[0]),
                });
            }
        }
    }
    for (const token of base.sandbox) {
        out.push({ id: `-sandbox:${token}`, label: `remove sandbox token \`${token}\` (header and attribute)`, policy: withoutSandbox(base, token), direct: true });
    }
    out.push(
        { id: "-sandbox:header", label: "remove the `sandbox` directive from the header (attribute stays)", policy: withoutSandboxHeader(base), direct: true },
        { id: "-sandbox:attribute", label: "remove the iframe `sandbox` attribute (header stays)", policy: withoutSandboxAttribute(base) },
    );
    for (const feature of base.allow) {
        out.push({ id: `-allow:${feature}`, label: `remove \`allow="${feature}"\``, policy: withoutAllow(base, feature) });
    }
    out.push(
        { id: "~'self' for the origin", label: "NAME `'self'` instead of the origin in `script-src` and `connect-src`", policy: withSelfForOrigin(base), control: true, alsoStream: true },
        { id: "+sandbox:allow-same-origin(both)", label: "ADD `allow-same-origin` to header and attribute", policy: withSandbox(base, "allow-same-origin"), control: true, direct: true },
        { id: "+sandbox:allow-same-origin(attribute)", label: "ADD `allow-same-origin` to the attribute only", policy: withSandbox(base, "allow-same-origin", "attribute"), control: true, direct: true },
    );
    return out;
}

