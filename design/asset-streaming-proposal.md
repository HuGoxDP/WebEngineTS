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

**Stage 0 engine half complete 2026-08-11** — the manifest-driven *scenario* loader landed.
The seam is where a scenario's **scripts** come from, not a second loader: `IScenarioScriptSource`
(`listScripts` + `readScript`) is satisfied by both `ZipAssetSource` and `StreamingAssetSource`,
so pre-linking, the entry-point brand check, the context an entry point receives and every
`Resources` call from scenario code are shared verbatim. Entry points:
`Scenario.loadFromManifestUrl` / `Application.loadScenarioFromManifest`.

Three decisions worth keeping:

- **`ScenarioAssets` now sits on an `IAssetSource`** instead of owning a JSZip. That is what
  makes the expensive, Three.js-facing half — GLTF import, material conversion, texture
  decoding — shared rather than duplicated for streaming. Its ZIP half moved out into
  `ZipAssetSource`; a JSZip is still accepted and wrapped, so nothing downstream changed.
- **Scripts are not part of the `IAssetSource` face.** `has`/`list` stay asset-only: `Resources`
  decodes assets into engine objects, and a module is neither decodable that way nor something
  scenario code should reach by path.
- **Every module is fetched during pre-linking, none deferred.** The import graph has to be
  fully rewritten before any of it runs, so a lazily loaded module is not expressible — unlike
  an asset, which is what Stage 1 defers.

The manifest schema gained `scripts`, `entry`, `name` and `description`; `toScenarioManifest`
converts one into the `IScenarioManifest` the loader already speaks. The two manifests are
deliberately **not** merged: a streaming manifest says *where the bytes are*, a scenario
manifest says *what the content is and how to start it*.

**Still not done, and outside this repo:** the content-addressed store, the storage migration
off Google Drive, and the editor's publish step.

### Stage 1 — Progressive first paint (critical vs. deferred)
- Manifest marks assets `critical` vs. deferred; loader shows the scene after scripts +
  critical assets, then loads the rest after the first frame.
- **Done when:** time-to-first-frame drops materially on Scene 3 / real scenarios (measured);
  no visual regressions once fully loaded.

**Engine half done 2026-08-11.** `Resources.prefetch(paths, { concurrency, onProgress })` warms
the decoded-asset cache by choosing each decoder from the path's extension, so a manifest's
asset list can be preloaded with no type token. `Scenario` uses it twice: `critical` assets are
warmed inside `run()` **before** the entry point runs, so `awake()`'s own `Resources.load` calls
hit a cache instead of the network; `high` then `low` are fetched from `_onFrameRendered`, which
`Application._loop` calls after each frame and which acts only on the first. `lazy` is never
preloaded — reading one already fetches it, and preloading it would make the declaration
meaningless.

Decisions worth keeping:

- **A prefetch is not a use.** Each asset's own reference is released once decoded, so it sits
  cached at zero references: a later `load` finds it warm, and `unloadUnused` can still reclaim
  it if nothing ever asked. Otherwise every optimistically fetched asset would be pinned for the
  lifetime of the scenario.
- **Failures are per-asset, not per-batch** — the same reason `tryLoad` exists. One missing
  texture must not cancel the other forty. A background pass also stops early if the scenario
  unloaded under it, rather than failing once per remaining asset.
- **The loop reports every frame; the scenario decides what "first" means.** `_onFrameRendered`
  is idempotent, so `Application._loop` carries no scenario state.
- **ZIP scenarios are untouched.** An archive is already in memory, so there is nothing to defer
  and no preload to gain; the streaming path is the only one with a decision to make.

`Scenario.timeToFirstFrame` (ms from `run()` to the first drawn frame, `-1` before) is reported
on **both** paths — that is what makes a ZIP run and a streamed run of the same content
comparable, and it is the number this stage exists to move.

**Not done:** the measurement itself. The A/B on Scene 3 belongs to the harness in
WebEngineTS-Benchmarks, and needs a streamed build of a real scenario to run against.

### Stage 2 — On-demand + preload (priority streaming)
- Priority queue + bounded concurrency; `Resources.prefetch`; `lazy` assets load on reference.
- **Done when:** initial bytes/VRAM are lower than Stage 1; smooth behaviour on throttled
  networks; prefetch demonstrably hides latency.

**Engine half done 2026-08-11.** `StreamingAssetSource` now *schedules* requests instead of
issuing them: at most `maxConcurrentRequests` (default 6) are in flight and the rest wait in a
queue ordered by priority. Without a queue, priority had nothing to act on — every request had
already been sent, which is why bounded concurrency and the priority queue are one change rather
than two.

Ranking, in order: **demand** → critical → high → low → lazy, FIFO within a rank.

- **A real read outranks every speculation**, whatever the manifest declares. The declared
  priority says how eagerly to *preload*; an actual read is something waiting. A `lazy` asset the
  scenario just asked for must not queue behind two hundred speculative `low` fetches. The hint
  travels as `AssetReadOptions.speculative` on the `IAssetSource` seam — optional, so the ZIP
  source, which has nothing to schedule, simply ignores it.
