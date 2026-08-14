# Audit findings

Defects found by the class-by-class audit ([`method.md`](method.md),
[`checklist.md`](checklist.md)). Newest last within each part.

Each entry follows the shape `ScenarioCreator/docs/ENGINE-GAPS.md` uses, because it made every
report there verifiable in minutes: **what was wanted**, **what happens**, **why** with the
evidence, **what is affected**, and **what a fix looks like**. A finding without evidence is a
rumour; a finding without a fix sketch leaves the next person to redo the thinking.

Ideas that are not defects go in [`improvements.md`](improvements.md).

| # | Part | Finding | State |
|---|---|---|---|
| F1 | 1 | `Transform.parent` did not preserve world position | fixed `7ab9fa2` |
| F2 | 1 | `Destroy(obj, delay)` counts wall-clock, not game time | **open** |
| F3 | 1 | `FindObjectsOfType` promises "active" and does not filter | doc fixed; semantics **open** |
| F4 | 1 | `Awake` fires on `addComponent` even when the object is inactive | **open** |
| F5 | 1 | Coroutines paused instead of stopping on deactivation | half fixed `e6e0b45` |
| F6 | 1 | `Time.deltaTime` did not report the fixed step inside `fixedUpdate` | fixed `5c585b0` |
| F7 | 1 | `DontDestroyOnLoad` on a child recorded a survival that never happened | fixed `ac95d83` |
| F8 | 1 | Held keys and mouse buttons stuck after focus loss | fixed `aca2caa` |
| F9 | 2 | `releaseSourceImage` has no upload guard; the documented one does not exist | docs fixed; guard **open** |
| F10 | 2, 3, 9 | Sixteen getters handed out shared math constants | fixed `ec73f3a` |
| F11 | 3 | `Light.shadowStrength` was stored and never applied | fixed `04e1e31` |
| F12 | 2, 3, 8 | 680 lines of non-English comments, most of it public JSDoc | **open** |
| F13 | 3 | Batching twice drew every source mesh twice | fixed `f064a58` |
| F14 | 3 | `renderScene` allocates a `Color` every frame | **open** |
| F15 | 4 | Asset identity outlived the destroyed instance | fixed `c709fb5` |
| F16 | 4 | A load landing after its source was released cached itself anyway | fixed `pending` |

---

## Part 1 — Core object model and lifecycle

### F1. `Transform.parent` did not preserve world position — fixed `7ab9fa2`

**Wanted.** `child.transform.parent = parent.transform` to leave the child where it is, as
Unity does.

**What happened.** The child jumped: its local values were kept and reinterpreted against the
new parent, so it moved by the parent's transform.

**Why.** The property setter passed `worldPositionStays: false`. The engine's own `setParent`
already defaulted to `true`, so the property contradicted its sibling, and the JSDoc claimed
"Equivalent to Unity's `Transform.parent`" one sentence before telling the reader to use
`setParent` if they wanted world position preserved. Unity's documented behaviour: "Changing the
parent will modify the parent-relative position, scale and rotation but keep the world space
position, rotation and scale the same."

**Affected.** Any reparenting after the object had been positioned in world space. Checked
across ScenarioCreator's ten scenarios before changing it: 45 uses of `.parent =`, none of which
set a world position first — every one parents and then assigns `localPosition`, which the fix
leaves untouched.

**Fix.** `setParent(newParent, true)`, and a JSDoc that says what it does. Covered by
`tests/TransformHierarchy.test.ts`; 4 of its 10 tests fail against the old argument.

### F2. `Destroy(obj, delay)` counts wall-clock time, not game time — **open**

**Wanted.** `EngineObject.Destroy(go, 2)` to destroy the object after two seconds *of game
time*, so pausing the game postpones it — Unity's behaviour, and the reason `Time.timeScale`
exists.

**What happens.** The delay is a `setTimeout(delay * 1000)`, so it fires on wall-clock time
regardless of `Time.timeScale`, and even while the loop is stopped via `Application.stop()`. A
scenario that pauses watches objects disappear while paused.

