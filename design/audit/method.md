# Engine audit — walking every class looking for defects

Drafted 2026-08-13, against `65ead79`. Inventory taken from the tree, not remembered:
**159 files, 175 exported classes, 50 204 lines, 37 test files.**

## Why this exists

Every engine defect found in the last two weeks was found **by a consumer**, not by the engine:

| Defect | Found by |
|---|---|
| `PhysicMaterial.friction` reached no contact | ScenarioCreator, building a friction slider |
| `Slider` missing `setValueWithoutNotify` | ScenarioCreator, writing shared UI helpers |
| Streamed path held ~2.9× the texture VRAM | virtual-lab, measuring both load paths |
| Asset URLs joined instead of resolved | virtual-lab, laying out an object store |
| `Texture.load` swap never reached materials | found here, while fixing something adjacent |
| `Material.shader` discarded the material's state | found here, while fixing something adjacent |

1133 tests are green and none of them caught any of it. That is the point: the suite tests what
was built deliberately, and these were all **things that silently did nothing**. A test written
from the implementation cannot find a behaviour the implementation never had.

So this audit is not "read the code carefully". It is a hunt for a specific, known set of
failure shapes, class by class.

## Method — what actually found things

Ordered by how much each has paid off here.

1. **Write the test from Unity's documented behaviour, not from our source.** Every physics
   callback defect and both `Shader`/`Matrix4x4` bugs were found this way. If our code and
   Unity's documented semantics disagree, that is a finding even when our code is
   self-consistent.
2. **Negative-control every test.** Break the fix, confirm the test fails, restore. Two tests in
   this series passed for the wrong reason and were only caught this way — one of them because
   the scripted edit silently matched nothing (the files are CRLF; searching for `\n` finds
   nothing and looks like success).
3. **Trace the value all the way to the backend.** `PhysicMaterial.friction` wrote a field that
   cannon never read. Ask of every setter: *what actually consumes this, and did I watch it
   arrive?*
4. **Grep for the call site that should exist.** `addContactMaterial` had zero call sites; that
   one grep was the whole diagnosis.
5. **Measure before asserting.** A claim here about compression was wrong until measured.
6. **A test that reads the real clock tests the machine, not the code.** The rate-limit test in
   `TextureStreaming` asserted "less than 500 ms of wall time passed between these lines", which
   is true until the suite runs slowly — it failed once during a 39-second full run and passed
   on retry. Pin the clock instead. Two traps when doing so: `vi.waitFor` reads the clock you
   just froze, and a clock frozen at `0` collides with counters that start at `0`.

## The failure shapes to hunt

Each is a real defect from this codebase, generalised. Check every class against the ones that
apply.

- **A public API that silently does nothing.** `PhysicMaterial.friction`, `DontDestroyOnLoad`
  before it was made real, `Texture.load`'s handle swap. *Symptom: no error, no effect.*
- **Two sources of truth for one thing.** `ScenarioAssets` cached textures separately from
  `Resources`, so the same asset decoded twice. *Ask: is there another cache/registry/copy of
  this?*
- **State lost on replacement.** `Material.shader` built a new backing object and carried one
  field across. *Ask of every "replace the underlying X" path: what did the old one carry?*
- **Asymmetric accessors.** `MeshFilter.mesh` returns a private copy; `Camera.backgroundColor`
  returns a temporary clone. `obj.prop.x = 1` then reads back unchanged. *Especially dangerous
  under a serialization decorator.*
- **Enum member `0` tested with `||`.** `Shader.getPropertyType` returned null for every colour
  because `ShaderPropertyType.Color === 0`. *Grep for `|| ` next to enum lookups.*
- **`Object.freeze` on a typed array.** `Matrix4x4.identity` threw on first use in a process.
  *Freezing does not work on `Float32Array` elements.*
- **Deferred destroy assumed synchronous.** `EngineObject.destroy` queues a microtask;
  `destroyImmediate` does not. *Any cleanup asserted in the same tick is wrong.*
- **Registration without unregistration.** A referent set, an active-instance registry, a
  material paired into the world — each leaks or goes stale if the removal path is missing.
- **Unreachable branch.** The priority-promotion branch was dead because an earlier check
  matched first. *Ask: can this `if` actually be reached?*
- **Missing member of an API family.** `Slider` lacked the `WithoutNotify` its three siblings
  had. *For every family, tabulate who has what.*
- **Three.js leaking into a public signature.** The repo's first rule; still worth grepping per
  area.
