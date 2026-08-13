# Where engine work stops, and what comes next

Drafted 2026-08-11, after the asset-streaming series (commits `0c63295` … `fec8686`).

This document draws a line. Above it is engine work that is done; below it is engine work
that is deliberately **not** being done next, each with the reason and with what would bring
it back above the line. The last section sequences the work in the consumer repositories,
which is where the value now is.

It exists because the engine had begun to outrun its own evidence.

---

## 1. The decision

**Engine feature work pauses here. The next work happens in `ScenarioCreator`,
`testv/virtual-lab` and `WebEngineTSEditor`.**

The reason is not that the engine is finished. It is that the streaming stack built over this
series — manifest loading, progressive first paint, a priority queue, a VRAM budget, per-asset
detail levels, in-place reload, and a budget policy — has **never been run against real
content**. Every design note in `asset-streaming-proposal.md` ends with a "done when" that is a
*measurement*, and not one of them can be evaluated today, because nothing publishes a scenario
in the form the engine now knows how to consume.

Continuing to add engine layers in that state means guessing. The next layer down
(§3.1) is a policy whose correctness is a judgement call about scenes nobody has profiled.

## 2. Above the line — what is done

Streaming, engine side, Stages 0–3:

| Stage | State |
|---|---|
| 0 — manifest + source parity | Done, including the manifest-driven scenario loader |
| 1 — progressive first paint | Done; `Scenario.timeToFirstFrame` reported on both the ZIP and manifest paths |
| 2 — priority queue + bounded concurrency | Done; demand outranks speculation, queued requests are promoted |
| 3 — VRAM budget, per-asset levels, in-place reload, budget policy | Done **except** the on-screen-size input (§3.1) |

Supporting work that came out of it, and stands on its own:

- **Texture handle swaps propagate to materials** (`ITextureReferent`). This fixed a live
  defect unrelated to streaming: `Texture.load(url)` swapped its handle in the loader callback,
  so a material assigned that texture before the image arrived drew the empty placeholder for
  the rest of the run.
- **`Material.shader` no longer discards the material's state.** It previously carried exactly
  one field across the swap and dropped every colour, texture and cutout setting.
- **Build identity** — `BuildInfo` (`version` / `builtAt` / `isBuild`), stamped at build time
  and carried through `release:local`, so a consumer can name the engine it is running and a
  recorded measurement can name the engine that produced it.

State at the line: `typecheck`, **1116 tests** across 35 files, and `build` green, with no
circular-dependency warnings. All three consumers are on `0.1.0-local.1786478271988`.

## 3. Below the line — engine work deliberately not next

### 3.1 On-screen-size input to `TextureStreaming`

`TextureStreaming` degrades by **cost**, not by what the camera can see, so a scene whose
expensive textures all sit near the camera is degraded in the wrong order.

The mechanism is no longer the obstacle: `Renderer.bounds` gives a world AABB,
`LODGroup.computeRelativeHeight` is already an `@internal` static, and a pass runs every 500 ms,
so a scene walk per pass would be free relative to the fetch it is deciding about.

What is missing is **evidence for the policy**, not code. How screen size should combine with
cost, how many levels a near object should be allowed to hold, and whether the whole heuristic
beats the simple cost rule are questions about real scenes. Building it now would produce a
second unmeasured heuristic layered on the first.

*Back above the line when:* a texture-heavy scenario is published with LOD variants and a
profiled run shows the cost-only rule degrading the wrong textures.

### 3.2 Streaming Stage 4 — cross-scenario dedup, mip streaming, incremental publish

Almost entirely storage and publishing work. The engine's part is small and cannot be specified
until the content-addressed store exists.

*Back above the line when:* the platform serves content-addressed assets and a second scenario
sharing assets with the first exists to dedup against.

### 3.3 WebGPU backend, OffscreenCanvas, material property blocks

Unblocked by the `RenderBackend` seam and genuinely wanted, but none of them is on the paper's
critical path, and all three are large. They compete directly with the evaluation data.

*Back above the line when:* Section 5 is defensible, or a consumer blocks on one of them.

### 3.4 The residual WebGL assumptions

`MemoryProfiler` and `Texture2D`'s KTX2 transcoder still assume WebGL and read through
`_internalThreeRenderer`, which returns null on a non-WebGL backend. Both degrade rather than
break. Only worth fixing alongside §3.3.

## 4. What to do next, in order

The ordering is by what unblocks the most, not by repository.

### Zeroth — two things that cost about a day and make everything after them measurable

Do not skip these to get to the interesting work faster; both are measurement hygiene.

1. **`virtual-lab` R1 — republish the rebuilt archives.** The catalog still serves stale Drive
   imports, so any before/after comparison would be against content nobody republished, and a
   difference could not be attributed to the change under test.
