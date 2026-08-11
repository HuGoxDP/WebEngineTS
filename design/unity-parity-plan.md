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
| animation | 518 | 3 | High — state machine + blend trees; no retargeting/Timeline |
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

*Update 2026-08-10:* all three landed (Stage 5) — `LoadSceneMode.Additive` + `unloadScene` +
`moveGameObjectToScene`, `DontDestroyOnLoad`, and `@ExecutionOrder`. §2.3 is closed.

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

*Update 2026-08-10:* the seam is in — see Stage 5. The **shader authoring path** is in too:
`Shader.create(name, { vertex, fragment, uniforms })` compiles GLSL into a material driven by
the same `setColor` / `setFloat` / `setTexture` calls a built-in takes, so a material can move
from `Shader.Standard` to authored GLSL without changing how it is driven. The declared uniform
defaults fix each uniform's GLSL type (`Color` → `vec4`, alpha included, as Unity's `fixed4`
is); declaring them is required, because Three builds the program from the uniform object it is
handed and one added later would have nowhere to go. GLSL rather than a ShaderLab-alike: the
browser compiles GLSL, and a second language would buy nothing but a translator to maintain.

**Material property blocks are still open, and are harder here than they look.** Unity's block
overrides uniforms per renderer without instancing the material. Three.js re-uploads a
material's uniforms only when the material or program changes, so the same material drawn twice
in a row would keep the first object's values; the honest implementations are per-instance
attributes (which `InstancedMeshRenderer` already has) or a material instance. Worth doing
deliberately, not by patching uniforms in a draw callback.

### 2.6 Physics — **Adapt**

Unity: PhysX, with a layer collision matrix, joints, continuous detection, `FixedUpdate`.

Verdict: the component *API* is already Unity-shaped (`Rigidbody`, colliders, `PhysicMaterial`,
`Collision`). Gaps: the layer collision matrix, joints, and trigger/collision callback
completeness. Adapt around the backing library rather than chasing PhysX behaviour exactly —
matching PhysX numerically is not achievable and not worth pretending.

*Update 2026-08-10:* all three are closed. The matrix and joints landed on 2026-08-05 (Stage 5);
**callback completeness** landed now, and what "incomplete" actually meant was worse than the
word suggests — four separate defects, each found by a test written against Unity's documented
behaviour:

1. **A pair fired more than once per step.** One cannon contact *equation* is one contact
   point, so a box resting flat on the floor produced four of them; the loop dispatched per
   equation, so `onCollisionStay` arrived in the same step as `onCollisionEnter`, three times.
   Contacts are now grouped by pair before dispatch, and each pair fires exactly once.
2. **`Collision.contacts` never held more than one point,** though all four were in hand. The
   grouped pair carries every point.
3. **Callbacks went through `sendMessage`,** which calls every `ScriptableBehaviour` whether or
   not it is enabled — right for a broadcast, wrong for a physics callback. Unity delivers
   these to neither a disabled behaviour nor an inactive GameObject, and now neither does this.
   A destroyed receiver is skipped, which is what makes the Exit after a `destroy()` safe: the
   *other* object still hears that the collision ended.
4. **A Rigidbody added after a collider collided with nothing.** The collider had already built
   its own static body; the Rigidbody's body was left with zero shapes, silently. It now adopts
   the colliders already on its GameObject, as Unity does — order stops mattering.

`Rigidbody` learns about its colliders through a callback `Collider` installs at module load,
not an import: `Collider` already imports `Rigidbody`, and importing back made the build report
a circular dependency. Same pattern as `LayerCollisionMatrix._setChangeHandler`.

`Physics._reset()` now also drops the touching pairs. Left behind they stay "active", so the
first step after a scene load reports Exit for collisions belonging to a scene that is gone.

### 2.7 Animation — **Adopt (large)**

Unity: `Animator` + state machines, blend trees, `Avatar` retargeting, Timeline, IK.

