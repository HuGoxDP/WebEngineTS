# Ecosystem roadmap — engine, platform, editor, content

**Drafted 2026-09-03**, after the coordinate/handedness work closed. Supersedes nothing: the
per-subject plans (`render-adapter-plan.md`, `canvas-ui-roadmap.md`, `asset-streaming-proposal.md`,
`unity-coordinates-plan.md`, `unity-parity-plan.md`) stay authoritative for their own detail. This
document only decides **order**, across all four repositories, and says why.

Completed plans are not listed as work. `unity-coordinate-spaces.md` is closed — it remains as the
reference for the coordinate contract, not as a to-do.

---

## 0. Where things stand — measured, not assumed

| Repo | Last commit | State |
|---|---|---|
| **WebEngineTS** | 2026-09-03 | 53k LOC, 6 TODOs, 1762 tests. Healthy. |
| **testv/virtual-lab** | 2026-08-30 | **Live** — students use it. Express + `pg` + nginx + Docker, Angular frontend. R1–R6, R10, CI all closed. |
| **ScenarioCreator** | 2026-08-30 | Active. 10 production scenarios. Slated for retirement once the editor can export. |
| **WebEngineTSEditor** | 2026-08-11 | **Dormant stub.** 19 `.ts` files, `app/` has never been `npm install`ed, so `release:local` has always skipped it. Its own last commit: *"get it running first, then decide what it is for."* |

**The consequence that should drive everything:** a large part of the engine's planned work
(`canvas-ui-roadmap.md` Stage 1, `unity-parity-plan.md` Stages 2–4) is justified by the editor's
needs — and the editor does not currently build. Until it does, that work is speculative. The one
consumer with real users is the platform.

## 1. Priorities

### P0 — Verify the handedness fix against real content *(engine + content, ~1 day)*

`Scene._contentRoot` changed what every scenario looks like. Tests and the
`design/coordinate-check/` harness both pass, but neither can tell whether a scenario author
compensated for the old mirror by hand. Where they did, the content is now wrong in the other
direction.

Check in this order, worst-consequence first:

1. **DNA** — the helix must read right-handed (B-DNA). This is the reason the fix was worth its
   disruption; `HelixBuilder` derives from real constants, so it should now be correct.
2. **Molecules**, **Crystals** — stereochemistry and crystal handedness.
3. **Circuits**, **Mechanics** — right-hand rule for fields and torque.
4. **Optics**, **Kepler**, **AtomStructure**, **GasTheory**, **solar-system** — sanity pass.

Anything that reads mirrored now had a manual compensation; remove it rather than re-mirroring the
engine.

### P1 — Editor P0: make it build *(editor, ~0.5 day)*

The single highest information-per-hour action in the ecosystem. `npm install` in `app/`, build it
against the current engine, and see what breaks. The engine has moved a long way underneath it —
full component serialization, prefab variants, `ScriptableObject`, the Animator state machine, the
`RenderBackend` seam, the streaming stack, and now the handedness change.

Two things to settle while there:

- **`file:../../WebEngineTS` vs. a packed tarball.** `app/package.json` depends on both `three` and
  the engine, and takes the engine as a directory. That is the configuration `CLAUDE.md` warns
  about: the bundler may resolve the engine's own `node_modules/three` and load **two** THREE
  instances, which does not crash — it quietly breaks every `instanceof THREE.Mesh` check.
- **Whether the editor is worth continuing at all.** Answering that unblocks or cancels several
  engine plans. It is a decision, and it needs evidence, which this task produces.

### P2 — Close G2: the streamed path's texture memory *(platform, then engine)*

The platform's one open blocker: the manifest path reports **2.9×** the texture VRAM of the ZIP
path (269.8 MB vs 92.8 MB) for the same scenario with the same 19 live textures, so the platform
will not default to streaming.

The engine has already proved `Resources` + a source are identical (`tests/SourceVramParity.test.ts`)
and added the instrument to localise the rest. The next move is **in the platform**: re-run
`e2e/tests/streaming.spec.ts` printing both `liveTextures` and `textures`.

