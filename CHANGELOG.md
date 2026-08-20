# Changelog

What changed in each version of WebEngineTS, for the people who consume it.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are sections in
this one file rather than a file each: `scripts/release-local.mjs` stamps a unique
`0.1.0-local.<timestamp>` on **every** pack, so a file per stamped version would be one file per
build. The version that means something to a consumer is the released one, and that is what gets
a section here.

**Writing an entry.** Say what a consumer can now do, or what behaves differently, not which
files moved. Anything that changes a measured number belongs under *Changed* with that stated —
the benchmark suite reads this file to decide whether it has to re-measure.

---

## [Unreleased]

### Added

- **`Cubemap.fromEquirectangular` accepts a `Texture2D`**, not only a URL. This is the only way
  to build a skybox from a format the browser cannot decode — KTX2 above all: load the panorama
  through `Resources`, which honours `preferExtension` and transcodes, and hand the result over.
  A borrowed texture is not copied and not modified; the cubemap shares its GPU upload and holds
  a second handle differing only in mapping.
- **`Transform.dirtyTransformsEnabled`** — a read-only accessor for the dirty-transform batching
  switch, so a host that toggles it per run can record what the engine holds instead of what it
  asked for.
- **`MemoryProfiler.diagnosticsAllowed`** — a host-level policy that scenario code cannot get
  past. While it is `false`, `showOverlay`, `toggleOverlay` and `enableToggle` do nothing and an
  overlay already on screen is taken down. `snapshot()` still works: it puts nothing on screen.
- **`MemoryReport.renderer.textureFormats`** — live textures tallied by the GPU format they
  actually ended up in, e.g. `{ BC7: 3, ETC2: 8, RGBA8: 1 }`. Answers "did KTX2 transcode, and to
  what?" directly; a KTX2 asset reading `RGBA8` did not transcode.
- **`MemoryReport.renderer.liveTextures`** — how many engine texture objects the VRAM estimate
  covers, next to `textures`, which counts GPU uploads. The two always described different sets;
  only one had a number, so "retaining more textures" and "estimating the same ones differently"
  could not be told apart.

### Changed

- **`Texture2D.fromKTX2ArrayBuffer` warns once per run** when `maxSize` is set, because the cap
  does not reach it. Behaviour is unchanged — one console line where there was silence.

### Fixed

- **A borrowed cubemap is no longer counted twice in VRAM.** `MemoryProfiler` sums live textures
  and live cubemaps into one figure; a cubemap sharing a `Texture2D`'s upload now reports zero,
  since the source already reports those bytes.
- **`tests/SceneManagement.test.ts` no longer depends on test order.** Its reset helper called
  `loadScene`, which an object marked `DontDestroyOnLoad` survives by design, so a test that
  marked one left the next test's "fresh" scene already populated.

### Documentation

- **`Texture2D.maxSize` states which loaders honour it.** It caps what the engine decodes itself
  — `fromArrayBuffer`, `Load`, and `Cubemap.fromEquirectangular` given a URL. It does **not**
  reach KTX2 (block-compressed data cannot be resized through a canvas) or textures inside a GLB
  (three.js decodes them before the engine wraps them). Both were silent no-ops.
- **A host CSP needs `script-src blob:`.** Scenario scripts execute as ES modules from `blob:`
  URLs on every delivery path, and without that directive no scenario runs at all. Stated on all
  three `loadScenarioFrom*` entry points.
- **`loadScenarioFromManifest` documents URL resolution** — manifest asset URLs resolve the way a
  browser resolves a link, so relative and root-relative forms both work, and `baseUrl` replaces
  what they resolve against.
- `design/scenario-parameters-decision.md` records why there is no host-to-scenario parameter
  channel, and under what circumstances the question is worth reopening.
- `design/upstream-answers.md` replies to the three consumer gap lists in one place.

### Internal

- **The `GameObject` → `Prefab` → `SceneSerializer` import cycle is gone.** Rollup warned on
  every build; the cycle was safe only by convention, and one static field initializer would have
  turned the warning into an `undefined` at load. The serializer now builds GameObjects through a
  hook `GameObject` installs.
- Cross-layer hooks audited. Three of four are sound by construction; the fourth is pinned by
  `tests/ModuleHookInstallation.test.ts`.

### Known issues

- **The streamed path has been reported to hold ~2.9× the texture VRAM of the ZIP path** for the
  same scenario. Not reproduced from the engine side — `Resources` plus either source type give
  identical cache entries and identical estimates, pinned by `tests/SourceVramParity.test.ts`.
  Use the new `liveTextures` alongside `textures` to tell retention from mis-estimation; see
  `design/upstream-answers.md`.
- **KTX2 needs `'unsafe-eval'` in a host CSP.** The engine ships no transcoder — the file is
  three.js's Emscripten build, served by the host at `Texture2D.ktx2TranscoderPath`. A host that
  keeps a strict policy will see `textureFormats` report `RGBA8` for KTX2 assets.

---

## [0.1.0]

First packaged version. Consumed as a packed tarball by ScenarioCreator, WebEngineTSEditor and
`testv/virtual-lab`, and as a standalone bundle by WebEngineTS-Benchmarks.

Earlier history predates this file; see the git log.
