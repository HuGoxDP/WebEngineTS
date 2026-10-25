// scripts/player-smoke/nginx-headers.mjs
// ============================================================
// Reads the headers out of the SHIPPED `player.nginx.conf`, so the smoke serves the
// player with exactly what the snippet says rather than with a copy that could drift
// from it. Understands only what the snippet uses: `location [=] <path> { ... }` blocks
// holding `add_header <Name> "<value>" [always];` lines, and the two variables
// `$scheme` and `$http_host`. Anything else in the file is ignored, so a directive the
// parser does not know cannot make the smoke pass by accident - it simply is not served.
// ============================================================

/** @returns {Record<string, Record<string, string>>} headers per exact location path */
export function parseNginxLocations(conf) {
    const text = conf.split(/\r?\n/).filter(line => !line.trimStart().startsWith("#")).join("\n");
    const locations = {};
    for (const [, path, body] of text.matchAll(/location\s+(?:=\s+)?(\S+)\s*\{([^}]*)\}/g)) {
        const headers = (locations[path] ??= {});
        for (const [, name, value] of body.matchAll(/add_header\s+(\S+)\s+"([^"]*)"(?:\s+always)?\s*;/g)) headers[name] = value;
    }
    return locations;
}

/** Replaces nginx's `$scheme` and `$http_host` the way nginx would for a request to `origin` (`http://127.0.0.1:1234`). */
export function expandVariables(value, origin) {
    const { protocol, host } = new URL(origin);
    return value.replaceAll("$scheme", protocol.slice(0, -1)).replaceAll("$http_host", host);
}

/** The headers nginx would send for `path` on a server reached at `origin`; empty if no location matches. */
export function headersFor(locations, path, origin) {
    return Object.fromEntries(Object.entries(locations[path] ?? {}).map(([name, value]) => [name, expandVariables(value, origin)]));
}
