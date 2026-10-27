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

- **A scenario can report a result, and the host page receives it from the sandboxed player.**
  `ScenarioBehaviour.reportResult({ score, completed? })` (protected) sends a score in 0..1 to the
  host: out-of-range scores are clamped, a non-finite one is dropped, a report before `start()` or
  after the scenario is destroyed is ignored, and a repeat of the previous report is not re-sent.
  `Scenario.onResult` is the engine-side hook a host installs; the player installs it and forwards
  a new protocol-v1 message `{ v: 1, type: "result", score, completed }`, which `PlayerHost` parses
  like every other player message (never cast) and delivers to the new
  `callbacks.onResult({ score, completed })`. The manifest gains an optional `graded?: boolean`
  (a hint for the host; the loader passes it through and the engine never reads it).
  `IScenarioResult` and `PlayerResult` are exported. Additive: protocol version stays 1.

- **Prefab instances know their prefab, and keep knowing it through a save.**
  `GameObject.isPrefabInstance`, `prefabSource` and `prefabNodeId` say whether an object is the
  root of a prefab instance, which prefab, and which node of it each object is;
  `unpackPrefab(completely)` cuts the link, and refuses a prefab nested inside another instance,
  naming the instance to unpack instead. Every node of a prefab now has an id, so an instance is
  compared with its prefab node by node: `Prefab.getOverrides` no longer misreads a removed
  sibling as edits to the next one, and `Prefab.getChanges` reports added and removed
  children and components alongside the values (`PrefabChanges` and its parts are exported).
  An object that has no ids — one saved or copied before they existed, or the object a prefab
  was made from without `connect` — is still compared with the prefab by position, as before.
  `Prefab.instantiate`, `instantiateWithOverrides` and `revert` return instances; `revert` puts
  the fresh one in the old one's place (see *Changed*). An instance keeps its link through undo,
  Play restore, copy and paste and `EngineObject.Instantiate` — provided its prefab has an asset
  id (it was saved, or loaded through `Resources` or `AssetDatabase`). A prefab made in code and
  never given one has nothing to be named by, so its instances are copied and saved as plain
  trees and the copy is not an instance. A copy of an object from *inside*
  an instance is a plain object, as a duplicate of one is in Unity. A prefab made from an object
  that holds another prefab's instance keeps it as a link, so it follows that prefab.
  **Saved files gain two optional keys**: `id` on the
  nodes of a prefab and of an instance, and `prefab: { guid }` on an instance root. A scene with
  no prefab instance in it is written byte for byte as before — apart from the defects fixed
  below, which change what a scene that hit them writes — and a reader that predates the keys
  ignores them. A prefab file written before ids existed is given ids derived from node
  positions, the same ones on every load.
- **Scenes can save prefab instances as links, and prefab files always do** (see *Changed*):
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
  prefab no longer has are kept (`unused`) and apply again if it comes back. A child the instance
  added is placed after the prefab child it follows (`PrefabAddedChild.after`, `null` for first),
  so a child the prefab gains in front neither moves it in among the prefab's own nor changes
  what a save writes. When that child is gone it goes after the nearest earlier one the instance
  still has (first, if none) — or last, if the prefab no longer has it. A file with an `index`
  and no `after` is placed by its index, as before. An instance that reordered or reparented its prefab's own objects is
  saved in full, with a warning — inside an instance that is itself saved as a link, as an object
  its changes add in full. A linked instance does not copy its prefab's inline materials into the
  scene. The default stays `"expand"`, which writes every instance in full.
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
  Before, an instance that touched anything inside a nested prefab stored that prefab's whole
  link and stopped following all of it; files written that way are still read.
  `Prefab.getChanges` finds the nested prefabs' trees itself; where a nested prefab is not
  loaded it compares the two links' changes instead, so a scene opened while a nested prefab is
  missing saves its changes back one field at a time, as they were read. A change that no longer applies inside a nested instance stays one field too, and
  applies again if the nested prefab gets its object back. An outer prefab made while its nested
  prefab was not loaded holds the nested instance in full; once that prefab is loaded, an
  untouched instance of the outer one has no changes, and a change inside the nested instance is
  one field, applied to the outer prefab's copy.
