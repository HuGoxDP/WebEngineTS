// scripts/player-smoke/shipped-host.js
// ============================================================
// A host page that drives the SHIPPED artifacts: `PlayerHost` from dist/player-host.js
// embeds dist/player/player.html (served with the headers of player.nginx.conf) and
// runs a ZIP through it, then pauses, resumes, measures, restarts into a NEW frame,
// measures again and disposes. It records what it saw as plain data and POSTs it to
// the runner (the runner never evaluates script in this page).
//
// Nothing here knows the protocol: it is what a platform viewer would write.
// ============================================================

const { runId, ...opts } = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const report = (kind, data) => fetch("/__report", { method: "POST", body: JSON.stringify({ runId, kind, data }) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const describe = error => `${error?.name ?? "Error"}: ${error?.message ?? error}`;

const stage = document.getElementById("stage");
stage.style.cssText = "width:640px;height:480px"; // CSSOM: the host CSP forbids a style attribute
const seen = { states: [], errors: [], fps: [], paused: [], progress: 0, contextLost: 0 };
const frames = () => [...stage.querySelectorAll("iframe")];

/** Resolves with the first value `predicate` accepts, polling the recorded events. */
async function until(label, predicate, timeoutMs = 20_000) {
    for (let waited = 0; waited < timeoutMs; waited += 50) {
        const value = predicate();
        if (value) return value;
        await sleep(50);
    }
    throw new Error(`timed out waiting for ${label}`);
}

const result = { checks: {}, seen };
const check = (name, ok, detail) => { result.checks[name] = { ok: !!ok, detail }; };

try {
    const { PlayerHost, PLAYER_PROTOCOL_VERSION } = await import("/player-host.js");
    const blob = await (await fetch(opts.zipUrl)).blob();
    check("host-exports", typeof PlayerHost === "function" && PLAYER_PROTOCOL_VERSION === 1, `v${PLAYER_PROTOCOL_VERSION}`);

    const host = new PlayerHost(stage, {
        playerUrl: "/player/player.html",
        engineUrl: opts.engineUrl,
        transcoderPath: opts.transcoderPath,
        callbacks: {
            onState: state => seen.states.push(state),
            onError: error => seen.errors.push(error),
            onFps: value => seen.fps.push(value),
            onPaused: value => seen.paused.push(value),
            onProgress: p => { seen.progress = Math.max(seen.progress, p.progress); },
            onContextLost: () => { seen.contextLost++; },
        },
    });

    // ── first run ─────────────────────────────────────────────────────
    await host.load({ kind: "blob", blob }, { diag: false });
    const first = frames();
    check("load-resolves-running", seen.states.join(">").includes("handshake>loading>running"), seen.states.join(">"));
    check("one-frame", first.length === 1, `${first.length} iframe(s)`);
    check("frame-sandbox", first[0]?.getAttribute("sandbox") === "allow-scripts allow-pointer-lock" && first[0]?.getAttribute("allow") === "autoplay",
        `sandbox="${first[0]?.getAttribute("sandbox")}" allow="${first[0]?.getAttribute("allow")}"`);
    check("progress-reported", seen.progress > 0, `max progress ${seen.progress}`);

    await until("an fps report above 0", () => seen.fps.some(v => v > 0));
    const metrics = await host.measure(1);
    result.metrics = metrics;
    check("metrics", metrics.avgFps > 0 && metrics.engineBuild.length > 0 && metrics.timeToFirstFrameMs >= 0, JSON.stringify(metrics));

    host.pause();
    await until("paused=true", () => seen.paused.includes(true));
    host.resume();
    await until("paused=false", () => seen.paused.at(-1) === false);
    check("pause-resume", true, seen.paused.join(","));

    // ── restart: a NEW frame, same source ─────────────────────────────
    const fpsBefore = seen.fps.length;
    await host.restart();
    const second = frames();
    check("restart-new-frame", second.length === 1 && second[0] !== first[0] && !first[0].isConnected, `same element: ${second[0] === first[0]}, old still connected: ${first[0].isConnected}`);
    check("restart-states", seen.states.join(">").endsWith("handshake>loading>running"), seen.states.join(">"));
    await until("an fps report after restart", () => seen.fps.slice(fpsBefore).some(v => v > 0));
    const again = await host.measure(1);
    check("running-after-restart", again.avgFps > 0, JSON.stringify(again));

    check("no-errors", seen.errors.length === 0, JSON.stringify(seen.errors));

    // ── dispose ───────────────────────────────────────────────────────
    host.dispose();
    check("dispose-removes-frame", frames().length === 0 && seen.states.at(-1) === "disposed", `${frames().length} iframe(s), last state ${seen.states.at(-1)}`);
} catch (error) {
    result.fatal = describe(error);
}

await report("done", result);
