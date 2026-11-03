# Discovery + Design: frame capture for the sandboxed player

Request: the virtual-lab admin needs a still image of the running scenario (paused or running) as the catalog
preview. The page cannot read the canvas (opaque-origin sandboxed iframe), so the image must cross the existing
private `MessagePort`. Engine-side change only; no commit, no `release:local` (orchestrator does that).

## Files Found
- `src/player/protocol.ts` - wire types + parsers (`parsePlayerMessage`, `parseHostMessage`, `parseHello`).
- `src/player/host/PlayerHost.ts` - host client; `measure()` is the template for a request/reply with timeout.
- `src/player/player/PlayerRuntime.ts` - the player; `PlayerSession._handle` dispatches host messages.
- `src/engine/core/Application.ts` - owns the GL canvas, `_render()`, the loop; `Canvas._renderAll()` paints the 2D UI
  overlay canvases (separate `<canvas>` elements, `position: fixed`, on top of the GL canvas).
- `tests/PlayerHost.test.ts`, `tests/PlayerRuntime.test.ts`, `tests/PlayerProtocol.test.ts`, `tests/_playerFakes.ts`.

## Findings that drive the design
- The loop keeps rendering while paused (`Time.timeScale = 0`, not a stopped loop), but the GL drawing buffer is
  cleared after each composite, so reading the canvas at an arbitrary moment gives a blank image. Reading must happen
  in the same task as a render.
- The UI (`Canvas`) is drawn on separate 2D canvases, so a GL-only readback would omit the HUD.
- Nothing in the engine can render on demand today; `_render()` is private.

## Design
1. **Capture mechanism: render on demand, then copy synchronously.** New `Application.captureFrame(options)`:
   `_render()` + `Canvas._renderAll()` in the current task, then `drawImage` the GL canvas (and each visible overlay
   canvas) into a scratch 2D canvas already sized for the downscale, then `toBlob`. The copy happens before the browser
   can clear the drawing buffer, so a paused (or running) scenario yields its real last frame.
   Cost: zero during normal rendering; one extra scene render + one 2D copy per *capture request*.
   `preserveDrawingBuffer: true` was rejected: it is a context-creation attribute, applies to every frame for the whole
   session (it disables the buffer-swap optimisation on some GPUs/tiled mobile), and Three.js would need it set in the
   backend for a feature used a few times per session. The on-demand render also avoids a second hazard: it does not
   depend on the loop having run since the last state change.
2. **Protocol (additive, still v1).** host->player `{v:1,type:"capture",id,maxWidth,mime,quality}`; player->host
   `{v:1,type:"capture",id,blob}` or `{v:1,type:"capture-failed",id,message}`. A `Blob` crosses by structured clone
   (no base64 inflation). `id` ties a reply to its request so a reply that arrives after a timeout can never satisfy the
   next capture.
3. **Compatibility without a version bump.** A bump would make every existing host/player pair fail the handshake
   ("version"), for a purely additive feature. Instead the player's `hello` gains `features: ["capture"]`; old hosts
   ignore the extra field (parseHello reads only `v`/`origin`). A new host remembers the features and, if the player
   did not advertise `capture` (old player, which would silently drop the unknown message and leave the promise to
   time out), rejects immediately with "this player build does not support capture". Old host + new player: the host
   never sends `capture`, nothing changes.
4. **Untrusted reply.** The parser accepts a capture reply only with a safe-integer `id`; a bad body for a valid id
   becomes `capture-failed` (fast reject, not a 10 s wait). The host additionally: matches the id to the pending
   request, rejects size 0 or > 20 MB, checks the PNG/JPEG magic bytes against the requested type, and re-wraps
   the bytes in a fresh `Blob` with the *requested* MIME (the type string from the frame is never trusted). The bytes
   are never decoded or evaluated by the host. (A hostile scenario can still send any bytes with a valid header; the
   upload endpoint must validate the image server-side.)
5. **Limits.** `maxWidth` default 1920, clamped 16..4096; only downscales, never upscales. JPEG `quality` default 0.92,
   0..1. Timeout 10 s. One capture in flight.

## Done / left
- [x] discovery file
- [x] `Application.captureFrame` + `Canvas._overlaySurfaces` + export of `CaptureFrameOptions`
- [x] protocol: types + parsers (+ `hello.features`)
- [x] PlayerRuntime: handle `capture`, advertise feature
- [x] PlayerHost.capture
- [x] tests: protocol, host, runtime, engine captureFrame
- [x] docs: CHANGELOG, CLAUDE.md, design/player-sandbox.md, JSDoc; build, typecheck, size green
- [ ] left (not done here): `npm run player-smoke` in real browsers (not run: needs Playwright browsers); a real-GPU check that a
  paused WebGL frame is non-blank and that the UI overlay is composited (unit tests use a fake canvas); `release:local`
  (orchestrator); README has no player API section, so nothing to update there.

Notes: `dist/player-host.js` is 7,897 B gzipped against the 8,000 B budget; the next host feature must raise it or trim.
`ApplicationDisposeInput.test.ts` first test times out (5 s cold import) under a full parallel run on the untouched baseline too.
