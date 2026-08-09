# Research + plan: bringing the architecture to Unity parity (drafted 2026-08-04)

Commissioned as "make it exactly like Unity". This document answers three questions in order:
**what Unity's architecture actually is**, **what this engine has today** (measured, not
recalled), and **what it would take to close the distance** — sequenced, sized, and honest
about which parts cannot be closed at all.

---

## 0. The honest framing, before the plan

"Точь-в-точь как в Unity" is not reachable, and roughly a fifth of it should not be attempted.
Three reasons, and they change what the plan optimises for:

1. **Some of Unity is its native runtime.** IL2CPP, Burst, the C# job system, PhysX, Enlighten
   GI baking. A browser engine on Three.js cannot have these; the nearest equivalents (WASM,
   Web Workers, a JS physics library) are different engineering with different limits.
2. **Some of Unity is its editor**, and the editor *is* the architecture. Unity's asset
   pipeline, serialization format and Inspector are one interlocking system; you cannot adopt
   the runtime half and leave the editor half for later without building the wrong thing twice.
3. **Some of Unity is legacy** this project is better off not copying — `.meta` files as loose
   YAML siblings, the `Resources/` folder, the two parallel UI systems, `SendMessage`.

So this plan sorts every item into **Adopt** (do it Unity's way), **Adapt** (same concept,
web-native mechanism), or **Reject** (with the reason). A plan that pretends all three are the
same thing would be a worse plan.

**What "Unity-like" already means here.** The engine deliberately matches Unity's *API surface
and semantics* — `GameObject`/`Component`, the `MonoBehaviour` lifecycle, `RectTransform`,
Cinemachine, coroutines. That work is largely done and is not what is missing. What is missing
is Unity's **asset and serialization architecture** — the part that makes an editor possible.

---

## 1. Where this engine actually stands

Measured 2026-08-04.

| Subsystem | LOC | Files | Unity parity |
|---|---:|---:|---|
| ui | 7 802 | 27 | **High** — uGUI equivalent, incl. layout, masking, scrolling, transitions, navigation |
| math | 6 376 | 11 | **High** |
| graphics | 4 823 | 11 | Medium — materials/shaders/textures; no SRP concept |
| components | 2 774 | 9 | Medium — Camera, lights, LODGroup |
| scenario | 2 331 | 5 | **N/A — no Unity equivalent** (see §3.1) |
| diagnostics | 1 683 | 4 | Above Unity in places (VRAM estimates, CPU frame time) |
| rendering | 1 452 | 6 | Medium — static batching + GPU instancing present |
| cinemachine | 950 | 9 | High (Cinemachine 3.x shapes) |
| assets | 881 | 3 | **Low — path-addressed, no database** |
| particles | 808 | 4 | Low (Shuriken subset) |
| input | 578 | 3 | Medium |
| animation | 518 | 3 | **Low — clips only, no Animator state machine** |
| serialization | 502 | 3 | **Low — exists but unused by the engine itself** |
| audio | 481 | 4 | Medium |
| postprocessing | 342 | 4 | Low |
| reflection | 289 | 3 | **Low — see below** |
| physics (`src/engine/physics/`) | — | 11 | Medium — Rigidbody, 4 collider types, PhysicMaterial, Collision |

**Three measured findings drive everything below.**

**Finding 1 — the serialization system exists and nothing uses it.**
`@Serializable` / `@SerializedField` decorators, a `TypeRegistry`, a `SceneSerializer` and a
`Prefab` class are all implemented. A grep across `src/engine/core` for components carrying
those decorators returns **nothing but the serializer's own files**. `SceneSerializer`'s own
doc comment concedes it: *"Built-in components (Transform, MeshRenderer, ...) are serialized
only if they have `@Serializable` metadata."* They do not. So today a saved scene loses every
built-in component and keeps only decorated user scripts. In Unity, serialization is not
opt-in — it is the substrate the Inspector, prefabs, undo and the build pipeline all stand on.

**Finding 2 — assets are addressed by path, not identity.**
`ScenarioAssets` caches by *normalized path string*. Unity addresses every asset by a **GUID**
that survives renaming and moving; the path is only a lookup convenience. Without stable
identity there can be no reliable reference from a scene to a material, no rename-safe editor,
and no dependency graph.

