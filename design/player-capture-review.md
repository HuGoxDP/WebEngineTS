# Review: player frame capture (R-1..R-8)

## Executed Results
- `npx vitest run` (default workers), run 3 times on the changed tree: 11 failed / 2619 passed each time. The failures are `ApplicationDisposeInput > leaves no listener attached` (the known cold-import flake) and 10 tests in `RenderBackend.test.ts`. Their cause is "Test timed out in 5000ms" in `beforeEach`, on the cold dynamic import of `Application`; later tests in that file then see `Application` undefined.
  - Excluding the new `ApplicationCaptureFrame.test.ts` gave the same 11 failures.
  - Alone, `RenderBackend.test.ts` passes 10/10 and `ApplicationDisposeInput.test.ts` passes 5/5.
  - `npx vitest run --maxWorkers=4` on the changed tree: **150 files, 2630/2630 pass**.
  - Baseline (`git archive HEAD` in a temp dir, same default workers), run twice: all pass, with 1 DisposeInput flake in run 1. Baseline skips 9 tests, which is fewer tests and less load.
  - The RenderBackend failures are therefore load-induced import timeouts, not a logic defect that I could demonstrate. But they occurred on every default-parallel run of the changed tree and on neither baseline run, so the change may have tipped the suite over a timing threshold. See Notes.
- `npm run typecheck`: clean (build, player, test configs).
- `npm run build`: OK. `dist/player-host.d.ts`, `dist/player/player.js` etc. rebuilt (this mutated `dist/` only, as the task required).
- `npm run size`: standalone 393,484 gz (budget 450,000), player-host 7,897 gz (budget 8,000, 103 bytes headroom), player 3,190 gz (budget 4,000). All pass.
- Lint: no lint script in package.json.

## Requirement Fulfillment

### R-1
EVIDENCE: `src/player/host/PlayerHost.ts:224-244` (`capture`), `Application.ts:~300-343` (`captureFrame`, default 1920, `scale = min(1, maxWidth/width)`, aspect kept), `host/index.ts` exports `PlayerCaptureOptions`.
TRACE: `capture()` → port `capture` {id, mime, maxWidth≤4096} → `PlayerSession._capture` → `app.captureFrame` → PNG Blob → port reply → `_acceptCapture` → `new Blob([blob], {type: mime})`. Tests: PlayerHost "happy path", "options", ApplicationCaptureFrame "downscales to the default 1920 … aspect kept", "never upscales".
VERDICT: PASS

### R-2
EVIDENCE: `Application.ts` `_capture`: `this._render(); Canvas._renderAll();` then `drawImage` in the same synchronous run, then `toBlob`. No `preserveDrawingBuffer` added (grep: no change to backend options).
TRACE: paused → capture msg → render on demand, copy in the same task → real frame. Cost only when capture is called. Tests: ApplicationCaptureFrame "renders on demand and copies in the same task (event order render→copy)"; PlayerRuntime "works while paused: neither resumes nor changes timeScale"; PlayerHost "works while paused". Real WebGL readback cannot be exercised under vitest (fake backend); this is desk-checked only.
VERDICT: PASS

### R-3
EVIDENCE: `PlayerHost.ts:224-244` (disposed / no running session / `session.capture` set), `_fail`→`_settleCapture(session, reason)` (~l.393), timer `CAPTURE_TIMEOUT_MS=10_000`, id guard in `_settleCapture` (~l.446).
TRACE: each case yields a rejected promise. A late reply after timeout finds `session.capture === null` (or a different id) and is ignored. Tests: "rejects when no scenario is running", "rejects after dispose, and a pending capture rejects", "second capture while one is in flight", "rejects after 10 s, and a late reply cannot satisfy the next capture". All pass.
VERDICT: PASS

### R-4
EVIDENCE: `protocol.ts` `parsePlayerMessage` "capture" case (non-Blob body → `capture-failed`, bad id → dropped); `PlayerHost._acceptCapture` (size 1..20 MB, signature on the first 8 bytes only, re-wrapped with the host-chosen MIME, never decoded); `hasImageSignature`; window listener removed after the handshake.
TRACE: wrong id → `request.id !== id` → ignored; non-Blob (string/data URL/buffer) → rejected fast; oversize / wrong signature / empty → rejected; frame-chosen MIME is discarded; reply after dispose → `session.capture` null, so ignored (also across the `await` in `_acceptCapture`, via the id and null guards). The hostile frame can only cause bounded work (slice 8 bytes). Tests in PlayerHost ("oversized", "not the requested image type", "not a Blob", "no valid id / none pending", "type string not trusted") and PlayerProtocol pass. I did not find an explicit test of a forged capture reply posted on `window` after the handshake. Desk-check: `_onWindowMessage` is deregistered after the hello, and before it only `parseHello` runs, so such a message is inert.
VERDICT: PASS

