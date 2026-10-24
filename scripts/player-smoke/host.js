// scripts/player-smoke/host.js
// ============================================================
// The minimal HOST for the spike: what the platform viewer will do, stripped to
// the parts the player depends on. It is served under a platform-like CSP
// (no import map, no blob:, frame-src 'self') and:
//   - creates the iframe with the sandbox / allow attributes it is told to;
//   - accepts the player's hello only from `iframe.contentWindow`;
//   - answers with a MessageChannel port, and sends the ZIP over it as a Blob
//     (the host keeps a Blob, as the plan requires, never a string or a URL).
//
// It starts itself from `location.hash` and reports to the server with POSTs, so
// the Playwright runner never evaluates script in this page: Playwright does so
// with a user gesture, which would give the page the activation that the audio
// and pointer-lock probes exist to measure.
// ============================================================

const { runId, ...opts } = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const report = (kind, data) => fetch("/__report", { method: "POST", body: JSON.stringify({ runId, kind, data }) });

// Listening from the start: the runner clicks as soon as it sees the hello, which can beat a later listener.
const hostGesture = opts.waitForHostGesture ? new Promise(resolve => document.addEventListener("pointerdown", resolve, { once: true })) : null;

document.body.style.margin = "0";
const iframe = document.createElement("iframe");
if (opts.sandbox !== null) iframe.setAttribute("sandbox", opts.sandbox);
if (opts.allow) iframe.setAttribute("allow", opts.allow);
iframe.style.cssText = "width:640px;height:480px;border:0;display:block";
iframe.src = "/player.html";

const hello = new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), opts.helloTimeoutMs ?? 8000);
    window.addEventListener("message", event => {
        if (event.source !== iframe.contentWindow || event.data?.kind !== "hello") return;
        clearTimeout(timer);
        resolve(event.data);
    });
});
document.body.append(iframe);

const greeting = await hello;
await report("hello", greeting);
if (!greeting) {
    await report("loaded", { noHello: true });
} else {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => {
        if (data.kind === "loaded") report("loaded", data.report);
        else if (data.kind === "gesture") report("gesture", data.gesture);
    };
    iframe.contentWindow.postMessage({ kind: "init" }, "*", [channel.port2]);

    await hostGesture;

    const zip = opts.zipUrl ? await (await fetch(opts.zipUrl)).blob() : undefined;
    channel.port1.postMessage({
        kind: "run", zip, manifestUrl: opts.manifestUrl, engineUrl: opts.engineUrl,
        transcoderPath: opts.transcoderPath, diag: opts.diag, security: opts.security, exfilUrl: opts.exfilUrl,
    });
}
