# Review 2: PlayerHost.capture (uncommitted, master)

## Executed Results
- `npx vitest run` (default config, no --maxWorkers), 3 consecutive runs: 151 files / 2635 tests passed each time, exit 0 (65.5 s, 41.9 s, 48.1 s).
- `npm run typecheck`: no errors (all three tsc projects).
- `npm run build`: succeeded. `npm run size`: engine 393,484 B gz (budget 450,000), player-host 7,897 (8,000), player 3,190 (4,000).
- `player.nginx.conf`: not in `git status`; unchanged.

## Requirements
- R-1 PASS. `PlayerHost.ts` `capture()` (PNG default, `DEFAULT_CAPTURE_WIDTH` 1920, clamp to 4096), exported via `host/index.ts`. `Application._capture` scales with `Math.min(1, maxWidth/source.width)`, so aspect is kept and there is no upscale. Covered by `ApplicationCaptureFrame.test.ts` (3840x2160 -> 1920x1080; 800x600 stays) and PlayerHost "happy path".
- R-2 PASS (unit level). `Application._capture` calls `_render()` then `Canvas._renderAll()` then `drawImage(source)` and each `Canvas._overlaySurfaces()` in the same task. There is no `preserveDrawingBuffer` anywhere in the diff. Tests: the render-before-copy order, the "works while paused" test in PlayerRuntime (timeScale stays 0), and the overlay order test. A real-GPU check of a non-blank paused frame was not run. The author lists it as not done, and a fake canvas cannot show it. This is a note, not a failure.
- R-3 PASS. All rejection paths exist: disposed, not running, in flight, 10 s timeout, and dispose while pending (`_fail` calls `_settleCapture`). Late replies are guarded by id in `_acceptCapture` and `_settleCapture(.., id)`. PlayerHost tests cover these, including "rejects after 10 s, and a late reply cannot satisfy the next capture".
- R-4 PASS. Trace of a hostile frame:
  - A non-Blob body becomes `capture-failed` in `parsePlayerMessage`.
  - A bad id is dropped.
  - Size 0 or over 20 MB is rejected.
  - Only 8 bytes are read, via `blob.slice(0, 8)`.
  - The signature is checked against the requested MIME.
  - The result is re-wrapped with the host's MIME.
  - A stale id or a duplicate reply is a no-op.
  - Nothing is evaluated.
  - A wrong-id `capture-failed` is ignored.
  - Tests cover HTML, wrong signature, empty, oversize, data URL, buffer, and no-id replies.
- R-5 PASS. The protocol version stays 1. `hello.features` is optional, bounded to 16 entries of 64 chars, and string-only. A new host with an old player (no feature) rejects at once, with nothing sent (tested). An old host ignores the extra field. A new player with an old host never receives `capture`.
- R-6 PASS. The nginx conf is untouched.
- R-7 PASS. CHANGELOG, CLAUDE.md and `design/player-sandbox.md` are updated, and the JSDoc and `.d.ts` exports (`PlayerCaptureOptions`, `PlayerCaptureType`, `CaptureFrameOptions`) are present. The build, typecheck and size checks pass. The suite is green 3/3. The previous 10 `RenderBackend` timeouts did not recur.
- R-8 PASS. The new `tests/CanvasOverlaySurfaces.test.ts` covers `Canvas._overlaySurfaces`: empty, back-to-front regardless of creation order, a disabled canvas and an inactive GameObject excluded, re-enable and destroy. This runs against the real `Canvas`, not a mock. `ApplicationCaptureFrame.test.ts` covers the compositing order `[source, back, front]` at the downscaled size. It also covers render-before-copy, JPEG, NaN options, no size, and encoder null. `PlayerRuntime._capture`, `PlayerHost.capture`, `_acceptCapture`, `_settleCapture`, `hasImageSignature` and the parsers all have tests.
- R-9 JUSTIFIED. Evidence:
  - I exported HEAD with `git archive` into a scratch dir (node_modules junctioned) and ran `npx vitest run` twice with the unchanged baseline config.
  - Run 1 failed 5 tests (all `ApplicationDisposeInput`, "Test timed out in 5000ms").
  - Run 2 failed 15 tests: `ApplicationDisposeInput` plus `RenderBackend.test.ts` ("the factory decides...", "construction options...", "initial resize...", "quality settings...").
  - So the cold-import timeouts reproduce on the baseline, and on the same `RenderBackend` tests the earlier review flagged.
  - Import graph: the diff adds no `import` line to `Application.ts` (`Canvas` was already imported at line 24 and `Canvas._renderAll` already used in the loop). `Canvas.ts` gains only a static method. The player and host additions are protocol-only. The engine import cost is therefore unchanged.
  - Baseline total import time was 278 s against 261-375 s with the change, which is within run-to-run noise (`ApplicationDisposeInput` took 5 s+ on the baseline).
  - The 30 s global timeout is a blanket workaround and could hide a future real slowdown, but it is not masking anything this change introduced. Note: `ApplicationCaptureFrame.test.ts` also sets its own 30 s timeout, which is redundant with the global.

## Test-DW coverage
Every requirement is backed by a test that ran in the 3 green runs. Coverage gaps against 100%: none found. Every new or changed routine has a test.

## Dead code
None found.

## Correctness dimensions
| Dimension | Status | Evidence |
|---|---|---|
| Concurrency | PASS | One capture in flight on both sides (`session.capture`, `_capturing`). The id-guarded async verdict cannot settle request N+1. The `finally` resets `_capturing`. |
| Error handling | PASS | Every failure path rejects with an actionable message. `captureFrame` converts sync throws to rejections. The player always replies, with `capture` or `capture-failed`. |
| Resources | PASS | The timer is cleared on every settle. The capture is settled on `_fail` and `dispose`. The scratch canvas is garbage-collected. The reply is capped at 20 MB. |
| Boundaries | PASS | maxWidth 0, NaN, 1e9 and quality out of range are clamped or rejected, both in the host options and in the parsers. A zero-size canvas rejects. |
| Security | PASS | The reply is untrusted and validated (see R-4). |

## Loaded-skill criteria
| Skill | Criterion | Status | Evidence |
|---|---|---|---|
| cc-defensive-programming | External input validated at the barricade | PASS | The port reply is validated in `parsePlayerMessage`, then size and signature in the host. The host request is validated again in the player's `parseHostMessage`. |
| cc-defensive-programming | No empty catch / no side-effecting assertions | PASS | The only `.catch(() => undefined)` marks the already-returned promise as handled after the rejection is delivered. It is not a swallow, since the caller gets the same rejection. |
| aposd-verifying-correctness | RC, CS, EH, RM, BC, SE | PASS | See the dimensions above. |

## Notes (non-blocking)
- No real-browser or real-GPU verification that a paused WebGL frame is non-blank (the author's own gap). The unit tests use fake canvases.
- The global 30 s timeouts are broad. A narrower fix (a per-file timeout for the cold-import files) would hide less.
- `player-host.js` is at 7,897 / 8,000 B gz, so the next host feature must raise the budget.
- A hostile frame can still send a valid PNG/JPEG header followed by arbitrary bytes. The upload server must validate the image, which the author's doc says.

**Verdict: PASS.** Both prior blockers are fixed. `_overlaySurfaces` has direct tests, and the default suite is green 3/3. The timeout raise is justified, because the baseline fails the same way.
