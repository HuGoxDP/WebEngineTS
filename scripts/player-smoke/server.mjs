// scripts/player-smoke/server.mjs
// ============================================================
// One HTTP server standing in for the platform's nginx, plus a second one on
// another port that stands in for a foreign site trying to embed the player.
//
//   /host.html, /host.js        the host, under a platform-like CSP
//   /player.html, /player.js    the player; `player.html` carries the policy
//                               under test as `Content-Security-Policy`
//   /engine/*, /basis/*         the standalone bundle and the basis transcoder
//   /zip/<name>                 archives, fetched by the HOST (same origin)
//   /stream/*                   the streamed scenario, fetched by the PLAYER
//   foreign origin /exfil       a third party; every request that reaches it is a leak the policy failed to stop
//   POST /__report              where the host sends what it observed (see `waitFor`)
//
// With `shipped`, it also serves the artifacts the engine ships, unmodified:
//   /shipped-host.html, .js     a smoke host page that drives `PlayerHost`
//   /player-host.js             dist/player-host.js (the `WebEngineTS/player-host` client)
//   /player/player.html, .js    dist/player/*, each with the headers of dist/player/player.nginx.conf
//                               for that path - `$scheme` / `$http_host` expanded like nginx does
//
// Everything the opaque frame fetches carries `Access-Control-Allow-Origin: *`:
// an opaque origin is cross-origin to everything, including the server that
// served it. The research spike showed a module without it fails with a CORS
// error in all four engines; the dirty run in design/player-sandbox.md records
// it for the real bundle and the transcoder too.
// ============================================================

import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cspHeader } from "./policy.mjs";
import { headersFor, parseNginxLocations } from "./nginx-headers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORS = { "Access-Control-Allow-Origin": "*" };
const HOST_CSP = "default-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'";

