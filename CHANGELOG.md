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

- **`Texture.flipVertically`** — states whether an image is flipped as it is uploaded. Two
  conventions meet in the engine: the image path uploads `flipY = true` (V=0 at the bottom, as
  Unity and the engine's own primitives expect), while glTF uploads `false` and a KTX2 texture is
  always `false` because block-compressed data cannot be flipped at all. So a separately-loaded
  map on a glTF-imported mesh samples upside down, and the same asset shipped as `.ktx2` does
  not — the file format changes the picture. Content can now say which orientation it wants
  instead of reaching past the API into the Three.js texture. Unifying the engine on one
  convention is planned separately: `design/unity-coordinates-plan.md`.
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

- **Four `Mesh.create*` primitives were wound inside out.** `createPlane`, `createCylinder`
  (its side wall), `createCapsule` and `createTorus` emitted triangle indices opposite to the
  normals they stored, so `side: FrontSide` culled them: a plane vanished entirely, a torus was a
  hollow shell, a cylinder an open tube with its lids intact. Every build has done this since the
  builders were written. **This changes what these primitives look like and therefore what they
  cost to draw** — any measurement taken on a scene using them is not comparable across the fix.
- **`createCapsule` also stitched its middle rings to the wrong neighbours.** The hemispheres
  ordered rings top-down while the cylindrical middle ordered them bottom-up, and one index grid
  joined them as if they agreed, so the middle band spanned the whole capsule.
- **An imported mesh keeps its second UV set, and it reaches the channel that samples it.**
  Two defects met in the middle: `Mesh.fromThreeGeometry` read only the `uv` attribute, dropping
  the second set every glTF import brought; and the writer emitted the engine's `uv2` as three's
  `uv2`, which is channel *two*. A material whose texture sits on `texCoord: 1` — an ordinary
  choice for normal and lightmap maps — therefore sampled an attribute that was not there. The
  failure does not look like a missing texture, it looks like broken shading. Engine `uv2` is
  Unity's second set, which is three's `uv1`.
- **Data textures are no longer decoded as sRGB.** `Texture2D.fromArrayBuffer` tags everything
  sRGB — it decodes an image and cannot know what the image means — while the KTX2 path tags
  nothing. So a normal map shaded one way as a JPEG and another as KTX2, and metallic-roughness
  maps were wrong on both. The `StandardMaterial` slot now says which it is: albedo and emission
  are colour, normal, metallic, occlusion and height are linear data, matching what three.js's
  `GLTFLoader` assigns to the same slots.
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