- **Non-English comment or identifier.** `LineRenderer.ts:581` is Ukrainian, against the repo's
  own rule.
- **A getter that is safe on one path and unsafe on another.** Sixteen getters cloned on their
  hit path and returned a shared `Color.white` / `Vector3.zero` on their **miss** path, so
  read-modify-write corrupted the global constant — but only when the property happened to be
  unset. *Ask of every getter with a fallback: what does the miss path return, and who owns it?*
  Grep the shape across the tree rather than reading class by class; that found all sixteen at
  once.

---

## The split

Ten parts, ordered by expected yield × consumer impact, not alphabetically. Each is one
session. Class counts are from the tree.

### Part 1 — Core object model and lifecycle (17 files, 21 classes)

`EngineObject` `GameObject` `Component` `Behaviour` `Transform` `Scene` `SceneManager`
`Application` `Time` `Input` `EngineSettings` `RenderSettings` `ScriptableObject`
`ScriptableBehaviour` `Coroutine` `KeyCode` `BuildInfo`

**Why first:** everything else sits on it, and `Transform`, `GameObject`, `Scene` and
`EngineObject` have no direct tests at all. A defect here is a defect everywhere.

**Hunt for:** lifecycle order against Unity (`Awake → OnEnable → Start → …`); destroy semantics
(deferred vs immediate, double-destroy, destroy during iteration); parent/child reparenting and
world-vs-local transform round-trips; `Transform` accessor symmetry — `transform.position.x = 1`
is the classic trap; registry cleanup on destroy.

**Done when:** every public member of `Transform`, `GameObject` and `EngineObject` is exercised,
and the lifecycle order is asserted against Unity's documented sequence rather than ours.

### Part 2 — Graphics assets (12 files, 11 classes)

`Material` `StandardMaterial` `UnlitMaterial` `Shader` `ShaderSource` `Texture` `Texture2D`
`Cubemap` `Mesh` `Sprite` `RenderingEnums` `_TextureMemory`

**Why second:** two real defects came out of here in one week (`Material.shader`,
`Texture.load`), both by accident. That density says the area is under-audited.

**Hunt for:** the state-lost-on-replacement shape everywhere something swaps a backing object;
`sharedMaterial` vs `material` clone-on-write semantics against Unity; texture disposal and the
ImageBitmap `.close()` path; `Object.freeze` on constants; the enum-zero shape in `Shader`
property lookups (one already bit).

### Part 3 — Rendering (8 files, 7 classes) and components (9 files, 10 classes)

`Renderer` `MeshFilter` `MeshRenderer` `InstancedMeshRenderer` `StaticBatchingUtility`
`ShaderWarmup` `RenderBackend` `WebGLRenderBackend` · `Camera` `Light` `DirectionalLight`
`PointLight` `SpotLight` `AmbientLight` `LODGroup` `LineRenderer` `SpriteRenderer`

**Hunt for:** `MeshFilter.mesh` / `Camera.backgroundColor` asymmetry (both already known — check
the rest of the family); light property → Three.js sync completeness; `LineRenderer`'s open TODO
and its Ukrainian comment; enabled/disabled and layer culling paths.

### Part 4 — Assets and scenario (14 files, 12 classes)

`Resources` `StreamingAssetSource` `StreamingManifest` `ZipAssetSource` `AssetDatabase`
`AssetTypes` `LoadHandle` `TextureStreaming` `_AssetMime` · `Scenario` `ScenarioAssets`
`ScenarioBehaviour` `ScenarioTypes`

**Why here:** this area was rewritten heavily over two weeks. Churn is where defects live, and
two of the four consumer reports landed here.

**Hunt for:** refcount correctness across `load`/`prefetch`/`reload`/`release`/`unloadUnused`;
double-decode paths like the one just fixed; blob-URL lifetime; unload leaving registries
populated; the manifest parser against malformed input it has not seen.

### Part 5 — Physics (13 files, 16 classes)

`Physics` `PhysicsWorld` `Rigidbody` `Collider` `BoxCollider` `SphereCollider`
`CapsuleCollider` `PhysicMaterial` `Joint` `Collision` `RaycastHit` `LayerCollisionMatrix`

**Why here:** one silent no-op already found, and the same shape — *the engine writes a field
cannon never reads* — is plausible anywhere the two models meet.

**Hunt for:** every property that sets something on a cannon object, traced to the code that
consumes it; collider shape rebuild on resize; sleeping bodies; trigger vs collision callback
completeness (audited once — verify the joints and layer paths too).

