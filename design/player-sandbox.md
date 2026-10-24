# Player sandbox: what the engine does inside an opaque-origin frame

**Phase 1 of the player-isolation plan** (`.code-foundations/plans/2026-10-24-player-isolation.md`),
measured 2026-10-24. Inputs: the research `.code-foundations/research/2026-10-24-scenario-delivery-and-script-isolation.md`
(its §4 proved blob modules, WebGL2 and the CSP behaviour with toy modules; this document repeats the
measurement with the **real standalone bundle**, a real ZIP and everything the toys did not touch).

Everything below comes from `npm run player-smoke`. The tables are its output, pasted unedited. The
prose says what they mean for Phases 2 and 3.

- [1. Verdict](#1-verdict)
- [2. Reproduce](#2-reproduce)
- [3. The plan's assumptions](#3-the-plans-assumptions)
- [4. Results per capability and browser](#4-results-per-capability-and-browser)
- [5. Minimal player CSP](#5-minimal-player-csp)
- [6. `sandbox` and `allow` tokens](#6-sandbox-and-allow-tokens)
- [7. What the server must send](#7-what-the-server-must-send)
- [8. Failed or unobservable capabilities: consequences for Phase 3](#8-failed-or-unobservable-capabilities-consequences-for-phase-3)
- [9. What the spike did not cover](#9-what-the-spike-did-not-cover)
- [Appendix: the removal run in full](#appendix-the-removal-run-in-full)

## 1. Verdict

The player works as planned. **Nothing is dropped.** In Chromium 151 and Firefox 153 every capability the
spike could observe passes; in WebKit 26.5 three (pointer lock, audio decode, audio resume) are not observable in
Playwright's Windows build, which has no Web Audio and cannot focus the window, and they fail identically with no
sandbox at all (§8).

Four things differ from what the plan assumed or left open, and Phase 2 and 3 must carry them:

1. **`'unsafe-eval'` is required, `'wasm-unsafe-eval'` is not.** The basis transcoder's Emscripten glue
   calls `new Function(...)` inside its worker. `'wasm-unsafe-eval'` alone is not enough, and
   `'unsafe-eval'` already implies it, so the minimal policy carries only `'unsafe-eval'` (§5).
2. **A KTX2 load that the policy blocks never fails: it hangs.** The engine's `Resources.load(Texture2D, "x.ktx2")`
   does not settle when the transcoder worker throws. A host or player that waits for the scenario to load
   will wait forever (§8).
3. **`connect-src` needs `blob:` too**, because a GLB's embedded texture is fetched from a blob URL, and
   without it the model loads *untextured* and nothing rejects. `img-src` needs `blob:` for plain images (§5).
4. **Every URL the frame fetches needs `Access-Control-Allow-Origin`**: `player.js`, the engine bundle, the
   transcoder, and (by the same mechanism) every streamed asset (§7). An opaque origin is cross-origin to
   the server that served it.

## 2. Reproduce

Environment of this run: Windows 11, Node 24, Playwright 1.62.1 (borrowed from `virtual-lab/e2e`),
Chromium 151.0.7922.34 (headless, ANGLE/SwiftShader, `--autoplay-policy=document-user-activation-required`,
which is desktop Chrome's default; headless builds relax it), Firefox 153.0, WebKit 26.5. Engine build
`2026-10-24T19:33:55.447Z` (`BuildInfo.builtAt`). A different GPU changes the transcode target in §4, not any verdict.

```bash
cd WebEngineTS
npm run build                          # dist/WebEngineTS.standalone.js
npm run player-smoke                   # the capability tables below (about 3 minutes, three browsers, exit code 0)
npm run player-smoke -- --dirty        # plus the removal run in §5, §6 and the appendix (about 35 minutes)

# narrower runs
npm run player-smoke -- --browsers chromium
npm run player-smoke -- --dirty --only "unsafe-eval,connect-src:blob" --browsers firefox
npm run player-smoke -- --markdown out.md --json out.json   # keep the tables / the raw runs
PLAYER_SMOKE_DEBUG=1 npm run player-smoke -- --browsers webkit   # print every console message
```

The exit code is 1 if a capability that should pass does not. A capability that also fails with no sandbox
at all is reported as not observable and does not count.

**Playwright is found, not assumed.** `scripts/player-smoke/locate-playwright.mjs` walks up from the
script and looks for `node_modules/playwright` under both `virtual-lab/e2e` (the workspace-root layout,
this machine) and `testv/virtual-lab/e2e` at every ancestor, nearest first, so it works from the main
checkout and from a worktree. `PLAYWRIGHT_E2E_DIR` overrides it. With none found it names every path it
tried. `scripts/shoot.mjs` still hard-codes the `testv/` path and fails here. Pinned by
`tests/PlaywrightLocator.test.ts` (both layouts, a nested worktree, the override, the error message).

How the harness is built, because two choices change what the numbers mean:

- **The host page is never evaluated by Playwright.** Playwright runs script with a user gesture, which
  would hand the page the activation the audio and pointer-lock probes measure. The host starts from its URL
  hash and reports by `POST /__report`. Gestures are real `page.mouse.click` events.
- **`scripts/player-smoke/policy.mjs` holds the policy as data**, so the removal run edits a list. The base
  policy is a deliberate superset; what no capability notices is not in the minimal policy of §5.
  `tests/PlayerSmokePolicy.test.ts` pins that each removal removes exactly one piece and never edits the base.

## 3. The plan's assumptions

| Assumption (confidence) | Result | Evidence |
|---|---|---|
| Blob modules, cross-origin module loads, WebGL2, eval/WASM run in the opaque frame (HIGH) | **Confirmed**, three engines, real bundle | `blob-module-engine-url`, `engine-import`, `webgl2`, `ktx2`; module loads need `ACAO` (§7) |
| A blob module importing the absolute engine URL gets the same engine instance (MED) | **Confirmed**, no fallback needed | `same-engine-instance`: inside the scenario, `Application.current === ` the player's own `Application`. Holds when the scenario imports the **identical URL string** the player imported; a different string would be a second module instance, so Phase 2's rewrite must use the exact URL the player gives it |
| KTX2 transcoder works under the frame's own CSP (MED) | **Confirmed**, with `'unsafe-eval'` | `ktx2` passes with the §5 policy; it fails without `'unsafe-eval'`. KTX2 is **not** dropped |

No assumption needed its fallback.

## 4. Results per capability and browser

The synthetic scenario is a manifest, two scripts (one importing the other, both importing the engine by
absolute URL from `blob:` modules) and a `.ktx2`, a `.png`, a `.glb` with an embedded texture and a `.wav`.
It is loaded as a `Blob` sent over a `MessageChannel`. `Mechanics.zip` and `solar-system-scenario.zip` are
the real `ScenarioCreator` release archives with `"WebEngineTS"` rewritten by hand to the engine's URL (Phase 2
builds the real rewrite).

### Capabilities (baseline policy, synthetic ZIP)

| Capability | chromium | firefox | webkit |
|---|---|---|---|
| player script runs in the frame and says hello (`player-boots`) | pass | pass | pass |
| `self.origin` is `null` (`opaque-origin`) | pass | pass | pass |
| storage, cookie, IndexedDB, `parent.document`, top navigation, popup all blocked (`hostile-access-blocked`) | pass | pass | pass |
| WebGL2 context (`webgl2`) | pass | pass | pass |
| `import(engineUrl)` of the standalone bundle, no import map (`engine-import`) | pass | pass | pass |
| ZIP reaches the player as a `Blob` over a MessageChannel and loads (`zip-as-blob`) | pass | pass | pass |
| scenario loaded and entry point ran (`scenario-loaded`) | pass | pass | pass |
| scenario `blob:` module imports the absolute engine URL (`blob-module-engine-url`) | pass | pass | pass |
| that import is the player's own engine instance (`same-engine-instance`) | pass | pass | pass |
| relative import between scenario scripts (engine's blob re-link) (`relative-import-relink`) | pass | pass | pass |
| frames advance (engine and scenario) (`frames-advance`) | pass | pass | pass |
| KTX2 transcodes in the frame (`ktx2`) | pass | pass | pass |
| PNG decodes (blob URL image) (`png`) | pass | pass | pass |
| GLB loads with its embedded texture (`glb`) | pass | pass | pass |
| WAV decodes (`decodeAudioData`) (`audio-decode`) | pass | pass | - |
| `MemoryProfiler` overlay is built and positioned (`overlay`) | pass | pass | pass |
| the browser logged no Content Security Policy message (`no-csp-messages`) | pass | pass | pass |
| a hostile scenario's fetch, image, beacon, iframe and script to a third-party origin all fail (`no-exfiltration`) | pass | pass | pass |
| `Input.lockCursor()` after a click in the frame locks the pointer (`pointer-lock`) | pass | pass | - |
| `AudioContext` runs after a click in the frame (`audio-resume`) | pass | pass | - |

**webkit: `pointer-lock` not observable here.** It fails identically with no sandbox at all (`pageerror: WrongDocumentError: Pointer lock requires the window to have focus.`), so the cause is the browser build, not the policy.

### Capabilities by source

| Source | chromium | firefox | webkit |
|---|---|---|---|
| synthetic ZIP | all pass | all pass | all pass |
| streamed manifest | all pass | all pass | all pass |
| Mechanics.zip (real) | all pass | all pass | all pass |
| solar-system-scenario.zip (real) | all pass | all pass | all pass |
| control: no sandbox at all (not a policy) | FAIL: opaque-origin | FAIL: opaque-origin | FAIL: opaque-origin, pointer-lock |

The `control` row is the same page with **no sandbox at all**. It exists only to tell a sandbox failure from a
browser that never could (`opaque-origin` fails there by construction).

### Direct open and foreign embedding

| Check | chromium | firefox | webkit |
|---|---|---|---|
| `player.html` opened top-level: origin | `null` | `null` | `null` |
| `player.html` opened top-level: hostile probes | all blocked | all blocked | all blocked |
| embedded by a foreign origin (`frame-ancestors 'self'`) | refused | refused | refused |
| engine texture formats the KTX2 became | `{"ASTC 4x4":1,"RGBA8":2}` | `{"BC7":1,"RGBA8":2}` | `{"BC7":1,"RGBA8":2}` |

The KTX2 became ASTC on Chromium only because headless Chromium here renders through SwiftShader; real GPUs
pick their own target. Informational: it transcodes everywhere.

### Audio and pointer lock

`AudioContext` state is read in the frame before any click (`before`), then after a real click inside the frame
that calls `AudioManager.resume()` (`after`). The three gesture rows differ in **where the user clicked before the
context was created**: nowhere, on the host page outside the frame, or (after load) inside the frame. Each is run with
and without `allow="autoplay"` on the iframe.

| Gesture / `allow` | chromium: before -> after gesture | firefox: before -> after gesture | webkit: before -> after gesture |
|---|---|---|---|
| `none-gesture:autoplay` | suspended | suspended | no Web Audio |
| `none-gesture:no-allow` | suspended | suspended | no Web Audio |
| `host-gesture:autoplay` | running | running | no Web Audio |
| `host-gesture:no-allow` | suspended | running | no Web Audio |
| `frame-gesture:autoplay` | suspended -> running | suspended -> running | no Web Audio |
| `frame-gesture:no-allow` | suspended -> running | suspended -> running | no Web Audio |

| Pointer lock (baseline) | chromium | firefox | webkit |
|---|---|---|---|
| result | locked | locked | not locked (pointerlockerror) |

What this says:

- **Without any click an `AudioContext` stays `suspended`** in Chromium and Firefox, with or without `allow`.
- **A click inside the frame unlocks it**, `allow` or not (`frame-gesture` rows), through `AudioManager.resume()`.
  The engine never calls `resume()` itself (nothing in `src/` does), so **the player must call it on the first
  pointer or key event inside the frame**.
- **`allow="autoplay"` matters in Chromium for one case:** the user clicked the *host* (the HUD's start button)
  and the context is created afterwards. With the attribute it runs; without it it stays suspended
  (`host-gesture`). A click in one frame never activates another, so the host cannot forward its gesture.
- **Firefox ignores `allow="autoplay"`** (it logs `Feature Policy: Skipping unsupported feature name "autoplay"`)
  and unlocks after a host click regardless. Harmless; keep the attribute for Chromium.
- **Pointer lock works under `allow-pointer-lock`** in Chromium and Firefox, and fails without it (§6).
- WebKit: Playwright's Windows build has **no Web Audio** (`AudioContext` is undefined), and `requestPointerLock` fails
  there with `Pointer lock requires the window to have focus` even with no sandbox. Neither can be observed here (§8).

## 5. Minimal player CSP

The smallest policy that passes every capability above in all three engines:

```
Content-Security-Policy:
  default-src 'none';
  script-src   $scheme://$http_host blob: 'unsafe-eval';
  connect-src  $scheme://$http_host blob:;
  img-src      blob:;
  frame-ancestors 'self';
  sandbox allow-scripts allow-pointer-lock
```

(`$scheme://$http_host` is the nginx spelling of the server's own origin. The spike uses `http://127.0.0.1:<port>`.)

Each line, with what was observed without it. "All" means Chromium, Firefox and WebKit agreed.

| Line | What happens without it |
|---|---|
| `script-src <origin>` | `player.js` and the engine bundle are refused: *Loading the script ... violates ... "script-src"*. The player never starts, so no hello reaches the host. All. |
| `script-src blob:` | The scenario's entry module cannot load: `[Scenario] Failed to import entry point "Scenario.js": TypeError: Failed to fetch dynamically imported module: blob:null/...`. `zip-as-blob`, `scenario-loaded`, `frames-advance` fail. All. |
| `script-src 'unsafe-eval'` | The transcoder worker dies with `EvalError: Evaluating a string as JavaScript violates ... 'unsafe-eval'` (the stack is `new Function` in Emscripten's `craftInvokerFunction`, under `__embind_register_function`). `ktx2` fails. Nothing else does. All. |
| `connect-src <origin>` | The transcoder `fetch` is blocked (*connect-src blocked .../basis/basis_transcoder.js*): `ktx2` fails. Streamed assets are blocked too: a streamed scenario never finishes loading. All. |
| `connect-src blob:` | A GLB's embedded texture is read with `fetch(blob:...)` by three's loader. Blocked, the GLB still loads, **without its texture** and nothing rejects (`glb` fails on `textured`). All. |
| `img-src blob:` | Plain images are decoded from a blob URL: *img-src blocked blob*, `png` fails. All. |
| `frame-ancestors 'self'` | A page on another origin embeds the player and receives its hello. All. |
| `default-src 'none'` | Every channel with its own directive is still blocked (`connect-src`, `img-src`, `script-src`), but an `<iframe>` has none, and a hostile scenario's iframe **reaches a third-party origin**. All. This is the one line justified by a leak a probe made, not by a feature. |
| `sandbox allow-scripts allow-pointer-lock` (header) | The embedded frame stays opaque from the *attribute*, but **`player.html` opened directly** has `self.origin = http://127.0.0.1:<port>`: a real origin, same as the platform. All. See §6. |

**Tested and not needed** (removing each changed no capability in any engine, and no CSP message appeared):

| Candidate | Why it is safe to leave out |
|---|---|
| `'wasm-unsafe-eval'` | Implied by `'unsafe-eval'`. It would be the only eval token needed if the transcoder stopped using `new Function`, which is not in the engine's hands. |
| `worker-src blob:` | Workers fall back to `script-src`, which has `blob:`. It becomes necessary only if `script-src` loses `blob:`, which nothing works without. |
| `img-src data:` | No engine path decodes a `data:` image. |
| `media-src`, `font-src` | No engine path uses a media element or a web font. A scenario that does needs the directive added. |
| `style-src` | The engine and the profiler overlay set styles through the CSSOM (`el.style.cssText`), which CSP does not govern. A `<style>` element or a `style=""` attribute would be blocked, and nothing here emits one. |
| `base-uri 'none'`, `form-action 'none'` | No effect observed. The sandbox already refuses forms. |

**`'self'` is not an option.** The same policy with `'self'` in place of the origin passes in Chromium and Firefox
but **fails in WebKit** (the transcoder `fetch` is refused: *connect-src blocked .../basis_transcoder.js*). That
is the research's finding repeated with the real engine, and it is why the plan names the origin.
`frame-ancestors 'self'` is fine: the host embeds the player in all three engines.

`'unsafe-eval'` costs little here: the frame already runs arbitrary scenario JavaScript, and it has no storage,
no cookie, no parent and no network beyond its own origin. String evaluation adds no capability a script lacks.

## 6. `sandbox` and `allow` tokens

```html
<iframe sandbox="allow-scripts allow-pointer-lock" allow="autoplay" src="/player.html"></iframe>
```

and `sandbox allow-scripts allow-pointer-lock` in the player's CSP header.

| Token | Needed | Observed without it, or with it added |
|---|---|---|
| `allow-scripts` | yes | `Blocked script execution in '.../player.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.` The player never starts. All (Firefox says nothing, but the frame is silent too). |
| `allow-pointer-lock` | yes, for `Input.lockCursor()` | Chromium and Firefox: `lockCursor()` ends in `pointerlockerror`. WebKit: not observable (§8). |
| `allow-same-origin` | **never** | **Control, both header and attribute:** `self.origin` becomes the server's origin and storage, cookies and `parent` are reachable from scenario code. All. **Control, attribute only:** nothing changes, because the header's `sandbox` still holds. |
| `allow-popups`, `allow-top-navigation` | never | Not granted in any run, and the hostile probes (`window.open`, `top.location = ...`) are refused in all three engines in the baseline. |
| `allow-forms`, `allow-modals`, `allow-downloads` | never | Not probed. No capability needed them, and the secure default is to omit. |
| `allow="autoplay"` | for Chromium, §4 | Without it a context created after a click on the host stays `suspended` in Chromium. No effect in Firefox, none observable in WebKit. |
| `sandbox` **header** | yes | Without it the embedded frame is still opaque (the attribute holds), but `player.html` opened as a top-level page is not: `self.origin = http://127.0.0.1:<port>`. All. |
| `sandbox` **attribute** | yes | Without it, with the header kept, nothing changes in any run. It is kept because it is the host's own control and does not depend on the server's headers being right: with the header removed, the embedded frame stays opaque *because of* the attribute. The header and the attribute cover each other's absence. |

`fullscreen` is not delegated: the host fullscreens, the engine never calls `requestFullscreen`.

## 7. What the server must send

| Resource | Headers | Observed without |
|---|---|---|
| `player.html` | `Content-Security-Policy:` the §5 policy | A bare page has a real origin. |
| `player.js` | `Access-Control-Allow-Origin: *` | The frame's own script is refused: *Access to script ... from origin 'null' has been blocked by CORS policy*. The player never starts. All. |
| the engine bundle | `Access-Control-Allow-Origin: *` | `import(engineUrl)` fails: *Failed to fetch dynamically imported module*. All. |
| `basis_transcoder.js` / `.wasm` | `Access-Control-Allow-Origin: *` | `ktx2` fails (`Failed to fetch`). All. |
| streamed assets and manifest (`/a/...`) | `Access-Control-Allow-Origin: *` | Not ablated; the spike's streamed run only passes with it, by the same mechanism as the transcoder. Treat as required. |

`*` is correct, not sloppy: an opaque origin is the string `null`, and a header that echoes `null` is worse. These
are public static files.

Everything else (the ZIP) travels over `postMessage`, not the network.

## 8. Failed or unobservable capabilities: consequences for Phase 3

No capability fails in Chromium or Firefox. Nothing is dropped from the player. What does not pass or cannot be
observed, and what Phase 3 does about it:

| # | Capability / finding | Where | Cause | Consequence for Phase 3 |
|---|---|---|---|---|
| 1 | `pointer-lock` | WebKit | **Environment.** `Pointer lock requires the window to have focus`, identical with no sandbox (the control row). | **Not dropped.** Keep `allow-pointer-lock`. The smoke guard reports it `-`, not a failure. Needs a manual check in desktop Safari before release. |
| 2 | `audio-decode`, `audio-resume` | WebKit | **Environment.** Playwright's Windows WebKit has no `AudioContext`. | **Not dropped.** Same: manual Safari check. The engine's audio path is untested in WebKit by this suite. |
| 3 | A blocked KTX2 transcoder **hangs** the load | all | The engine's `Resources.load` for `.ktx2` never settles when the worker throws, so `loadScenarioFromBuffer` never resolves or rejects. Observed: with `'unsafe-eval'` removed the host got no `loaded` report in 60 s. The harness now gives each asset 15 s, which is why the tables show `ktx2` failing instead of a timeout. | **Needs a stated change.** The player must not wait forever: a load timeout in the host (show the failure and offer retry), and ideally a boot self-check in the player (`new Function("return 1")` must work) that reports a misconfigured policy by name. Candidate **engine gap** (KTX2 error path); not added to `.claude-shared/ENGINE-GAPS.md`, which is outside this phase's scope. |
| 4 | `allow="autoplay"` | Firefox | Unsupported feature name; logged once as a warning, no effect. | None. Keep it for Chromium. |
| 5 | The engine never calls `AudioManager.resume()` | all | Nothing in `src/` does. | The player calls it on the first in-frame pointer or key event, or audio never starts after a restart. |
| 6 | A GLB loses its texture silently without `connect-src blob:` | all | three's loader `fetch`es the blob URL. | Already in the §5 policy. The player's CSP test (Phase 3) should keep `glb` textured as a regression guard. |

## 9. What the spike did not cover

So Phase 3 does not assume it was checked:

- **Credentialed requests.** Whether a scenario can reach `/api/admin/*` with the host's cookie is Phases 5 and 6 (the hostile archive).
  The spike proves `document.cookie`, storage and `parent` are blocked, and that nothing reaches a third-party origin.
- **The overlay's keyboard toggle** (Backquote). The overlay itself is built and positioned in all three engines; the key needs
  keyboard focus inside the frame, which the host must give it.
- **Frame restarts, context loss, ten round trips, memory.** The spike runs one frame per run.
- **Real GPUs and mobile.** Headless Chromium used SwiftShader. Android and iOS were not run.
- **Fonts, `<video>`/`<audio>` elements, scenario-created workers.** No engine path uses them; a scenario that does needs the
  matching directive (§5).
- **Protocol `v`, `expectedOrigin`, the opaque-origin self-check.** The spike's player is not the real one: it says hello with
  `self.origin` and takes one `run` message. The findings carry over, the code does not.
- **The real pre-linker rewrite.** `"WebEngineTS"` was replaced by hand with an absolute URL (Phase 2).
- **A hostile archive.** The exfiltration probe tries `fetch`, `Image`, `sendBeacon`, an `<iframe>` and a `<script>` to a
  third-party origin, nothing more.

## Appendix: the removal run in full

`npm run player-smoke -- --dirty`. "Flips" lists the capabilities that passed in the baseline and failed with that one
piece changed (`(stream)` is the streamed scenario). "player never starts" abbreviates the whole chain of failures that
follows from the frame's script not running. A `control` is a hardening check, not a removal.

| Removed / added | chromium | firefox | webkit |
|---|---|---|---|
| remove directive `default-src` | flips: no-exfiltration | flips: no-exfiltration | flips: no-exfiltration |
| remove directive `script-src` | player never starts | player never starts | player never starts |
| remove `http://127.0.0.1:56081` from `script-src` | player never starts (ZIP and stream) | player never starts (ZIP and stream) | player never starts (ZIP and stream) |
| remove `blob:` from `script-src` | flips: zip-as-blob, scenario-loaded, frames-advance, no-csp-messages | flips: zip-as-blob, scenario-loaded, frames-advance, no-csp-messages | flips: zip-as-blob, scenario-loaded, frames-advance, no-csp-messages |
| remove `'unsafe-eval'` from `script-src` | flips: ktx2, no-csp-messages | flips: ktx2, no-csp-messages | flips: ktx2, no-csp-messages |
| remove `'wasm-unsafe-eval'` from `script-src` | no effect | no effect | no effect |
| remove directive `connect-src` | flips: ktx2, glb, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) | flips: ktx2, glb, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) | flips: ktx2, glb, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) |
| remove `http://127.0.0.1:56081` from `connect-src` | flips: ktx2, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) | flips: ktx2, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) | flips: ktx2, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) |
| remove `blob:` from `connect-src` | flips: glb, no-csp-messages, glb (stream), no-csp-messages (stream) | flips: glb, no-csp-messages, glb (stream), no-csp-messages (stream) | flips: glb, no-csp-messages, glb (stream), no-csp-messages (stream) |
| remove directive `worker-src` | no effect | no effect | no effect |
| remove directive `img-src` | flips: png, no-csp-messages | flips: png, no-csp-messages | flips: png, no-csp-messages |
| remove `blob:` from `img-src` | flips: png, no-csp-messages | flips: png, no-csp-messages | flips: png, no-csp-messages |
| remove `data:` from `img-src` | no effect | no effect | no effect |
| remove directive `media-src` | no effect | no effect | no effect |
| remove directive `style-src` | no effect | no effect | no effect |
| remove directive `font-src` | no effect | no effect | no effect |
| remove directive `base-uri` | no effect | no effect | no effect |
| remove directive `form-action` | no effect | no effect | no effect |
| remove directive `frame-ancestors` | flips: foreign-embed-refused | flips: foreign-embed-refused | flips: foreign-embed-refused |
| remove sandbox token `allow-scripts` (header and attribute) | player never starts | player never starts | player never starts |
| remove sandbox token `allow-pointer-lock` (header and attribute) | flips: pointer-lock | flips: pointer-lock | no effect |
| remove the `sandbox` directive from the header (attribute stays) | flips: direct-open-opaque | flips: direct-open-opaque | flips: direct-open-opaque |
| remove the iframe `sandbox` attribute (header stays) | no effect | no effect | no effect |
| remove `allow="autoplay"` | no effect | no effect | no effect |
| **control** NAME `'self'` instead of the origin in `script-src` and `connect-src` | no effect | no effect | flips: ktx2, no-csp-messages, scenario-loaded (stream), frames-advance (stream), no-csp-messages (stream) |
| **control** ADD `allow-same-origin` to header and attribute | flips: opaque-origin, hostile-access-blocked, direct-open-opaque | flips: opaque-origin, hostile-access-blocked, direct-open-opaque | flips: opaque-origin, hostile-access-blocked, direct-open-opaque |
| **control** ADD `allow-same-origin` to the attribute only | no effect | no effect | no effect |
| serve the engine bundle without `Access-Control-Allow-Origin` | flips: engine-import, zip-as-blob, scenario-loaded, frames-advance | flips: engine-import, zip-as-blob, scenario-loaded, frames-advance | flips: engine-import, zip-as-blob, scenario-loaded, frames-advance |
| serve `player.js` without `Access-Control-Allow-Origin` | player never starts | player never starts | player never starts |
| serve the basis transcoder without `Access-Control-Allow-Origin` | flips: ktx2 | flips: ktx2 | flips: ktx2 |

First evidence for each removal, from the browser's own message or the harness's observation:

| Removed | chromium evidence | firefox evidence | webkit evidence |
|---|---|---|---|
| remove directive `default-src` | `requests reached the third-party origin via: frame` | `requests reached the third-party origin via: frame` | `requests reached the third-party origin via: frame` |
| remove directive `script-src` | `no hello from the frame; console: Loading the script 'http://127.0.0.1:56081/player.js' violates the following Content Security Policy directive: "default-src 'none'". Note that 'script-src-elem' was not explicitly set, so 'default-src' is used as a fall` | `no hello from the frame; console: [JavaScript Warning: "Loading failed for the module with source “http://127.0.0.1:56081/player.js”." {file: "http://127.0.0.1:56081/player.html" line: 4}]` | `no hello from the frame; console: Refused to load http://127.0.0.1:56081/player.js because it appears in neither the script-src directive nor the default-src directive of the Content Security Policy.` |
| remove `http://127.0.0.1:56081` from `script-src` | `no hello from the frame; console: Loading the script 'http://127.0.0.1:56081/player.js' violates the following Content Security Policy directive: "script-src blob: 'unsafe-eval' 'wasm-unsafe-eval'". Note that 'script-src-elem' was not explicitly set, so ` | `no hello from the frame; console: [JavaScript Warning: "Loading failed for the module with source “http://127.0.0.1:56081/player.js”." {file: "http://127.0.0.1:56081/player.html" line: 4}]` | `no hello from the frame; console: Refused to load http://127.0.0.1:56081/player.js because it does not appear in the script-src directive of the Content Security Policy.` |
| remove `blob:` from `script-src` | `Error: [Scenario] Failed to import entry point "Scenario.js": TypeError: Failed to fetch dynamically imported module: blob:null/4d4187a1-9379-4e97-8084-fde6cb81b947` | `Error: [Scenario] Failed to import entry point "Scenario.js": TypeError: error loading dynamically imported module: blob:null/63c648e0-148a-4410-a2a3-c733e82281cf` | `Error: [Scenario] Failed to import entry point "Scenario.js": TypeError: Importing a module script failed.` |
| remove `'unsafe-eval'` from `script-src` | `pageerror: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src http://127.0.0.1:56081 blob: 'wasm-unsafe-eval'".` | `[JavaScript Error: "Content-Security-Policy: The page’s settings blocked a JavaScript eval (script-src) from being executed because it violates the following directive: “script-src http://127.0.0.1:56081 blob: 'wasm-unsa` | `Unhandled Promise Rejection: EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' or 'trusted-types-eval' is not an allowed source of script in the following Content Security Policy directive: "scr` |
| remove `'wasm-unsafe-eval'` from `script-src` |  |  |  |
| remove directive `connect-src` | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` |
| remove `http://127.0.0.1:56081` from `connect-src` | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` |
| remove `blob:` from `connect-src` | `connect-src blocked blob` | `connect-src blocked blob` | `connect-src blocked blob` |
| remove directive `worker-src` |  |  |  |
| remove directive `img-src` | `img-src blocked blob` | `img-src blocked blob` | `img-src blocked blob` |
| remove `blob:` from `img-src` | `img-src blocked blob` | `img-src blocked blob` | `img-src blocked blob` |
| remove `data:` from `img-src` |  |  |  |
| remove directive `media-src` |  |  |  |
| remove directive `style-src` |  |  |  |
| remove directive `font-src` |  |  |  |
| remove directive `base-uri` |  |  |  |
| remove directive `form-action` |  |  |  |
| remove directive `frame-ancestors` | `a page on another origin embedded the player and received its hello` | `a page on another origin embedded the player and received its hello` | `a page on another origin embedded the player and received its hello` |
| remove sandbox token `allow-scripts` (header and attribute) | `no hello from the frame; console: Blocked script execution in 'http://127.0.0.1:59322/player.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.` | `no hello from the frame; console: (silent)` | `no hello from the frame; console: Blocked script execution in 'http://127.0.0.1:59322/player.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.` |
| remove sandbox token `allow-pointer-lock` (header and attribute) | `lockCursor() after a click in the frame: {"locked":false,"error":"pointerlockerror"}` | `lockCursor() after a click in the frame: {"locked":false,"error":"pointerlockerror"}` |  |
| remove the `sandbox` directive from the header (attribute stays) | `player.html opened top-level: self.origin = http://127.0.0.1:56081` | `player.html opened top-level: self.origin = http://127.0.0.1:56081` | `player.html opened top-level: self.origin = http://127.0.0.1:56081` |
| remove the iframe `sandbox` attribute (header stays) |  |  |  |
| remove `allow="autoplay"` |  |  |  |
| NAME `'self'` instead of the origin in `script-src` and `connect-src` |  |  | `connect-src blocked http://127.0.0.1:56081/basis/basis_transcoder.js` |
| ADD `allow-same-origin` to header and attribute | `player.html opened top-level: self.origin = http://127.0.0.1:56081` | `player.html opened top-level: self.origin = http://127.0.0.1:56081` | `player.html opened top-level: self.origin = http://127.0.0.1:56081` |
| ADD `allow-same-origin` to the attribute only |  |  |  |
| serve the engine bundle without `Access-Control-Allow-Origin` | `TypeError: Failed to fetch dynamically imported module: http://127.0.0.1:56081/engine/WebEngineTS.standalone.js` | `TypeError: error loading dynamically imported module: http://127.0.0.1:56081/engine/WebEngineTS.standalone.js` | `TypeError: Cross-origin script load denied by Cross-Origin Resource Sharing policy.` |
| serve `player.js` without `Access-Control-Allow-Origin` | `no hello from the frame; console: Access to script at 'http://127.0.0.1:56081/player.js' from origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.` | `no hello from the frame; console: [JavaScript Error: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://127.0.0.1:56081/player.js. (Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code` | `no hello from the frame; console: Origin null is not allowed by Access-Control-Allow-Origin. Status code: 200` |
| serve the basis transcoder without `Access-Control-Allow-Origin` | `Failed to fetch` | `NetworkError when attempting to fetch resource.` | `Load failed` |