**Finding 3 — there is no build-time asset processing.**
Textures ship as authored. The one exception, KTX2, is a per-scenario shell script plus a
`--ktx2` flag that puts **both** formats in the archive and picks at runtime. Unity decides at
import time and ships one variant. (This is the thing the previous conversation identified;
it is a symptom of Findings 1–2, not an isolated gap.)

---

## 2. Unity's architecture, pillar by pillar, with a verdict

### 2.1 Asset pipeline — **Adopt (adapted storage)**

Unity: source assets in `Assets/`, each with a `.meta` sidecar holding a **GUID** and importer
settings. `AssetDatabase` maps GUID → path → imported artifact. Importers
(`TextureImporter`, `ModelImporter`, `AudioImporter`) turn source into platform-specific
artifacts cached in `Library/`, keyed by a hash of (source + settings + importer version).
Per-platform overrides select compression per target. Only the artifact ships.

Verdict: **adopt the model wholesale** — GUIDs, sidecar settings, deterministic artifact
hashing, per-target overrides. **Adapt** the storage: JSON sidecars rather than Unity YAML, and
"platform" becomes *device capability profile* (desktop GPU / mobile GPU / no-compression
fallback), because the web has one platform and many capabilities.

### 2.2 Serialization + prefabs — **Adopt**

Unity: `[SerializeField]` on private fields, references as `{fileID, guid}`, prefabs with
nesting, variants and per-instance overrides recorded as a property-path diff.

Verdict: **adopt**, including the override-diff model. This is the single highest-leverage
item: the Inspector, prefabs, undo, and scene diffing are all consequences of it. The
decorators already exist — what is missing is applying them to every built-in component and
adding reference resolution by GUID.

### 2.3 Scene / GameObject model — **Already there**

`GameObject`, `Component`, `Transform` hierarchy, `SceneManager`, tags and layers all exist and
match. Gaps are small: additive scene loading, `DontDestroyOnLoad`, and script execution order
(`grep` for `executionOrder` returns nothing).

### 2.4 Editor — **Adopt the architecture, not the UI**

Unity's Inspector is *generated* from serialization metadata, with `CustomEditor` and
`PropertyDrawer` as escape hatches; `Undo` records serialized-state diffs; play mode
serializes, runs, and restores.

Verdict: adopt generated-inspector-from-metadata and diff-based undo. These are free once §2.2
lands and prohibitively expensive without it — which is the strongest argument for ordering.

### 2.5 Rendering — **Adapt, mostly Reject**

Unity: SRP (URP/HDRP), ShaderLab, SRP Batcher, lightmapping, probes, shadow cascades.

Verdict: **reject SRP as a shape** — it is an abstraction over native graphics APIs the engine
does not own; Three.js already is that layer. **Adopt** the pieces that are architecture rather
than implementation: a render-pipeline seam (already listed as roadmap P2.8), material property
blocks, and a documented shader authoring path. Lightmapping/GI: **reject** for now — it needs
a baking toolchain, and the engine's audience does not have one.

### 2.6 Physics — **Adapt**

Unity: PhysX, with a layer collision matrix, joints, continuous detection, `FixedUpdate`.

Verdict: the component *API* is already Unity-shaped (`Rigidbody`, colliders, `PhysicMaterial`,
`Collision`). Gaps: the layer collision matrix, joints, and trigger/collision callback
completeness. Adapt around the backing library rather than chasing PhysX behaviour exactly —
matching PhysX numerically is not achievable and not worth pretending.

### 2.7 Animation — **Adopt (large)**

Unity: `Animator` + state machines, blend trees, `Avatar` retargeting, Timeline, IK.

Verdict: this repo has clips and a player (518 LOC). The **Animator state machine and blend
trees** are the parity gap that matters; retargeting and Timeline are further out. Adopt the
state-machine model; defer the rest.

### 2.8 Scripting runtime — **Partly there, partly Reject**

`MonoBehaviour` lifecycle, coroutines, `ScriptableBehaviour` — present and faithful.
Missing: **execution order control**, and a true `ScriptableObject` (an asset that holds data
without a GameObject — distinct from `ScriptableBehaviour`, which is the MonoBehaviour analogue
despite the name).
Reject: DOTS/ECS, the job system, Burst.

### 2.9 Build pipeline — **Adapt**

Unity: build targets, player settings, stripping, AssetBundles/Addressables, build reports.