**Why.** `EngineObject.Destroy` (`EngineObject.ts`, the `delay > 0` branch):

```js
setTimeout(() => { if (obj.exists()) obj._destroyImmediate(); }, delay * 1000);
```

`Time.timeScale` exists and is honoured elsewhere (`Time.deltaTime` is scaled,
`unscaledDeltaTime` is not), so the engine has the clock — this path just does not use it. The
JSDoc says "after the specified delay" without naming a clock, so the divergence is not even
visible to a reader.

**Affected.** Any timed destruction in a scenario that pauses or slows time. None of the ten
current scenarios uses a delayed `Destroy`, so nothing is broken today; it is a trap waiting for
the first pause menu.

**Fix sketch.** Keep a list of `{ obj, remaining }` on `EngineObject`, decrement by
`Time.deltaTime` from `Application._loop`, and destroy at zero. That also makes the destruction
cancellable and stops it firing when nothing is running — neither of which `setTimeout` allows.
Cost: one more per-frame driver, and a decision about whether the list survives a scene change.

### F3. `FindObjectsOfType` promises "active" and returns everything — doc fixed, semantics **open**

**Wanted.** What the JSDoc says: "Returns all **active** loaded objects of the specified type",
matching Unity, where `FindObjectsOfType` excludes objects on inactive GameObjects.

**What happens.** The filter is `obj.exists() && obj instanceof type` — destroyed objects are
skipped, inactive ones are not. A `GameObject` with `setActive(false)`, and every component on
it, is returned.

**Why.** No active check exists in the loop. The word "active" in the doc appears to mean "not
destroyed".

**Affected.** Any caller trusting the doc. Internally the only callers are
`MemoryProfiler._estimateTextureVram` / `_estimateGeometryVram`, which enumerate `Mesh`,
`Texture` and `Cubemap` — assets, with no active state — so the engine itself is indifferent
either way.

**Done so far.** The doc now describes what the code does and names the difference from Unity,
so nobody plans around a promise that is not kept.

**Still open, and a decision rather than a bug fix.** Making it match Unity means excluding a
`GameObject` that is not `activeInHierarchy` and any `Component` on one. That is a behavioural
change for consumers who currently rely on finding inactive objects, and it needs `EngineObject`
to reason about `GameObject`/`Component` without importing them — a duck-typed check, or moving
the filtering to a `Scene`-level API. Worth doing with `Scene.findObjectsOfType`
(`Scene.ts:270`, which also claims Unity equivalence) rather than piecemeal.

### F4. `Awake` fires on `addComponent` even when the GameObject is inactive — **open**

**Wanted.** Unity's rule: "If a GameObject is inactive during start up, Awake is not called
until it is made active." Adding a component to an inactive object should defer `Awake` to
activation, so a script can assume `Awake` runs shortly before its first `OnEnable`.

**What happens.** `Awake` runs immediately, whatever the object's state:

```ts
// GameObject.addComponent
const component = new type(this);
this._components.push(component);
if (component instanceof ScriptableBehaviour) component._systemAwake();   // unconditional
else if (component instanceof Behaviour) component._internalInitialize(); // unconditional
if (component instanceof Behaviour && this.activeInHierarchy && component.enabled) {
    component._onEnabledChanged();                                        // conditional
}
```

Only the `OnEnable` step consults `activeInHierarchy`. `Awake` does not.

**Affected.** Building a hierarchy under a deactivated root — the usual pooling and
"assemble hidden, then reveal" pattern. A script whose `awake()` assumes it is about to become
active, or that reads state the enabling code sets up, will see a different order than it would
in Unity. Nothing in the ten current scenarios does this, so nothing is broken today.

**Why it was not fixed here.** The same call site initialises **built-in** components through
`_internalInitialize` — that is where `Camera`, `Light` and the renderers create their Three.js
objects. Deferring that would mean a `Camera` added to an inactive GameObject has no backing
object until activation, and every built-in component would need to tolerate the gap. That is a
change across the whole component library, not a one-line fix, and it wants its own pass with
its own blast-radius check.