Verdict: this repo has clips and a player (518 LOC). The **Animator state machine and blend
trees** are the parity gap that matters; retargeting and Timeline are further out. Adopt the
state-machine model; defer the rest.

*Update 2026-08-10:* the state machine **and blend trees** are done — see Stage 5.
Retargeting, Timeline and IK are still open.

### 2.8 Scripting runtime — **Partly there, partly Reject**

`MonoBehaviour` lifecycle, coroutines, `ScriptableBehaviour` — present and faithful.
Missing: **execution order control**, and a true `ScriptableObject` (an asset that holds data
without a GameObject — distinct from `ScriptableBehaviour`, which is the MonoBehaviour analogue
despite the name).

*Update 2026-08-10:* both exist now — `@ExecutionOrder(n)` with ordered dispatch in
`GameObject._systemUpdate`, and `ScriptableObject` (Stage 5). Nothing in §2.8 is open.
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

**The manifest seam landed 2026-08-05.** `IScenarioManifest.assets` — an optional
`{ guid, path }[]` — is handed to `AssetDatabase.setManifest` when a scenario activates its
asset source, before any decoder runs (a decoder that ran first would bind its asset to a
minted id and never see the declared one).

That closes the engine half of Stage 2. Without the field the engine still mints
session-local ids, so references resolve *within* a run but a saved scene could not find its
assets again after a reload; with it, an id is the same every run. There is a test for
exactly that difference, since it is the entire reason the field exists.

**Remaining for Stage 2, and it is not engine work:** ScenarioCreator has to *write* the
field — generate sidecar identities at import time and emit them into `manifest.json`. The
engine reads whatever it is given and degrades honestly when given nothing.

`ScenarioAssets` needs no migration after all: it is an `IAssetSource`, and `Resources` binds
every decoded asset into the database on load, so the path API already resolves through the
identity layer without a shim.

**`Sprite` needed its own answer (2026-08-05).** A `Sprite` is *not* a loadable asset — it is
a **framing** of one: a texture reference plus a sub-rect, border and pivot, usually
constructed in code rather than loaded from a file. Serializing it as an asset reference
would have produced null (it has no identity of its own); serializing it through the generic
object fallback would have flattened its texture into a meaningless plain object.

So `FieldType.Sprite` serializes the framing as a value with the *texture* referenced by id.
Two sprites cut from one atlas therefore share the texture on load and differ only in their
rect, which is the point of an atlas. The unresolved-reference path carries the framing
alongside the id, so a sprite whose texture arrives late is rebuilt whole rather than as a
bare texture.

This is the general shape of the remaining work: **a field is an asset reference only if the
thing behind it is loaded as a file.** Materials are the next case and are the same problem
— usually built in code, so they need either an identity of their own or value serialization.

**The UI controls followed (2026-08-05):** `Selectable`'s `interactable` and `transition`
(inherited by every control), then `Button`, `Toggle`, `Slider` and `Scrollbar`. A control
panel — layout group, label, slider, button — now reloads intact.

Two things worth pinning, and both have tests:
- **Loading state is not the user acting.** A restored `Toggle` does not fire
  `onValueChanged`; it goes through the property, and the property only notifies on an
  actual change. A scenario that wires handlers in `Start` would otherwise see a burst of
  fake input on load.
- **Field order matters and is now depended on.** `Slider.value` clamps to
  `[minValue, maxValue]`, so restoring it before the range would silently clamp `750` to `1`.
  `getAllFields` walks in declaration order, and the range is declared first, so it works —
  but that was luck until a test made it a requirement.

`Selectable.targetGraphic` stays out: it is a reference to another **component**, which the
serializer has no representation for. GameObject references exist; component references do
not, and inventing one belongs with prefabs (Stage 4) rather than here.

**The UI subsystem is now serializable end to end (2026-08-05):** `Canvas` and
`CanvasScaler` — the root a UI scene is nothing without — plus `ScrollRect`, `Dropdown`,
`InputField`, `VirtualJoystick` and `ToggleGroup`. That closes canvas-ui-roadmap §6.6 for
everything except component references.

