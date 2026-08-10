# Plan: Next Updates (drafted 2026-07-31)

Detailed execution plan behind the summary list in `CLAUDE.md` → "Roadmap / Next Steps".
Covers priorities, sequencing, resources and the metric that closes each item.

---

## 0. Where things stand

| Item | Status |
|---|---|
| P0.1 GPU/VRAM diagnostics | **Done** (2026-07-16) |
| P0.2 Reproducible benchmark harness | **Done** (2026-07-16) — single-run only, see P0-A |
| P0.3 Integrated-graphics readiness | **Harness ready** (2026-07-18); hardware runs outstanding |
| P1.4 Static batching / instancing | **Done** (2026-07-16) |
| P1.5 LOD system | **Done** (2026-07-16) |
| P1.6 WebGPU backend | Not started (unblocked: implement `RenderBackend`) |
| P1.7 Asset streaming | Proposal only (`design/asset-streaming-proposal.md`) |
| P2.8 Adapter generalization | **Done** (2026-08-10) — `RenderBackend` seam + `WebGLRenderBackend` |
| P2.9 OffscreenCanvas | Not started |
| Profiler v1 (phase timings + markers + overlay) | **Done** (f1b6876 → a0806e3) |
| UI/Canvas round 1 (HiDPI, scaler, on-demand repaint, hit-testing) | **Done** (4a84e99) |
| **Paper Section 5 evaluation data** | **Blocking, not started** |

The engine side of the reviewer asks is largely built. What is *not* done is running the
measurements it exists to produce — that is the critical path.

## 1. Constraints and assumptions

- **The live constraint is thesis submission 76.** Section 5 (Evaluation) scored fair/poor
  from 2 of 3 reviewers; the raw data behind the paper's Scene 3 table is lost and the
  surviving files describe a different, heavier scene. Everything below is ordered against
  "does this get Section 5 defensible".
- [INFERRED] **No resubmission date is recorded.** The plan is sized for ~8 focused weeks and
  gated so it can be cut to ~3 (see §7). If a date exists, sequence from the gates backwards.
- [INFERRED] **Solo developer** with assistant support; no parallel contributors.
- [INFERRED] **Integrated-GPU and phone hardware may not be on hand.** P0-C is written to
  degrade gracefully if it is not.
- The engine repo stays engine-only: no scenario content, no editor, no platform code.

## 2. Priorities

### P0 — Unblocks the resubmission

**P0-A. Batch/matrix mode for the benchmark harness** — *engine, ~1.5–2 days*

Today `Benchmark.run()` returns one result and the harness (`run.ts`, now in
WebEngineTS-Benchmarks) runs one config per page
load; the RUNBOOK's minimum matrix is roughly 120 runs (Scene 3 alone is 7 configs × 10 reps),
each a manual reload plus a download click. That is days of error-prone clicking standing
directly in front of the blocking task, and "re-run it" is the reviewers' reproducibility ask.

Scope:
- `?matrix=` / a config-list runner in `run.ts`: drive N reps × M configs in one page session,
  reloading state between configs, with progress UI and abort.
- Aggregation in `Benchmark`: drop-first, mean ± stdDev, CV per metric across reps; emit one
  merged CSV keyed by config plus a Markdown table ready to paste into the paper.
- Record the scene fingerprint (tris, GameObjects, textures, draw calls, shaders) in **every**
  row, so a table can never again be orphaned from the scene it describes.
- Extend the harness RUNBOOK with the one-command flow; keep the manual per-row links.

Why first: it is the only item that shortens the critical path instead of extending it.

**P0-B. Execute the evaluation matrix** — *user-side, ~1 day supervised (vs ~3–4 manual)*

Scenes 1–3 + KTX2 A/B per the RUNBOOK, on the discrete GPU. Commit the CSVs into the repo as
the reproducibility artifact. Rebuild the Scene 3 table 3.1 → 3.7 against the actually
deployed scene, and report each optimization with the metric that can show it: KTX2 by texture
VRAM, dirty transforms by CPU frame time, shader warmup by first-render cost.

**P0-C. Cross-device runs** — *~0.5 day per device, hardware-gated*

Integrated GPU (Intel UHD/Iris Xe) and a phone, Scene 3 rows 3.1 and 3.7 plus the KTX2 A/B;
verify KTX2 actually transcodes to ASTC/ETC2 there and record the transcoded format.
If no second machine is available: run `?gpu=low-power` on the same box, and label it in the
paper as a power-preference hint on the same silicon — *not* as an integrated-GPU result.
Claiming otherwise is the kind of thing R1 would catch twice.