**Fix sketch.** Split the two paths: keep `_internalInitialize` eager (built-ins need their
backing objects to exist), and defer only `ScriptableBehaviour._systemAwake` until the first
activation, guarded by an `_awakeCalled` flag so it runs exactly once. That gets Unity's
semantics where user code can observe them, and leaves the engine's own components alone.
Verify against `GameObject.setActive` and `_onParentActiveStateChanged`, which are the two
places activation is discovered.

**Not asserted in tests**, deliberately — a test of the current behaviour would cement it.
`tests/GameObjectLifecycle.test.ts` covers the transitions that *are* correct and says so at the
top.

### F5. Coroutines paused where Unity stops them — deactivation half fixed

**Wanted.** Unity's two rules, which pull in opposite directions:

- `gameObject.SetActive(false)` **stops** coroutines. Reactivating does not resume them.
- `behaviour.enabled = false` does **not** stop them; they keep running.

**What happened.** Both merely paused. Coroutines are ticked from `_systemUpdate`, which returns
early unless `isActiveAndEnabled` — so either flag suspended them, and clearing either one
resumed them exactly where they left off. An object deactivated and later reactivated finished a
sequence the scene had moved on from.

**Why.** `ScriptableBehaviour._systemUpdate` guards everything, coroutine ticking included:

```ts
public _systemUpdate(): void {
    if (!this.isActiveAndEnabled) return;
    ...
    this._coroutineRunner?.tickUpdate();
}
```

**Affected.** Nothing today: across ScriptableCreator's ten scenarios there are **zero** uses of
`startCoroutine`, against 52 of `setActive`. That is why the deactivation half could be fixed
without risk, and why it was worth fixing before the first scenario relies on the wrong
behaviour.

**Fixed.** `ScriptableBehaviour._onEnabledChanged` now stops coroutines when the transition
leaves the GameObject inactive — not when only `enabled` went false. Covered in
`tests/Coroutine.test.ts`; the test fails with the stop removed.

**Still open — the `enabled = false` half.** Making coroutines keep running while a behaviour is
disabled means ticking the runner outside the update guard, which means the dispatch has to
visit disabled behaviours. That is a change to the core loop rather than to this class, and it
needs its own pass: today a disabled behaviour is skipped wholesale, and nothing else about it
runs either.

### F6. `Time.deltaTime` reported the frame delta inside `fixedUpdate` — fixed

**Wanted.** Unity's documented rule: "The interval in seconds from the last frame to the current
one. **When called from inside MonoBehaviour.FixedUpdate, returns Time.fixedDeltaTime.**"

**What happened.** `deltaTime` returned the frame delta everywhere. Code integrating inside
`fixedUpdate` — the Unity-idiomatic `velocity += accel * Time.deltaTime` — used the wrong step,
and used it the wrong number of times: the fixed loop runs zero or more times per frame, so at
60 fps against a 1/50 timestep it ran roughly 1.2 times while reporting ~16.7 ms instead of
20 ms. Both the size and the count were wrong, in a way that jitters with frame rate.

**Why.** There was no notion of a fixed phase anywhere in the engine — `grep` for a phase flag
returned nothing. `deltaTime` was a plain field read.

**Affected.** Any scenario integrating inside `fixedUpdate`. The engine's own consumers of
`Time.deltaTime` — `Animation`, `CinemachineBrain`, `Coroutine`, `ParticleSystem` — all run in
the Update phase and are untouched by the change. ScenarioCreator's ten scenarios mention
`fixedUpdate` twice, so the change is a correction where it applies at all.

**Fix.** `Time._beginFixedUpdate()` / `_endFixedUpdate()` bracket the fixed loop in
`Application._loop`, and `deltaTime` returns `fixedDeltaTime` while the flag is set.
`unscaledDeltaTime` deliberately does **not** follow the rule — it keeps meaning real frame
time, which is what a profiler reads. Covered by `tests/TimeFixedPhase.test.ts`; the fixed-phase
test fails with the rule removed.