`Canvas.pixelRatio` is deliberately **not** saved, and there is a test asserting its absence.
Its getter reports the *effective* ratio while its setter installs an **override**, so a
round trip would silently convert "follow the application" into "pin to whatever the
authoring machine had" — a scene authored on a HiDPI laptop would render at 2× on every
phone that opened it. An asymmetric accessor is a trap for any generic serializer, and it is
worth checking for one before decorating a property rather than after.

**Component references landed 2026-08-05** — `FieldType.Component`, serialized as the owning
GameObject's path plus the component's registered type name and an index. That last part
matters: a GameObject may legally carry two `UIImage`s, and without the index a reference to
the second would silently resolve to the first.

They resolve in the **same deferred pass** the GameObject references already used, since the
object being pointed at may not exist yet when the field is read. `ScrollRect.content`,
`Selectable.targetGraphic`, `Canvas.worldCamera` and `Toggle.group` are decorated, so a
scroll view, a composed button, a world-space canvas and a radio group all survive a round
trip with their wiring intact — including references that cross between scene roots.

The one deliberate limit: a reference **out of the saved subtree** serializes as null rather
than as a half-reference that fails later. Saving one GameObject is saving one GameObject;
what it points at outside itself is not part of that document.

This was listed as Stage 4 (prefab) work. It turned out to be a natural extension of the
existing deferred pass rather than new machinery, and prefabs will want it either way.

### Where Stage 1 actually stops, and why

`SpriteRenderer` and the `Renderer` base (`receiveShadows`, `shadowCastingMode`) landed
2026-08-05 — `SpriteRenderer`'s sprite is a `Texture2D`, which `Resources` *does* load, so it
has a real identity.

**`MeshRenderer`, `MeshFilter` and `LODGroup` cannot be finished at this stage, and it is not
a matter of effort.** Checked rather than assumed: `Resources` registers decoders for
`Texture2D`, `JsonAsset`, `TextAsset`, `BinaryAsset` and `AudioClip` — **not** `Mesh` and
**not** `Material`. So:

- **A material has no identity**, because it is never loaded from a file; it is constructed
  in code. Referencing it by id yields null.
- **A material could be value-serialized**, and probably should be — but doing that per
  renderer would silently break sharing, which is the entire meaning of `sharedMaterial`.
  Preserving sharing means an inline sub-asset table in the scene JSON (mint an id per
  distinct material, emit its values once, reference it by id). That is a real mechanism and
  it belongs in one piece with **Stage 3's importers**, where a material becomes a file with
  an id anyway.
- **A mesh can be neither.** It has no identity for the same reason, and value-serializing
  vertex and index buffers into a scene file is not something to do on purpose.
- `LODGroup` additionally holds **renderer references**, which is the component-reference gap
  above.

So a `MeshRenderer` is the one built-in whose defining data the engine currently has no
honest way to store. Decorating it would produce a component that reloads without its mesh
*and* without its material — strictly worse than not claiming to support it.

`LineRenderer` **landed 2026-08-05**, and the blocker was smaller than it looked: it already
had `getPositions()` / `setPositions()`; what it lacked was a *property*, since a method pair
cannot be a serialized field. A `positions` accessor delegating to those two was enough, and
it is a better API in TS regardless. The line's shape, widths, colours and modes all
round-trip.

**`MeshFilter` landed 2026-08-05, and the mesh problem had a third answer** the earlier note
missed. A mesh cannot be referenced (never loaded from a file) and must not be
value-serialized (vertex buffers) — but it *can* be stored as **the recipe that built it**.
`Mesh`'s `create*` factories now record `{ kind, args }`, exposed as `Mesh.primitive` and
rebuilt by `Mesh.fromPrimitive`. A sphere is six numbers instead of a vertex buffer, and
educational scenes are mostly primitives. A mesh with neither an id nor a recipe (hand-built,
combined) still serializes as null, which is honest and visible.