const MIME = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html; charset=utf-8" };
const mime = path => MIME[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";

function listen(server) {
    return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

/**
 * Starts both servers.
 * @param {{ engineFile: string, basisDir: string, shipped?: { playerDir: string, hostFile: string } }} options
 */
export async function startServer({ engineFile, basisDir, shipped }) {
    const events = new Map();
    const exfil = [];
    const waiters = new Map();
    const state = { policy: null, zips: new Map(), stream: new Map(), cors: { engine: true, player: true, basis: true } };
    let origin = "";
    let foreignOrigin = "";

    const cors = which => (state.cors[which] ? CORS : {});

    const files = {
        "/host.html": () => [readFileSync(join(HERE, "host.html")), ".html", { "Content-Security-Policy": HOST_CSP }],
        "/host.js": () => [readFileSync(join(HERE, "host.js")), ".js", {}],
        "/player.html": () => [readFileSync(join(HERE, "player.html")), ".html", { "Content-Security-Policy": cspHeader(state.policy) }],
        "/player.js": () => [readFileSync(join(HERE, "player.js")), ".js", cors("player")],
        "/engine/WebEngineTS.standalone.js": () => [readFileSync(engineFile), ".js", cors("engine")],
    };

    if (shipped) {
        const locations = parseNginxLocations(readFileSync(join(shipped.playerDir, "player.nginx.conf"), "utf8"));
        const served = path => [readFileSync(join(shipped.playerDir, path.slice("/player/".length))), path.slice(path.lastIndexOf(".")), headersFor(locations, path, origin)];
        files["/shipped-host.html"] = () => [readFileSync(join(HERE, "shipped-host.html")), ".html", { "Content-Security-Policy": HOST_CSP }];
        files["/shipped-host.js"] = () => [readFileSync(join(HERE, "shipped-host.js")), ".js", {}];
        files["/player-host.js"] = () => [readFileSync(shipped.hostFile), ".js", {}];
        files["/player/player.html"] = () => served("/player/player.html");
        files["/player/player.js"] = () => served("/player/player.js");
    }

    const deliver = ({ runId, kind, data }) => {
        events.set(`${runId}/${kind}`, data);
        for (const resolve of waiters.get(`${runId}/${kind}`) ?? []) resolve(data);
        waiters.delete(`${runId}/${kind}`);
    };

    const server = http.createServer((req, res) => {
        const path = decodeURIComponent(req.url.split("?")[0]);
        if (req.method === "POST" && path === "/__report") {
            const chunks = [];
            req.on("data", chunk => chunks.push(chunk));
            req.on("end", () => { deliver(JSON.parse(Buffer.concat(chunks).toString())); res.writeHead(204); res.end(); });
            return;
        }
        let entry = files[path]?.();
        if (!entry && path.startsWith("/basis/")) {
            entry = [readFileSync(join(basisDir, path.slice(7))), path, cors("basis")];
        } else if (!entry && path.startsWith("/zip/") && state.zips.has(path.slice(5))) {
            entry = [state.zips.get(path.slice(5)), ".zip", {}];
        } else if (!entry && path.startsWith("/stream/") && state.stream.has(path.slice(8))) {
            const [body, type] = state.stream.get(path.slice(8));
            entry = [Buffer.from(body), type === "text/javascript" ? ".js" : ".bin", CORS];
        }
        if (!entry) { res.writeHead(404); res.end(); return; }

        const [body, extension, headers] = entry;
        res.writeHead(200, { "Content-Type": mime(extension), "Cache-Control": "no-store", ...headers });
        res.end(body);
    });

    const foreign = http.createServer((req, res) => {
        if (req.url.startsWith("/exfil")) {
            exfil.push(new URL(req.url, "http://x").searchParams.get("via"));
            res.writeHead(200, CORS);
            res.end("ok");
            return;
        }
        const body = req.url.startsWith("/evil.js")
            ? `const frame = document.createElement("iframe");
               frame.setAttribute("sandbox", "allow-scripts");
               frame.src = ${JSON.stringify(origin)} + "/player.html";
               window.__framed = new Promise(resolve => {
                   const timer = setTimeout(() => resolve(false), 3000);
                   addEventListener("message", event => { if (event.source === frame.contentWindow && event.data?.kind === "hello") { clearTimeout(timer); resolve(true); } });
               });
               document.documentElement.append(frame);`
            : `<!doctype html><meta charset="utf-8"><script src="/evil.js"></script>`;
        res.writeHead(200, { "Content-Type": req.url.startsWith("/evil.js") ? "text/javascript" : "text/html; charset=utf-8" });
        res.end(body);
    });

    const [port, foreignPort] = await Promise.all([listen(server), listen(foreign)]);
    origin = `http://127.0.0.1:${port}`;
    foreignOrigin = `http://127.0.0.1:${foreignPort}`;

    return {
        origin,
        foreignOrigin,
        /** Requests a hostile scenario managed to send to a third-party origin, by channel (`fetch`, `img`, ...). */
        exfilHits: () => [...exfil],
        resetExfil: () => { exfil.length = 0; },
        /** Policy served on the next `player.html`. */
        setPolicy: policy => { state.policy = policy; },
        /** Which of the bundle (`engine`), the player script (`player`) and the transcoder (`basis`) carry `ACAO: *`. */
        setCors: next => { Object.assign(state.cors, next); },
        /**
         * What the host reported for a run, once it does. The host posts here instead of being polled with
         * `page.evaluate`, because Playwright evaluates with a user gesture, which would hand the page the
         * user activation the audio and pointer-lock probes are measuring.
         */
        waitFor: (runId, kind, timeoutMs) => new Promise(resolve => {
            const key = `${runId}/${kind}`;
            if (events.has(key)) return resolve(events.get(key));
            const timer = setTimeout(() => resolve(null), timeoutMs);
            waiters.set(key, [...(waiters.get(key) ?? []), data => { clearTimeout(timer); resolve(data); }]);
        }),
        addZip: (name, bytes) => state.zips.set(name, bytes),
        addStreamFiles: files => { for (const [name, value] of Object.entries(files)) state.stream.set(name, value); },
        close: () => Promise.all([server, foreign].map(s => new Promise(resolve => s.close(resolve)))),
    };
}