- **A queued request is promoted** when something demands it, and stays one request: the waiters
  already holding its promise are the ones the demand read joins.
- **A request in flight is never re-ranked or cancelled.** It cannot be usefully un-sent and its
  bytes are wanted either way. Lowering `maxConcurrentRequests` therefore only narrows what
  starts next.
- `activeRequestCount` / `pendingRequestCount` are exposed so a host or the harness can see the
  queue working rather than infer it.

`lazy` assets already loaded on reference (a read fetches), and `Resources.prefetch` landed with
Stage 1 — so this completes the engine side of Stage 2.

**Not done:** the throttled-network and initial-bytes measurements, which need a streamed build
of a real scenario. Nothing here reorders *decode* work, only fetches.

### Stage 3 — LOD streaming (the headline)
- Editor pipeline emits per-asset LOD variants (KTX2 + mip levels; mesh decimation).
- `LODGroup` (+ streaming path) fetches/upgrades asset LOD by on-screen size + VRAM budget;
  placeholder → low → high; evicts under pressure using the VRAM estimator.
- **Done when:** peak texture VRAM drops sharply on the integrated GPU for a texture-heavy
  scene while near-camera quality is preserved (measured via `estimatedTextureVramBytes`).

**Eviction half done 2026-08-11.** `Resources.vramBudgetBytes` (default `Infinity`, i.e. off)
with `estimatedVramBytes` / `evictableVramBytes` and `evictToBudget()`. Over budget, the least
recently used **unreferenced** assets are destroyed until it fits, charged by the engine's own
per-asset accounting — so a KTX2 texture costs what it actually occupies on the GPU, not its
uncompressed size.

- **Referenced assets are never evicted.** Destroying a texture a material is holding would
  break rendering rather than save memory, so a scene whose *live set* alone exceeds the budget
  stays over it. `estimatedVramBytes` vs. `evictableVramBytes` is what says which case you are
  in; the budget is a target honoured as far as it honestly can be, not a guarantee.
- **Eviction runs on release, not only on load.** Dropping the last reference is the moment a
  candidate appears; waiting for the next load kept a prefetched asset alive one load too long.
  Found by a test that asserted the expected behaviour and failed against the first
  implementation.
- A cache hit counts as a use, so an asset loaded once at startup is evicted before one the
  scene keeps re-requesting.
- Assets with no GPU footprint are never chosen: evicting a JSON blob reclaims no VRAM and
  still costs a reload.

**The upgrade blocker is gone (2026-08-11).** Materials copied the underlying Three.js texture
reference at assignment time (`Material.ts`: `mat.map = value._internalThreeTexture`), so
replacing an engine texture's handle never reached anything already drawing with it. `Texture`
now keeps a referent set (`ITextureReferent`, `_addReferent` / `_removeReferent`) and notifies
it from `_setInternalThreeTexture`; `Material` registers on `setTexture`, on clone and on
`copyPropertiesFromMaterial`, and unregisters in `onDestroy` — registrations are strong, so a
material that failed to unregister would be kept alive by its own textures.

This fixed a live defect beyond streaming: `Texture.load(url)` swapped its handle in the loader
callback, so a material assigned that texture before the image arrived drew the empty
placeholder for the rest of the run.

**Per-asset level selection landed the same day.** `setLodLevel(path, level)` /
`clearLodLevel` / `getLodLevel` pick the level one asset is served at; `maxLodLevel` became a
**ceiling** rather than the only control, so a per-asset request is clamped by it and lowering
it globally cannot be undone asset by asset. A request is resolved against what the manifest
actually offers: asking above an asset's best gives its best, asking below its coarsest gives
the coarsest. `getLodLevel` reports the *resolved* level, which is what a fetch would bring.

**In-place reload landed the same day.** `Texture2D._adoptThreeTexture` takes over a freshly
decoded handle without the engine-side object changing identity, and `Resources.reload(type, path)`
re-reads at whatever level the source now serves and adopts into the cached instance. Combined
with the referent index, that is a working upgrade: set a level, reload, and every material
already holding the texture draws the new content.

Two decisions worth keeping:

- **A type that cannot adopt is refused, not silently replaced.** Swapping the cache entry
  would leave every existing reference pointing at the old content — which looks like it worked
  and is worse than an error. Only `Texture2D` adopts today; nothing else has levels to move
  between.
- **The freshly decoded shell is not destroyed.** Its Three.js texture now belongs to the cached
  instance, so destroying the shell would dispose the resource just handed over.

**Still open for the LOD half:**

1. **A policy** deciding *when* to upgrade — `LODGroup`'s on-screen size against the VRAM
   budget. Everything it would need to act on now exists; nothing calls it yet, so today a host
   or scenario drives the level by hand.
2. The editor emitting the variants, which is not this repo's work.

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