Two defects this turned up, both the same shape as `Canvas.pixelRatio`:
- **`MeshFilter.mesh`'s getter instantiates a private copy.** Serializing through it would
  have changed the scene *by saving it* — turning a shared mesh into a per-object instance.
  `sharedMesh` is the correct field, which is also what Unity serializes. A test asserts that
  saving leaves `_meshInstance` null.
- **`Mesh.clone()` dropped the recipe**, so an instanced primitive lost the one thing that
  made it storable. A clone of a cube is still a cube.

The rule these three share is worth stating once: **before decorating a property, check that
its getter is pure and its setter is symmetric.** Three of the traps found in this stage were
accessors that quietly did something else.

**The inline sub-asset table landed 2026-08-05, and with it `MeshRenderer`.** A material has
no file behind it, so it is value-serialized **once** into a scene-level `assets` table and
referenced by id from every component that used it. Two renderers sharing one material still
share it after a load — which is the whole meaning of `sharedMaterial`, and what
per-component value serialization would have silently broken.

The pieces: `SerializedScene.assets` / `SerializedGameObject.assets`,
`SerializeContext.inlineAsset` (mints an id, emits the values once, keyed by object
identity), `AssetDatabase._bindGuid` for an asset with an id but no path, and a
materialization pass that runs **before** any component is rebuilt. An id already in memory
is left alone, so loading a scene twice does not hand out two copies of the same material.

Textures inside a material stay **references**, not inlined values — they are loadable, so
they have real identity. That is the rule stated earlier holding up: a field is an asset
reference when the thing behind it is a file, and a value when it is not.

**This completes Stage 1's goal.** Every built-in component now survives save → load:
`Camera`, all four lights, the whole UI subsystem, `Rigidbody` and the colliders,
`MeshFilter`, `MeshRenderer`, `SpriteRenderer`, `LineRenderer` — with GameObject, component
and asset references between them, and `@ExecutionOrder` on top.

**Arrays of references landed 2026-08-05**, along with two fixes the work exposed:

- **`elementType` did nothing for compound elements.** The array branch dropped the declared
  type, so an array of component references serialized as a list of nulls. It is now passed
  down on both sides.
- **A reference inside an array has to be written into its slot**, not over the field.
  Resolution is deferred, so every element resolved to the same field and the array collapsed
  to whichever one finished last. Both `GameObjectRef` and `ComponentRef` now carry the index.
- **The untyped fallback duck-typed a GameObject on `.transform` + `.getInstanceID`** — which
  a `Component` also has. An undeclared component-typed field was therefore written out as a
  *null GameObject reference*. It now asks the context which kind of object it is holding.

**`LODGroup` closed 2026-08-05, by taking Unity's answer to the same problem.** Its levels
are `{ screenRelativeTransitionHeight, renderers: Renderer[] }` — an array of *structs* each
holding an array of references, which one level of field metadata cannot describe. Unity
solves this with `[System.Serializable]` on the struct: the nested type carries its **own**
field metadata, so nothing has to describe it from outside.

`LOD` is therefore a `@Serializable` **class** rather than an interface, and the serializer
gained **nested serializable values** (`$type: "Nested"`): a registered class that is neither
a component nor an asset is stored with its type and its own fields. That generalizes — any
settings struct holding references can now serialize — rather than special-casing one
component.

Two consequences worth recording:
- **`setLODs` now keeps a level that is already a `LOD`** instead of copying it. References
  inside it resolve in a later pass, and copying would have left that pass writing into a
  discarded object. Object literals are still normalized, so existing callers are unaffected
  — `LODLevel` is the shape they satisfy.
- **A structurally identical class makes `instanceof` narrowing useless.** With the parameter
  typed as `LOD[]`, TypeScript decided every element already was one and narrowed the other
  branch to `never`. Typing it by shape (`LODLevel`) is what makes the check mean anything.