**Related and not done:** Unity applies the same substitution to `Time.time` inside the fixed
phase (it reports `fixedTime`). Left alone — nothing in the engine or the scenarios reads
`Time.time` from `fixedUpdate`, and the deltaTime rule is the one with a wrong number attached.

### F7. `DontDestroyOnLoad` on a child marked it and destroyed it anyway — fixed

**Wanted.** Either the object survives a scene load, or the caller is told it will not.

**What happened.** Neither. `DontDestroyOnLoad(child)` recorded the mark unconditionally, but
survivors are collected by walking **root** GameObjects only:

```ts
// SceneManager._collectPersistentRoots
for (const scene of SceneManager._loadedScenes) {
    for (const go of scene.getRootGameObjects()) {
        if (go._isPersistent()) out.push(go);
    }
}
```

So a marked child was destroyed with its scene while `_isPersistent()` kept answering `true` —
the state described a survival that never happened, silently.

**Why it matters.** This is the same shape as `PhysicMaterial.friction`: a public API that
accepts the call, changes recorded state, and has no effect. The mark makes it worse than doing
nothing, because a caller checking `_isPersistent()` is told the opposite of the truth.

**Affected.** No scenario uses `DontDestroyOnLoad` today (zero across the ten), and the engine's
three internal uses are on roots. It is a trap rather than a live break.

**Fix.** Refuse a non-root and warn, naming the parent and what to do instead — which is what
Unity does for the same case, minus the recorded lie. Assets keep working: the guard only fires
for objects that actually have a hierarchy, found by duck-typing rather than importing
`GameObject`/`Component`, since both import `EngineObject` and naming either would close a
cycle.

Covered in `tests/SceneManagement.test.ts`, including that an asset is unaffected; the child
test fails with the guard removed.

### F8. Held keys and mouse buttons stuck after focus loss — fixed

**Wanted.** Alt-Tab away with a key held, come back, and the key is not still down.

**What happened.** It was, for the rest of the session. `Input` listened for `keydown`/`keyup`
and `mousedown`/`mouseup` and nothing else — `grep` for `blur` or `visibilitychange` in the file
returned nothing.

Browsers do not deliver `keyup` after the window loses focus, and `mouseup` was bound to the
**canvas**, so a drag that ended anywhere else never arrived either. `_currentKeys` and
`_mouseButtons` kept the stale entry, and only pressing and releasing the same input again
cleared it. This is the "character keeps walking after Alt-Tab" bug, and it needed no unusual
sequence to reproduce.

**Why the per-frame reset did not save it.** `_resetFrame` clears the *edge* buffers —
`_downKeys`, `_upKeys`, scroll and mouse deltas — deliberately, because held state must survive
between frames. The held sets are the ones that had no way to be cleared.

**Fix.** A `blur` listener on the window and a `visibilitychange` listener on the document, both
clearing held keys and buttons. No synthetic "up" is raised: polling reports the truth
immediately, while code listening for a *release* is not handed one the user never performed —
the same trade Unity makes on focus loss. Covered by `tests/InputFocusLoss.test.ts`, including
that input works again once focus returns.

---

## Part 2 — Graphics assets

### F9. `releaseSourceImage` blanks a texture that has not been uploaded yet — docs fixed, guard **open**

**Wanted.** Release the CPU copy of a texture's pixels without losing the texture.

**What happens.** Called before the texture has been drawn once, it nulls the image and the
texture is blank for the rest of the run. Nothing in the engine prevents it, and two things
actively suggest it is safe.

**Why.** Three uploads pixels during the first `render()` that draws with the texture. Both
`Texture2D.releaseSourceImage` and `Cubemap.releaseSourceImage` null the image immediately, and
both then set `needsUpdate = false` under a comment claiming that "prevents the *no image data
found* warning". It does not: three's setter only acts on `true` —