- **What an editor's prefab workflow calls.** `GameObject.prefabInstanceRoot` and
  `outermostPrefabInstanceRoot` find the instance an object belongs to, crossing nested prefabs
  for the outermost (the one a Hierarchy marks and the only one that can be unpacked);
  `isPrefabAssetMissing` says an instance's prefab is not loaded. `Prefab.getChanges(instance)`
  lists what an instance changed — values, added and removed children and components — as a
  link save records it, addressed by node ids that `prefabNodeId` maps back to live objects.
  `Prefab.applyInstance` writes an instance into its prefab (or into a variant's changes),
  keeping the prefab root's own name, position and rotation, and refuses an instance that holds
  the prefab itself. `Prefab.revertOverride` undoes one change in place, so untouched objects
  keep their identity and references to them stay valid; a removed child or component it
  builds again is what the instance's references point at again, wherever its prefabs say so
  and the reference still holds the removed object — and so is what any reference elsewhere in
  the scene that still held it points at, found by node id (a component only when it is the one
  of its type there; otherwise the reference is left empty, with a warning). A reference set to
  `null` is never re-pointed, since it may be the scene's own change — so **a reference to a
  removed object that was saved and reloaded in between stays null**. A nested instance whose
  children were reordered is reported as removed and added again under one id; reverting either
  half reverts both, and builds the nested instance once, as a link — reverting one half used to
  leave two live copies under one id, or none. `Prefab.revert` keeps every reference from elsewhere in the scene into
  the instance — from its twin in the same outer prefab, the instance around it, or a plain scene
  object — pointing at the object that takes its place, as Unity's revert keeps identity; one
  whose object the revert takes away is left empty, with a warning naming the holder and field.
  An object the scene added is never taken for the prefab's object that now stands at its place,
  and a component on an object that had fewer of its type than the prefab gives it is left empty
  too, since which of them it was cannot be told until components have ids of their own.
  `Prefab.removeUnusedOverrides` drops what no longer applies. `Prefab.fromGameObject(go, name, { connect: true })` makes `go` an
  instance of the prefab made from it, as Unity's Save As Prefab Asset And Connect does. Asked
  of a prefab nested inside another instance, each of these works against that prefab as the
  prefabs around it change it, as Unity does: `getChanges` lists what the scene changed on it,
  `applyInstance` writes only that into its prefab (not what the outer prefab sets on it), and
  `revert` and `revertOverride` go back to what the outer prefab sets. Whatever the instance —
  nested or not, of a prefab or of a variant — `applyInstance` writes no reference out of it: a
  changed value that points out leaves the prefab's own, and one on a child or component the
  scene added is applied as null.
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

- **The engine says which file versions it reads.** `SceneSerializer.readableVersions` (frozen
  `[1, 2]`), `SceneSerializer.versionOf(json)` — the version a file states: `1` when absent, a
  whole number of 1 or more when present, `null` for anything else (`"2"`, `0`, `null`, `1.5`,
  `-1`, or a value that is not an object) — and `SceneSerializer.canRead(json)`. Every refusal
  throws the new `UnsupportedFormatError`, exported by name and on the default namespace, with
  `version` (what the file stated), `readable` (what the reader reads) and `what` (`"scene"`,
  `"prefab"`, `"gameObject"`, `"material"` or `"physicMaterial"`, the exported `FormatKind`), so
  a host can word the message itself instead of parsing a string. A host that wants to know
  before it hands a file over (an editor deciding whether to offer to open it) asks `canRead`.
  Material and physic material files are read as version 1 only; their writers state
  `version: 1` as before and are unchanged.

- **A sandboxed player for scenario code, shipped with the engine.** `dist/player/` holds
  `player.html`, `player.js` and `player.nginx.conf`: a page that runs a scenario in an `<iframe sandbox>`
  document on an opaque origin, so the scenario's own scripts cannot reach the host page's storage,
  tokens, DOM or `top`. A host serves the three files under one path (`player.nginx.conf` carries every
  header the page must have: the CSP, `sandbox`, `frame-ancestors 'self'` and `Access-Control-Allow-Origin: *`,
  which the frame needs to read the engine bundle and transcoder from `Origin: null`), and keeps its
  own page free of an import map and of `blob:` in `script-src`. The page refuses to start when it is
  opened top-level or on a non-opaque origin, loads the engine by URL, and runs KTX2 inside the frame (with
  `'unsafe-eval'`, which only the frame's CSP grants). It resumes the `AudioContext` on the first key or
  pointer event inside the frame, because the engine never does. The measured CSP, the `sandbox`/`allow`
  tokens and the capabilities per browser are in `design/player-sandbox.md`.
- **`WebEngineTS/player-host`: the host side of that player, with no engine in it.** `import { PlayerHost,
  PLAYER_PROTOCOL_VERSION, type PlayerMessage, type PlayerMetrics } from "WebEngineTS/player-host"`.
  `new PlayerHost(container, { playerUrl, engineUrl, transcoderPath?, expectedOrigin?, callbacks? })` puts the
  frame in `container`, checks that the player reports origin `"null"` and protocol `v1` before it sends a
  byte, then talks over a private `MessageChannel`. `load({ kind: "blob" | "manifest", … }, { diag })`,
  `restart()` (always a fresh frame), `pause()`, `resume()`, `toggleDiagnostics()`, `measure(seconds)` and
  `dispose()`; progress, FPS, pause state, errors and context loss come back as callbacks. Everything the
  frame sends is parsed and capped (text 500 characters, numbers finite and in range). The handshake times
  out after 10 s and a load after 60 s, reset on each progress report. `npm run size` now also holds
  `player-host.js` and `player.js` to a size budget and fails if either contains engine code.
- **`Scenario.engineModuleUrl`: a scenario's bare `"WebEngineTS"` import can resolve to the running engine
  without an import map.** A static `string | null`, `null` by default; set it before a load and the
  scenario pre-linker rewrites every form of the bare specifier (`import x from`, `import * as`,
  `export … from`, `export * from`, side-effect `import "…"`, dynamic `import("…")`, single or double
  quotes) to that URL. Subpaths and lookalikes (`"WebEngineTS/x"`, `"WebEngineTSx"`) are left alone. The
  setter throws for anything but an absolute `http(s):` or `blob:` URL, and for quotes, backslashes,
  whitespace and `<`, `>` or backtick, because the URL is spliced into untrusted source. The rewrite
  is a token match, not a parser: a `from "WebEngineTS"` inside a string or a comment is rewritten too.
  With it unset the output is byte for byte what it was, so a host that keeps its import map is unaffected.
  The player sets it.
- **Space pauses and resumes inside the player.** With the scenario's frame focused, Space toggles
  pause and the player reports it, so a host's HUD follows without handling the key itself. It is ignored with
  a modifier held, in a text field, and for key repeats; the scenario's own `Input` still sees the key.
- **`npm run player-smoke`.** Runs a real scenario archive through the shipped files themselves
  (`player-host.js`, `dist/player/*`, served with the headers of `player.nginx.conf`) in Chromium, Firefox
  and WebKit: the player boots on an opaque origin, imports the real engine, runs a scenario whose
  script imports bare `"WebEngineTS"`, restarts into a new frame, and pauses once per Space press. `-- --spike`
  and `-- --dirty` run the capability table and the remove-one-directive checks `design/player-sandbox.md` was
  measured with. It borrows Playwright from virtual-lab's `e2e/` in either layout. WebKit's pointer lock and
  audio cannot be observed headless on Windows and need a manual Safari run.

### Changed

- **`MemoryProfiler.diagnosticsAllowed` is a one-way latch.** Once it has been set to `false` it stays
  `false` for the page's lifetime: assigning `true` afterwards is ignored and logs a
  `console.warn("[MemoryProfiler] …")`, and an overlay already on screen stays closed. Before this a scenario
  could reopen the gate its host had closed. It is policy, not a security boundary — scenario code in the same
  realm can still reach engine internals; only the sandboxed player is a boundary. A host that closes the
  gate and later reopens it (a benchmark run that hides the overlay for one phase, a test) no longer can:
  set it once, before the first scenario. Tests use the `@internal` `MemoryProfiler._resetDiagnosticsPolicy()`.
  Setting `false` twice, or `true` before any `false`, behaves as it did.
- **`release:local` finds virtual-lab at `virtual-lab/` or at `testv/virtual-lab/`, and refuses a tarball
  without the player.** When both exist the one at the workspace root is used and the other is reported,
  never written to. Packing now fails, before anything is copied to a consumer, if `dist/player/*` or
  `dist/player-host.js` is missing from the tarball.
- **The tarball is larger by the player files.** `dist/player/*` and `dist/player-host.js` ship in the
  existing `dist` list. Nothing here runs in the engine's frame loop or changes rendered output, so no
  measured number is expected to move; that was not measured. The `diagnosticsAllowed` latch can change what
  a benchmark that reopens the overlay shows, not what it measures.

- **`Prefab.revert` leaves the instance where it was.** The fresh instance keeps the old one's
  place among its siblings and its name, local position and rotation — what an instance never
  takes from its prefab, and what Unity's Revert All leaves alone too. It used to come back at
  the prefab's own position, attached to the old parent keeping its world pose. The old instance
  is now destroyed at once rather than once the running task finishes, so a save made straight
  after a revert — an editor's undo snapshot, say — no longer writes both.
- **Prefab files take the new form without anything opting in.** Link mode is opt-in for scenes
  only: `Prefab.toJSON()` always writes the prefab instances nested in a prefab as links and the
  references between its own objects by node id. A prefab holding either — most do — is
  therefore `version: 2`, a version-1 file read with `Prefab.fromJSON` and saved again included.
  An engine from before this build checks no version: reading such a file it throws on the
  references, and builds the nested instances empty. A prefab file with neither stays in the
  version-1 form, with only `id` keys added, which an older engine ignores.
- **`Prefab.toJSON()` returns the exported `SerializedPrefab`**, whose `snapshot` is optional: a
  variant saved with its base has `base` and `changes` instead. Code that reads `snapshot` from
  the result directly has to allow for that.
- **`SerializedScene.version` is `1 | 2`.** Version 2 marks a file only a reader that knows prefab
  links can read (see *Added*); `deserializeScene` and `Prefab.fromJSON` now throw for a version
  above 2 instead of loading it hollow. A scene saved in the default mode is version 1 unless it
  writes back, as it read them, a placeholder's link or data whose paths name nodes by id — an
  unknown component's from a prefab file, or changes kept as unused. A reader that refuses
  version 2 therefore cannot always reopen a default-mode save either.
- **A scene, prefab, GameObject, material or physic material file whose `version` is not an
  integer this build reads is refused with `UnsupportedFormatError`** (before: `"3"`, `0`, `null`
  and the like were accepted, a lone GameObject was not checked, and a prefab file's references
  were loaded before its version was looked at). `deserializeScene`, `deserializeGameObject`,
  `Prefab.fromJSON`, `SceneSerializer.deserializeAsset` and the `Resources` decoders for
  prefabs, materials and physic materials all apply the one rule, and the decoders apply it
  before they load anything the file refers to. A snapshot from `serializeGameObject` states no
  version and reads as 1, as before. The error's message is reworded (it names the kind of file
  and the versions read); a caller that matched on `/version 3/` still finds it.
- **A scenario manifest whose `manifestVersion` major is not 1 is refused.** `Scenario` accepted
  any present value, so a manifest written for a newer engine loaded and was misread. `"1"`,
  `"1.0"`, `"1.2"`, `"1.0.0"` and the number `1` are read; `"2.0"` is refused as asking for a
  newer engine, and `"v1"` or `"1.0abc"` as not a version number — the rule the platform
  applies at upload. The manifest converted from a streaming manifest passes through the same
  check. An `engineVersion` in the manifest is never a reason to refuse; one whose `major.minor`
  is newer than the running build's logs a single warning naming both (pre-release stamps such
  as `0.1.0-local.<timestamp>` are ignored, and an engine running from its sources compares
  nothing).