**Stage 1 is complete.** Every built-in component round-trips, with GameObject, component,
array-of-component and asset references between them.

Stage 3 changes the *storage* of the inline table rather than the mechanism: once a material
is a file with an id, it moves out of the scene and becomes an ordinary reference. Nothing
built here has to be undone for that.

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

1. ~~Prefab **instances** with per-instance override diffs~~ — **done 2026-08-05.**
   `PrefabDiff.compare` / `.apply` (`serialization/PrefabOverride.ts`) express an instance as
   *prefab + differences* rather than as a copy, addressed by property path (which GameObject,
   which component and index, which field). `Prefab.getOverrides`,
   `instantiateWithOverrides` and `revert` are the live API. A test pins the behaviour that
   makes the model worth having: edit the prefab, and an instance rebuilt from its overrides
   picks the change up on untouched fields while keeping its own.

   Two decisions: **structural changes are not overrides** — a child added to an instance is
   a different shape, not a different value, and Unity treats it separately — and **revert is
   destroy-and-recreate**, because a field-by-field revert would leave a component the prefab
   does not have still attached, which is not what reverting means.

   The diff module is pure (two snapshots in, differences out), so the editor can reuse it
   for "modified" markers without touching live objects.
2. **Prefab variants — done 2026-08-05.** `Prefab.createVariant(base, overrides)` builds a
   prefab that holds *no tree of its own*: it resolves its base every time it is asked, so an
   edit to the base reaches the variant and everything instantiated from it. Variants of
   variants resolve recursively. That is the whole reason to prefer a variant over a copy, and
   it is what the tests pin.

   Resolution is deliberately **not cached** — caching is what would break the propagation
   this exists for, and a prefab tree is small next to the scene it populates.

   **Saving a variant flattens it**, and the JSDoc says so: recording "base plus differences"
   means *naming* the base, and prefabs have no ids yet. The saved values are right, the link
   is lost. That is also exactly what **nested prefabs** need — a snapshot that references
   another prefab rather than embedding it — so both wait on prefab identity, which belongs
   with Stage 2/3's asset ids rather than here.
3. **Inspector generated from serialization metadata**, with custom-drawer escape hatches.
4. **Undo** as serialized-state diffs.
5. Play mode: serialize → run → restore.

**Done when:** the editor can author a scene the runtime loads identically, and the Inspector
required no per-component UI code.

### Stage 5 — Runtime parity items (**L**, parallelisable)

Independent of 1–4, and of each other:

- ~~**Animator state machine**~~ — **done 2026-08-10.** `Animator` is now a `Behaviour`
  (`go.addComponent(Animator)`, as its own JSDoc had always claimed) evaluated once per frame
  from `Application._loop`, immediately **before** `Animation._updateAll()` so a transition
  decided this frame is the one the mixer then plays, rather than landing a frame late.

  Conditions are **declarative** — `{ parameter, mode, threshold }` with an
  `AnimatorConditionMode` (If / IfNot / Greater / Less / Equals / NotEqual) — not opaque
  predicate functions. That is the whole difference between a controller that can be
  serialized, inspected and drawn as a graph and one that only exists as code; the predicate
  form survives as `addTransitionWhen` for tests no comparison can express, and is documented
  as unsaveable.

  Parameters carry a declared `AnimatorParameterType`, which is what makes **triggers** work:
  the previous implementation could only guess which bools were triggers (its reset loop was
  empty but for the comment `// Only reset if it was set as a trigger (heuristic)`), so a
  trigger stayed true forever and re-fired its transition on every following frame. A trigger
  is now consumed *before* the target state is entered, so a state that transitions straight
  out again cannot see the same trigger twice. `setTrigger` declares the type implicitly, so
  the common case needs no separate declaration.

  `addState` registers the clip with the sibling `Animation`, adding one if it is missing —
  requiring the caller to add both in the right order was a trap rather than a design.