2. **`virtual-lab` R2 — verify KTX2 end to end.** Its failure mode is silent. If the compressed
   path is broken or mis-configured, every VRAM figure taken afterwards is wrong. There is
   already a reason to suspect it: `earth_normal.ktx2` is 2.67 MB and deflates to 15%, which a
   properly supercompressed texture would not — see `ScenarioCreator/docs/PLAN.md`.

**And, in parallel, `ScenarioCreator` P0 — compress the content.** `complex_model.glb` is
38.58 MB of raw geometry, which is the single largest thing in the catalogue and the actual
cause of "large scenarios load slowly". Draco or meshopt addresses it; no delivery change does.
Cheap, independent, and it helps the ZIP path and the manifest path alike.

### First — `ScenarioCreator`: emit `scenario.json` beside the ZIP

**This is the single change that unblocks measuring everything built in this series.** Nothing
today publishes a scenario in manifest form, so the whole streaming path is unexercised outside
its own tests.

- Emit the manifest the engine reads: `schema`, `id`, `name`, `entry`, `scripts[]`, `assets[]`.
  Two shape notes that will otherwise cost a debugging round — an asset is addressed by
  **`path`** (with an optional `guid`), *not* by the `"id": "earth_albedo"` shown in
  `testv/virtual-lab/docs/scenario-delivery-migration.md` §3.1; and `scripts` + `entry` are what
  make a manifest runnable, since one listing only assets is a valid asset source but not a
  scenario. `parseStreamingManifest` rejects both mistakes at parse time with a named error.
- Mark assets `critical` vs. deferred. Stage 1's whole effect is the split, and a manifest that
  marks everything critical measures nothing.
- Fix the placeholder manifest metadata while there (`build-package.mjs` hard-codes
  `version: 0.0.1-template`, `author: Template Author`) — this is R7 in the platform's roadmap.

*Done when:* a scenario loads through `Application.loadScenarioFromManifest` and renders
identically to its ZIP, and `Scenario.timeToFirstFrame` differs measurably between the two.

### Second — `WebEngineTS-Benchmarks`: the matrix runner, then the runs

The thesis critical path, and the only remaining item that *shortens* it. Already scoped as
**P0-A** in `roadmap-2026H2.md`. The harness there is mid-rewrite (`rollup.config.mjs`,
`tsconfig.json` are untracked in the working tree) — finish that first.

Once ScenarioCreator emits manifests, the same harness measures the streaming claims:
time-to-first-frame ZIP vs. manifest, and peak texture VRAM with `TextureStreaming` on and off
against a budget. Record `BuildInfo.version` in every row.

### Third — `testv/virtual-lab`: R1 → R2, then R4

- **R1** republish the rebuilt archives from `ScenarioCreator/ReleaseScenarios/` — the catalog
  still serves the stale Drive imports.
- **R2** verify KTX2 end to end, which R1 unblocks. Its failure mode is silent, so it needs a
  real run rather than a passing build.
- **R4** Playwright over the browser-only surface. 208 tests cover the logic and nothing covers
  the browser; the manual checklist decays the moment nobody runs it.

Phase 6 / R8 (the streaming client) is unblocked engine-side but should follow ScenarioCreator,
not lead it — there is nothing to stream until manifests exist.

### Fourth — `WebEngineTSEditor`

`app/` has no `node_modules`, so `release:local` skips it and it has never consumed a current
engine. Getting it installing and running against `0.1.0-local.1786478271988` is the first step;
everything else there is ahead of it.

## 5. What brings work back to the engine

Any of:

1. A consumer blocks on a missing engine capability — that is a real requirement, not a guess.
2. A measurement contradicts something built here, most likely §3.1's cost-only degradation.
3. Section 5 becomes defensible, at which point §3.3's larger items stop competing with it.

Until one of those happens, engine changes should be confined to defects.

### It worked — 2026-08-12

`ScenarioCreator/docs/ENGINE-GAPS.md` is the channel doing its job: two gaps found while
building ten scenarios, each with the evidence attached rather than reported as a feeling.
Both were defects, so both were fixed here without reopening feature work:

- `PhysicMaterial.friction` never reached a contact. cannon reads friction from a
  `ContactMaterial` registered for the *pair*, and the engine registered none, so every contact
  fell through to the world default and the property silently did nothing.
- `Slider` had no `setValueWithoutNotify`, alone among the controls that do.

Worth keeping as the pattern: the report checked the installed engine's own `.d.ts` and bundle
rather than assuming, and said so — which made both verifiable against current source in
minutes. That file is where the next gaps should go too.

`testv/virtual-lab/docs/upstream/` did the same a day later, from the other side: five engine
questions with repros, four of which were real. The streamed path holding ~2.9× the texture VRAM
turned out to be two independent asset caches decoding everything twice.

**Six defects, all found by consumers, none by 1133 green tests.** That is the argument for
[`../docs/audit/`](../docs/audit/README.md) — a class-by-class hunt for the specific failure
shapes this codebase actually produces, rather than more features on top. It sits below the line
as maintenance, not above it as feature work.