### Part 6 — UI core (roughly half of 32 files, 39 classes)

`Canvas` `CanvasScaler` `CanvasGroup` `RectTransform` `RectMask2D` `LayoutGroup`
`GridLayoutGroup` `LayoutElement` `ContentSizeFitter` `AspectRatioFitter` `UIBehaviour`
`EventSystem` `PointerEventData` `UIEvent` `UIUtils` `TintCache`

**Hunt for:** the Y-down contract stated in every JSDoc (the repo requires it — check it is
actually there); layout invalidation and the once-per-frame driver order; hit-testing under
rotation and masks; the repaint hash missing a field that affects drawing.

### Part 7 — UI controls (the other half)

`Selectable` `SelectableTransition` `Navigation` `Button` `Slider` `Toggle` `ToggleGroup`
`Scrollbar` `Dropdown` `InputField` `ScrollRect` `VirtualJoystick` `UIImage` `UIText`
`RichText` `UITween`

**Hunt for:** the API-family shape — tabulate `WithoutNotify`, `interactable`, `onValueChanged`
across all of them and find who is missing what (this is exactly how the `Slider` gap was
reported); event ordering; focus and keyboard navigation.

### Part 8 — Math (11 files, 12 classes)

`Vector2` `Vector3` `Vector4` `Quaternion` `Matrix4x4` `Color` `Bounds` `Rect` `Ray` `Mathf`
`AnimationCurve`

**Why not first, despite being the foundation:** `Mathf`, `Matrix4x4`, `Quaternion` and
`AnimationCurve` already have tests, and pure math fails loudly rather than silently. But
`Vector2/3/4`, `Color`, `Bounds` and `Rect` have none, and they are the most-used types in the
engine.

**Hunt for:** the `out?` parameter contract (does it return the out, and is aliasing
`a.add(b, a)` safe?); static cached temporaries leaking across nested calls; frozen constants;
`Object.freeze` on typed arrays; edge cases — zero-length normalize, degenerate bounds.

**Cheapest confidence per hour in the whole plan** — exhaustive tests are quick to write here.

### Part 9 — Animation (4 files, 6 classes) and Cinemachine (9 files, 11 classes)

`Animation` `AnimationClip` `Animator` `BlendTree` · `CinemachineBrain` `CinemachineCore`
`CinemachineVirtualCamera` and the five body/aim strategies

**Why together:** both drive transforms per frame and both are recent or untested. Cinemachine
has **zero** tests and 11 classes.

**Hunt for:** blend weights not summing to 1; a state machine transition consuming a trigger
twice; first-frame Cut behaviour (a documented decision — verify it holds); damping and
`Time.deltaTime` at very small or very large steps.

### Part 10 — The tail (19 files, ~23 classes)

`MemoryProfiler` `Profiler` `Benchmark` `ProfilerHooks` · `SceneSerializer` `ValueSerializer`
`Prefab` `PrefabOverride` · `TypeRegistry` `Decorators` `Types` · `AudioClip` `AudioListener`
`AudioSource` `AudioManager` · `ParticleSystem` and friends · `PostProcessing` `PostEffect`
`BloomEffect` `VignetteEffect` · `Touch` `DeviceSensors` `Gamepad` · `Plugin` `PluginManager`

**Hunt for:** the diagnostics numbers themselves — `MemoryProfiler` sums *engine* objects while
the platform compares against `renderer.info`, and that mismatch is what made the 2.9× report
ambiguous; serializer round-trips for every `FieldType`; audio disposal.

---

## How to run a part

1. List the classes and their public members. Tabulate families side by side — that is where
   missing members show up.
2. For each class, walk the failure-shape list above and note which apply.
3. Write tests **from Unity's documented behaviour** for the ones that do.
4. Negative-control each test.
5. Fix what fails; if a fix is out of scope for the part, record it rather than half-doing it.
6. Commit per class or per coherent group, with the usual `typecheck` + tests + build green.

## Where findings go

- **A defect with a fix** — fix it, in its own commit, with the test that catches it.
- **A defect without an obvious fix** — record it in this file under the part, with evidence, in
  the shape `ScenarioCreator/docs/ENGINE-GAPS.md` uses: what was wanted, what happens, why, what
  is affected, what a fix looks like. That format worked; copy it.
- **A design question** — the handoff boundary (`handoff-boundary.md` §5) governs whether it
  reopens feature work. An audit finding is a defect or it waits.