### P1 — Strengthens the paper and unblocks consumers

**P1-A. Asset streaming Stage 0** (manifest + `StreamingAssetSource` at parity) — *engine ~2–3 days*
**P1-B. Asset streaming Stage 1** (progressive first paint) — *engine ~3–4 days*

Stage 1 is the first stage that produces a headline number (time-to-first-frame) and it feeds
the paper's loading-latency claim directly. Stage 0 has no user-visible payoff on its own, so
treat 0+1 as one deliverable. Storage work (nginx/MinIO, dropping Google Drive) lives in the
platform repo and can run in parallel. Stages 2–4 are explicitly post-resubmission.

**P1-C. UI/Canvas round 2** — *~4–6 days*

Round 1 fixed resolution, repaint cost and hit-testing. The gaps that remain are feature gaps:
`ScreenSpaceCamera`/`WorldSpace` render modes (the enum still documents them as planned),
layout groups (horizontal/vertical/grid), `RectMask2D` + a scroll view, and an input field.
Priority driver is the platform and editor, not the paper — schedule after P1-A/B unless a
consumer blocks on it.

**P1-D. Core test coverage** — *~2–3 days*

298 tests, and none for `Vector3`, `Matrix4x4`, `Transform`, `Camera`, `Material`, `Texture2D`
or the scenario loader — i.e. the code every other subsystem sits on. Backfill the math and
transform layers first, then the scenario load path (the most consumer-visible failure mode).

**P1-E. Profiler v2** — *~3–4 days*

Ring-buffer history graphs in the overlay, call-tree hierarchy with self vs. inclusive time,
and the editor-side panel. Supports the methodology narrative; not itself a reviewer ask.

### P2 — Post-resubmission architecture

- ~~**P2-A. Adapter generalization**~~ — **done 2026-08-10.** `RenderBackend` +
  `WebGLRenderBackend` + `Application.backendFactory`; the loop no longer names Three.js. The
  paper's "un-generalized adapter" limitation can be rewritten. Residual: `MemoryProfiler` and
  the KTX2 transcoder still assume WebGL — see the parity plan's Stage 5 entry.
- **P2-B. WebGPU backend** (*~15+ days*) — spike behind a flag, Scene 1 parity first.
- **P2-C. OffscreenCanvas rendering** (*~4–6 days*).
- **P2-D. Streaming Stages 2–4** (on-demand/preload, LOD streaming, dedup + partial updates).

### Continuous hygiene

- `npm run release:local` after every engine change that should reach a consumer — **the UI
  round-1 change (4a84e99) has not been pushed yet.**
- Four open code TODOs; `LineRenderer.ts:549` is a non-English comment, against the repo's own
  "all comments in English" rule.
- Keep `typecheck` + `test` + `build` green per commit (currently green, 298 tests).

## 3. Timeline

Eight sprint-weeks with gates. Weeks are ordinal, not calendar-locked.

| Week | Focus | Gate at end of week |
|---|---|---|
| W1 | P0-A matrix runner + aggregation + RUNBOOK | One command produces a full Scene 3 table; zero manual reloads |
| W2 | P0-B execute Scenes 1–3 + KTX2 A/B; commit CSVs | Every paper table cell traceable to a committed CSV |
| W3 | P0-C cross-device (or documented substitute); paper Section 5 rewrite from real data | **Gate 1: Section 5 defensible.** Resubmission possible from here |
| W4–W5 | P1-A + P1-B streaming Stages 0–1 | TTFF measured before/after on Scene 3; parity verified |
| W6 | P1-D core tests; hygiene backlog; `release:local` to consumers | Coverage gate met; consumers on the current engine |
| W7 | P1-C UI round 2 (layout + mask/scroll first) | Scroll list + anchored HUD correct at DPR 1/2/3 |
| W8 | P1-E Profiler v2; P2-A spike + design note | **Gate 2: P1 closed.** P2 planned with a real estimate |

Ordering rules: P0 is strictly serial and nothing else starts until Gate 1. P1-A/B before
P1-C because streaming feeds the paper and UI does not. P2-A must precede P1.6 (WebGPU)
regardless of numbering.

## 4. Required resources

**Time.** ~28–35 focused engineering days for P0+P1. P2 is a further ~30–40 and should not be
committed to before Gate 2.

**Hardware.**
- Discrete-GPU laptop (RTX 3050) — have it; the P0-B baseline.
- Integrated-GPU machine (Intel UHD / Iris Xe) — **needed for P0-C**, substitute documented above.
- Android and/or iOS phone — needed for the mobile claim and for KTX2 → ASTC/ETC2 verification.
- Thermal discipline: benchmark runs need a cool, idle machine; budget wall-clock, not attention.