```js
// node_modules/three/src/textures/Texture.js
set needsUpdate( value ) {
    if ( value === true ) { this.version ++; this.source.needsUpdate = true; }
}
```

so the write was inert, and the comment described a protection that never ran.

**The engine's own docs pointed at the unsafe call site.** `Texture2D`'s example said to call it
"Later, in start() or update()" — and `start()` runs *before* that frame's render.

**Worse, the protection is documented as existing.** `CLAUDE.md` states: "`releaseSourceImage()`
uses a two-frame countdown (`_releaseCountdown = 2`) to ensure GPU upload completes before CPU
data is released." There is no `_releaseCountdown` anywhere in `src/`. The countdown is real —
but it lives in **scenario content**, reinvented by whoever hit the bug:

```ts
// ScenarioCreator/Scenarios/solar-system-scenario/scripts/Scenario.ts
// Cannot release in awake() or start() — Three.js needs image data
// for the initial texImage2D GPU upload that happens during render().
this._releaseCountdown = 2;
```

So the hazard is confirmed by someone who hit it, the workaround is duplicated into content, and
the engine claims credit for a guard it does not implement.

**Affected.** `Resources.releaseAllSourceImages()` is public and does this to every cached
texture at once, so a host calling it during loading would blank the scene. One scenario uses
the per-texture call, correctly, via its own countdown.

**Done.** Removed the inert `needsUpdate = false` from both classes — it changed nothing and
claimed to change something — and rewrote the `Texture2D` JSDoc to say plainly that the call is
unsafe before the first render, with an example that defers.

**Still open: the guard itself.** The fix is the countdown `CLAUDE.md` already promises: schedule
the release, tick it after render from `Application._loop`, and free when it reaches zero. That
deletes the workaround from every scenario. It needs a per-frame driver and a shared home —
`Cubemap` extends `EngineObject`, not `Texture`, so the scheduling cannot simply live on the
base class.

**`CLAUDE.md` is wrong until that lands** and should be corrected either way; it is outside this
audit's reach because it carries unrelated uncommitted edits.

### F10. Sixteen getters handed out shared math constants — fixed

**Wanted.** The read-modify-write the engine's own `Transform` docs teach:

```ts
const c = material.color;
c.r = 0.5;
material.color = c;
```

**What happened.** When the property was unset, that corrupted `Color.white` process-wide, and
every later reader of the constant — including every other material's unset colour — saw the
change.

**Why.** `Color.white`, `Vector3.zero`, `Matrix4x4.identity` and the rest are shared instances;
their own JSDoc says "Shared instance — do not mutate!". Sixteen public getters returned one
directly on their **miss** path while cloning on the hit path:

```ts
public getColor(propertyName: string): Color {
    const value = this._properties.get(propertyName);
    if (value instanceof Color) return value.clone();  // hit: safe
    return Color.white;                                 // miss: the global
}
```

The inconsistency is what made it invisible: the same getter is safe or unsafe depending on
whether the property happens to be set, so it behaves correctly right up until a default is
read.

**Affected.** `Material` (5 sites), `Camera` (4), `LineRenderer` (3), `Texture2D` (3),
`CinemachineCore` (1) — parts 2, 3 and 9 of this audit. All are fallback or error paths, which
is exactly where a caller is least likely to be careful.

**Fix.** `.clone()` on every one of the sixteen, found by grepping for the shape rather than by
reading each class. The cost is one allocation on a path that previously returned a landmine;
none of them is a per-frame hot path except `CinemachineCore`'s degenerate-direction branch,
where an allocation is cheaper than a corrupted global.

Covered by `tests/SharedConstantLeak.test.ts`, including that two reads of an unset property are
independent — the property whose absence made this so hard to trace. Four of its five tests fail
with a single site reverted.

**Worth keeping as a lesson.** This was found by asking "what does the *miss* path return?", not
by reading the happy path. Any getter with a fallback is a candidate.

---

## Part 3 — Rendering and components

### F11. `Light.shadowStrength` was stored and never applied — fixed