Verdict: ScenarioCreator is already this, in embryo. Adapt it into a real pipeline: per-target
asset variants, a dependency graph, and a build report. Addressables maps onto the
already-proposed streaming work (`design/asset-streaming-proposal.md`).

### 2.10 Package management — **Reject**

npm already fills this role. UPM exists because Unity predates a package manager it could use.

---

## 3. Two places this engine is deliberately *not* Unity

Recording these so the plan is not read as "erase every difference".

### 3.1 The scenario system has no Unity equivalent

`src/engine/core/scenario/` (2 331 LOC) loads a ZIP containing compiled scripts and assets, then
links and runs it at runtime. Unity has nothing like this: a Unity game is a *build*, not a
document a viewer opens. This exists because the platform's requirement is "students open a
lesson", and it should stay. Where Unity is the better teacher is **inside** the ZIP: the
manifest should become a real, GUID-addressed asset database rather than a path list.

### 3.2 Y-down UI coordinates

Documented, deliberate, permanent (see `design/canvas-ui-roadmap.md` §3). "Exactly like Unity"
would mean flipping it — which would add a coordinate flip to every draw call and every pointer
event to match a convention no browser uses. **Reject.**

---

## 4. The plan

Five stages. Each is independently valuable and leaves the engine working; the ordering is
forced by dependency, not preference.

Effort: **S** ≈ 1 week · **M** ≈ 2–4 weeks · **L** ≈ 1–2 months · **XL** ≈ 3 months+, for one
developer. These are architecture-sized, not feature-sized.

### Stage 1 — Make the engine serialize itself (**M**) ⭐ start here

*Nothing else on this list is affordable until this is true.*

**Progress — step 0 landed 2026-08-05: the serializer gaps that block step 1.**
Decorating thirty built-in components would have written three defects into all of them at
once, so these went first:

- **Compound fields are now written *in place*** (`SceneSerializer._assign` copies into the
  existing instance when the types match) rather than replaced. Two built-in patterns need
  this: a field declared `readonly` — `Selectable.colors`, `Navigation` — cannot be replaced
  without breaking its own contract, and anything holding a reference to the old vector (a
  cached layout snapshot, a group) would otherwise keep writing to an object nothing reads.
- **`Rect` and `Bounds` round-trip.** `ValueSerializer` knew Vector2/3/4, Quaternion and
  Color; UI rects, camera viewports, sprite regions and collider bounds are all one of the
  two missing types, so half the built-ins could not have been serialized correctly.
- **A duplicate type name is refused rather than accepted.** A collision silently makes one
  class unloadable — scenes referring to it rebuild the *other* one. This is the failure mode
  step 2 exists to prevent, so the registry now reports it instead of letting it through.
  Re-registering the *same* class stays legal (two bundle copies, hot reload).