**Toolchain.**
- Chromium-based browser launched with the RUNBOOK's flags; fully quit between sessions.
- **PowerShell** for ScenarioCreator ZIP builds (Git Bash's `tar.exe` mishandles `C:\` paths).
- KTX-Software for the dual-format KTX2 ZIP.
- Docker + nginx/MinIO for streaming Stage 0 storage (platform repo).

**External / cross-repo dependencies.**
- ScenarioCreator: Scene 2/3 ZIPs, `--ktx2` dual-format build.
- testv/virtual-lab: storage migration for streaming Stage 0; consumes the engine tarball.
- WebEngineTSEditor: consumes the engine; UI round 2 and Profiler v2 land here.
- These are pushed to only via `npm run release:local`; the engine never imports from them.

**Not required:** additional contributors. Nothing in P0/P1 parallelizes cleanly for a solo
developer, and the measurement work is serialized by the hardware anyway.

## 5. Success metrics

**P0-A — matrix runner**
- Full Scene 3 table (7 configs × 10 reps) from a single command; manual reloads = 0.
- Output carries mean ± stdDev and CV per metric; re-running the same config twice gives
  CV < 5% on `cpu_frame_ms`.
- Every row carries its scene fingerprint (tris / GameObjects / textures / draw calls / shaders).

**P0-B — evaluation data**
- Tables 1–3 complete, each cell traceable to a committed CSV.
- Scene 3 fingerprint recorded in the same CSV matches the deployed scene.
- Each optimization reported with a metric that can move: KTX2 → texture VRAM; dirty
  transforms → CPU frame time; shader warmup → first-render CPU ms.

**P0-C — cross-device**
- Scene 3 rows 3.1 and 3.7 on integrated GPU and phone, 5 reps each.
- Transcoded KTX2 format recorded per device (ASTC/ETC2/BC7).
- Any substitute measurement labelled as such in the paper.

**P1-A/B — streaming**
- Manifest path renders an identical scene to the ZIP path: tris, draw calls and VRAM within 1%.
- Time-to-first-frame on Scene 3 down ≥ 40% vs. all-up-front, with no visual difference once
  fully loaded. (Target, not a promise — Stage 1's ceiling is set by how much of Scene 3 is
  genuinely deferrable.)
- Single-ZIP path still passes its tests unchanged.

**P1-C — UI round 2**
- A scrollable list and an anchored HUD render correctly at DPR 1 / 2 / 3 and at 16:9, 4:3 and
  a phone-portrait aspect.
- Static HUD still skips repaint on ≥ 90% of frames (measurable via `Canvas.repaintedLastFrame`).

**P1-D — tests**
- `core/math`, `Transform` and `Camera` at ≥ 80% line coverage; every public API on those types
  exercised at least once.
- Scenario load path covered end-to-end with a fixture ZIP.

**P1-E — Profiler v2**
- Overlay shows ≥ 300 frames of history and per-marker self vs. inclusive time.

**Cross-cutting**
- `typecheck`, `test`, `build` green on every commit; no new circular-dependency warnings.
- Consumers reinstallable from a fresh `release:local` with no manual edits.

## 6. Risks

| Risk | Impact | Response |
|---|---|---|
| No integrated GPU / phone available | R1's ask stays open | Ship `?gpu=low-power` substitute, labelled honestly; state the limitation in the paper |
| Re-run data contradicts the paper's published claims | Section 5 needs rewriting, not patching | Better found now than by a reviewer; the incremental table is the story either way |
| Benchmark noise (thermals, browser state) | Unusable spread | 10 reps, drop-first, CV < 5% gate; cool machine; RUNBOOK flags |
| Streaming Stage 0 blocked on platform storage | P1-A/B slips | Engine side ships against local static files; storage migration is decoupled |
| Scope creep from UI/editor requests | P0 slips | Nothing before Gate 1; UI round 2 is W7 |
| Consumers drift from the engine | Breakage surfaces late | `release:local` at every gate, not ad hoc |

## 7. If the deadline compresses

Minimum viable path to a defensible resubmission is **W1–W3 only**: matrix runner, execute the
matrix, rewrite Section 5 from real data. Everything from W4 on is strengthening, not
unblocking. If even that is too long, drop P0-A and run the matrix by hand — it costs ~2–3
extra days of clicking and loses the reproducibility-automation story, but the data is the same.

Do not cut: 10 reps on Scene 3, the drop-first rule, and the scene fingerprint per row. Those
are exactly what made the previous evaluation unusable.