**Wanted.** `light.shadowStrength = 0.25` to lighten the shadow, as Unity's does.

**What happened.** Nothing. The value was clamped, stored, and read by no one.

**Why.** Every other setter on `Light` ends in a sync — `_syncColorAndIntensity`,
`_syncShadowSettings`, `_syncShadowBias`. Two did not: `shadowStrength` and
`bounceIntensity`. Grepping the whole engine for either name outside `Light.ts` returned no
hits at all, so the values reached neither Three.js nor any engine subsystem.

**Why it was not simply unimplementable.** three 0.182 has `LightShadow.intensity`, with the
same 0..1 meaning and the same direction as Unity's `shadowStrength`. The property was unwired,
not unsupported.

**Affected.** Any scene tuning shadow darkness. Silent, like every member of this shape: the
value reads back correctly from the getter, so a caller checking their own work sees success.

**Fix.** `shadowStrength` now rides `_syncShadowBias` — which already writes the other two
shadow fields — and the test covers that bias and strength do not clobber one another, since
they now share a helper.

**`bounceIntensity` stays inert, and now says so.** Unity uses it to scale indirect light from a
GI system; this engine has neither baked nor realtime GI, so there is nothing to apply it to.
Its JSDoc said "(reserved)", which reads like a hint rather than a contract, and claimed Unity
equivalence besides. It now states plainly that the value is stored and not applied, why it is
kept (a Unity-shaped scene round-trips through serialization without losing the field), and
carries a `TODO` naming what would have to exist first — which is what the repo's completeness
rule asks for.

### F12. 680 lines of non-English comments, most of it public JSDoc — **open**

**Wanted.** What `CLAUDE.md` requires: "All comments and identifiers in English."

**What is there.** 680 lines of Ukrainian/Russian comments across 13 files, swept by scanning
every `.ts` under `src/engine` for Cyrillic:

| File | Lines |
|---|---:|
| `core/graphics/Mesh.ts` | ~170 |
| `core/components/LineRenderer.ts` | ~99 |
| `core/graphics/RenderingEnums.ts` | ~73 |
| `core/math/Vector3.ts` | ~62 |
| `core/math/Color.ts` | ~56 |
| `core/math/Vector2.ts` | ~50 |
| `core/math/Vector4.ts` | ~46 |
| `core/math/Bounds.ts` | ~42 |
| `core/math/Quaternion.ts` | ~40 |
| `core/rendering/MeshFilter.ts` | ~22 |
| `core/EngineSettings.ts` | ~15 |
| `physics/RaycastHit.ts` | ~6 |
| `core/scenario/index.ts` | 1 |

**Why it is more than tidiness.** Most of it is **public JSDoc** on the most-used types in the
engine — `Vector3`, `Vector2`, `Color`, `Quaternion`, `Bounds`, `Mesh`. That text is what
TypeDoc publishes and what a consumer's IDE shows on hover. Every scenario author and every
consumer repo reads it, and the rule exists because not all of them read Ukrainian.

**Scale corrected.** An earlier note in this audit recorded "a Ukrainian comment at
`LineRenderer.ts:581`", from having seen one line. Sweeping found ninety-nine in that file
alone. Reading a sample is not an inventory.

**Not fixed here, deliberately.** 680 lines of translation is a large diff with no test to catch
a mistranslated parameter, and JSDoc is exactly where a wrong word becomes someone else's bug.
It wants its own pass, file by file, and it is mechanical rather than exploratory — the audit
should not swallow it.

**Suggested order.** The math classes first (`Vector2/3/4`, `Color`, `Quaternion`, `Bounds`) —
most read, smallest per-file risk, and part 8 of this audit will be reading them anyway. Then
`Mesh` and `RenderingEnums`, then the rest.

### F13. Batching twice drew every source mesh twice — fixed

**Wanted.** `StaticBatchingUtility.combineRoot(root)` called a second time — after adding
content, or simply on a reload — to batch what is new and leave what is already batched alone.