- **`Prefab.getOverrides` compares an instance in the form a prefab is stored in**: nested
  prefab instances as links, references naming prefab nodes by id — the form `Prefab.getChanges`
  reads it in too. An untouched instance therefore has no overrides, nested instances included.
  `getOverrides` used to compare a snapshot from `SceneSerializer.serializeGameObject(instance)`,
  whose nested instances and references inside the instance read as changes; `PrefabDiff`,
  which is internal and no longer exported from the package, expects the stored form as well. An object with no node ids at all is
  still compared by position.
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
- **The serializer's contexts say where a reference is counted from.** `SerializeContext` gains
  an optional `locate`; pending-reference entries gain `ref` (`RefScope`, now exported);
  `componentIndex` may return -1.
- **`PrefabAddedChild.index` is optional, and not written.** An added child is placed by
  `after`, the prefab sibling it follows; the position written beside it moved whenever the
  prefab gained a child in front, so a link save of a scene nobody touched showed a diff. A file
  that gives only `index` is still placed by it, and one that gives both is placed by `after`.
  Code that reads `index` from what `Prefab.getChanges` returns must allow for its
  absence.
- **`PrefabOverride.path` is optional, and not written where `node` is.** An override addresses
  its object by node id; the position written beside it changed whenever the prefab gained or
  lost a child in front, so a link save of a scene nobody touched rewrote every such override and
  showed a diff in version control. It is now written only where `node` is absent — a prefab
  whose nodes have no ids, or a node inside a nested instance held in full, whose ids belong to
  another prefab; one read beside a `node` from an older file is accepted and ignored, and an
  override that gives neither is not applied. Code that reads `path` from what
  `getOverrides` or `getChanges` return must allow for its absence and use
  `node` (`GameObject.prefabNodeId` maps it to the live object).
