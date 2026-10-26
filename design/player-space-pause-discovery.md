# Discovery + Design: Phase 5, DW-5.U1 (engine part) - Space pauses inside the player frame

Plan: `.code-foundations/plans/2026-10-24-player-isolation.md`, decision #23 (owner, 2026-10-26).
File scope per the plan: `src/player/player/**` and `tests/**` only. Nothing in the protocol, the host client or
`package.json` changes.

## Files Found
- `src/player/player/PlayerRuntime.ts` - `PlayerSession._afterRunning` (audio unlock, fps timer) and `_setPaused`.
- `tests/PlayerRuntime.test.ts`, `tests/_playerFakes.ts` - the player's unit tests; window, document and engine are
  doubles, the port is a real `MessageChannel`.
- `src/engine/core/Input.ts:232` - the engine's own key handling listens on `window`, bubble phase, and never reads
  `defaultPrevented`; `preventDefault` from the player therefore changes nothing for the scenario.
- `scripts/lib/release-targets.mjs` `missingFromTarball` - the tarball content check `release:local` runs.

## Current State
The player listens for `pointerdown`/`keydown` on `document` (capture) only to unlock audio, and the listener removes
itself on the first event. `_setPaused` already guards on `engine && _running`, saves/restores `Time.timeScale` and posts
`{v:1, type:"paused", value}`; the host's `pause`/`resume` messages call it. No player teardown path exists: the host
removes the iframe, and the frame's document and its listeners go with it.

## Gaps
- The brief says the Space listener is "removed on teardown/dispose". The player has no dispose. The only teardown signal
  the frame itself sees is `pagehide` (fired when the host removes the iframe), so that is the hook. It removes the
  input listeners only (the Space handler and any audio-unlock listener still pending); the fps interval dies with the
  document and is out of scope.
- `tests/PlayerRuntime.test.ts` "the first pointer or key event in the frame resumes audio, once" asserts
  `document.listenerCount("keydown") === 0` after the unlock. Registering the Space handler on `window` (not
  `document`) keeps that assertion, and every other existing test, unchanged.

## Code Standards
No `docs/code-standards.md` in the engine; the engine `CLAUDE.md` applies: strict TS, no `any`, JSDoc only on public and
protected members, comments inside bodies only for non-obvious logic, English only.

## Test Infrastructure
Vitest in node, no jsdom. `FakeEventTarget.dispatch(type, event)` calls the registered listeners (capture flag and
options are ignored by the fake). A real key press crosses window (capture) then document (capture); the new tests
emulate that path with a `press()` helper that dispatches on both, so "one press never toggles twice" is checked on the
full path, not on a single dispatch.

## DW Verification

| DW-ID | Done-When Item | Status | Test Cases |
|-------|---------------|--------|------------|
| DW-5.U1 | Space pauses and resumes with the scenario frame focused: the engine's player handles Space inside the frame and reports `paused`; one key press never toggles twice (engine part; host e2e is the virtual-lab agent's) | COVERED | `DW_5_U1 Space toggles pause ...`; `... shares one state with the host's pause/resume`; `... one press toggles exactly once on the full capture path`; `... ignored before the scenario runs`; `... ignored with a modifier`; `... ignored on repeat`; `... ignored in editable targets`; `... other keys are ignored`; `... listener removed on dispose`; `... audio unlock still fires` |

**All items COVERED:** YES (1 of 1 DW-ID in the brief)

## Design Decisions
- Handler: one capture-phase `keydown` listener on the frame's `window`, registered in `_afterRunning` (so none exists
  before the scenario runs; `_setPaused` still guards `_running`). It returns early unless
  `event.code === "Space"` with no Ctrl/Alt/Meta/Shift and a non-editable target; then it calls `preventDefault()` and,
  unless `event.repeat`, `_setPaused(!this._paused)`.
- Editable: `input`, `textarea`, `select` (any type, case-insensitive tag) or `isContentEditable` (which the browser
  computes through inheritance, so a child of a contenteditable host counts).
- No `stopPropagation`: the engine's `Input` still sees Space (release 1 accepted that a scenario reading Space also
  pauses). The audio unlock stays a separate document-level listener and still fires on Space.
- No protocol change: the same `_setPaused` posts the same `paused` message the host path posts.

- `preventDefault()` for every plain Space, repeats included: a held key is one toggle and no default action (page
  scroll, activation of a focused control) fires between press and release. Not called when the key is ignored
  (modifier, editable), so Ctrl+Space, a text field's Space and the like are untouched.
- No `event.isTrusted` requirement. A scenario that synthesises a Space can only make the player send the `paused` the
  host already accepts from it (a boolean, treated as untrusted data by the host). A hostile scenario can already post
  any valid player message by intercepting the port, so this adds no capability; a trusted-only rule would silently
  break automation that dispatches synthetic keys.
- Teardown is `pagehide` (see Gaps); the Space handler, and the audio unlock if it has not fired yet, are removed there.

## Verification (what was run)
- Unit: `tests/PlayerRuntime.test.ts`, 12 new `DW_5_U1` tests; mutation-checked (repeat toggling, editable not
  ignored, modifiers not ignored, listener left after `pagehide`, double registration, no `preventDefault` each fail
  at least one test).
- Real browsers: `npm run player-smoke` gained two checks, `space-pauses-focused-frame` and
  `space-resumes-focused-frame`. The host page focuses the frame like the viewer does; the runner presses a trusted
  Space with Playwright; the page must see exactly one `paused` report per press (400 ms window for a second toggle).
  Passes in Chromium, Firefox and WebKit; with the handler's `"Space"` renamed in `dist/player/player.js` both fail
  ("nothing" reported), so the check detects the absence.
- Delivery: the stamped tarball goes to the virtual-lab build worktree only. A plain `npm install` there is a no-op
  ("up to date", version unchanged); `npm install ./WebEngineTS-0.1.0.tgz --prefer-offline` (what `release:local` runs)
  is what takes the new content.

## Prerequisites
- [x] Worktree `feature/player-isolation` at 32a4fd7, clean, deps installed
- [x] `npm run build` available for the tarball step

## Recommendation
BUILD. Edit `PlayerRuntime.ts` (`_afterRunning` + one helper), add DW-5.U1 tests to `tests/PlayerRuntime.test.ts`,
then build, pack with a stamped version and deliver the tarball to the virtual-lab build worktree.