## What this does not cover

Performance and rendering correctness. Nothing here catches "the shadow is in the wrong place" —
that needs a browser and an eye. The audit is for behaviour that can be asserted in a test.

**A scripted negative control can be vacuous, and then it lies in the safe direction.** The
control for F18 was a `python` one-liner that swapped the fix back out, ran the tests, and
swapped it in again. The tests passed — which should have been impossible — because the
replacement string never matched: an escaping layer had eaten the backslashes, `str.replace`
found nothing and said nothing, and the tests ran against the *fixed* code. Redoing it with a
real edit showed 3 of 5 failing. So: after scripting a negative control, check that the file
actually changed before believing the run. The failure mode is silent and always reports
success.

**An unobserved rejection in a test fails files it never touched.** Writing the F20 tests,
`void source.readBytes(...)` left a rejection nobody handled. Vitest reported it as one
unhandled error — and eight tests in `RenderBackend.test.ts`, a file with nothing to do with
assets, failed with timeouts in the same run while passing on their own. So: a sudden cluster
of failures in an unrelated file is worth reading as *this run is poisoned* before it is read
as a regression. It is F17 one level up — the same defect the audit had just fixed in
`LoadHandle`, reproduced in the tests written to prove it.

**Revert one defect at a time.** The negative control for F28 reverted both of the raycast
defects at once and the normal test *passed* — with a stale world matrix the test's box was
never rotated, so the local-space normal happened to equal the world one. Two defects in one
code path can cancel, and a control that removes both can therefore report that neither exists.
Restoring one half and re-running showed the second failure immediately.

**"A cache outliving what it describes" is now the audit's most productive single shape.** F15
(a guid pointing at a destroyed asset), F24 (a scene emptied but left registered), F34 (tinted
bitmaps of a destroyed texture) are the same defect three times, in three subsystems, found by
asking one question: *what is keyed by this thing's identity, and who tells that keeper when the
thing dies?* Worth asking of every map, set and registry the remaining parts contain — the
answer is a defect surprisingly often, and the fix is usually one notification.

**Follow the chain down.** F34 (a cache nobody told about destruction) led to F35 (a list that
never asked), which led to F36 (the liveness test everything asks being wrong for destroyed
objects). Each fix was correct and each one exposed the next question rather than closing it.
When a fix ends "…and it checks X", the next move is to verify that X actually means what the
fix assumes.

**A partial pass is a clue, not a flake.** Fixing F40, three tests failed and one passed — the
group chain updated, the mask chain did not, from the same fix. The temptation is to suspect the
test; the truth was that both chains shared one cache key, so whichever resolver ran first
marked the element fresh and the other kept its stale answer. When a fix works for one of two
symmetric cases, the asymmetry is in the code.

**The reference-holding family now has five members, and one recognisable signature.** F15,
F34, F35, F44, F53: something keeps a pointer to an engine object that a scenario can destroy,
and nothing tells it. The signature in the tests is always the same — most assertions pass
either way, because using a destroyed object rarely complains, and only the assertion "was the
reference dropped" fails. So when auditing a class that stores an `EngineObject`, write that
assertion first; the behavioural ones will not tell you anything.

**Check a comment's claim before treating it as evidence.** F56 was a comment stating that
`Vector3.up` was "corrupted", and the first instinct was to record that as a finding about
`Vector3`. The claim was untestable-by-inspection but trivially testable by code: the constant is
frozen and the only consumer reads it. The comment was the defect. A note asserting a fact about
another part of the engine is a hypothesis, not a source.

**Do not test with the idealised frame time.** F57's first tests passed against the broken code
because `dt = 1/60` makes `dt * 60` exactly `1`, and an integer exponent is the one case where
`Math.pow` accepts a negative base. Every real frame time — 59 fps, 120 fps, a 16 ms step —
exposed it. Where a formula's behaviour depends on a computed exponent, an index, or a modulus,
the round number is the value most likely to be accidentally safe.

**Compare a class's `onDisable` against its `onDestroy`.** They are two answers to the same
question — what must stop being true when this component stops taking part — and where they
disagree, one of them is usually wrong. `AudioSource` destroyed silently and disabled loudly
(F58). The UI registries pass this check: every one removes in both. It costs one diff per class
and needs no test to run.

**Write the test against the code path, not against a paraphrase of it.** F61's first helper
registered a pass by always calling `_createPass`, where the real builder only calls it when the
map has nothing. The paraphrase passed with and without the fix; reproducing the branch made the
test fail correctly. A helper that "does what the engine does" is a second implementation, and
the one thing it must copy exactly is the branch under test.