**Progress — step 1 begun 2026-08-05: `Camera` and the light family are serializable.**
Ten fields on `Camera`, eight on the `Light` base (inherited by all four subclasses via
`getAllFields`' prototype walk) plus each subclass's own. Every one registers under an
**explicit** `typeName`, never the class name, so a minifier cannot rename a component out of
every saved scene.

One defect found by decorating rather than by reasoning: `Camera.backgroundColor` and
`Camera.viewport` are accessors that **return a clone on every read**. The in-place copy
above would have written the loaded value into a throwaway and dropped it silently. The
loader now distinguishes the two by reading the property twice — a plain field returns the
same instance, a cloning getter does not — and assigns through the setter in that case.
`Transform.localPosition` behaves the same way, so this would have bitten again immediately.

**Progress — the UI layout core is serializable (2026-08-05).** `RectTransform`,
`CanvasGroup`, `LayoutElement`, the layout groups (`Horizontal`/`Vertical`/`Grid`),
`ContentSizeFitter`, `AspectRatioFitter` and `RectMask2D`. That is the half of
canvas-ui-roadmap §6.6 the engine can deliver before Stage 2: a whole laid-out panel now
survives save → load, hierarchy and all.

It needed one more serializer rule. A **settings struct** — `LayoutPadding`, `MaskPadding`,
and later `ColorBlock` and `Navigation` — has no `copy` method and comes back from JSON as a
bare object, so assigning it would leave the field holding something without any of the
class's methods. Those are merged key-by-key into the instance the component already owns.
A test asserts `padding instanceof LayoutPadding` after a round trip, since the failure is
otherwise invisible until something calls `padding.set()`.

**Progress — physics is serializable (2026-08-05).** `Rigidbody` (mass, both drags, gravity,
kinematic, constraints) and the `Box` / `Sphere` / `Capsule` colliders, with `isTrigger`
inherited from the `Collider` base.

Decorating these replaced the rule the previous step had guessed at. A collider's `center`
and `size` are **accessors whose setters resize the cannon-es shape**, so writing the field
in place would have loaded a component whose reported size and real collision volume
disagreed — the kind of defect that surfaces as "physics is subtly wrong" much later. The
loader now decides by **descriptor**: a property with a setter is always assigned through it,
because the setter is the component's own definition of what storing means. Only plain data
fields are written in place. That covers `Camera`'s defensive clone and
`AspectRatioFitter`'s clamp under one rule, and retires the two-reads heuristic.

**Progress — `@ExecutionOrder` landed 2026-08-05 (Stage 1 item 4).** Global, Unity's
`[DefaultExecutionOrder]` semantics: lower runs first, everything undecorated sits at `0`,
and within one order the hierarchy still decides — so adding the decorator to one class
cannot reshuffle anything else.

Implemented as **passes over the existing hierarchy walk**, not as a sorted global registry.
A registry would have replaced hierarchy order with registration order for the equal-order
case, silently changing the order every existing scenario already runs in. Instead the loop
walks the tree once per *distinct declared order*, and that list stays `[0]` until a scenario
actually declares one — so the default path does no ordering work at all, not even a lookup
per component.

**Stage 1 is now done except for the components that need Stage 2.** Serializing:
`Camera`, all four lights, `RectTransform`, `CanvasGroup`, `LayoutElement`, the three layout
groups, `ContentSizeFitter`, `AspectRatioFitter`, `RectMask2D`, `Rigidbody`, and the three
colliders. Still waiting on asset identity: renderers (`mesh`, `materials`), `LODGroup`
(renderer references), and the UI graphics and controls (`sprite`).

**Round-trip tests are the regression net Stage 1 asked for** — 53 cases in
`tests/Serialization.test.ts`. Worth recording what they caught, since the plan's own
argument for doing Stage 1 first was that it would tell you whether the rest is worth
walking: **three separate defects in the value-assignment rule**, none of them findable by
reading the code, each found by decorating one more real component. The answer that gives is
encouraging — the tests were cheap to write and they work.

1. Apply `@Serializable` / `@SerializedField` to **every** built-in component — `Transform`,
   `Camera`, lights, renderers, colliders, `Rigidbody`, the UI components, `LODGroup`.
2. Add a **stable type name** per component, independent of the class name, so renaming a class
   does not break saved scenes.
3. Round-trip tests: build a scene with one of each component, serialize, deserialize, assert
   equality. This is the regression net for everything after.
4. Add script **execution order** (`@ExecutionOrder(n)`), since ordering must be serialized too.

**Done when:** a scene containing every built-in component survives save → load unchanged.

**Why first:** the Inspector, prefabs, undo, and the build pipeline are all derived from this.
Building any of them first means building it twice.

### Stage 2 — Asset identity and the database (**M**)

**Progress — the runtime half of steps 2–3 landed 2026-08-05.** `AssetDatabase`
(`core/assets/AssetDatabase.ts`) holds GUID ↔ path ↔ loaded instance, and serialized asset
references are now `{ $type: "AssetRef", guid }` rather than path strings. `Resources` binds
every decoded asset on load, so an object acquires an identity without any call site asking
for one; clearing the source clears the database with it.

Decisions worth recording:
- **The engine owns the runtime half, not the sidecars.** `.meta` files are authoring
  artifacts — ScenarioCreator and the editor write them — so the engine takes them as a
  manifest (`AssetDatabase.setManifest`) instead of reading files it has no business reading.
- **A missing manifest mints session-local ids** so references still resolve *within* a run.
  Deliberately random rather than derived from the path: a path-derived id changes when the
  file moves, which is the one thing an id must not do. Those ids do not survive a reload,
  which is exactly the gap a manifest fills, and the JSDoc says so.
- **An unresolved reference is reported, not dropped.** Loading is asynchronous and
  deserialization is not, so a scene referring to an unloaded material rebuilds with that
  field null and the id listed in `SceneSerializer.pendingAssetGuids`; a caller preloads
  those and calls `resolvePendingAssets()`. Silently nulling would surface as a blank
  material at first render with nothing to trace it to.
- The path rides along in the JSON for diagnostics only — nothing resolves through it.

**Done when** (from the original plan) *renaming an asset on disk breaks nothing* — there is
now a test for exactly that: save a scene, move the asset, load it, and the reference still
points at the same instance.

Remaining for Stage 2: sidecar `.meta` generation and the manifest in the scenario archive
(both ScenarioCreator work), and migrating `ScenarioAssets` to resolve through the database
while keeping the path API as a shim.

1. **GUIDs.** Every asset gets a stable id, stored in a sidecar (`foo.png.meta`, JSON).
2. **`AssetDatabase`** — GUID ↔ path ↔ loaded object, with rename/move tolerance.
3. **References by GUID** in serialized scenes: `{ guid, localId }` replacing path strings.
4. Migrate `ScenarioAssets` to resolve through the database; keep the path API as a shim so
   existing scenarios keep working.

**Done when:** renaming an asset on disk breaks nothing.

### Stage 3 — Importers and build-time processing (**M**)

*This is where the KTX2 question from the previous discussion actually gets answered.*

1. **`TextureImporter`**: maxSize, compression (auto / KTX2 / none), mipmaps, wrap/filter, sRGB
   — persisted in the sidecar.
2. **Capability profiles** replacing Unity's platform overrides: `desktop` / `mobile` /
   `fallback`.
3. **Artifact cache** keyed by hash(source + settings + importer version) — the thing that makes
   re-imports cheap and builds reproducible.
4. Build emits **one** variant per profile instead of shipping both formats; the manifest
   records which. Test builds may still emit both for A/B measurement.
5. `ModelImporter` (scale, normals, material extraction) and `AudioImporter` after.

**Done when:** a production ZIP carries one texture format, chosen at build, and re-importing an
unchanged asset costs nothing.

### Stage 4 — Prefabs and the generated Inspector (**L**)

1. Prefab **instances** with per-instance override diffs (today `Prefab` is a snapshot only).
2. Nested prefabs and prefab variants.
3. **Inspector generated from serialization metadata**, with custom-drawer escape hatches.
4. **Undo** as serialized-state diffs.
5. Play mode: serialize → run → restore.

**Done when:** the editor can author a scene the runtime loads identically, and the Inspector
required no per-component UI code.

### Stage 5 — Runtime parity items (**L**, parallelisable)

Independent of 1–4, and of each other:

- **Animator state machine + blend trees** (`M`) — the largest single runtime gap.
- **Layer collision matrix + joints** (`S`)
- **Additive scene loading + `DontDestroyOnLoad`** (`S`)
- **`ScriptableObject`** proper — data assets without a GameObject (`S`)
- **Render pipeline seam** (`M`) — already roadmap P2.8, prerequisite for WebGPU
- **Addressables-equivalent streaming** (`L`) — already specified in
  `design/asset-streaming-proposal.md`

---

## 5. What this costs, and the honest recommendation

Stages 1–4 are roughly **4–6 months** of focused work for one developer; Stage 5 adds as much
again. That is a re-architecture, not a feature.

**Recommendation: do Stage 1, then decide.**

Stage 1 is ~2–4 weeks, is useful on its own (scenes save and load correctly, which they do not
today), unblocks the editor, and is a prerequisite for every other stage. It is also the
cheapest way to find out whether the full path is worth walking: if the round-trip tests are
painful to write, that is real information about Stages 2–4.

Two cautions worth stating plainly:

- **The thesis does not need this.** Its critical path is the Section 5 evaluation data. Stage 1
  helps the editor chapter; Stages 2–4 do not help the paper at all and would consume the time
  it needs. This plan describes the engineering, not a claim that it should start now.
- **"Exactly like Unity" is the wrong success metric.** Unity's architecture is shaped by
  constraints this engine does not share (native runtime, C# reflection, one editor). The
  parts worth copying are the ones that solve problems this engine *actually has* — and those
  are, in order: serialization the engine itself uses, asset identity, and import-time
  processing. That is Stages 1–3, and it is where the value is concentrated.
