// scripts/player-smoke/player.js
// ============================================================
// The minimal PLAYER for the spike, run in an opaque-origin frame. It does what
// the real player will: import the engine by URL (no import map), build the
// canvas and Application, run a ZIP handed over as a Blob (or a streamed
// manifest), and report what it could and could not do.
//
// Everything is measured, nothing is assumed: each probe records its own failure
// so that a removed CSP directive shows up as a named capability going red, with
// the browser's own `securitypolicyviolation` events attached.
// ============================================================

const report = { errors: [], violations: [] };
let exfilOrigin = null;
const post = (port, message) => port.postMessage(message);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const describe = error => `${error?.name ?? "Error"}: ${error?.message ?? error}`;

document.addEventListener("securitypolicyviolation", event => {
    if (exfilOrigin && event.blockedURI.startsWith(exfilOrigin)) return; // the exfiltration probe is MEANT to be blocked
    report.violations.push(`${event.violatedDirective} blocked ${event.blockedURI || "(inline)"}`.slice(0, 200));
});
addEventListener("error", event => report.errors.push(String(event.message).slice(0, 200)));
addEventListener("unhandledrejection", event => report.errors.push(`unhandledrejection: ${describe(event.reason)}`.slice(0, 200)));

/**
 * What a hostile scenario would try first. `blocked` is the good answer for every one of them.
 * Opened top-level there is no parent to reach, so only the storage probes mean anything.
 */
async function probeSecurity() {
    const result = {};
    const attempt = async (name, fn) => {
        try { result[name] = (await fn()) ?? "ACCESSIBLE"; } catch (error) { result[name] = `blocked: ${error?.name}`; }
    };
    await attempt("localStorage", () => { localStorage.getItem("probe"); });
    await attempt("sessionStorage", () => { sessionStorage.getItem("probe"); });
    await attempt("cookie", () => { void document.cookie; });
    await attempt("indexedDB", () => new Promise((resolve, reject) => {
        const request = indexedDB.open("probe");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    }));
    if (parent === window) return result;
    await attempt("parentDocument", () => { void parent.document.title; });
    await attempt("topNavigation", () => { top.location.href = "about:blank#navigated"; });
    await attempt("popup", () => { if (window.open("about:blank") === null) throw { name: "returned null" }; });
    return result;
}

function probeWebgl2() {
    try { return document.createElement("canvas").getContext("webgl2") ? "ok" : "unavailable"; } catch (error) { return describe(error); }
}

if (parent === window) {
    // Opened directly: only the origin matters, and the runner reads it from here.
    window.__direct = { origin: self.origin, security: await probeSecurity() };
} else {
    parent.postMessage({ kind: "hello", origin: self.origin }, "*");
    addEventListener("message", event => {
        if (event.source !== parent || event.data?.kind !== "init" || !event.ports[0]) return;
        const port = event.ports[0];
        port.onmessage = ({ data }) => {
            if (data.kind !== "run") return;
            run(port, data).catch(error => {
                report.fatal = describe(error);
                post(port, { kind: "loaded", report });
            });
        };
    });
}

/** Every channel a hostile scenario could use to send data to a third party; the runner counts what arrives. */
async function tryExfiltration(target) {
    const attempt = fn => { try { fn(); } catch { /* blocked synchronously is as good as blocked */ } };
    attempt(() => fetch(`${target}?via=fetch`, { mode: "no-cors" }).catch(() => {}));
    attempt(() => { new Image().src = `${target}?via=img`; });
    attempt(() => navigator.sendBeacon(`${target}?via=beacon`, "x"));
    attempt(() => {
        const frame = document.createElement("iframe");
        frame.src = `${target}?via=frame`;
        document.body.append(frame);
    });
    attempt(() => {
        const script = document.createElement("script");
        script.src = `${target}?via=script`;
        document.head.append(script);
    });
    await sleep(500);
}

async function run(port, opts) {
    report.origin = self.origin;
    if (opts.exfilUrl) {
        exfilOrigin = new URL(opts.exfilUrl).origin;
        await tryExfiltration(opts.exfilUrl);
    }
    report.security = opts.security === false ? null : await probeSecurity();
    report.webgl2 = probeWebgl2();
    report.zip = opts.zip ? { isBlob: opts.zip instanceof Blob, bytes: opts.zip.size } : null;

    const engine = await import(/* engine by absolute URL, no import map */ opts.engineUrl);
    report.engineImport = "ok";
    report.engineBuiltAt = engine.BuildInfo.builtAt;
    engine.Texture2D.ktx2TranscoderPath = opts.transcoderPath;
    engine.MemoryProfiler.diagnosticsAllowed = !!opts.diag;

    document.body.style.cssText = "margin:0;overflow:hidden";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100vw;height:100vh";
    document.body.append(canvas);

    const app = new engine.Application(canvas);
    globalThis.__smokeApp = app;
    if (opts.diag) {
        engine.MemoryProfiler.enableToggle();
        engine.MemoryProfiler.showOverlay();
    }

    const started = performance.now();
    if (opts.zip) await app.loadScenarioFromBuffer(await opts.zip.arrayBuffer());
    else await app.loadScenarioFromManifest(opts.manifestUrl);
    report.loadMs = Math.round(performance.now() - started);
    report.scenarioLoaded = true;

    const firstFrame = engine.Time.frameCount;
    for (let waited = 0; engine.Time.frameCount < firstFrame + 10 && waited < 8000; waited += 100) await sleep(100);
    report.frames = { engine: engine.Time.frameCount - firstFrame, scenario: globalThis.__smoke?.frames ?? null };
    report.smoke = globalThis.__smoke ?? null;

    if (opts.diag) {
        const overlay = document.getElementById("webengine-profiler");
        report.overlay = { present: !!overlay, positioned: overlay ? getComputedStyle(overlay).position === "fixed" : false };
    }
    try { report.textureFormats = engine.MemoryProfiler.snapshot().renderer?.textureFormats ?? null; } catch (error) { report.textureFormats = describe(error); }

    const context = typeof AudioContext === "function" ? engine.AudioManager.context : null;
    report.audio = context ? { afterLoad: context.state } : { webAudio: "missing" };
    if (context) {
        await sleep(300);
        report.audio.afterWait = context.state;
    }

    canvas.addEventListener("pointerdown", async () => {
        const gesture = { activation: { active: navigator.userActivation?.isActive, been: navigator.userActivation?.hasBeenActive } };
        const pointer = new Promise(resolve => {
            document.addEventListener("pointerlockchange", () => resolve({ locked: document.pointerLockElement === canvas }), { once: true });
            document.addEventListener("pointerlockerror", () => resolve({ locked: false, error: "pointerlockerror" }), { once: true });
            setTimeout(() => resolve({ locked: false, error: "no event in 2 s" }), 2000);
        });
        try { engine.Input.lockCursor(); } catch (error) { gesture.lockThrew = describe(error); }
        if (context) {
            gesture.audioBefore = context.state;
            await Promise.race([engine.AudioManager.resume(), sleep(2000)]);
            gesture.audioAfter = context.state;
        }
        gesture.pointer = await pointer;
        if (document.pointerLockElement) document.exitPointerLock();
        post(port, { kind: "gesture", gesture });
    }, { once: true });

    post(port, { kind: "loaded", report });
}