- ~~**Blend trees**~~ — **done 2026-08-10.** `BlendTree` (`animation/BlendTree.ts`) in two
  forms: `Simple1D`, where the two children bracketing the parameter share the weight, and
  `FreeformCartesian2D`, using Unity's own gradient band interpolation rather than
  inverse-distance weighting — a child contributes nothing once another child sits between it
  and the sample point, which is what stops a strafe blend from bleeding the backward clip
  into a forward run. An `AnimatorState`'s motion is now a clip **or** a tree, and a tree state
  is re-sampled every frame it is held, since its weights keep moving while the state does not.

  The mixer-side half is `Animation.blend(weights, wrapMode, fadeIn, synchronize)`: weighted
  simultaneous playback, normalized, meant to be called every frame — re-weighting an active
  clip does not restart it, and a clip entering an existing blend starts at the blend's current
  phase. `synchronize` time-scales every clip to a common weighted-average cycle (Unity's
  homogeneous speed), without which a 1 s walk and a 0.6 s run drift apart within a second and
  the feet slide.

  The fade into a blend is applied by `Animation` as its own envelope during the frame update,
  not through Three.js' `fadeIn`: three schedules a weight ramp that the next
  `setEffectiveWeight` cancels, and a blend re-weights every frame.

  Still open in this area: **avatar retargeting, Timeline and IK** — further out, and named as
  such in §2.7.
- ~~**Layer collision matrix + joints**~~ — **both done 2026-08-05.**
  `LayerCollisionMatrix.ignoreLayerCollision` / `.collides` / `.maskFor`, enforced through
  cannon-es' `collisionFilterGroup` / `collisionFilterMask`. It lands in the **broad phase**,
  so an ignored pair costs nothing rather than costing a contact that is then discarded —
  which is the reason to have a matrix at all.

  The matrix is deliberately **symmetric**: a one-way collision is not something a solver can
  express, and pretending otherwise gives a pair that collides or not depending on which body
  was looked at first. Changes reach bodies that already exist, via a change handler `Physics`
  registers — the matrix stays free of the world so it can be read without pulling physics in.

  One limitation stated in the JSDoc rather than left to be found: several colliders sharing
  one `Rigidbody` are one physical body, so the last one attached decides its layer. Unity has
  the same limitation for the same reason.

  **Joints** (`physics/Joint.ts`): a `Joint` base plus `FixedJoint`, `HingeJoint` and
  `SpringJoint`, over cannon-es' `LockConstraint` / `HingeConstraint` / `DistanceConstraint`.
  The base owns *when* a constraint exists — built on enable, removed on disable, rebuilt when
  `connectedBody` changes — so a disabled joint genuinely releases rather than leaving a
  solved-but-ignored constraint in the world. A null `connectedBody` anchors to a shared
  static body, which is how a swinging sign or a hinged door frame is expressed.

  Unity's `CharacterJoint` and `ConfigurableJoint` are not mapped: cannon-es has no
  equivalent, and faking them from a distance constraint would be a worse lie than their
  absence.
- ~~**Additive scene loading + `DontDestroyOnLoad`**~~ — **done 2026-08-05.**
  `LoadSceneMode.Single | Additive` on `SceneManager.loadScene`, plus `unloadScene` and
  `moveGameObjectToScene`. An additive load leaves the **active scene alone**, matching Unity:
  loading a HUD over a lesson must not silently redirect the lesson's own spawns.

  **`DontDestroyOnLoad` was a no-op and is now real.** `EngineObject` recorded the mark and
  nothing ever read it — `_isPersistent()` had no callers outside its own file — so a marked
  object was destroyed with everything else. Survivors are now re-homed into the new scene
  *before* the old ones are destroyed, which is the ordering that matters: `Scene.destroy`
  walks its roots, so a survivor still registered there goes down with the scene.

  Also corrected a doc claim: `createScene` says it is Unity's `SceneManager.CreateScene`,
  which adds a scene without unloading. It replaces everything instead — which is what its
  callers (`Scenario.run`) want — so it now says that rather than claiming an equivalence it
  does not have.
