# Proposal: Manifest-Driven Asset Streaming, LOD & Progressive Loading

Status: **in progress** (Stage 0 engine half landed 2026-08-10) · Scope: engine
(`WebEngineTS`) + platform (`testv/virtual-lab`) + editor (`WebEngineTSEditor/app`) ·
Author: engine team

## 1. Problem

Today a scenario is a single **monolithic ZIP** (manifest + compiled scripts + *all* assets).
It is downloaded whole (`Application.loadScenarioFromBuffer`) and every asset is decoded up
front. Storage is Google Drive behind an HTML-scraping proxy (see the storage analysis).

This packaging is the root blocker for the capabilities we want:

- **No LOD streaming.** All detail levels — if they even exist — are inside one blob; the
  engine cannot fetch a low-detail model/texture first and upgrade to high detail on demand.
- **No progressive first paint.** The scene cannot appear until the *entire* ZIP is
  downloaded and every texture is decoded → long time-to-first-frame, especially on the
  constrained networks/hardware the thesis targets.
- **No preloading / prioritization.** Loading is all-or-nothing; the engine cannot prefetch
  the next-likely asset or defer a rarely-seen one.
- **No cross-scenario dedup / caching.** Each ZIP re-bundles shared assets (skybox, common
  textures), so a shared 4K texture is re-downloaded per scenario and can't be cached by
  content.