### R-5
EVIDENCE: `PLAYER_PROTOCOL_VERSION` unchanged (`v:1`); `hello.features` optional (`parseHello`); `PlayerHost.capture` refuses at once when the `capture` feature is absent (new host + old player = clear error, nothing sent); an old host ignores the extra `features` field and never sends `capture` (old host + new player). Tests: "a player that did not advertise capture is refused at once", "hello features: absent stays absent".
VERDICT: PASS

### R-6
EVIDENCE: `git status`/`git diff --stat` show no nginx file modified.
VERDICT: PASS

### R-7
EVIDENCE: CHANGELOG.md, CLAUDE.md, design/player-sandbox.md and design/player-capture-discovery.md updated; `CaptureFrameOptions` and `PlayerCaptureOptions` exported and in the rebuilt `.d.ts`. Typecheck, build and size pass. The default-parallel `npx vitest run` fails (see Executed Results and Notes); it passes at `--maxWorkers=4`.
VERDICT: PARTIAL (suite is green only with reduced concurrency)

### R-8
Covered with tests: `PlayerHost.capture`, `_acceptCapture`, `_settleCapture`; `PlayerRuntime._capture` (7 tests); the protocol parsing of capture / capture-failed / host capture / hello features / `hasImageSignature`; `Application.captureFrame` (7 tests).
**Not covered: `Canvas._overlaySurfaces`** (`src/engine/core/ui/Canvas.ts:~161-172`). `grep -rn _overlaySurfaces tests` returns nothing, and `ApplicationCaptureFrame.test.ts` never creates a Canvas, so the overlay loop in `captureFrame` (`for (const surface of Canvas._overlaySurfaces()) ctx.drawImage(...)`) never runs with a surface. The requirement names this routine explicitly. Neither the filtering (inactive or disabled canvases, null `_htmlCanvas`) nor the back-to-front compositing order is tested.
VERDICT: FAIL

**All requirements met:** NO

## Test-DW Coverage
- All R items except the R-8 gap have executed tests.
- Coverage level 100%: gap = `src/engine/core/ui/Canvas.ts` `_overlaySurfaces` (and the overlay compositing branch of `Application.captureFrame`) has no unit test.

## Dead Code
None found.

## Correctness Dimensions
| Dimension | Status | Evidence |
|---|---|---|
| Concurrency | PASS | Single-flight on both sides (`session.capture`, `_capturing`). The id guard prevents a stale async verdict from settling a newer request. |
| Error Handling | PASS | Every path settles the promise; a Blob-less reply rejects fast; `captureFrame` converts sync throws into rejections. |
| Resources | PASS | The timer is cleared in `_settleCapture`; the pending capture is settled on dispose; the host reads only the first 8 bytes. |
| Boundaries | PASS | maxWidth clamped 16..4096 on the player side and 1..4096 on the host side; quality clamped; id is a safe non-negative integer; size 1..20 MB. |
| Security | PASS | See R-4. |

## Loaded-Skill Criteria
| Skill | Criterion | Status | Evidence |
|---|---|---|---|
| cc-defensive-programming | External input validated at entry (port replies) | PASS | `parsePlayerMessage` + `_acceptCapture` |
| cc-defensive-programming | No empty catch / side-effecting asserts | PASS | the only swallow is `promise.catch(() => undefined)`, which avoids a duplicate unhandled rejection |
| aposd-verifying-correctness | RC, CS, EH, RM, BC, SE | PASS | as above; RC-3 flags the `_overlaySurfaces` test gap (R-8) |

## Notes (non-blocking)
- Under default parallelism the changed tree failed `RenderBackend.test.ts` (10 tests) with a 5 s cold-import timeout on all 3 runs, whereas the baseline did not fail in 2 runs. It passes alone and at `--maxWorkers=4`. Probably load (more tests plus the now-built `dist`), but worth checking before merge.
- The player-host bundle has 103 bytes of gzip headroom.
- No test for a forged capture reply on `window`; the code is inert to it by construction.

## Issues
1. R-8 coverage gap: `Canvas._overlaySurfaces` and the overlay compositing in `Application.captureFrame` have no test.
   - File: `src/engine/core/ui/Canvas.ts:~161`; `tests/ApplicationCaptureFrame.test.ts`.
   - Fix: add a unit test (e.g. in `tests/Canvas*.test.ts`) that creates active, disabled and inactive Canvases with differing `sortingOrder`, and asserts the returned surfaces are active-only and back-to-front. Add a capture test that asserts the overlays are drawn after the 3D source, in order.

**Verdict: FAIL — blocker: R-8 (`Canvas._overlaySurfaces` untested). Also: the default-parallel full suite fails on the RenderBackend / DisposeInput cold-import timeouts, passes with `--maxWorkers=4`.**
