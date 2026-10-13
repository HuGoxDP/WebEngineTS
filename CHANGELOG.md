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

- **Prefab instances know their prefab, and keep knowing it through a save.**
  `GameObject.isPrefabInstance`, `prefabSource` and `prefabNodeId` say whether an object is the
  root of a prefab instance, which prefab, and which node of it each object is;
  `unpackPrefab(completely)` cuts the link, and refuses a prefab nested inside another instance,
  naming the instance to unpack instead. Every node of a prefab now has an id, so an instance is
  compared with its prefab node by node: `Prefab.getOverrides` no longer misreads a removed
  sibling as edits to the next one, and `PrefabDiff.compareChanges` reports added and removed
  children and components alongside the values (`PrefabChanges` and its parts are exported).
  An object that has no ids — one saved or copied before they existed, or the object a prefab
  was made from without `connect` — is still compared with the prefab by position, as before.
  `Prefab.instantiate`, `instantiateWithOverrides` and `revert` return instances; `revert` puts
  the fresh one in the old one's place (see *Changed*). An instance keeps its link through undo,
  Play restore, copy and paste and `EngineObject.Instantiate`; a copy of an object from *inside*
  an instance is a plain object, as a duplicate of one is in Unity. A prefab made from an object
  that holds another prefab's instance keeps it as a link, so it follows that prefab — and is no
  longer instantiated as an empty shell. **Saved files gain two optional keys**: `id` on the
  nodes of a prefab and of an instance, and `prefab: { guid }` on an instance root. A scene with
  no prefab instance in it is written byte for byte as before, and a reader that predates the
  keys ignores them. A prefab file written before ids existed is given ids derived from node
  positions, the same ones on every load.
- **Scenes and prefab files can save prefab instances as links:**
  `SceneSerializer.serializeScene(scene, { prefabs: "link" })` (and `serializeGameObject`) writes
  an instance as its prefab plus what differs — values, added and removed children and
  components — so an edit to the prefab reaches every scene that uses it on its next load, while
  each instance keeps its own changes. The instance's name, position and rotation always stay its
  own; its scale and active state follow the prefab unless overridden. A reference counts its
  path from the instance it is written in, or says how many instances out it counts from
  (`scope`). Reading such a file needs the prefabs loaded first:
  `SceneSerializer.assetReferences` lists them, and loading a prefab file through `Resources`
  loads the prefabs nested inside it, without hanging on two that contain each other — and
  waits for one that another load is still reading. An
  instance whose prefab is not loaded becomes a **placeholder** that keeps its link and is saved
  back exactly as it was read, with a warning; load the prefab and open the scene again to
  rebuild it. A reference from the rest of the scene into a placeholder, or to one of its
  components, has nothing to find: it is null, a warning names its holder and field, and it is
  lost if the scene is saved before the prefab is loaded. Changes that address something the
  prefab no longer has are kept (`unused`) and apply again if it comes back. An instance that
  reordered or reparented its prefab's own objects is saved in full, with a warning — inside an
  instance that is itself saved as a link, as an object its changes add in full. A linked
  instance does not copy its prefab's inline materials into the scene. The default stays
  `"expand"`, which writes every instance in full.
  **A file holding a link, or a reference that names a prefab node by id, is written as
  `version: 2`; the engine refuses any version above 2.** Every engine that will read such files
  — including any that runs exported scenarios — has to be on a build that reads version 2 before
  anything writes them.
- **A change inside a prefab nested in another is recorded one field at a time.** An override
  is addressed through the nesting — `PrefabOverride.node` may be `"outer/inner"`, the nested
  instance's id and then the node's id in the nested prefab — and is folded into the nested
  instance's own link when it is applied. So when the outer prefab later edits a *different* field
  of the same nested instance, the edit reaches every instance of it, and an edit to a child or
  component the outer prefab itself added to the nested instance, or its removal, is kept as well.
  Before, an instance that touched
  anything inside a nested prefab stored that prefab's whole link and stopped following all of
  it; files written that way are still read. `PrefabDiff.compareChanges` takes an optional
  resolver for the nested prefabs' trees; without one, or without the prefab loaded, it compares
  the two links' changes instead, so a scene opened while a nested prefab is missing saves its
  changes back one field at a time, as they were read. A change that no longer applies inside
  a nested instance stays one field too, and applies again if the nested prefab gets its object
  back.