- **No partial updates.** Changing one texture forces repacking + redistributing the whole ZIP.
- **High peak VRAM.** Every texture is uploaded at full resolution regardless of on-screen
  size — the opposite of what integrated GPUs (the paper's target) need.

The engine already ships the *runtime* primitives to fix this (see §5); what is missing is an
**asset-addressing model** (manifest + individually-fetchable, content-hashed assets) and a
**streaming loader** that uses it.

## 2. Goals / non-goals

**Goals**
- Progressive loading: show the scene ASAP, stream the rest by priority.
- LOD streaming: fetch low → high detail on demand (camera proximity + VRAM budget).
- Preloading + prioritization; lazy-load rarely-seen assets.
- Content-addressed, deduplicated, immutably-cached assets.
- Incremental publish (only changed assets re-uploaded).
- Keep the existing single-ZIP path working (offline / simple scenarios).

**Non-goals (for now)**
- Rewriting the rendering backend or the component model.
- Server-side rendering / OffscreenCanvas (tracked separately).
- Mandatory streaming — small scenarios may keep the one-ZIP path forever.

## 3. Target architecture

Move from *"one opaque ZIP"* to *"a small manifest + individually-addressable, content-hashed
assets"*, loaded by a streaming source that plugs into the existing `IAssetSource` seam.

### 3.1 Manifest (`scenario.json`)

Small JSON, loaded first. Declares scripts and assets; each asset carries type, content hash,
size, **priority**, and optional **LOD variants** and dependencies.

```jsonc
{
  "schema": 1,
  "id": "solar-system",
  "version": 3,
  "entry": "scripts/main.js",
  "scripts": [
    { "path": "scripts/main.js", "url": "/a/9f3c…c1.js", "hash": "sha256-9f3c…c1" }
  ],
  "assets": [
    {
      "id": "earth_albedo",
      "type": "texture",
      "priority": "high",          // critical | high | low | lazy
      "lods": [                    // ascending detail; loader upgrades on demand
        { "level": 0, "url": "/a/1a…512.ktx2",  "bytes": 180000, "hash": "sha256-1a…" },
        { "level": 1, "url": "/a/2b…2048.ktx2", "bytes": 720000, "hash": "sha256-2b…" }
      ]
    },
    {
      "id": "skybox",
      "type": "cubemap",
      "priority": "critical",      // needed for first paint
      "lods": [ { "level": 0, "url": "/a/7d…2k.ktx2", "bytes": 900000, "hash": "sha256-7d…" } ]
    }
  ]
}
```

- **Content-addressed URLs** (`/a/<hash>.<ext>`) → immutable, dedup across scenarios, cache
  forever (`Cache-Control: immutable`).
- **Priority** drives load order; **lods** drive on-demand quality.
- Assets may point into a bundled *base* ZIP (for critical/low-LOD assets, one request) **and**
  individual URLs (for streamed high-LOD) — a hybrid, so first paint is one round-trip.

### 3.2 Engine: a streaming `IAssetSource`

`Resources` already loads through a pluggable `IAssetSource` (today `ScenarioAssets`, ZIP +
JSZip). Add a **`StreamingAssetSource`** implementing the same interface, backed by the
manifest + `fetch` over HTTP/2 (cheap multiplexed small requests) instead of an in-memory ZIP.
Existing scenario code (`Resources.load`, `assets.loadTexture`, …) works **unchanged**.

New capabilities layered on top:
- **`ScenarioStreamer`** — priority queue + bounded concurrency + progress events; loads
  `critical`/`high` first, defers `low`, lazy-loads `lazy` on reference.
- **`Resources.prefetch(ids, priority)`** — explicit preloading.
- **Streaming texture upgrade** — placeholder → LOD0 → LODn; reuse KTX2 transcode +
  `Texture2D.releaseSourceImage()` per level.
- **`LODGroup` streaming integration** — when a detail level activates, ensure its asset LOD is
  loaded (fetch if missing), swap when ready; unload far/high LODs under VRAM pressure.
- **VRAM-budget eviction** — driven by the existing VRAM estimates (`MemoryProfiler`,
  `estimatedTextureVramBytes` / `…GeometryVramBytes`): evict the least-useful high-LOD assets
  when over budget.

### 3.3 Platform & editor

- **Storage** (see storage analysis): content-addressed object store (nginx volume → MinIO/R2)
  + CDN + immutable caching. Assets keyed by hash → automatic dedup.
- **Editor publish**: on export, split the scene into assets, generate **LOD variants offline**
  (KTX2 via `toktx`/`gltf-transform`; downscaled mips; decimated meshes), content-hash each,
  upload only **changed** hashes, emit the manifest. One atomic "Publish".

## 4. Staged rollout

Each stage is independently shippable and reversible, ends with measurable value, and builds
toward the full system. Metrics are captured with the existing `Benchmark` harness (load time,
frame time, VRAM) so every stage is quantified for the thesis.

### Stage 0 — Foundation: real storage + manifest (no engine streaming yet)
- Platform: drop Google Drive → content-addressed store (nginx/MinIO); immutable caching.
- Format: define `scenario.json` schema; ScenarioCreator/editor emit it beside the ZIP.
- Engine: `StreamingAssetSource` reads the manifest but still loads everything up front
  (behavioural parity with the ZIP path).
- **Done when:** a scenario loads identically from manifest URLs; storage no longer scrapes
  Drive; assets are immutably cached & deduped by hash.

**Engine half done 2026-08-10.** `core/assets/StreamingManifest.ts` defines and validates the
schema (`schema`/`id`/`baseUrl`/`assets[]`, each asset a path + optional guid + priority +
ascending LOD list); `core/assets/StreamingAssetSource.ts` implements `IAssetSource` over
`fetch`. `StreamingAssetSource.fromUrl` loads a manifest and makes its own location the default
base. `Resources.useSource` / `.releaseSource` install one outside the scenario pipeline;
`assetEntries()` hands identities to `AssetDatabase.setManifest` so a streamed scenario gets
the same durable asset ids a packaged one does.

Three decisions worth keeping:

- **Fetch on first read, not all up front.** Stage 0 says "loads everything up front"; per-asset
  fetching is strictly closer to the goal and, from scenario code, indistinguishable — the
  results are identical, only the timing differs (a round trip instead of a decompression).
  Nothing had to be built to *undo* later.
- **Bytes are not retained by the source.** `Resources` already caches the decoded asset;
  holding the compressed bytes as well would double the cost of every texture. Concurrent reads
  of one path still share a single request.
- **Assets without a `guid` get no identity** rather than a minted one. A made-up id that does
  not survive a reload is worse than none, because it looks stable.

`priority` and the LOD lists are parsed, indexed and queryable but nothing orders fetches by
priority (Stage 2) and nothing upgrades an asset as the camera nears (Stage 3); `maxLodLevel`
caps quality globally in the meantime, which is useful on its own for a low-memory device.

**Not done, and the honest remainder of Stage 0:** a manifest-driven *scenario* loader.
`Scenario` pre-links scripts out of the ZIP (`_prelinkAllScripts`, `_createRewrittenBlobUrl`),
so running a scenario from a manifest needs that path to fetch scripts by URL too. The storage
and publish halves live in the platform and editor repos, not here.

### Stage 1 — Progressive first paint (critical vs. deferred)
- Manifest marks assets `critical` vs. deferred; loader shows the scene after scripts +
  critical assets, then loads the rest after the first frame.
- **Done when:** time-to-first-frame drops materially on Scene 3 / real scenarios (measured);
  no visual regressions once fully loaded.

### Stage 2 — On-demand + preload (priority streaming)
- Priority queue + bounded concurrency; `Resources.prefetch`; `lazy` assets load on reference.
- **Done when:** initial bytes/VRAM are lower than Stage 1; smooth behaviour on throttled
  networks; prefetch demonstrably hides latency.

### Stage 3 — LOD streaming (the headline)
- Editor pipeline emits per-asset LOD variants (KTX2 + mip levels; mesh decimation).
- `LODGroup` (+ streaming path) fetches/upgrades asset LOD by on-screen size + VRAM budget;
  placeholder → low → high; evicts under pressure using the VRAM estimator.
- **Done when:** peak texture VRAM drops sharply on the integrated GPU for a texture-heavy
  scene while near-camera quality is preserved (measured via `estimatedTextureVramBytes`).

### Stage 4 — Full progressive + dedup + partial updates
- Content-addressed dedup across scenarios (shared assets fetched once, cached forever).
- Progressive texture (mip streaming) + audio streaming.
- Editor: incremental publish (only changed hashes uploaded).
- **Done when:** re-loading a scenario or loading a second scenario that shares assets fetches
  near-zero new bytes; publishing an edited scenario uploads only what changed.

## 5. Leverage — what already exists (build, don't rebuild)

- **`IAssetSource` seam** (`Resources` + `ScenarioAssets`) → add `StreamingAssetSource` beside
  the ZIP source; no scenario-code churn.
- **`LODGroup`** (`components/LODGroup.ts`) → on-screen-size selection already implemented;
  extend to gate on streamed asset LODs.
- **KTX2 / `Texture2D.maxSize` / `releaseSourceImage()` / `Cubemap.releaseSourceImage()`** →
  per-LOD GPU-compressed textures + CPU memory release, already in place.
- **VRAM diagnostics** (`MemoryProfiler.estimatedTextureVramBytes/…GeometryVramBytes/…RenderTargetVramBytes`)
  → the budget signal for eviction.
- **`Resources.tryLoad` / `loadBatch`** → extend with priority/prefetch rather than replace.
- **`Benchmark`** harness + `?scenario=` real-ZIP loading → measure every stage's load time,
  frame time, and VRAM on discrete vs. integrated GPUs.

## 6. Compatibility & risk

- `Application.loadScenarioFromBuffer` (single ZIP) stays — the manifest/streaming path is
  **additive** (a second `IAssetSource`); the engine picks the source from the input.
- Engine changes are additive (`Resources`/`LODGroup`/new source), not rewrites.
- Storage/editor changes live entirely in the platform + editor; the engine never depends on
  them.
- Each stage is small and independently valuable, so the migration can pause at any stage
  without leaving the system broken.

## 7. Metrics (thesis-relevant)

Per stage, on **discrete (RTX 3050)** vs **integrated (Intel UHD)** GPUs, via the benchmark
harness / real `?scenario=` runs:
- Time-to-first-frame and full-load time.
- Peak & steady texture/geometry/render-target VRAM.
- Frame-time percentiles under streaming vs. all-up-front.
- Bytes transferred on first load vs. repeat load vs. second scenario (dedup).

These directly strengthen the paper's loading-latency and VRAM-reduction claims and its
integrated-graphics story.