- **`Texture2D.fromKTX2ArrayBuffer` warns once per run** when `maxSize` is set, because the cap
  does not reach it. Behaviour is unchanged — one console line where there was silence.
- **A scene loaded from a file puts its children where they were saved** (see *Fixed*: "A child
  keeps its local position, rotation and scale when a scene is loaded"). Every hierarchy whose
  parents were not at the origin with no rotation and unit scale used to load displaced, so this
  moves objects and **can change what such a scene costs to draw** — a measurement of a scene
  loaded from a file is not comparable across the fix.
- **The standalone bundle is minified: 917,253 → 391,742 bytes gzip** (4,077,276 → 1,505,564 raw,
  gzip at level 9, measured on this build); class and function names are kept. A student's
  browser downloads about 525 KB less. Only `WebEngineTS.standalone.js` changes — the ESM and
  CJS builds stay readable, because a consumer bundling them minifies the result itself.
  Because class and function names are kept, `constructor.name`, scenario code that registers
  by class name and the warnings that print one read as before; local names and comments are
  gone, apart from the three.js and jszip licence notices. The bundle no longer ends with a
  `//# sourceMappingURL` comment, which pointed at a file hosts do not copy: the map is still
  written beside it, and a release attaches `WebEngineTS.standalone.js.map` for reading a stack
  trace. A host that took the unminified bundle's stack traces at face value needs that map.
  **Load time changes** (download and parse); frame time is not expected to, and was not
  measured, so a benchmark that records the load phase is not comparable across this build.

### Fixed

- **A UI object reloaded with two RectTransforms and lost its saved layout.** `go.addComponent(UIImage)`
  — the usual way to make a UI object — lists `[UIImage, RectTransform]`, because the graphic's
  `awake` adds the rect it needs. A load added the UIImage first, so that `awake` added a fresh
  default RectTransform and the saved one came in beside it: the graphic bound to the default, **the
  layout the author set was gone**, the object held two rects, and an instance of a prefab made from
  such an object reported a RectTransform in `Prefab.getChanges.addedComponents` that nobody had
  added. Every Canvas UI scene the editor saves had this shape. A load now builds every component of
  an object before the first of them wakes, so the graphic finds the saved rect, and an object keeps
  the component list it was saved with. Each component then wakes and takes its fields in list order,
  as before; the one difference a script can see is that, during a load, its `awake` and `onEnable`
  find a component listed after it (`getComponent` answered `null`), which has not woken yet.
  Fields are still written after a component wakes, not before as in Unity: a built-in setter that
  runs before its `onAwake` loses the value (`DirectionalLight.shadowDistance` read back 200 for a
  saved 75). A scene already saved with two RectTransforms on one object — each reload added one —
  now loads with one: the extra copies are folded into the first, the later saved values winning,
  since those are the ones that carry the original layout, with a warning naming the object. Saving
  again writes one. The other places that add a missing sibling (`LayoutGroup`, `RectMask2D`,
  `Animator`) do it on first use rather than in `awake`, so a load does not reach them.
- **A destroyed child is gone from its parent.** Destroying a GameObject removed its Three.js
  object but left its `Transform` in the parent's child list, so `childCount`, `getChild` and
  sibling indices still counted it, and the serializer still wrote it. The editor deletes objects
  this way, so **a deleted child came back, with no components, on the next save or undo.** It
  now leaves the list when it is destroyed: at once for `destroyImmediate`, at the end of the
  frame for `destroy`, as in Unity.
- **A destroyed component is gone from its object (D5).** A component left its GameObject's
  component list only when removed with `removeComponent`; `destroy()` and `destroyImmediate()`
  left it listed, so `getComponent(s)` still returned it and **a saved scene kept it, along with
  every reference to it, and brought both back to life on load.** The editor deletes with
  `destroyImmediate`, and a prefab instance never reported such a component as removed. It now
  leaves the list after its `onDisable` and `onDestroy` have run: at once for `destroyImmediate`,
  at the end of the frame (or after its delay) for `destroy`, and when its GameObject is
  destroyed — including one a sibling adds from its `onDisable` or `onDestroy` while the object
  is being destroyed. Removal replaces the list instead of splicing it, so `removeComponent`
  called from `update` no longer makes the next component skip its update that frame. A
  component whose `onDestroy` throws still leaves the list, as it already did through
  `removeComponent`, and now ends destroyed too (see the next entry). The `Transform` is not
  part of the list and is untouched.
- **A component whose `onDestroy` throws is destroyed anyway, and destroying an object from its
  own `onDestroy` is a no-op.** The object was marked destroyed only after `onDestroy` returned,
  so one that threw stayed `exists()` and was found by `FindObjectsOfType` — yet no longer listed
  on its GameObject, so destroying that object never reached it again. Nothing could destroy it.
  Unity logs the exception and destroys the object regardless; so now does the engine: the
  object leaves the registry and the persistent set whatever its `onDestroy` did, and
  `destroyImmediate` then rethrows the error to the caller as before. A throwing `onDisable`
  keeps the same promise — `onDestroy` still runs. Destroying a GameObject whose component
  throws logs the error and goes on destroying the other components, the children and the
  Transform, instead of aborting half way and leaving the object registered with its scene; a
  timed `destroy(delay)` that throws no longer strands the objects due after it, nor ends the
  frame loop. Asking an object to destroy itself from inside its own `onDestroy` — or two
  components each asking the other — used to recurse without bound, because `exists()` is still
  `true` during `onDestroy` (so that it can read its object). It runs once now. `exists()` during
  `onDestroy` is unchanged.
- **A child destroyed during its parent's update loop no longer breaks the loop.** `update`,
  `fixedUpdate` and `lateUpdate` walked a GameObject's children by index over a count taken
  before the first one ran, so a child that destroyed a later sibling, an earlier one or itself
  made the walk throw `RangeError: Transform.getChild: index 2 out of range [0, 2)` — and the
  rest of the frame's scripts did not run. They now walk the list as it stood when the walk began
  and skip any child destroyed since, or moved to another parent (which runs it there, once). The
  same holds for the walks that tell children about a change: `setActive` and `broadcastMessage`
  no longer skip the sibling after a destroyed one. `Transform`'s child list is copy-on-write
  while a walk holds it, so a frame in which nothing changes allocates nothing, and a child
  created during a walk joins the next frame.
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
  material. The scene's copy says what it is a copy of — `of: { prefab, id }` on its table entry
  (`SerializedAsset.of`) — so a scene opened in a new session *after* that prefab, whose material
  still serializes as the copy does, shares the prefab's material too, and follows it: without
  it every instance got a copy of its own, reported a `MeshRenderer.sharedMaterial` change, and a
  link save recorded that and stopped following the prefab. With the prefab not loaded, or its
  material changed since, the copy is used, as before. `of` is optional and leaves the file at
  version 1: a reader that predates it ignores it and uses the copy. Any loaded prefab whose table
  carries that id will do, so a material saved into two prefabs binds through either.
  `SceneSerializer.assetReferences` lists the prefab `of` names, and the new
  `optionalAssetReferences` says it is one the file reads without, so a loader that follows the
  list binds the copy, and one the project lacks is passed over without a warning (`AssetFiles`
  does both). A scene opened *before* the prefab — what an editor that opens a scene directly
  does — keeps the copy, but once the prefab is loaded a copy that still serializes as the
  prefab's material counts as it: no `sharedMaterial` change, nothing carried by a link save, and
  `of` still written by a full one; the copy follows edits to the prefab's material only after the
  scene is opened again. A scene that bound to the prefab's material goes on writing `of` after the
  prefab is unloaded.
- **A child keeps its local position, rotation and scale when a scene is loaded.** The loader
  set a child's saved pose and then attached it to its parent keeping its *world* pose, which
  subtracted the parent's: a child at `(0, 0.5, 0)` under a parent at `(1, 2, 3)` came back at
  `(-1, -1.5, -3)`. Every load, undo and `EngineObject.Instantiate` of a hierarchy whose parents
  were not at the origin with no rotation and unit scale was affected. **Scenes that were saved
  after such a load hold the displaced values** and keep them; only the loader is fixed. **This
  changes where such a scene's objects are when it is loaded, and so can change what it costs to
  draw** — a measurement of a scene loaded from a file is not comparable across the fix.
- **A reference to a removed component no longer comes back pointing at another one.** A
  component reference is saved as its object plus which component of that type it is, and a
  component that had been removed counted as the first. So a field that held a removed component
  — a button's target graphic, say — was saved as a reference to the first component of the same
  type on that object, and reopened pointing there (or at nothing, if there was none). It is now
  saved as `null`, as a reference to a destroyed GameObject always was. A scene that held such a
  reference saves `null` where it used to write that `ComponentRef`.
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