- ~~**`ScriptableObject`** proper — data assets without a GameObject~~ — **done 2026-08-05.**
  `core/ScriptableObject.ts`: an `EngineObject` with no GameObject and no lifecycle, plus
  `create`, `toJSON` and `fromJSON`. The JSDoc states the distinction §2.8 flagged — this is
  Unity's `ScriptableObject`, while `ScriptableBehaviour` is the `MonoBehaviour` analogue
  despite its name.

  It needed almost no new machinery: an instance is `@Serializable`, so a component field
  declared `FieldType.Asset` already routes it through the **inline sub-asset table** built
  for materials. Two components pointing at one settings asset therefore still point at one
  after a load, which is the reason to put shared data in an asset rather than copy it into
  each component. That the material mechanism generalized this cleanly is a good sign for it.
- ~~**Render pipeline seam**~~ — **done 2026-08-10.** `RenderBackend`
  (`rendering/RenderBackend.ts`) is the interface everything API-specific now lives behind;
  `WebGLRenderBackend` is the implementation, and `Application.backendFactory` chooses one
  before construction. `Application` no longer creates a `THREE.WebGLRenderer`, sets its colour
  space, tone mapping or shadow map, branches on post-processing, or calls `ShaderWarmup` — it
  asks for a frame. Its only remaining Three.js reference is the `@internal`
  `_internalThreeRenderer` accessor, which now returns **null** on a non-WebGL backend.

  The seam is deliberately **frame-level, not draw-level**: `renderScene(scene, camera)` with
  engine types. A draw-level seam (submit mesh, bind material) would be a second renderer
  written in engine types, and the engine would then be maintaining two — which is the mistake
  "generalize the adapter" invites. Three.js' own `WebGPURenderer` consumes a scene and a
  camera too, so the frame-level shape is also the one the actual WebGPU path needs.

  GPU counters are exposed as an engine-typed `RenderBackendStats` rather than
  `renderer.info`, so diagnostics need not know which API produced them.

  **Two subsystems still assume WebGL** and say so in their own comments: `MemoryProfiler`
  (`renderer.info`, `WEBGL_debug_renderer_info`, GL queries for render-target sizes) and
  `Texture2D`'s KTX2 transcoder (`KTX2Loader.detectSupport` takes a WebGLRenderer). Both read
  through `_internalThreeRenderer` and degrade to null rather than breaking. A WebGPU backend
  will need its own reporting and its own transcoder support detection; that is the honest
  remaining cost, and it is smaller than it was.

  Covered by `tests/RenderBackend.test.ts`, which drives an `Application` with a fake backend
  and no WebGL at all — that the test can exist is the property the seam was for.
- **Addressables-equivalent streaming** (`L`) — specified in
  `design/asset-streaming-proposal.md`. **Stage 0's engine half landed 2026-08-10:**
  `StreamingAssetSource` + `parseStreamingManifest` (`core/assets/`), a second `IAssetSource`
  beside the ZIP one, so `Resources.load` and `assets.loadTexture` work unchanged against
  either — that seam is why streaming is additive rather than a rewrite. `Resources.useSource`
  / `.releaseSource` install one outside the scenario pipeline.

  What is deliberately *recorded but not yet acted on*: `priority` is parsed and queryable and
  nothing orders fetches by it (Stage 2); LOD lists are indexed and `maxLodLevel` selects one,
  but nothing upgrades an asset as the camera nears (Stage 3). Writing them into the schema now
  means a manifest written today stays correct then.

  **Still open, and mostly not in this repo:** the manifest-driven *scenario* loader (scripts
  are pre-linked out of the ZIP by `Scenario`, so a streamed scenario needs that path too);
  the content-addressed store and the editor's publish step (platform + editor repos); Stages
  1–4 proper.

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