**A precaution is a checklist.** F63 fixed one dispatch loop that could skip an element when its
list changed mid-pass, and noted that `UIEvent` had solved the same problem years earlier with a
comment explaining why. Following that comment to its twins found five more (F64). The habit
generalises: when a class takes a named precaution — a snapshot, a defensive copy, an epoch
counter — the other places doing the same *kind* of work are worth checking immediately, and the
comment is what tells you what to look for.

**`npx vitest run | grep …` hides the exit code, and it hid one again.** This was recorded once
already, near the start of the audit, after a commit went out on a red run. It happened a second
time while finishing F64: the verification chain ended in `grep -E "Test Files|Tests "`, grep
found its match and returned 0, and `&&` carried on to `git commit` over a run that said
`1 failed | 1451 passed`. The committed state turned out to be green — three later runs and the
exit code confirm it, and the failure did not reproduce — but that was luck, not method.

The rule that actually works: redirect to a file, check `$?` on its own line, *then* grep the
file. A pipeline's status is the last command's, and the last command is never the test runner.

**Re-measure the claims the plans are built on.** F67 was not found in code: the parity plan's
headline finding — quoted in `CLAUDE.md` as the prerequisite for the editor — described a grep
result that had stopped being true. Documents have no tests, so nothing fails when the engine
moves under them. Any plan that opens with "a grep shows…" is worth re-running before its next
stage is scheduled, and the re-run costs one command.

**Ask what the checker actually covers.** F69: `npm run typecheck` had been green all audit, and
it was green over `src/engine` alone — `tsconfig.json` excludes `**/*.test.ts`, and Vitest's
esbuild strips types without reading them. Every test written during this audit had compiled
unchecked. A green check is a claim about a file set; read the config's `include`/`exclude`
before trusting the green.

**A class can be clean at runtime and broken for every caller.** F70 sat in a class an earlier
part had walked and marked clean, on real evidence: `create` called, a round-trip verified. The
defect was a `protected` modifier — erased before any of that ran, and fatal to every TypeScript
caller. Runtime tests cannot see the type system. Where a class's usage is *documented*, compile
the documented example rather than a paraphrase of it.

**A passing test can be asserting nothing.** Two tests wrote to properties the engine does not
have (`KeyCode.W`, `CanvasScaler.scaleMode`) and passed anyway — one because an undefined key
round-trips like any other, one because the mode it meant to select was already the default.
Neither was wrong today. Both would have gone quiet, not red, the moment a default moved.

**A comment with no statement under it is a defect report.** F71's cone branch ended with
`// Slight offset on the disk at radius=0 for cone base` and nothing after it. The author knew
what belonged there. When a comment describes an action, check that the action is in the code —
a stranded note reads exactly like a description of working code, which is why it survives
review.

**Test the shape where the bug is visible.** F72 was invisible on a cube, which is the shape
every test used: all six faces really are a sixth of a cube's surface. The existing cone test
asserted direction only, and the direction was always right. When a sampler has a parameter,
vary the parameter — the defaults are where defects hide, not where they show.

**A failing new test accuses the code. Check the test first.** The CSV column-parity test failed
on its first run — 32 cells against 31 headers — and the exporter was right: the fixture's label
contained a comma, the exporter quoted it correctly, and the test was splitting on commas
naively. A false finding was one minute of confidence away. A new test has never been run before;
the code under it has run thousands of times. Weight the suspicion accordingly.

**Check the ruler, not only what it measures.** `Profiler` and `Benchmark` compute every number
the thesis reports and were the last classes in the walk to be tested at all — 1485 tests covered
the engine being measured and none covered the instrument. Any project with a measurement story
has this asymmetry, because the instrument feels like infrastructure rather than behaviour.

**Check for absence, not for presence.** The F12 translation sweep replaced known strings and
then scanned for *any* remaining Cyrillic. That second check found three lines the first pass had
mangled — a short comment that was a prefix of a longer one got replaced first and ate its
beginning. A sweep verified only by "did my replacements apply?" answers yes to a corrupted file.
Verify the property you actually want, which is that the old thing is gone.

**For a mechanical edit, compare mechanically.** The claim was "comments only". Reading the diff
would not have established it — 664 lines is past the point where an eye is evidence. Stripping
every comment from both versions and diffing what remains does establish it, and it found the one
file where the claim was untrue.