- `liveTextures` differs, `textures` matches → the streamed path retains texture objects nothing
  drew. A leak; send both figures upstream.
- Both match → same textures estimated at different sizes. Check `textureFormats`, then dimensions.

Streaming end-to-end is additionally blocked on ScenarioCreator emitting manifests — that is a
content-pipeline task, not an engine one.

### P3 — Engine defects found but not yet fixed *(engine, ~1 day total)*

- **`LineRenderer.useWorldSpace` is a no-op.** The property is stored and never read; vertices are
  always treated as local. The default is `true`, the opposite of what happens, and Unity's `true`
  means world space. **Fixing it changes rendered output** for any content using a LineRenderer
  under a transformed parent — DNA does. Implement it, but treat the default as a content decision,
  not a free choice.
- **`Renderer._computeWorldBounds` has no test** across the handedness mirror. The fix is reasoned,
  not witnessed; standing up a `MeshRenderer` with real geometry headlessly did not work cheaply.

### P4 — `RenderTexture` *(engine, ~2–3 days)*

The one obviously missing Unity primitive (`NavMesh`, `Terrain`, `Tilemap` are irrelevant to this
domain; `CharacterController` is marginal). It unlocks the editor's viewport, picture-in-picture,
minimaps and cheaper post-processing. Worth doing **after** P1 says whether the editor is real.

### P5 — Adapter generalization, stages 1–4 *(engine, weeks)*

`render-adapter-plan.md`. Stage 0 landed 2026-09-03. Stage 1 (resource handles) is the large one
and the true prerequisite for WebGPU. **Do not start it in fragments** — each stage must leave
exactly one way to reach the GPU, or the `instanceof THREE.Mesh` checks the engine relies on start
failing for whichever objects took the new path.

### P6 — Deferred, with the condition that revives each

| Item | Revives when |
|---|---|
| Canvas UI Stage 1 (`canvas-ui-roadmap.md`) | the editor builds and needs the inspector surface |
| Unity parity Stages 2–4 | same |
| Texture UV convention, C3 (`unity-coordinates-plan.md`) | someone runs the visual harness for UVs; it changes every texture's orientation |
| WebGPU backend | P5 Stage 1 lands |
| OffscreenCanvas | a measurement shows main-thread render cost matters |

## 2. Platform (server-side) specifics

Express + `multer` + `pg`, nginx, Docker Compose, with Playwright e2e. Closed: catalog republish,
build identity, CSP, archive GC, Playwright, the Google Drive path. Open there, in order:

1. **G2 diagnosis** (P2 above) — the only thing blocking the streaming default.
2. **Catalog `image_url`** — the ten production scenarios have none, so every card falls back to a
   placeholder. Cosmetic, cheap, visible to every student.
3. **KTX2 runtime half** — the file half is verified; nothing exercises the transcode at runtime.

## 3. Risks

- **P0 is the one with a deadline that has already passed.** The handedness fix is committed and
  built; any scenario republished before it is checked ships whatever the mirror did to it.
- **Doing engine work justified by the editor before P1** is how the last round of planning went
  stale. P1 costs half a day and settles it.
- **P5 half-done is worse than not started.** Two paths to the GPU break type checks silently.

## 4. The next prompt

Written in English, ready to paste:

> Verify the handedness fix (F7) against real scenario content. The engine now mirrors the scene in
> `Scene._contentRoot` so it renders Unity's handedness; before, every frame was horizontally
> flipped. Build the engine, run `design/coordinate-check/` to confirm the reference still reads
> correctly, then load the ScenarioCreator scenarios in this order — DNA, Molecules, Crystals,
> Circuits, Mechanics, then the rest — and check anything whose meaning depends on handedness: the
> DNA double helix must be right-handed (B-DNA), stereochemistry and crystal handedness must match
> the real substance, and right-hand-rule diagrams in Circuits and Mechanics must point the right
> way. Where a scenario now reads mirrored, the author compensated for the old bug by hand: remove
> that compensation in the content rather than changing the engine back. Report per scenario:
> correct, compensated-and-fixed, or still wrong. Before editing anything, list every file the
> change will touch, and re-check that list after each edit.
