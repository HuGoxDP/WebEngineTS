// tests/PlayerShippedFiles.test.ts
// ============================================================
// The static files the engine ships for the player, and the smoke's reading of them.
//
// player.nginx.conf is what a consumer includes in their server. The tests parse the REAL file (comments stripped,
// like nginx) and hold it to the plan: every player header present, `ACAO: *` on player.html and player.js, the
// CSP naming the origin and never 'self', and the sandbox tokens identical to the ones PlayerHost puts on the
// iframe - so the header and the attribute cannot drift apart.
// ============================================================

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { expandVariables, headersFor, parseNginxLocations } from "../scripts/player-smoke/nginx-headers.mjs";
import { ENGINE_MARKERS, findMarkers } from "../scripts/lib/bundle-checks.mjs";
import { PLAYER_SANDBOX_TOKENS } from "../src/player/protocol";

const read = (file: string) => readFileSync(new URL(`../src/player/static/${file}`, import.meta.url), "utf8");
const conf = read("player.nginx.conf");
const locations = parseNginxLocations(conf);
const html = locations["/player/player.html"];
const script = locations["/player/player.js"];
const directive = (csp: string, name: string) => csp.split("; ").find(d => d.startsWith(`${name} `));

describe("player.nginx.conf", () => {
    test("has exactly the two player locations", () => {
        expect(Object.keys(locations).sort()).toEqual(["/player/player.html", "/player/player.js"]);
    });

    test("the CSP is the Phase 1 minimal policy, with the sandbox tokens PlayerHost uses", () => {
        expect(html["Content-Security-Policy"]).toBe(
            "default-src 'none'; script-src $scheme://$http_host blob: 'unsafe-eval'; connect-src $scheme://$http_host blob:; " +
            "img-src blob:; frame-ancestors 'self'; sandbox " + PLAYER_SANDBOX_TOKENS.join(" "),
        );
    });

    test("the CSP names the origin and never 'self' for script or connect sources, and never allows same-origin", () => {
        const csp = html["Content-Security-Policy"];

        expect(directive(csp, "script-src")).not.toContain("'self'");
        expect(directive(csp, "connect-src")).not.toContain("'self'");
        expect(csp).not.toContain("allow-same-origin");
        expect(directive(csp, "default-src")).toBe("default-src 'none'");
        expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
    });

    test("ACAO * is on player.html and on player.js", () => {
        expect(html["Access-Control-Allow-Origin"]).toBe("*");
        expect(script["Access-Control-Allow-Origin"]).toBe("*");
    });

    test("every location repeats the hardening headers (nginx add_header does not inherit)", () => {
        expect(html["X-Content-Type-Options"]).toBe("nosniff");
        expect(script["X-Content-Type-Options"]).toBe("nosniff");
        expect(html["Referrer-Policy"]).toBe("no-referrer");
    });

    test("every add_header says `always`, so error responses carry the policy too", () => {
        const lines = conf.split("\n").filter(line => line.trimStart().startsWith("add_header"));
        expect(lines.length).toBeGreaterThanOrEqual(8);
        for (const line of lines) expect(line).toMatch(/\balways;/);
    });

    test("player.html loads player.js relatively, as a module, with no inline script or style", () => {
        const page = read("player.html");

        expect(page).toContain('<script type="module" src="./player.js"></script>');
        expect(page).not.toMatch(/<style|style=|onclick=|<script>(?!<)/i);
    });
});

describe("nginx-headers (the smoke's reading of the snippet)", () => {
    test("comments are ignored, so a warning about allow-same-origin is not a header", () => {
        const parsed = parseNginxLocations(`# add_header X "no";\nlocation = /a {\n  # allow-same-origin\n  add_header A "1" always;\n}`);
        expect(parsed).toEqual({ "/a": { A: "1" } });
    });

    test("a location without `=` and a header without `always` parse too", () => {
        expect(parseNginxLocations('location /x { add_header B "2"; }')).toEqual({ "/x": { B: "2" } });
    });

    test("$scheme and $http_host expand like nginx for a request to the origin", () => {
        expect(expandVariables("$scheme://$http_host blob:", "http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080 blob:");
        expect(expandVariables("$scheme://$http_host", "https://platform.test")).toBe("https://platform.test");
    });

    test("headersFor expands every value and returns nothing for an unknown path", () => {
        const headers = headersFor(locations, "/player/player.html", "http://127.0.0.1:9");

        expect(headers["Content-Security-Policy"]).toContain("script-src http://127.0.0.1:9 blob:");
        expect(headersFor(locations, "/nope", "http://127.0.0.1:9")).toEqual({});
    });
});

describe("bundle-checks", () => {
    test("findMarkers matches whole words only", () => {
        expect(findMarkers("new WebGLRenderer(); class GameObjectX {}", ENGINE_MARKERS)).toEqual(["WebGLRenderer"]);
        expect(findMarkers("const a = 1;", ENGINE_MARKERS)).toEqual([]);
    });
});