**What happened.** It produced a second batch containing every source mesh **twice**, then
disabled the first batch. The scene rendered the same geometry doubled and overlapping, with no
error and no warning.

**Why.** `getComponentsInChildren` filters on GameObject *activeness*, not on renderer
`enabled`:

```ts
public getComponentsInChildren<T>(type, includeInactive: boolean = false): T[]
// ... collection checks `_activeSelf`, never `renderer.enabled`
```

So the second call collected the originals the first call had disabled — their GameObjects are
still active — *and* the batch object the first call created. All shared one material, so they
landed in one group: N originals plus a batch that already contains those N. `Mesh.combine`
duly merged the geometry twice over.

**Affected.** Nobody today — zero uses across the ten scenarios — but the failure is silent and
the trigger is ordinary: batch on load, add scenery, batch again.

**Fix.** Skip renderers that are already disabled. That is independently correct — a disabled
renderer draws nothing, so batching it *adds* geometry to the frame — and it makes the second
call safe by itself: the originals are skipped, leaving the first batch alone in its group and
below the two-member minimum, so nothing is created and nothing is disabled.

Covered in `tests/StaticBatching.test.ts`, including that an already-hidden renderer stays out
of the batch. All three fail with the guard removed.

### F14. `renderScene` allocates a `Color` every frame — **open**

**Observed.** `WebGLRenderBackend.renderScene` ends with, on every frame that does not use a
skybox:

```ts
if (!useSkybox) this.setClearColor(camera.backgroundColor);
```

`Camera.backgroundColor` returns a **clone** — the convention for value types throughout the
engine — so this allocates one `Color` per frame in the render path.

**Why it matters, mildly.** `CLAUDE.md` is explicit: "Never allocate in hot paths (Update,
LateUpdate, FixedUpdate)", and the render path is hotter than any of them. One small object per
frame is not a leak and will not show up in a frame-time graph, but it is exactly the allocation
the rule exists to prevent, and the file two lines above it already keeps a module-level
`_clearColor` "so setting the clear colour allocates nothing per frame" — the intent was there
and the caller undoes it.