- **What an editor's prefab workflow calls.** `GameObject.prefabInstanceRoot` and
  `outermostPrefabInstanceRoot` find the instance an object belongs to, crossing nested prefabs
  for the outermost (the one a Hierarchy marks and the only one that can be unpacked);
  `isPrefabAssetMissing` says an instance's prefab is not loaded. `Prefab.getChanges(instance)`
  lists what an instance changed — values, added and removed children and components — as a
  link save records it, addressed by node ids that `prefabNodeId` maps back to live objects.
  `Prefab.applyInstance` writes an instance into its prefab (or into a variant's changes),
  keeping the prefab root's own name, position and rotation, and refuses an instance that holds
  the prefab itself. `Prefab.revertOverride` undoes one change in place, so untouched objects
  keep their identity and references to them stay valid. `Prefab.removeUnusedOverrides` drops
  what no longer applies. `Prefab.fromGameObject(go, name, { connect: true })` makes `go` an
  instance of the prefab made from it, as Unity's Save As Prefab Asset And Connect does.
- **A prefab variant keeps its base when it is saved.** `Prefab.toJSON()` writes a variant whose
  base has an id as `{ name, version: 2, base, changes }`, and `Prefab.fromJSON` reads it back as
  a variant that follows later edits to its base; loading it through `Resources` loads the base
  first. Instantiating a variant whose base is not loaded throws an error naming the base, and a
  scene instance of one becomes a placeholder. `Prefab.createVariant` also accepts
  `PrefabChanges`, so a variant can add and remove children and components, and
  `Prefab.variantChanges` returns them. A variant whose base has no id is flattened, as before.

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

- **`Prefab.revert` leaves the instance where it was.** The fresh instance keeps the old one's
  place among its siblings and its name, local position and rotation — what an instance never
  takes from its prefab, and what Unity's Revert All leaves alone too. It used to come back at
  the prefab's own position, attached to the old parent keeping its world pose. The old instance
  is now destroyed at once rather than once the running task finishes, so a save made straight
  after a revert — an editor's undo snapshot, say — no longer writes both.
- **`Prefab.toJSON()` returns the exported `SerializedPrefab`**, whose `snapshot` is optional: a
  variant saved with its base has `base` and `changes` instead. Code that reads `snapshot` from
  the result directly has to allow for that.
- **`SerializedScene.version` is `1 | 2`.** Version 2 marks a file only a reader that knows prefab
  links can read (see *Added*); `deserializeScene` and `Prefab.fromJSON` now throw for a version
  above 2 instead of loading it hollow. A scene saved in the default mode is version 1 unless it
  writes back, as it read them, a placeholder's link or data whose paths name nodes by id — an
  unknown component's from a prefab file, or changes kept as unused. A reader that refuses
  version 2 therefore cannot always reopen a default-mode save either.
- **`PrefabDiff.compare` and `compareChanges` compare trees in the form a prefab is stored
  in**: nested prefab instances as links, references naming prefab nodes by id. That is the form
  `Prefab.getOverrides` and `Prefab.getChanges` read a live instance in, and they are what to call
  for one. A snapshot from `SceneSerializer.serializeGameObject(instance)` — what `getOverrides`
  itself used to compare — is not: its nested instances and its references inside the instance
  read as changes. An object with no node ids at all is still compared by position.
- **A reference path may hold prefab node ids.** `PendingGORef.path`, the `path` of
  `DeserializeContext.pendingGORefs` and `pendingComponentRefs`, and `SerializeContext.locate`
  are now `Array<number | string>`. Inside a prefab instance a reference names its target by node
  id rather than by child position, so it still finds it after the prefab gains or loses a child
  in front of it, and removing a sibling inside an instance no longer turns every later
  reference into an override. Code that reads these paths must accept a string segment: a node
  id, looked for among the descendants without entering a nested instance. Ids are written
  where prefab instances are saved as links and in prefab files. The default save encodes
  all-number paths as before, but what it writes back as it was read keeps its ids: a
  placeholder's link, the data of an unknown component or value, changes kept as unused. A prefab
  file from before node ids has its references read as ids on load, the data of its unknown
  components included.
- **`Texture2D.fromKTX2ArrayBuffer` warns once per run** when `maxSize` is set, because the cap
  does not reach it. Behaviour is unchanged — one console line where there was silence.

### Fixed

- **A destroyed child is gone from its parent.** Destroying a GameObject removed its Three.js
  object but left its `Transform` in the parent's child list, so `childCount`, `getChild` and
  sibling indices still counted it, and the serializer still wrote it. The editor deletes objects
  this way, so **a deleted child came back, with no components, on the next save or undo.** It
  now leaves the list when it is destroyed: at once for `destroyImmediate`, at the end of the
  frame for `destroy`, as in Unity.
- **A material with no file stays in the scene on every save, under one id.** A scene carries a
  material built in code in its `assets` table. Loading the scene gave the material that id, and
  the next save then took the id for a file: it wrote a bare reference and dropped the table
  entry, so the scene reopened in a new session with the material missing for good. Editor
  autosave hit this on the second save. An asset with no file behind it is now written into the
  table every time, under the id it already has, and its reference never carries a `path`. A
  material saved twice without being reloaded keeps its id too, so an unchanged scene saves
  byte-identically. The same cause made an untouched instance of a prefab with such a material
  report `MeshRenderer.sharedMaterial` as an override; it no longer does. A prefab's own material
  of this kind is the one exception to "the id it already has": a scene carries its copy under an
  id of the scene's, since one id written into both files let whichever a session read first
  decide the material — a scene opened before an edited prefab handed every new instance of it
  the scene's stale copy. Copies, undo and Play restore in one session still share the prefab's
  material.
- **A child keeps its local position, rotation and scale when a scene is loaded.** The loader
  set a child's saved pose and then attached it to its parent keeping its *world* pose, which
  subtracted the parent's: a child at `(0, 0.5, 0)` under a parent at `(1, 2, 3)` came back at
  `(-1, -1.5, -3)`. Every load, undo and `EngineObject.Instantiate` of a hierarchy whose parents
  were not at the origin with no rotation and unit scale was affected. **Scenes that were saved
  after such a load hold the displaced values** and keep them; only the loader is fixed.
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
- **Every push is typechecked, tested, built and packed in CI**, and each completed run keeps the
  packed tarball as a workflow artifact named after the commit it built. An unreleased change
  can be installed and tried from there without building the engine locally; the artifacts
  expire, so nothing deployed should depend on one.
- **Releases are published as GitHub Releases.** Pushing a `vX.Y.Z` tag runs the same checks
  on that commit and attaches the tarball, the standalone bundle with its `.d.ts`, and the
  Basis transcoder pair that matches the bundled three. A consumer can now pin
  `https://github.com/HuGoxDP/WebEngineTS/releases/download/vX.Y.Z/WebEngineTS-X.Y.Z.tgz`
  instead of committing a copied tarball; npm fetches it without a token, so a Docker build
  needs no credentials. The release notes are this file's section for that version. A tag that
  disagrees with `package.json`, has no section here, or leaves entries under `[Unreleased]`
  publishes nothing, so a release's notes always cover what its build contains.

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