**Fix sketch.** Either an out-parameter on the getter (`camera.getBackgroundColor(out)`, matching
the engine's zero-allocation math convention) or an `@internal` accessor returning the stored
instance for the backend to read components off. The first is more useful to scenario code as
well; the second is smaller. Not done here because it changes `Camera`'s public surface, which
deserves its own decision rather than a drive-by.

**Also fixed while reading:** `RenderBackendStats` now documents that a backend may return the
same object each frame, refreshed in place. The fields are `readonly`, which stops a caller
writing to them but not from being surprised when a retained reference changes underneath —
the F10 shape at the backend seam, caught by the type system on the write side and by nothing
on the read side.

---

## Part 4 — Assets and scenario

### F15. Asset identity outlived the destroyed instance — fixed `c709fb5`

**Wanted.** `AssetDatabase.isLoaded(guid)` to mean what it says: is this asset in memory right
now.

**What happened.** It answered `true` for assets that had been destroyed, and `get(guid)` handed
the destroyed object back. A deserialized scene resolving an asset reference would assign a
disposed texture to a material.

**Why.** `AssetDatabase` had `_bind` and `_bindGuid` and **no unbind at all**. `Resources`
binds on every successful load; nothing removed the binding when the asset was destroyed by
`unloadUnused()` or by `evictToBudget()`. Only `AssetDatabase.clear()`, on scenario unload,
emptied the maps — so within a run the map only ever grew, and grew stale.

**Affected.** Anything holding assets by id across an unload: the serializer, prefab
instantiation, and the VRAM budget, which was introduced during this same series and made
eviction routine rather than exceptional. That is what turned a latent gap into a reachable one.

**Fix.** `AssetDatabase._unbind(asset)`, called from `Resources._destroyAsset` — the single
funnel every destruction already goes through, which is why this is one call site and not four.

Two details worth keeping:

- **The path↔guid mapping is kept; only the instance pointer is dropped.** Destruction removes
  what is in memory, not what the file is called, so a scene referring to the asset resolves
  again the moment it reloads. A test covers exactly that round trip.
- **The guid is only cleared if it still points at the asset being destroyed.** A reload may
  already have bound a fresh instance under the same id, and unbinding blindly would erase the
  live one.

Covered by `tests/AssetIdentityLifetime.test.ts`; three of its five fail with the unbind removed.

### F16. A load that landed after its source was released cached itself anyway — fixed `pending`

**Wanted.** Unloading a scenario to end everything it started. A texture still decoding when
the scenario goes away belongs to nothing and should be dropped.

**What happened.** It was cached under whatever source was installed next, at `refCount: 1`,
and its guid bound over the new scenario's database. Nothing ever released that reference, so
neither `unloadUnused()` nor `evictToBudget()` would touch it — both only take entries at zero
references. The VRAM stayed held for the lifetime of the page, and `AssetDatabase.get(guid)`
answered with an asset from a scenario that had ended.

**Why.** `_load` read the source late:

```ts
const bytes = await Resources._source!.readBytes(fullPath, { speculative });
const asset = await entry.decoder(bytes, fullPath, Resources._source!);
Resources._cache.set(cacheKey, { asset, refCount: 1, ... });
AssetDatabase._bind(fullPath, asset as object);
```

Every one of those `Resources._source` reads happens *after* an await, so they see the source
of whenever the bytes arrive rather than the one the load was started against. `_clearSource`
clears `_cache`, `_inFlight` and `_source`, but a promise already in the air is not a map entry
— clearing the map does not cancel it, and the landing had no way to tell that it was stale.
The second read is worse than the first: after an unload `_source` is `null`, so a decoder that
uses it (models resolving their textures through `getBlobUrl`) dereferences null; after a
*replacement* it is somebody else's archive.

**Affected.** Any unload or source swap racing a load — which is the normal case on the
platform, where a student can leave a scenario while its textures are still decoding, and on
the streaming path, where loads are many and long. Reachable through
`Application.loadScenario*` (each one releases the previous source) as well as
`Resources.releaseSource()`.

**Fix.** Capture the source and a `_sourceEpoch` counter when the load starts; read the bytes
and decode through the captured source; on landing, if the epoch has moved, destroy the decoded
asset and reject. The rejection is the honest answer — the caller asked a scenario that no
longer exists for an asset, `tryLoad` turns it into `null`, and `prefetch` already logs and
carries on.

One consequence worth stating: the `finally` that clears `_inFlight` now only clears **its
own** promise. `_clearSource` empties that map, so by the time a stale load finishes the key
may belong to a load the *new* source started for the same path, and deleting that one would
let the next caller start a duplicate read.

Covered by `tests/ResourcesSourceLifetime.test.ts`; 4 of its 5 tests fail against the old code.
The fifth is a regression guard that passes either way, and says so.

---

## Negative results worth recording

Sweeps that found nothing are evidence too, and stop the next pass repeating them.

- **The F11 shape does not recur.** Every `public set` in `core/components`, `core/rendering`
  and `physics` was scanned for a body that never reaches a backend: 86 setters examined, 9
  flagged, all 9 false positives that reach one through a spelling the pattern did not know
  (`setPositions`, `setLODs`, `_body.*`, `_world.*`, `_localBounds.copy`). `Light` was the only
  real case.
- **The enum-zero shape does not recur in graphics.** `Shader.getPropertyType` already uses `??`
  with a comment explaining why `||` was wrong there.
- **No registry leaks a registration.** Every static `Set`/`Map` in the engine was scanned for
  adds without a matching remove: 27 examined, 3 flagged — `Resources._decoders`,
  `Shader._shaderRegistry`, `Input._axisValues` — and all three are bounded type tables that are
  permanent by design, not per-instance registries. The instance registries that matter
  (`LODGroup._activeInstances`, `Light`'s count, the renderer lists) all remove on both
  `onDisable` and `onDestroy`.
