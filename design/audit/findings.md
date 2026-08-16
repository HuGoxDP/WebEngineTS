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
| F12 | 2, 3, 8 | 674 lines of non-English comments, most of it public JSDoc | **open** — `Bounds` done `6e58f48` |
| F13 | 3 | Batching twice drew every source mesh twice | fixed `f064a58` |
| F14 | 3 | `renderScene` allocates a `Color` every frame | **open** |
| F15 | 4 | Asset identity outlived the destroyed instance | fixed `c709fb5` |
| F16 | 4 | A load landing after its source was released cached itself anyway | fixed `daecc97` |
| F17 | 4 | A failed `LoadHandle` nobody awaited raised an unhandled rejection | fixed `9903a90` |
| F18 | 4 | `TextAsset.lines` left a carriage return on every Windows line | fixed `ddbc1eb` |
| F19 | 4 | A streaming pass could overlap, and kept a level it never loaded | fixed `9b49401` |
| F20 | 4 | Disposing a streaming source left its queue running | fixed `0906e35` |
| F21 | 1, 4 | A throwing callback left `Time` and `Input` broken for the rest of the run | fixed `c338cda` |
| F22 | 4 | No per-callback isolation: one bad script stops the frame | **open** |
| F23 | 4 | A failed `run()` left a scene, a source and blob URLs behind | fixed `9bdad0e` |
| F24 | 4 | `unload()` emptied the scene but left it registered and active | fixed `9bdad0e` |
| F25 | 1, 4 | `Instantiate` on a GameObject returned an empty object | refuses now `030ae4b`; cloning **open** |
| F26 | 5 | `useGravity = false` did nothing after the first frame | fixed `27e4134` |
| F27 | 5 | `Collider.center` moved the ray proxy, not the shape | fixed `54c54e4` |
| F28 | 5 | Raycast normals were local-space; hits used stale matrices | fixed `09341b7` |
| F29 | 5 | `overlapSphere` tests origins, not shapes | **open** |
| F30 | 5 | A hinge told cannon only half of itself | fixed `8825050` |
| F31 | 5 | `SpringJoint` is a rigid rod, not a spring | docs fixed `8825050`; spring **open** |
| F32 | 5 | A material on a `Rigidbody` was unregistered and unreadable | fixed `24771f2` |
| F33 | 6 | A mask change did not repaint what it clips | fixed `1192778` |
| F34 | 6 | Tinted copies outlived the textures they came from | fixed `8a7a042` |
| F35 | 6 | A tween kept animating a destroyed element | fixed `0a571e3` |
| F36 | 1, 6 | `isActiveAndEnabled` was true for destroyed components | fixed `2c32687` |
| F37 | 6 | A `LayoutElement` shadowed the size its own control reported | fixed `f9083e3` |
| F38 | 6 | `FixedRowCount` did not fix the row count | fixed `6e25971` |
| F39 | 6 | Layout groups never shrank, so `minWidth` was inert | fixed `a06a2c5` |
| F40 | 6 | A re-parent above an element left its masks and groups stale | fixed `2041f38` |
| F41 | 6 | An element moved between canvases kept the old one for a frame | fixed `9b2049b` |
| F42 | 6 | A click reached the element its own pointer-up had closed | fixed `6cc8aea` |
| F43 | 7 | An open dropdown stayed open after focus moved on | fixed `57dbbe9` |
| F44 | 7 | A scroll view kept driving content that was destroyed | fixed `3cd0286` |
| F45 | 7 | `InputField` had no `setTextWithoutNotify` | added `67f5c9b` |
| F46 | 7 | Explicit navigation moved focus onto controls that were gone | fixed `d00df46` |
| F47 | 7 | A `<size>` run drew over the line beneath it | fixed `aa36804` |
| F48 | 8 | `Mathf.round` rounded halves the JavaScript way, not Unity's | fixed `8d1b1d0` |
| F49 | 8 | Only `Vector3`'s shared constants were frozen | fixed `31d7ad5` |
| F50 | 8 | `Keyframe`'s tangent weights are stored and never applied | documented `3d24607`; weighting **open** |
| F51 | 8 | Writing through `Ray.direction` bypassed its normalization | documented `954e6ea` |
| F52 | 9 | Cinemachine printed debug traces in shipped builds | fixed `16aa7ab` |
| F53 | 9 | A virtual camera kept following a destroyed target | fixed `90deb81` |
| F54 | 9 | A dead block allocated in the camera's LateUpdate forever | fixed `5fdd6a3` |
| F55 | 9 | Damping of zero froze the camera instead of removing the damping | fixed `8d235c3` |
| F56 | 9 | A workaround for a corruption that cannot happen | fixed `c0023cb` |
| F57 | 9 | A POV damping above one turned the camera to NaN | fixed `a6bf47e` |
| F58 | 10 | Disabling an `AudioSource` left the sound playing | fixed `e232954` |
| F59 | 10 | An empty `Gradient` threw from inside the particle update | fixed `01f3b01` |
| F60 | 10 | The two texture counters sat side by side, one of them unexplained | documented `5b0c6cc` |
| F61 | 10 | `clear` kept the passes it had just disposed | fixed `21c7ea7` |
| F62 | 10 | Disposing an Application left every input listener attached | fixed `861e4c5` |
| F63 | 10 | A plugin leaving mid-frame made the dispatch skip the next one | fixed `0028b9f` |
| F64 | 6, 10 | Every UI per-frame driver could skip an element mid-pass | fixed `072073c` |
| F65 | 10 | `TypeRegistry._clear` emptied one of its two maps | fixed `5c38e1f` |

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

### F16. A load that landed after its source was released cached itself anyway — fixed `daecc97`

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

### F17. A failed `LoadHandle` nobody awaited raised an unhandled rejection — fixed `9903a90`

**Wanted.** The two documented ways of reading a failure to both work: `await handle.promise`,
or poll `handle.isDone` and `handle.error`.

**What happened.** Polling worked, but the rejection stayed unobserved, so the host saw an
`unhandledrejection` for a failure the caller was handling. In a browser that is a red console
error and a fired `window.onunhandledrejection`; a platform that surfaces global errors would
show a dialog for a load the scenario dealt with itself.

**Why.** The constructor builds the promise and stores the error, and nothing ever attaches a
handler to the promise it built. `error` is public API — the class *invites* the path that
leaves the rejection unobserved.

**Affected.** `Resources.loadAsync` and `Resources.loadBatch`, the only producers, and any
caller that polls rather than awaits. Demonstrated by running such a caller under Vitest, which
reported `Errors 1 error` alongside a passing test.

**Fix.** `this.promise.catch(() => {})` in the constructor. It marks the rejection observed
without consuming it: a caller who awaits `promise` still gets it — and their own unhandled
rejection if they do not catch, which is theirs to own.

Covered by `tests/LoadHandleFailure.test.ts`, which asserts against a real
`process.on("unhandledRejection")` listener rather than a mock, because what the *host*
observes is the whole point. 2 of its 4 tests fail with the line removed.

### F18. `TextAsset.lines` left a carriage return on every Windows line — fixed `ddbc1eb`

**Wanted.** `asset.lines` to give the lines of the file.

**What happened.** `split("
")` alone, so a CRLF file yielded `"1,Earth
"` and every
comparison against a value written in the file failed.

**Why.** The engine's own repo is CRLF and scenario content is authored on Windows; `.csv` is
one of the extensions that decodes to `TextAsset`, and CSV is the format people split by line.
Reachable rather than theoretical.

**Affected.** Scenario data files only — nothing in the engine calls `lines`, which is why it
went unnoticed. Unity has no `TextAsset.lines`, so there was no parity check to catch it either.

**Fix.** Split on `/
|
|
/`. A trailing newline still yields a final empty string:
dropping it would make the line count depend on whether the author's editor ends files with a
newline, so it is documented instead of guessed at.

The same commit corrected the `BinaryAsset` example, which built a `DataView` from
`bytes.buffer` alone — wrong for any array that is a view into a larger buffer.

### F19. A streaming pass could overlap, and kept a level it never loaded — fixed `9b49401`

Two ways one `TextureStreaming` pass left state the next one would plan against.

**A failed reload kept the level that failed.** `evaluate()` sets the requested level on the
source, then reloads the texture. When the fetch or the decode threw, the texture still held
the content of the level it had, while the source went on claiming the new one. The next pass
then planned against a detail level nothing had ever decoded — in the test it steps *down* from
that level, succeeds, and hides the failure completely. Reachable the moment one LOD is missing
from the CDN, which is the failure a per-level manifest makes possible in the first place. The
level is now restored on the way out, and cleared if there was no explicit one.

**Passes could overlap.** The class documents that they never do, and `_update` honours it —
but `evaluate()` is public *precisely* so a host can drive quality on its own schedule, and it
walked straight past the flag. Two passes in flight both reload a texture and pick their next
target from VRAM figures the other is about to invalidate; `Resources.reload` itself documents
that concurrent reloads of one path are not deduplicated and the last to finish wins. It now
returns an idle pass while one is running, which is also the honest answer to "did this pass do
anything".

Both are covered in `tests/TextureStreaming.test.ts`, and each half has its own negative
control: removing one makes two tests fail, removing the other makes two *different* tests
fail.

### F20. Disposing a streaming source left its queue running — fixed `0906e35`

**Wanted.** `dispose()` to end the source: revoke what it handed out, stop asking for more.

**What happened.** It revoked the blob URLs, cleared the in-flight map, and left the request
queue standing. Two consequences, both reachable by unloading a scenario mid-fetch — what a
student leaving a page does.

**Queued requests were still sent.** Nothing cancels the pump, so the next completion drained
the queue and issued fetches for a scenario that had ended. Their callers heard nothing either
way: the promises never settled.

**A read after disposal could resolve to nothing.** `_shared` checks the queue before the
in-flight map and returns the shared promise for a queued URL:

```ts
const queued = this._queued.get(url);
if (queued) {
    if (rank < queued.rank) queued.rank = rank;
    return this._inFlight.get(url)!;   // invariant: queued ⇒ in-flight
}
```

`dispose()` broke that invariant by clearing one map and not the other, and the non-null
assertion then handed back `undefined` — which awaits to `undefined` and decodes as an empty
asset. A blank texture instead of an error, which is the outcome `ZipAssetSource` explicitly
refuses ("a silent empty read would hide it until a texture failed to appear").

**Fix.** Reject every queued request — it was never sent, so nothing is salvaged by letting it
through — and throw on reads afterwards, the way `ZipAssetSource` throws once released.
`isDisposed` mirrors its `isReleased`. In-flight reads are still left to settle, as documented:
their bytes are wanted by whoever is mid-decode.

Covered in `tests/ProgressiveLoading.test.ts`; each half has its own negative control, and
removing the read guard fails both tests.

### F21. A throwing callback left `Time` and `Input` broken for the rest of the run — fixed `c338cda`

Found reading `ScenarioBehaviour`, which is where user code enters the loop; the defect is in
`Application._loop`.

**Wanted.** An exception in scenario code to break that frame and nothing else.

**What happened.** It broke every frame afterwards. The loop calls
`requestAnimationFrame(this._loop)` before running anything, so a throw does not stop the
engine — the next frame is already scheduled. That is the right behaviour, and it is also what
makes the damage permanent:

- A throw inside the fixed phase skipped `Time._endFixedUpdate()`, so `Time.deltaTime` reported
  `fixedDeltaTime` from then on. That flag arrived with **F6** a few commits earlier: the fix
  for one Unity-parity bug created the state this one strands.
- A throw anywhere in the frame skipped `Input._resetFrame()`, so every "pressed this frame"
  flag stayed set — `getKeyDown` answering true forever, and forever is right, because an error
  in `update` repeats every frame.
- `Profiler._recordFrame` was skipped too, so the most expensive frames were the ones missing
  from the timings.

**Affected.** Every scenario during development, and student-facing scenarios on the platform.
A single typo in one `update` is enough.

**Fix.** Close what the frame brackets in `finally` — the fixed phase, the input reset, the
profiler record. The error is not caught: it still reaches the host, and the frame it broke
stays broken. Only bookkeeping is restored. The body is indented one level as a result;
`git diff -w` is the real change, 32 lines.

Covered by `tests/LoopFrameIntegrity.test.ts`, each half negative-controlled separately.

### F22. One bad script stops every callback after it in the frame — **open**

**Wanted.** Unity's isolation: an exception in one `MonoBehaviour.Update` is logged, and the
next component still updates.

**What happens.** `scene._update()` walks components in a plain loop, so the first throw skips
every component after it, the scenario's own `update`, animation, particles, UI layout and
input. F21 stopped that from corrupting engine state, but the frame is still cut short at the
first error.

**Why it is not fixed here.** It is a design decision, not an oversight. Wrapping every
callback in `try`/`catch` costs a little per call in the hottest loop in the engine and — more
importantly — changes what a scenario author sees: an error becomes a console line rather than
a stopped scene, which hides bugs during authoring. Unity makes that trade because it has an
editor console nobody can miss; a browser console is easier to ignore. Worth deciding
deliberately, with a `console.error` per failure and a policy for repeat offenders, rather than
adding it to a bug-fix commit.

### F23. A failed `run()` left a scene, a source and blob URLs behind — fixed `9bdad0e`

**Wanted.** A scenario that fails to start to leave the engine as it found it.

**What happened.** `run()` creates a Scene, installs the asset source through
`_activateAsResourceSource`, mints a blob URL per script and may run an entry point that has
already built part of a world. Its `catch` set the state to `Error` and rethrew — everything
else stayed. The host was then holding a scenario it could neither run nor clean up: `unload`
was never called, and `isLoaded` is false after an error, so there was no obvious handle on it
either. The assets stayed in memory until some *later* load happened to unload it.

**Affected.** Every failing start: a script with a syntax error, an entry point whose `awake`
throws, a `critical` asset that 404s. On the platform, the visible symptom is a scenario that
failed to open still holding its textures.

**Fix.** The catch unloads before rethrowing, then records `Error`. Nothing is lost by it:
`isLoaded` was already false after an error, so no caller could have retried `run()`.

### F24. `unload()` emptied the scene but left it registered and active — fixed `9bdad0e`

Found because the test for F23 would not pass: the scene was still there after the cleanup.

**What happened.** `unload()` called `scene.destroy()` directly. That empties a scene —
destroys its GameObjects, clears its Three.js scene, sets `_isLoaded = false` — and leaves the
object itself in `SceneManager._loadedScenes`, and active. So afterwards:

- `SceneManager.getSceneByName(name)` answered with a destroyed scene;
- `SceneManager.activeScene` *was* that destroyed scene, and the loop went on calling
  `_update` and rendering it;
- `onSceneUnloaded` never fired — for the one scene a host most wants to hear about.

It self-healed on the next scenario load only because `loadScene` in Single mode wipes
everything, which is why nothing had noticed.

**Fix.** Go through `SceneManager.unloadScene`, and when the scenario's scene was the only one
loaded — the usual case, since `createScene` replaces — load an empty scene in its place.
SceneManager always keeps one loaded; this leaves the engine where a fresh start would, with
one live, empty, active scene and the scenario's own gone from the registry.

Both are covered by `tests/ScenarioRunFailure.test.ts`, which induces the failure through the
environment rather than faking it: `run()` imports the entry point from a blob URL, which Node
cannot do, and that is a real failure in the same place a broken scenario script fails.

### F25. `Instantiate` on a GameObject returned an empty object — made honest `030ae4b`, cloning still **open**

Found reading `ScenarioAssets.loadModel`, whose docs promise a "prefab".

**Wanted.** Unity's `Instantiate(prefab)`: a copy, with the same components, children and
transform.

**What happened.** `GameObject` never overrode `_clone`, so `EngineObject.Instantiate` fell
through to the base implementation — `new GameObject(name + " (Clone)")`. No components, no
children, none of the transform. Added to the scene, and invisible. The most-used API in Unity,
failing silently.

**Why it went unnoticed.** The code documents the missing piece without noticing:
`Component._clone` throws *"components are cloned as part of GameObject.Instantiate()"* and its
JSDoc names `GameObject._clone` as the method that duplicates them. That method did not exist.
Nothing in the ten ScenarioCreator scenarios or the editor calls `Instantiate`, so the empty
object never reached anyone — checked before changing it.

**What was done.** The failure is now honest: an error naming the object, saying cloning is not
implemented, and pointing at `design/unity-parity-plan.md`. The stub carries a `TODO`, per the
repo's own completeness rule.

**What is still open.** Real cloning. It means copying arbitrary component state, which the
engine cannot do generically until components serialize themselves — Stage 1 of the parity
plan, which is already the prerequisite for the editor. When it lands, `Component._clone`'s
message becomes true and this error goes away.

**A wider version of the same defect, not fixed here.** `EngineObject._clone` assumes every
subclass has a `(name)` constructor. `Texture2D`'s takes `(width, height)`, so
`Instantiate(texture)` builds one whose width is the string `"… (Clone)"`. Same shape as the
GameObject case; less reachable, and the honest fix is the same serialization work.

`tests/InstantiateGameObject.test.ts` covers the refusal; 4 of its 5 tests fail with the
override removed. The commit also corrected `loadModel`'s example, which positioned the shared
instance as though it were a fresh copy — the trap this defect made unavoidable.

## Part 5 — Physics

### F26. `useGravity = false` did nothing after the first frame — fixed `27e4134`

**Wanted.** Unity's `Rigidbody.useGravity = false`: the body stops being pulled down and keeps
whatever velocity it has.

**What happened.** It fell exactly as if gravity were on.

**Why.** cannon-es has no per-body gravity switch, so the engine cancels gravity with an equal
and opposite force. That force was applied inside `_syncTransformToBody`:

```ts
public _syncTransformToBody(): void {
    // ... position and rotation ...
    if (!this._useGravity && this._body.type === CANNON.Body.DYNAMIC) {
        // apply -g * mass
    }
}
```

`Physics._step` calls that method for **kinematic** bodies only:

```ts
if (rb.isKinematic && rb.isActiveAndEnabled) rb._syncTransformToBody();
```

A kinematic body's cannon type is `KINEMATIC`, so the inner condition can never hold when the
outer one does. The counter-force was therefore applied only from `onAwake`/`onEnable`, and
cannon clears every force at the end of each step — so it survived at most one step.

Exactly the shape this part was opened for: *the engine writes a field cannon never reads*,
here by putting the write somewhere the read cannot reach.

**Affected.** Any floating, hovering or orbiting body — the obvious use of the flag. The
Solar-System scenario avoids it only because it moves its planets by transform rather than by
physics.

**Fix.** The compensation is its own method, `_applyGravityCompensation`, called for every
active dynamic body at the top of `Physics._step`, beside the kinematic transform sync it used
to hide inside. Keeping it out of `_syncTransformToBody` is half the fix: that method is about
transforms, and burying a force in it is what let the mismatch go unnoticed.

Covered by `tests/RigidbodyGravity.test.ts` — 5 of its 6 tests fail without the per-step call.
They include the Unity semantics that make this more than "y stays still": turning gravity off
mid-fall keeps the velocity already gained and stops only the acceleration.

### F27. `Collider.center` moved the ray proxy, not the shape — fixed `54c54e4`

The same shape as F26, one class along: a property written into one of a collider's two
representations and not the other.

**Wanted.** Unity's `BoxCollider.center`: the shape sits at that local offset, for collisions
and for raycasts alike.

**What happened.** Only the raycast agreed. Every collider keeps two representations — an
invisible Three.js mesh that `Physics.Raycast` intersects, and a cannon shape that the
simulation collides with. `center` set `_center` and moved the Three.js proxy; the cannon shape
was added with `body.addShape(shape)` and no offset, so it stayed at the object's origin.

**Affected.** A capsule offset so a character stands on its feet — the standard use — falls
through the floor it can see. Any raycast against an offset collider reports a hit at a place
nothing collides with, which is worse than either being wrong on its own, because the two
disagree.

**Why it hid.** `size` and `radius` are applied to *both* representations in the same setters,
so the pattern looks right at a glance; `center` is the one that stops halfway. And the
raycast, being the thing a scenario author checks first, is the half that works.

**Fix.** Plumbed through the base class, since cannon stores the offset on the **body** next to
the shape rather than on the shape: `_shapeCenter()` (overridden by the three colliders that
have a `center`), the offset passed to `addShape` for both the Rigidbody body and the implicit
static one, and `_syncShapeOffset()` for a `center` changed after attachment — which must also
recompute the bounding radius and the inertia, exactly as `addShape` does.

Covered by `tests/ColliderCenter.test.ts`; 6 of its 7 tests fail with the offset dropped, one
of them asserting precisely that the proxy and the simulation agree.

### F28. Raycast normals were local-space, and hits used last frame's matrices — fixed `09341b7`

**Wanted.** Unity's `Physics.Raycast`: a hit against the world as it is now, with
`RaycastHit.normal` in world space.

**Two defects, both demonstrated.**

*The normal was in the hit object's local space.* Three's `Intersection.face.normal` is local;
Unity's is world. A rotated collider reported a normal pointing somewhere the ray never came
from, so every use of one — reflecting a bounce, aligning a decal, asking which way is up here
— was wrong by the object's rotation. Now put through the normal matrix of the object's world
matrix.

*A collider moved earlier in the same Update was hit at its previous position.* Transform writes
can be deferred to `Transform._syncAllDirty`, and Three composes world matrices in
`updateMatrixWorld`, which only the render pass calls. A raycast in `update()` therefore tested
last frame's world. It now flushes dirty transforms and refreshes the world matrix of each
collider it is about to test.

Also cleaned up: `hitInfo.normal` kept the *previous* call's value when a hit had no face, and
`collider`/`transform` kept the previous call's object when the hit carried none. A stale answer
that looks fresh is worse than an empty one.

**One change that is not a fix.** `activeSelf` became `activeInHierarchy`, which matches Unity's
wording — but a collider under a deactivated parent is already unregistered through `onDisable`,
so the old check was never reachable. Its tests pass either way and say so. Recorded here so the
commit is not read as three fixes.

**A lesson the negative control taught.** Reverting both defects at once made the normal test
*pass*: with a stale matrix the box was never rotated, so the local normal was accidentally the
world one. Two defects in one path can mask each other, so the control has to revert one at a
time.

### F29. `overlapSphere` tests origins, not shapes — **open**

**What happens.** `Physics.overlapSphere(position, radius)` compares the sphere against each
collider's **transform position**. A large box whose origin sits outside the sphere is missed
even when half of it is inside; a collider whose origin is inside is returned however far its
shape extends away.

**Why it is not fixed here.** The honest fix is a real shape query, and the pieces for it are
already in the simulation: every cannon body maintains an AABB, and `world.broadphase` exists to
answer exactly this kind of question. Wiring `overlapSphere` (and the missing `overlapBox`,
`checkSphere`, `sphereCast`) into cannon is a small feature rather than a repair, and it wants
its own commit and its own tests.

Until then the JSDoc says what it does — "colliders whose origin lies within the sphere" — so
nobody plans a trigger volume around a promise the method does not keep.

### F30. A hinge told cannon only half of itself — fixed `8825050`

**Wanted.** Unity's `HingeJoint`: two bodies turning about one shared axis, each keeping the
position it had.

**What happened.** They snapped together and twisted. `_createConstraint` passed `pivotA` and
`axisA` — body A's description of the hinge — and nothing for body B. cannon defaults `pivotB`
to B's **origin** and `axisB` to B's local **X**, so the solver was asked to hold two different
points together and to align two different axes. It did exactly that.

**Why it hid.** Both halves are correct on their own, and the joint *does* something: a hinge
against the world (the `connectedBody = null` case, where B is a static body at the origin with
no rotation) is very nearly right, because B's origin and A's world anchor coincide when the
object sits at the origin. Test it in the simplest scene and it looks fine.

**Fix.** Derive B's half from A's, through world space — `pointToWorldFrame` then
`pointToLocalFrame`, and the same for the axis. Unity does this for you and calls it
`autoConfigureConnectedAnchor`.

`_rebuild` now also syncs both bodies from their transforms before measuring. The geometry is
relative to where the bodies *are*, and a body only reaches its transform's position when its
own `onEnable` runs — so the result depended on which component happened to be enabled first.

Covered by `tests/HingeJointGeometry.test.ts`; all 5 fail without B's half, including the
physical one — two bodies hinged a metre apart stay a metre apart.

### F31. `SpringJoint` is a rigid rod, not a spring — docs fixed `8825050`, spring **open**

**What it says.** "Keeps two bodies a fixed distance apart, springily… the bodies are pulled
back towards it when pushed away." `stiffness` is documented as "how hard the spring pulls
back".

**What it is.** A cannon `DistanceConstraint`: a fixed-length link the solver satisfies each
step. No oscillation, no damping. The fourth constructor argument the class passes `stiffness`
to is cannon's `maxForce` — the force limit before the link gives — so raising it makes the
joint *more rigid*, the opposite of what the name suggests.

**Done.** The class and both properties now describe the constraint they are.

**Open.** A real spring is cannon's `Spring`, which applies a force each step rather than being
a constraint, so it does not fit `Joint`'s create-on-enable / remove-on-disable shape and wants
its own driver. The name stays either way: scenarios already use it.

### F32. A material on a `Rigidbody` was unregistered, and unreadable — fixed `24771f2`

**Wanted.** `rigidbody.material = bouncy` to make the body bouncy, and `rigidbody.material` to
say what it is.

**What happened.** Neither. The setter assigned `body.material` and stopped, so the world had no
`ContactMaterial` pairing for it and the solver fell back to the default surface — the exact
trap `PhysicMaterial` documents and `Collider.sharedMaterial` avoids by calling
`_registerMaterial`. And with no getter, reading the property gave `undefined`.

**Why it hid.** The same material assigned to a *collider* works, and colliders are how most
scenes set a surface. The two paths differ by one line that only one of them has.

**Fix.** Register on assignment, keep the value, and document that a collider's own material
wins where both are set — cannon's rule, and Unity's.

Covered by `tests/RigidbodyMaterial.test.ts`; 4 of its 6 fail without the registration,
including the one that matters most: changing the material's bounciness *afterwards* only
reaches the solver if a pairing exists to refresh.

## Part 6 — UI core

### F33. A mask change did not repaint what it clips — fixed `1192778`

**Wanted.** `mask.padding.setAll(20)` to take effect on screen.

**What happened.** Nothing, until something unrelated forced a repaint. A canvas in `OnDemand`
mode redraws when a graphic's hash changes, and that hash covers the graphic's *own* state:
local rect, canvas matrix, group alpha, `_visualHash()`, draw overflow. What clips it is not
part of it, so a `RectMask2D` padding change — or the mask being switched off — left every
graphic beneath hashing exactly as before.

**Why it is worse than a stale pixel.** Hit-testing reads the mask live, through
`_passesMasks`, so the two halves disagreed: a button could be clickable where nothing was
drawn, or drawn where it could not be clicked. The class's own promise is that clipping applies
"to drawing *and* to hit-testing".

**Fix.** The per-graphic hash folds its mask chain: each mask's clip rect and canvas matrix,
plus the chain length, which covers a mask being enabled, disabled or destroyed. The chain is
already cached on the element and already walked for hit-testing, so the cost is a few numbers
per masked element per frame — the same order as the group-alpha walk on the line above.

**What was already right, and worth saying.** `CanvasGroup.alpha` *is* folded into the hash
(`g._groupAlpha()`), which is why the identical defect does not exist for groups. Two mechanisms
of the same shape, one of them remembered. That is the pattern to check for in the rest of this
part: state that lives above an element and changes how it draws.

Covered by `tests/MaskRepaint.test.ts`; 5 of its 6 fail without the fold.

### F34. Tinted copies outlived the textures they came from — fixed `8a7a042`

The same family as **F15** (a guid pointing at a destroyed asset) and **F24** (a scene emptied
but still registered): a cache outliving what it describes.

**What happened.** `TintCache` holds one full-resolution buffer per (texture, version, tint),
keyed by the texture's **instance id**. Instance ids are never reused, so the moment a texture
was destroyed — a scenario unloading, or `Resources` evicting it under the VRAM budget — its
tinted copies became unreachable. They stayed anyway: counted in `TintCache.bytes`, reported by
`MemoryProfiler` as UI memory, and released only when the 32 MB budget happened to push them
out. Nothing in the engine called `clear()`; the only route to it was the public
`UIImage.clearTintCache()`, which is a host's call to make, not a substitute for lifetime.

**Why it matters beyond the bytes.** The VRAM budget added earlier in this series makes eviction
routine. An evicted texture is supposed to free memory *now*; freeing its GPU copy while its
CPU-side tinted copies stay is half a job, and the profiler then reports UI memory belonging to
a scenario that has ended — which is exactly the number the paper's Section 5 quotes.

**Fix.** `Texture` announces its own destruction through a static hook and `UIImage` installs
the subscriber at module load. The direction is the point: the UI knows about graphics, graphics
knows nothing about the UI. It is the pattern the codebase already uses for `Collider` →
`Rigidbody._onEnabled` and `Physics` → `LayerCollisionMatrix._setChangeHandler`.

Dropping per texture rather than clearing everything keeps an unrelated scenario's tints alive
and covers eviction as well as unload.

Covered by `tests/TintCacheLifetime.test.ts`; 4 of its 5 fail with the notification removed.

### F35. A tween kept animating a destroyed element — fixed `0a571e3`

The fourth instance of the shape named after F34, and the first found by *going looking* for it
rather than by reading a class end to end: the audit swept the UI folder's static registries and
asked who tells each one that its subject died.

**What happened.** `UITween` keeps running tweens in a static list and applies each every frame,
with no check that the target still exists. A panel destroyed mid-fade — a dialog closed while
animating, a scenario tearing down its UI — was written to on every frame afterwards, and the
list writing to it kept it alive.

**The class knew.** `cancelAll()` is documented as "worth calling when a scenario tears down its
UI, so nothing keeps writing to discarded components". The responsibility was handed to the
caller, and nothing in the engine called it — exactly as `TintCache.clear()` was in F34.

**Fix, and why it differs from F34's.** Each handle carries its target's own `exists()`,
duck-typed because every real target is an `EngineObject` while `fade` also accepts any plain
object with an `alpha` — one of those never expires. This is a **pull**, not a notification: a
tween is already visited every frame so asking is free, whereas wiring a destroy hook into every
tweenable type would not be. F34 went the other way because a tinted bitmap is *not* visited
until someone draws it.

A cancelled tween does not raise `onComplete`; the motion did not finish.

Covered by `tests/TweenLifetime.test.ts`; 4 of its 7 fail without the check.

### F36. `isActiveAndEnabled` was true for destroyed components — fixed `2c32687`

The root of the family. Found by following F35 down one level: the tween needed a liveness test,
and the obvious one — the same test the rest of the engine uses — turned out not to be one.

**What it is asked.** `isActiveAndEnabled` is the guard everything uses before touching a
component: `EventSystem` before delivering a click, the update loops, `Physics._step` before
syncing a body, `Canvas` before drawing a graphic.

**What it answered.** `this._enabled && this.gameObject.activeInHierarchy`. Destruction clears
neither: `enabled` is never set false (Unity's field is not either) and a destroyed GameObject
keeps whatever `activeSelf` it had. A destroyed component therefore reported itself **active**,
and every guard written as "is this still there?" was answering a different question.

**Reachable through the most ordinary interaction there is.** `EventSystem` holds
`pressedGraphic`, `dragTarget` and `hoverOwner` across frames, and guards each delivery with
`isActiveAndEnabled`. A close button whose handler destroys its own panel — the standard shape
of a dialog — therefore had pointer-up, click and end-drag delivered to a destroyed graphic.

**Fix.** The existence test belongs in the getter, not at each call site: every caller means the
same thing by it. Teardown is deliberately unaffected — `_destroyImmediate` fires `onDisable`,
then `onDestroy`, and only then marks the object destroyed, so cleanup code that asks still sees
what it saw before. Both halves of that ordering are pinned by tests, because the temptation to
"tidy" it later is exactly what would break unregistration.

Covered by `tests/DestroyedIsNotActive.test.ts`; 4 of its 7 fail without the test, and the full
suite passes unchanged — nothing depended on the old answer.

**Why this one is worth remembering.** Three findings in a row (F34, F35, F36) came from one
question, and each answer sat one level below the last: a cache with no notification, a list
with no liveness check, and finally the liveness check itself being wrong. The audit's own
method note now says to follow that chain rather than stopping at the first fix.

### F37. A `LayoutElement` shadowed the size its own control reported — fixed `f9083e3`

**Wanted.** A label inside a layout group to be given the width its text needs, whether or not
it also carries a `LayoutElement` for something else.

**What happened.** It got the width of its current rect instead — but only sometimes.

**Why.** `LayoutUtility` resolves a size in three steps: an explicit `LayoutElement` override,
then any component reporting `preferredWidth`/`preferredHeight`, then the element's own rect.
The second step is duck-typed on purpose, so a scenario's control can join in without extending
anything from the engine. `LayoutElement` exposes both numbers too, and unset they are `-1`:

```ts
const reported = LayoutUtility._reported(rt);
if (reported && reported.preferredWidth > 0) return reported.preferredWidth;
return rt._resolvedLocalRect.width;
```

The scan returned the first match in component order, so a `LayoutElement` added *before* the
label answered for it, `-1 > 0` failed, and the real reporter was never asked. Added after, it
worked. Order-dependent, and invisible in the code that reads it.

**Fix.** The scan skips `LayoutElement` — already consulted explicitly one step earlier — and
skips disabled components, since a control switched off is not describing anything and its last
reported size is stale.

Covered by `tests/LayoutReportedSize.test.ts`, which asserts both component orders agree; 3 of
its 6 fail with the `LayoutElement` back in the scan, 1 with the enabled check dropped.

### F38. `FixedRowCount` did not fix the row count — fixed `6e25971`

**Wanted.** Unity's `GridLayoutGroup` constraint: exactly this many rows, columns worked out to
suit.

**What happened.** The rows were worked out too, from the columns that had just been worked out
from the rows:

```ts
const columns = this._columnCount(children.length, innerW);   // ceil(count / rows)
const rows = Math.ceil(children.length / columns);            // …and back again
```

Four children in three fixed rows gives `columns = ceil(4/3) = 2`, then `rows = ceil(4/2) = 2`.
A 2×2 grid — precisely what asking for two *columns* would have given, so the constraint had no
effect. Unity keeps the requested figure as `cellCountY` and derives only `cellCountX`.

**Affected.** Any count that is not a multiple of the row count: 4 in 3, 6 in 4, 8 in 5. Both
the layout pass and `preferredHeight` used the same round trip, so they agreed with each other
and disagreed with the author — which is why it reads as "the grid is just compact" rather than
as a bug.

**Fix.** One helper, `_rowCount`, used by both the layout pass and `preferredHeight`, returning
the constraint's figure when there is one.

Covered by `tests/GridFixedRows.test.ts`; 3 of its 6 fail with the derivation put back.

**A note on how the tests ended up.** The first draft asserted child *positions* after driving
`LayoutGroup._updateAll()`, and every child sat at its default rect: laying out for real needs
the canvas resolution pass, which this fix does not touch. Asserting the reserved size instead
tests the property the change actually controls. A test that needs half the engine running to
say anything is testing the engine, not the fix.

### F39. Layout groups never shrank, so `minWidth` was inert — fixed `a06a2c5`

Part 5's shape, in the UI: a documented property the code never reads.

**What it promises.** `LayoutElement.minWidth` — "smallest width this element may be shrunk
to". `minHeight` likewise.

**What happened.** No layout group ever shrank anything. `_distributeSpare` began with
`if (spare <= 0) return;`, so when the children's preferred sizes did not fit, every child kept
its preferred size and the row overflowed its panel. The minimums could not be honoured because
nothing went looking for them: `LayoutUtility.minWidth` was read only by `ContentSizeFitter`'s
`MinSize` mode, never by a group.

**Fix.** Shrink proportionally to what each child can give up — `preferred - min` — which is
Unity's rule. It is opt-in by construction: `LayoutUtility.minWidth` falls back to the preferred
size, so an element with no explicit minimum has nothing to give and lays out exactly as before.
Only a layout that *both* sets a minimum *and* overflows changes at all, which is what makes
this safe to add to an engine with scenarios already running.

A child never goes below its minimum, so a group asked to fit more than its minimums allow still
overflows — by the least it can. That is the honest outcome, and again Unity's.

Covered by `tests/LayoutShrink.test.ts`; 5 of its 7 fail with the early return restored. The
tests drive `_distributeSpare` directly, for the reason F38 recorded: placement needs the canvas
resolution pass, and the defect is in the arithmetic.

### F40. A re-parent above an element left its masks and groups stale — fixed `2041f38`

**Wanted.** Moving a panel to a different container to move everything in it — out of the old
mask and group, into the new ones.

**What happened.** Only the panel itself moved, as far as the UI was concerned. Every element
inside kept the ancestry it had: clipped by a mask no longer above it, faded by a group it no
longer belongs to, and neither clipped nor faded by the ones it had moved under.

**Why.** Each element caches its mask and group chains, because resolving one means a component
scan per ancestor. The cache is keyed on two counters: a global one bumped when a mask or group
is added or removed, and a per-element check for *that element's* parent changing. A node moving
higher up touches neither.

**Fix.** `Transform` publishes a `_hierarchyVersion` counter, bumped by `setParent`, and the
cached chains include it in their key. (The first version of this fix used a static callback in
the F34 style; **F41** wanted the same key, so it became a plain counter that any number of
subsystems can read without core knowing they exist.) Every cached chain is
discarded on any re-parent; a comparison per chain beats working out which subtrees were
affected, and chains rebuild lazily.

**Both wrong attempts are worth keeping.**

*First:* the hook went into `Canvas._revalidateParents`, which already detects re-parents — but
only of **graphics**. The moved node in the test is a plain container with no `UIBehaviour`, so
nothing fired. Re-parenting is a `Transform` event, not a graphics event, and putting the
notification anywhere else means missing the movers that are not themselves drawn.

*Second:* one `_chainHierarchy` field, shared by both resolvers. Whichever ran first marked the
element up to date and the second then trusted its own stale cache. The canvas hashes group
alpha before masks, so masks were the half that stayed wrong — and the group test passed while
the mask tests failed, which is exactly the kind of partial pass that looks like a test bug. One
field per chain.

Covered by `tests/AncestorChainReparent.test.ts`; 3 of its 5 fail with the notification removed.

### F41. An element moved between canvases kept the old one for a frame — fixed `9b2049b`

**Wanted.** Re-homing an element to another Canvas to put it on that canvas.

**What happened.** For the rest of the frame it still belonged to the one it had left, and laid
itself out against that canvas's size. `RectTransform.canvas` caches the lookup — it walks every
ancestor and is read once per element per ancestor per frame — and the key was the frame number
alone.

**Reachable in the two places a scenario re-homes anything:** a tooltip moved to a top-most
overlay so it draws above everything, and an item dragged from one panel to another. Both do it
inside an `Update`, which is exactly when the frame number does not change.

**Fix, and why it made F40 simpler.** The key it needed is the one F40 had just introduced, so
F40's static callback became a plain counter on `Transform` — `_hierarchyVersion`, bumped by
`setParent`. Any number of subsystems compare against it without core knowing they exist, which
is less machinery than a hook and has no install-order question.

That both defects wanted the same key is the point worth keeping: *anything cached from a walk
up the hierarchy is valid only while the hierarchy is* is one rule, and it now has one place to
be checked against. The remaining per-frame caches in `RectTransform` were re-read with that
rule in mind — `parentRectTransform` compares the live parent object rather than trusting the
frame, so it was already correct.

Covered by `tests/AncestorChainReparent.test.ts`; the two canvas tests fail with the counter
dropped from the key.

### F42. A click reached the element its own pointer-up had closed — fixed `6cc8aea`

The consequence **F36** predicted, in the place it predicted it.

**What happens on a release.** Up, then Click, to the element the press started on.

**What went wrong.** Up is user code, and the ordinary thing for it to do is close what was
pressed — a dialog dismissing itself, a button disabling itself against a double submit, a close
button destroying its panel. The Click went out regardless: to a component that was by then
destroyed, or to a control that had just declared itself non-interactive.

**Fix.** Re-check between the two, not before both. A control must always hear that the press it
was holding has ended, whatever its Up handler then does — that ordering is pinned by its own
test, because "guard the whole release" is the obvious wrong simplification.

**Why it could not have been fixed before F36.** `isActiveAndEnabled` answered `true` for
destroyed components until then, so this check would have caught the *disabled* case and missed
the destroyed one — the more common of the two, and the one that ends in a handler running
against a dead object.

Covered by `tests/ClickAfterUp.test.ts`; 3 of its 6 fail without the check. The tests drive the
private `_release` path, which is where the ordering lives — simulating a real press needs the
`Touch` and `Input` plumbing and would be testing that instead.

## Part 7 — UI controls

### F43. An open dropdown stayed open after focus moved on — fixed `57dbbe9`

**Wanted.** Clicking elsewhere to put the list away, as every dropdown in every toolkit does.

**What happened.** It stayed open. `Selectable` publishes `_onFocusLost` for precisely this and
`Dropdown` did not override it, so nothing closed the list when the user clicked another
control, tabbed away or pressed Escape.

**Not cosmetic.** An open list draws over whatever is beneath it, and through
`_expandsHitArea` and `_hitTest` it swallows pointer input across its whole height. So it covers
the control the user has just moved to — and the click that moved focus there is the very event
that should have closed it.

**Fix.** Override the hook. `Dropdown` already closes on `onDisable`; losing focus is the same
thought, and the hook was already sitting there unused.

Covered by `tests/DropdownFocus.test.ts`; 2 of its 6 fail with the override emptied. The other
four pin what must *not* change: the value survives the close, `onValueChanged` does not fire
for it, re-selecting the control that already holds focus is not a reason to close, and losing
focus while closed does nothing.

### F44. A scroll view kept driving content that was destroyed — fixed `3cd0286`

**F35's shape in a control:** a per-frame driver acting on a target nobody told it about.

**What happened.** `ScrollRect.content` is a reference a scenario assigns. Rebuilding a list
destroys that object — the ordinary way to refresh one — and nothing told the scroll view. Its
tick went on pinning anchors and writing `anchoredPosition` to a destroyed `RectTransform` every
frame, and the field held that component alive for as long as the scroll view existed.

**Fix.** Every internal read goes through `_liveContent()`, which drops the reference once the
component is gone. Clearing rather than merely skipping is the point: skipping stops the writes
and keeps the object alive, and a scenario that rebuilt its list is about to assign the new one
anyway.

**Two things worth keeping from getting there.**

The first version made `_liveContent` call itself — the helper was inserted before the
mechanical rewrite of the reads, then rewritten along with them. The tests failed with a stack
overflow rather than an assertion, which is its own kind of clear signal.

The negative control fails only **two** of the five tests, and that is the finding in miniature:
without the guard the tick writes to a dead object without complaining, so most of what one
would naturally assert still passes. The two that fail are the ones that ask whether the
reference was let go.

### F45. `InputField` had no `setTextWithoutNotify` — added `67f5c9b`

Found by the method this part's checklist entry had written down in advance: *put
`WithoutNotify`, `interactable`, `onValueChanged` and the transition hooks side by side across
the whole family and see who is missing what.* Five controls, one column, one blank.

**The gap.** `Slider`, `Toggle`, `Dropdown` and `Scrollbar` each offer a "without notify"
setter, and `Slider`'s JSDoc names the other three as its counterparts — so the family is
documented as a set. `InputField` had none. A scenario reflecting its own state into a field had
no way to do it without the field echoing back, which is the loop the family exists to prevent.

**Worse here than elsewhere.** A text listener commonly reformats what it receives — trimming,
upper-casing, re-masking — and writes the result back. With no silent setter that is a write per
write, forever.

Unity has `SetTextWithoutNotify` for the same reason. Filtering and the character limit still
apply, so what lands is what typing the same value would have produced, and the caret goes to
the end exactly as assigning `text` leaves it.

**No negative control, and why.** This is an addition, not a repair: the tests do not compile
without the method. What they pin instead is that it behaves like its siblings, and that
assigning `text` still notifies — the half that must not change.

### F46. Explicit navigation moved focus onto controls that were gone — fixed `d00df46`

**Two paths, one guarded.** `Selectable.findSelectable` either searches automatically or follows
an explicit link. The search walks `EventSystem._allSelectables()`, whose membership enable,
disable and destroy maintain, so it cannot return a control that is not there. The explicit path
follows a reference the scenario set once — `navigation.selectOnRight` and friends — and asked
only `isInteractable()`, which is about the interactable flag and the `CanvasGroup`s above it,
not about whether the control still exists.

**What happened.** An arrow key moved focus onto a destroyed or deactivated control. Focus then
sat where nothing could clear it: the destroy path runs `_unregisterSelectable`, which clears
the focus a control *held*, not focus set onto it afterwards. The keyboard user is left pressed
against a control that is not on screen, and every further key goes to it.

**Fix.** Require `isActiveAndEnabled` as well — the pair Unity requires (`IsActive() &&
IsInteractable()`) for exactly this reason. **F36** is again what makes the check mean anything:
before it, `isActiveAndEnabled` answered `true` for destroyed components.

Covered by `tests/ExplicitNavigation.test.ts`; 4 of its 6 fail without the check. One of the
other two is the non-interactable case, which passed before and is kept so the pair stays a
pair.

### F47. A `<size>` run drew over the line beneath it — fixed `aa36804`

**Wanted.** `<size=40>` inside a 16pt label to occupy the room it needs.

**What happened.** It drew at 40px and the line advanced by 16, so it overlapped the line below;
and `preferredHeight` reported the same too-small figure, which a `ContentSizeFitter` then
believed and sized the panel to.

**The data was already there.** `RichLine.maxSize` is documented as "largest token size on the
line; what its height is measured by", and only the baseline alignment *within* a line used it.
Both the draw and the measure advanced by the label's own font size.

**Why it survived.** The two halves agreed with each other. This is the harder version of F27's
shape: not one representation updated and the other not, but both consistently wrong against
what the feature promises. Checking them against each other would have found nothing — only
checking each against the markup does.

**Fix.** Both halves sum each line's own height, through one helper so they cannot drift apart.
A line with no runs — a blank paragraph — falls back to the label's size rather than collapsing.

Covered by `tests/RichTextLineHeight.test.ts`; 3 of its 6 fail with the old measurement, and the
other three pin what must not change: a label with no size tags, a blank paragraph, and the
plain-text path.

## Part 8 — Math

### F48. `Mathf.round` rounded halves the JavaScript way, not Unity's — fixed `8d1b1d0`

**What it did.** Called `Math.round`, which sends halves toward positive infinity: `0.5` → `1`,
`2.5` → `3`, `-1.5` → `-1`.

**What Unity does.** `Mathf.Round` is .NET's `Math.Round`, which sends halves to the **even**
neighbour: `0.5` → `0`, `2.5` → `2`, `-1.5` → `-2`.

**Why it matters more than one integer.** Rounding halves consistently in one direction biases a
sum of many rounded values — half a unit per value. To-even cancels it. That is why .NET, IEEE
and therefore Unity chose it, and the new tests include the sum rather than only the individual
cases, because the bias is the reason the behaviour exists.

**Why it counted as a defect rather than a difference.** Every other method on `Mathf` states
"Equivalent to Unity's …" in its JSDoc, and where the class *does* diverge deliberately it says
so — `sign` documents returning `0` for zero where Unity returns `1`. `round` claimed nothing
and diverged, which is the one combination a scenario author cannot see coming.

Negative zero is preserved as well: `-0.4` and `-0.5` both give `-0`, as IEEE and .NET do.

**A pre-existing test changed.** `tests/Mathf.test.ts` asserted `round(2.5) === 3`. It was
pinning the implementation rather than a decision — the JSDoc made no claim, and nothing in the
engine calls the method. The assertion now reads `2` and carries a comment naming this finding,
so a later reader does not take it for a regression. Changing a test to match a fix is exactly
the move that hides a mistake, so it is called out here and in the commit rather than left to be
noticed.

Covered by `tests/MathfRounding.test.ts`; 4 of its 6 fail against `Math.round`.

### F49. Only `Vector3`'s shared constants were frozen — fixed `31d7ad5`

**The enforcement half of F10.** That finding fixed sixteen *getters* that handed out shared
constants by returning copies. This is the other side: the constants that are still shared on
purpose, and whether "do not mutate" is a rule or a wish.

**What was there.** Every one carries the same sentence — "Shared instance — do not mutate!".
`Vector3`'s are `Object.freeze`d, so under ES module strict mode the contract throws.
`Vector2`'s, `Vector4`'s, `Color`'s and `Rect`'s were not, so the same sentence was advice.

**Why `Color` makes it serious.** `Color.white.a = 0.5` repaints every future use of white,
across the whole engine, permanently and silently — and `Color.white` is the constant a scenario
reaches for most. The engine itself knows the trap: `ColorBlock`'s defaults are
`Color.white.clone()` precisely to avoid it.

**Safe to add**, and the full suite passing unchanged is the evidence: nothing inside the engine
was relying on writing to one.

**The negative control is the finding demonstrating itself.** Unfreezing `Color` fails three
tests, and the third is *"a clone is still perfectly writable"* — which fails because the
earlier test's `Color.white.a = 0.5` succeeded and was still in effect when it ran. One test
corrupting the next through a shared constant is exactly what this does to a scenario.

**`Matrix4x4.identity` and `zero` stay unfrozen**, as their own JSDoc explains: `Object.freeze`
throws on a `Float32Array` that has elements, so the guarantee cannot be had there. That one
really is a contract, and it is documented as one.

### F50. `Keyframe`'s tangent weights are stored and never applied — documented `3d24607`, weighting **open**

The F39 shape in the math: a documented property nothing reads.

**What is there.** `Keyframe.inWeight` and `outWeight` are public, documented as "weighted
tangent mode", default to Unity's `1/3`, and are carried through `clone()`.

**What reads them.** Nothing. `_hermite` is a plain Hermite spline and there is no
`weightedMode` to turn weighting on. A curve authored with weighted tangents in Unity therefore
loads, keeps its weights, and draws a different shape — quietly, since the numbers are all
present and plausible.

**Done.** The fields say what they are: stored so a curve survives a round trip, never applied,
with a `TODO` naming what applying them needs.

**Open.** Real weighting means a `weightedMode` per key and a cubic Bezier evaluator that solves
for the parameter at a given time. That is a feature, and it is not something to smuggle into a
documentation commit — the same call as F31's spring.

**What was checked while there.** The wrap modes are the part of this class with an independent
reference: `Mathf.repeat` and `Mathf.pingPong` answer the same question through different code.
Compared across times before the curve as well as after — a negative cycle count and a parity
test being where ping-pong usually breaks — they agree exactly. `tests/AnimationCurveWrap.test.ts`.

### F51. Writing through `Ray.direction` bypassed its normalization — documented `954e6ea`

**The promise.** A `Ray`'s direction is unit length, and every consumer relies on it —
`Bounds.intersectRay` returns a distance measured in units of that vector, so a direction of
length 2 reports half the distance it should.

**The hole.** The setter normalizes, and so does `set()`. The getter hands back the ray's own
vector, so `ray.direction.set(1, 1, 1)` walks past both. The old doc said "Setting this will
normalize the input vector" and left the reader to work out that writing *through* it is not
setting it.

**Documented rather than closed, deliberately.** Returning a copy would allocate on every access
and a raycast reads this per frame — the live vector is the reason the class is shaped this way.
The doc now names the consequence and the two ways round it.

`tests/RayInvariants.test.ts` pins all four paths — constructed, assigned, `set`, and written
through — so the documented behaviour is a decision on the record rather than an accident nobody
had noticed.

## Part 9 — Animation and Cinemachine

### F52. Cinemachine printed debug traces in shipped builds — fixed `16aa7ab`

**What was there.** Seven `console.log` calls across three classes, with two private frame
counters whose only purpose was to gate them:

- `CinemachineVirtualCamera` logged its first computed state, and its discovered body and aim.
- `CinemachineHardLookAtAim` logged camera position, target and euler angles for three frames,
  and "lookAtTarget is NULL" when it had none.
- `CinemachineOrbitalAim` did the same for five frames, and announced whether component
  discovery had found a body.

**Why it counts.** This runs in the platform students use, on every scenario with a virtual
camera. None of it is actionable by a consumer — `[OrbitalAim] body discovery: FOUND (4
components)` is a note the author left for themselves. The engine has `console.warn` for things
a developer can act on and uses it properly elsewhere; this was instrumentation that never got
taken out.

**Fix.** Removed, counters included. Two of the sites stated a real fact *only* in their log
text — that a null target means "keep the current rotation" — so that is now a comment beside
the early return, where someone reading the code would look for it.

No behaviour change: the counters gated nothing but output. 5 insertions against 49 deletions,
suite unchanged.

### F53. A virtual camera kept following a destroyed target — fixed `90deb81`

**F44's shape, in Cinemachine**, and the fourth place this engine holds a reference nobody tells
it about — after `AssetDatabase`'s guids (F15), `TintCache`'s bitmaps (F34), `UITween`'s targets
(F35) and `ScrollRect`'s content (F44).

**What happened.** `follow` and `lookAt` are Transforms a scenario assigns once, and the thing a
camera follows is very often the thing that gets destroyed — a vehicle that explodes, an object
swapped for another, a scene rebuilt around the camera. The camera went on reading a destroyed
Transform's position every frame, and kept it, and the Three.js object under it, alive for as
long as the camera existed.

**Fix.** Both reads go through a guard that drops the reference. A body or aim with no target
keeps the state it had, which is exactly what happens before a target is ever assigned — so the
strategies gained no new case to handle.

**The negative control repeats F44's lesson.** Two of six tests fail without the guard: the two
that ask whether the reference was let go. The others pass either way, because reading a
destroyed Transform does not complain — which is why this family is invisible until somebody
goes looking for it.

### F54. A dead block allocated in the camera's LateUpdate forever — fixed `5fdd6a3`

**F52 with the log removed and the cost kept.** `CinemachineBrain.lateUpdate` ended with:

```ts
if (this._frameCount <= 3 || this._frameCount % 120 === 0) {
    const p = finalState.position;
    const e = finalState.rotation.eulerAngles;
}
```

Two values computed, neither used — what is left after deleting a `console.log` but not what fed
it.

**Why it is worth a finding rather than a tidy-up.** It runs every 120 frames for the life of
the scene, and *both* lines allocate: `position` returns a new `Vector3` and `eulerAngles`
builds one from the quaternion. That is in the camera's `LateUpdate` — the place the engine's
own conventions single out as one that must not allocate. `_frameCount` existed only to gate it,
and went with it.

**What the same pass verified.** Cinemachine had no tests at all across eleven classes; it now
has its first, on the behaviour `CLAUDE.md` records as a decision — *always cut on first
activation, because blending from a null `CameraState` starts the camera at the origin*. It
holds. Also covered: priority selection, `Cut` switching instantly, a `Linear` blend being half
way at half its duration and finishing, and no cameras leaving the transform alone.

### F55. Damping of zero froze the camera instead of removing the damping — fixed `8d235c3`

**The formula is right and its edge is not.** Both damped bodies smooth with
`1 - Math.exp(-damping * dt)` — framerate-independent, correct for every positive damping, and
it cannot overshoot because `1 - exp(-x)` approaches 1 from below. At `damping = 0` it evaluates
to **zero**: the camera never moves at all, sitting where it started while its target walks
away.

**Reachable by writing the obvious thing.** `damping = 0` is what an author sets for a rigid
camera bolted to its target — Unity reads it that way — and the result here was a camera that
does not follow. The doc said "higher = snappier, lower = smoother" and left the end of the
scale to be discovered.

**Fix.** Non-positive damping snaps. The field now says what it is: a rate, framerate-independent,
with zero meaning no damping.

**What the tests pin besides the fix.** Four of the six cover behaviour that was already right
and could have broken in fixing this — a positive damping lags then catches up, higher is
faster, a tiny step barely moves, and a huge step lands on the target rather than overshooting.
That last one is the property that makes this formula the right choice, so it is worth having a
test say so.

### F56. A workaround for a corruption that cannot happen — fixed `c0023cb`

**What was there.** `cameraLookRotation` passed `new Vector3(0, 1, 0)` as its up vector, with a
comment: *"Passes inline `new Vector3(0, 1, 0)` as up vector to avoid the corrupted `Vector3.up`
shared static instance."*

**Why it cannot be true.** `Vector3`'s constants are frozen — a write throws rather than
silently succeeding — and `Quaternion.lookRotation` only ever *reads* its up vector; it is even
that method's default argument. Whatever the original symptom was, the note outlived it.

**Why the comment is the defect.** A note claiming a core constant is unreliable is worse than
no note: it invites the next reader to distrust every use of `Vector3.up` in the engine, and to
copy the workaround into new code. This audit nearly did exactly that — the comment was read as
evidence for a *fifth* finding before checking whether the claim held.

**Fix.** The argument is gone, so the method uses `lookRotation`'s default; the comment records
what was actually true. One allocation per call goes with it, in the active camera's per-frame
path.

**Removing a workaround is only safe with a witness.** Seven tests pin the resulting rotation —
along each axis, straight down and straight up where forward and up are parallel and the
fallback up has to take over, a diagonal, and the degenerate case where `from` equals `to`. One
asserts the claim the comment made: that `Vector3.up` survives being used.

### F57. A POV damping above one turned the camera to NaN — fixed `a6bf47e`

**What happened.** POV smoothing computes `1 - Math.pow(1 - damping, dt * 60)`. Above a damping
of `1` the base is negative, and a negative base with a fractional exponent is `NaN`. Yaw and
pitch became `NaN` and stayed there: the camera pointing nowhere for the rest of the session,
with nothing logged to say why.

**Reachable by copying a number between two classes in the same subsystem.** `damping` on
`CinemachineFollowBody` and `CinemachineOrbitalBody` is a *rate* — larger is snappier, `5` is
the default. On `CinemachinePOVAim` it is a *fraction* — `0` is raw, approaching `1` is treacle.
Same name, same namespace, opposite meanings, and the body's default value is poison here.

**Fix.** The value is clamped into `[0, 1]`, and the field states the convention and that it is
the inverse of the bodies'. Making the meanings agree would be the better fix and is not a
bug-fix commit's to make: scenarios already set this.

**The tests are the lesson.** The first version passed against the unfixed code. `dt * 60` with
`dt = 1/60` is exactly `1` — an integer exponent, which `Math.pow` evaluates happily for a
negative base — so **the tidiest possible frame time is the one value that hides this defect**.
Real ones (59 fps, 120 fps, a 16 ms step) all produce fractional exponents and NaN. A test that
uses the idealised frame time is testing an idealised engine.

## Part 10 — The tail

### F58. Disabling an `AudioSource` left the sound playing — fixed `e232954`

**What happened.** `onDisable` removed the source from the spatial update list and left it
playing. So a disabled source went on sounding, no longer following its object, from wherever
that object had been when it was switched off. Deactivating a GameObject does the same — hide a
panel, hide a machine, and its loop carries on for the rest of the scene.

**Unity stops a source on disable**, and silence is what a scenario means by hiding something.

**Stop rather than pause**, matching Unity: the position resets, re-enabling does not resume by
itself, and a scenario that wants the sound back asks for it. Two tests pin that, so the choice
is on the record rather than implied.

**What made the gap visible.** `onDestroy` already stopped the source *and* disconnected and
dropped the panner and gain nodes. The two teardown paths disagreed about whether a source that
is going away should be silent — and comparing a class's own disable and destroy paths is a
cheap check that has now found this and, in the other direction, F44's clearing.

Covered by `tests/AudioSourceDisable.test.ts`; 5 of its 6 fail without the stop.

### F59. An empty `Gradient` threw from inside the particle update — fixed `01f3b01`

**What happened.** `setKeys` takes whatever arrays it is given, and every branch of `evaluate`
indexes key 0. A gradient with no keys threw `Cannot read properties of undefined (reading
'time')` — from inside the particle update, once per particle per frame.

**How a scenario gets there.** Building keys from data: filter a list of colour stops down to
none, or load a config where the array is missing. The particle system then stops with a
TypeError instead of drawing something plain.

**Fix.** An empty gradient evaluates to opaque white — the state a fresh `Gradient` is already
in, since its default keys are white at 0 and white at 1. "No keys" and "no colour information"
now agree, instead of one of them being fatal.

**The rest of the edges already held**, and the tests say so: a single key answering everywhere,
blending between two, clamping outside 0–1 rather than extrapolating, two keys sharing a time
not dividing by zero, and `Fixed` mode stepping rather than blending. The class is careful
everywhere except at the one input nobody pictured.

### F60. The two texture counters sat side by side, one of them unexplained — documented `5b0c6cc`

**The worry this part was opened on.** `MemoryProfiler` sums *engine* objects while a host
compares against `renderer.info`, and that mismatch is what made the 2.9× texture-memory report
ambiguous.

**Half of it was already handled.** `estimatedTextureVramBytes` documents itself precisely:
"counts every live engine texture whether or not it is currently uploaded to the GPU, and
excludes render targets".

**The other half was the gap.** `textures` and `geometries` — the raw `renderer.info.memory`
counters, sitting in the same object — had no documentation at all. A reader sees two texture
numbers side by side in one report with one of them explained, which is worse than either
having no explanation: it invites the assumption that the undocumented one is the same thing
measured better.

**Fix.** Both now state what they count and why they disagree. The renderer counts what it has
uploaded and *includes* render targets; the engine counts what is alive and *excludes* them. A
scene holding textures it has not drawn reads high on the estimate and low on the counter; a
scene with shadows reads the other way. Neither is wrong, and a measurement that gets quoted in
a paper should not require the reader to work that out.

### F61. `clear` kept the passes it had just disposed — fixed `21c7ea7`

**Two methods, one question, two answers.** `PostProcessing.removeEffect` disposes an effect's
pass *and* deletes it from the pass map. `clear` disposed and kept it.

**Why that matters.** `_buildPipeline` reuses whatever the map holds —
`let pass = _passes.get(eff); if (!pass) { … }` — so re-adding a cleared effect handed it
straight back its own disposed pass, and the pipeline was built on freed GPU resources.
Reachable by a scenario that swaps post-processing setups: clear the pipeline, add the same
effect instances back for the next scene.

**Found by the two checks this audit carries.** A map keyed by objects that something forgets to
prune (the reference-holding family), and two methods answering the same question differently
(the `onDisable`/`onDestroy` comparison from F58). Both pointed at the same line.

**One claim did not survive checking.** The first version of the fix called `_passes.clear()`
and the reasoning said the map "would hold every effect ever cleared". It is a `WeakMap`:
nothing leaks, the entries go when the effects do — and `clear()` does not exist on one. The
defect is only the stale pass, and the fix is a `delete` per effect.

**The test needed the same care.** Its first helper always created a fresh pass, so it passed
with and without the fix. It now reproduces `_buildPipeline`'s reuse branch, which is the
behaviour under test — negative control: 2 of 6 fail without the delete, where the sloppy
version failed 1.

### F62. Disposing an Application left every input listener attached — fixed `861e4c5`

**The reference-holding family, in the DOM.** `Input._dispose` and `Touch._teardown` both exist,
and both say in their own JSDoc that they are called when the Application shuts down. Nothing
called either.

`Application.dispose` removed exactly one listener — its own resize handler — and left the
keyboard, blur, visibilitychange, mouse and pointer-lock listeners `Input` attached, plus the
four touch listeners `Touch` attached to the canvas.

**The platform is the case that matters.** It creates a viewer per visit and disposes it when
the student leaves. Every visit added another full set, all writing into the same *static*
`Input` and `Touch` state on behalf of a canvas that is gone — so a key pressed on one page is
delivered by as many listeners as there have been visits.

**Fix.** Both teardowns are called from `dispose`.

**The test counts rather than asserts.** It stubs `addEventListener`/`removeEventListener` on
window, document and canvas and tallies them by type, so the assertion is "nothing was left
attached" rather than a list of the listeners anyone remembered. That is what will catch the
next listener added without a matching removal. One case runs five create/dispose cycles — the
platform's shape.

### F63. A plugin leaving mid-frame made the dispatch skip the next one — fixed `0028b9f`

**What happened.** The three dispatch loops walked `_ordered` directly. A plugin that
unregisters itself from inside its own update — how a one-shot plugin ends, and what
`unregister`'s documentation invites — splices that array while the loop is walking it, so the
plugin registered *after* it is skipped for that frame.

**Fix.** The loops iterate a reusable buffer copied before dispatch. Reusable rather than a
fresh slice because this runs three times a frame: the copy is a length assignment and N index
writes, with no allocation after the first.

**The engine already knew this.** `UIEvent.invoke` snapshots its listeners, with a comment
saying that re-entrant subscription changes are the only case where it bites. One place had the
precaution and the other did not, which is the whole of this finding — and the second instance
of that exact pair (see F33, where `CanvasGroup` was hashed and `RectMask2D` was not).

**The snapshot settles the other direction too**, and a test pins it: a plugin registered during
a dispatch starts on the *next* frame rather than running twice in this one — the same rule
`UIEvent` applies.

Negative control: 3 of 6 fail against direct iteration. One of the three that pass either way is
kept deliberately: a plugin that throws does not stop the others, which is the isolation the
component loops still lack (**F22**).

### F64. Every UI per-frame driver could skip an element mid-pass — fixed `072073c`

**F63's defect, found by taking F63's own lesson seriously.** That finding ended with a rule:
when a class solves a problem with a named precaution, the comment explaining it is a list of
the other places to check. `UIEvent.invoke` snapshots its listeners; `PluginManager` now
snapshots its plugins; the five UI drivers did not.

**What happened.** `Selectable`, `LayoutGroup`, `ScrollRect`, `ContentSizeFitter` and
`AspectRatioFitter` each walk `_instances` by index, while their components splice themselves
out of that same array in `onDisable`. Anything disabled during a pass shifts the array, and the
index loop skips whatever followed it.

**Which one a scenario can reach.** `ScrollRect`: its tick raises `onValueChanged`, and a
listener that hides a panel disables real components. The other four reach user code only
indirectly. They are fixed anyway — the hazard is identical, and working out which of them is
reachable today is not worth an afternoon that the fix costs five lines.

**A copy, not a backwards loop.** Reversing would also stop the skip, and would quietly change
the order layout groups rebuild in. The snapshot preserves order exactly.

The helper is shared and documented once in `UIUtils`, because this is now the third place in
the engine taking the same precaution.

Negative control: reverting `ScrollRect` alone fails the test that a second view still ticks
after the first disables itself.

### F65. `TypeRegistry._clear` emptied one of its two maps — fixed `5c38e1f`

**What happened.** The registry keeps `_byName` — a class by its stable name — and `_byCtor` —
the metadata, and the reverse lookup. `_clear` emptied the first and left the second. After
clearing, `getMeta` and `getTypeName` went on answering for classes the registry no longer knew,
and a name re-registered to a *different* class left the old constructor still claiming it.

**Why it was half done is visible in the fix.** A `WeakMap` has no `clear`. Emptying one means
replacing it — one line — and the absence of the obvious method is exactly what turns into "I
will do the other one in a moment".

**Same shape as F61, found by the same check** — two methods that answer the same question about
the same state, disagreeing. There `removeEffect` pruned its map and `clear` did not; here
`_clear` prunes one map and not the other. That check has now produced F58, F61 and F65.

Covered by `tests/TypeRegistryClear.test.ts`; 3 of its 6 fail without the replacement, including
the one that matters for the editor: a name reused for another class after a clear.

---

## Negative results worth recording

**The Set-based per-frame drivers need no snapshot, and were checked rather than assumed.**
`LODGroup`, `ParticleSystem`, `Animation` and `AudioSource` iterate `Set`s. Deleting an
unvisited element from a Set during iteration is well defined in JavaScript — that element is
simply not visited — so none of them can skip a neighbour the way an index loop over a spliced
array does. The array-based ones (five UI drivers, `Canvas`, `Animator`) all needed the fix; the
Set-based ones are correct by construction, which is worth knowing before anyone "makes them
consistent".

**`PluginManager` is otherwise the best-behaved registry in the engine**, and worth naming as
the pattern the others should follow: `register`/`unregister` keep the map and the ordered list
in step, `_reset` unregisters each plugin properly rather than emptying the containers, and every
dispatch wraps the call in `try`/`catch` so one plugin cannot break a frame. That last is exactly
the isolation `Scene._update` does not give components — recorded as F22, and here is a working
example of it inside the same engine.

**A method documented as "called on shutdown" is a claim to check, not a fact.** Both teardowns
in F62 read as though they were wired up; neither was. The same sentence appears on
`PhysicsWorld._reset`, `Physics._reset`, `Canvas._reset`, `EventSystem._reset`,
`UITween._reset`, `TintCache._reset` and `Animation._reset` — those are called from tests and
from `Scenario.unload`, and were checked while here. The two that were not called were the two
whose callers were in `Application`, the file nobody had needed to touch.

**The serializer covers every `FieldType`, checked by round-tripping rather than by reading the
switch.** Part 10's checklist named this as a risk. `ValueSerializer` handles each value type in
both directions, and the two that could plausibly have been one-way are not: a `Sprite` is
written as its texture reference plus framing and rebuilt from both, and a `Mesh` is written as
an `AssetRef` when it came from a file or as a `PrimitiveMesh` recipe when it came from a
factory — and `Mesh.fromPrimitive` reads that recipe back. `tests/ValueRoundTrip.test.ts` now
puts thirteen values through `JSON.stringify`/`parse` and asserts each returns as its own class,
so the coverage is a fact rather than an inspection.

The reference types (`GameObject`, `Component`, `Asset`) resolve in a **second pass** once every
object exists, so they deliberately do not round-trip through `ValueSerializer` alone. That is
recorded in the test file itself, so a later reader does not take it for a hole.

**Part 10 — `ParticleSystem` and `AudioListener` pass the disable/destroy comparison that found
F58.** `ParticleSystem` hides its points and unregisters on disable, then on destroy unregisters,
detaches the Three.js child and disposes the geometry and material: disable stops it being seen,
destroy frees what it owns, which is the right division. `AudioListener` does the same thing in
both paths because it owns nothing but its registration.

**Part 9 closes.** `AnimationClip` is a thin wrapper over a Three.js clip with nothing to get
wrong, and `CinemachineFlyBody` has no damping and no held references. The part's four risks
were named in the checklist before it started: blend weights summing to 1 (they do), a
transition consuming a trigger twice (it cannot), the documented first-frame Cut (it holds, and
now has a test), and damping at extreme steps — which is where two of the six findings were,
though not in the direction expected. The damping curve is exact at large and small `dt`; it is
at the *ends of the parameter's own range* that both cameras broke.

**`Animation` has the most careful teardown in the engine, and it is worth naming.** Its
registry is maintained on enable, disable *and* destroy; `onDestroy` stops the Three.js mixer's
actions, drops the mixer, and clears the action map, the clip list, the blend weights and the
fade-out reference. It is the class the reference-holding family (F15, F34, F35, F44, F53) would
have been checked against if anyone had thought to compare.

**Part 9 — the two things the part was opened to check both hold.** `BlendTree` normalizes:
weights are divided by their total, non-positive ones are skipped, and two children sharing a
clip name have their weights summed rather than one overwriting the other. `Animator` consumes a
trigger *before* entering the target state, so a state that transitions straight out again
cannot see it twice — and the consumption is guarded by parameter *type*, so a plain `Bool`
tested with the same `If` condition mode is not cleared along with the triggers. Both were named
in the checklist as risks before either was read.

**Part 8 closes with the arithmetic itself intact.** Across twelve classes the audit found three
things — a rounding rule that diverged from Unity, constants that asked rather than enforced,
and two properties documented as doing more than they do. Not one formula was wrong: the
aliasing discipline holds everywhere, `Mathf.repeat` is right at the boundary where it looked
wrong, `AnimationCurve`'s wrap modes agree exactly with `Mathf`'s answers to the same question,
and the Hermite evaluation, the vector algebra and the matrix transforms all check out. For a
library written by hand against a reference implementation, that is the result worth recording.

**Part 8 — the vector and matrix maths is aliasing-safe, checked rather than assumed.** The
checklist named aliasing (`Vector3.add(a, b, a)`) as this part's risk. Every operation whose
formula for one component reads another caches its inputs in locals first — `Vector3.cross`,
`Quaternion.multiply`, `Matrix4x4.multiplyPoint` / `multiplyPoint3x4` / `multiplyVector`. The
component-wise ones (`reflect`, `project`, `projectOnPlane`, `add`, `lerp`) read only the
component they write, and compute their scalars — the dot products, the squared magnitudes —
before the first write. Both patterns are safe with `out` aliased to either input.

**The F12 count was itself worth re-measuring.** The figure of "680 lines" matches what
`grep '[А-Яа-я]'` reports, and in a C locale that range matches *bytes*: it counts every line
containing an em-dash. Measured by code point it is **674 lines across 12 files**, the math
folder holding 296 of them and `Mesh.ts` alone 168. The original number was close enough to be
right, and arrived at in a way that could easily not have been.

**`Mathf.repeat` is correct at the boundary, checked rather than assumed.** Unity clamps its
result into `[0, length]` and this does not, which looked like a defect: for a tiny negative `t`,
`t - floor(t / length) * length` rounds up to exactly `length`. Working through it, Unity's own
clamp permits `length` too — the clamp bounds, it does not exclude — so both implementations can
return `length` and neither can exceed it. `repeat(-1e-17, 1)` returns `1` on both. No
divergence, and the method's promise ("never larger than `length`") holds.

**`SelectableTransition` is clean, and clean in the way F10 asked for.** `ColorBlock`'s defaults
are `Color.white.clone()` and fresh `new Color(...)` instances, not shared constants, and each
`Selectable` owns its own block. `Selectable._targetColor` hands back a reference into that
block, but both call sites copy rather than mutate, and the method is private — so the shape
that produced F10 is present and contained.

**`Navigation` and `RichText` are clean.** `Navigation` states the Y-down convention on the
enum itself and maps `Up` to `(0, -1)`, which is the direction that would be wrong if anyone had
carried a Y-up habit into it. `RichText` caps its tag stack, refuses to pop the base style on an
unbalanced closing tag, and leaves an unrecognised tag as literal text — all three documented,
and all three the tolerant reading, which is what Unity's markup does too. Its one quirk is that
a closing tag pops whatever is on top rather than matching by name, so `<b><color=red>x</b>`
closes the colour; that is malformed input, it cannot corrupt the styles after it, and it is not
worth trading the simplicity for.

**The rest of the control family tabulates clean.** `interactable` is consulted in every
interaction path of all five controls (four guarded call sites each), and every one raises its
change event only when the stored value actually moved. `Scrollbar` and `Dropdown` were checked
against `Slider`'s documented contract rather than against each other, so the reference is
Unity's rather than this engine's own habits.

**`Selectable` and `Slider` are clean, including the case that produced F44 elsewhere.**
`Selectable` counts hovers and presses rather than flagging them, because several fingers can do
either at once — and `onDisable` zeroes both counters with the comment "a control disabled
mid-press would otherwise come back stuck", which is exactly the defect this part was hunting.
`Slider` re-clamps its value when `minValue` or `maxValue` moves, and notifies only if the
stored value actually changed.

**`ToggleGroup` and `Toggle` are clean under the registry question.** Membership is removed on
`onDisable`, on `onDestroy`, *and* in the `group` setter when a toggle is moved between groups —
the three ways a member can leave. `_notifyTurnedOn` goes through `_setFromGroup` so a sibling
cannot bounce the notification back and start a loop.

**`EventSystem`'s other held references are guarded correctly.** `pressedGraphic`, `dragTarget`
and `hoverOwner` survive across frames, and every other delivery path — drag, end-drag, exit,
and the cancellation path for a pointer that vanishes without releasing — checks
`isActiveAndEnabled` before dispatching. `_unregisterSelectable` also clears the focus if the
control being removed held it. The release path was the one gap, and only in its second half.

**`PointerEventData` and `AspectRatioFitter` are clean.** The pointer data is a plain carrier
that states both things a caller needs — canvas units with Y down, and that the instance is
reused per pointer so anything worth keeping must be copied. The aspect fitter's four cases were
checked one by one against what each should produce (fit/envelope × parent wider/taller); the
XOR that picks the binding axis is right in all four, and forcing stretch anchors in the
parent-relative modes is what Unity does too.

**`CanvasScaler` is clean, checked against Unity's formulas rather than by eye.**
`MatchWidthOrHeight` blends the two ratios in log space —
`pow(2, lerp(log2(ratioW), log2(ratioH), match))` — which is Unity's own expression, and the
reason halfway between 2× and 8× is 4× rather than 5×. `Expand` takes the smaller ratio,
`Shrink` the larger, both matching. `ConstantPhysicalSize` divides out `devicePixelRatio` before
the unit conversion, which is a deliberate departure documented in place: Unity's DPI is a panel
query, the browser's is derived from `devicePixelRatio` against the 96-DPI CSS reference, so
folding it back out is what makes a point a point.

**`ContentSizeFitter` is clean in itself**, including the detail worth stealing elsewhere: it
writes `sizeDelta` by subtracting the anchor span times the parent size, because `sizeDelta` is
a delta on top of that span and assigning the size directly would double it for a stretched
element. The open question about *nested* fitters is recorded as I5 in `improvements.md`, not as
a finding, because it is not demonstrated.

**Part 6 — the UI's other static registries hold up.** The same sweep that found F35 checked
every static collection in `core/ui/`: `Canvas._instances` / `_live`, `Selectable._instances`,
`LayoutGroup`, `ScrollRect`, `ContentSizeFitter` and `AspectRatioFitter`'s instance lists, and
`EventSystem`'s `_selectables`, `_joysticks` and `_pointers`. Every one of them is removed from
in `onDisable` **and** `onDestroy` — the pair matters, because a component destroyed while
disabled reaches only the second. `Selectable` is the clearest example: it splices itself out of
both.

**Part 6 — `CanvasGroup` and `RectMask2D` are clean in themselves.** Both were read for the
F33 shape and both do their own half correctly: the structure-version counters they publish are
what let elements cache an ancestor walk that no transform change would otherwise invalidate,
and `RectMask2D` documents the Y-down convention on every padding field, as the repo requires.
The defect was in the canvas that consumes them, not in either class.

`UIImage._visualHash` and `UIText._visualHash` were checked field by field against what their
draw paths read, since a hash missing a field is this part's named risk. Both are complete —
`UIImage` even folds the Three.js texture `version` and the decoded source size, so a texture
repainted in place or decoded late still triggers a redraw.

**Part 5 — `LayerCollisionMatrix`, `Collision`, `ContactPoint`, `PhysicsWorld` are clean.** The
matrix was checked at its edges, where bitmask code usually breaks: layer 31 sets the sign bit,
so `1 << 31` is negative and `maskFor` can return a negative number. cannon's filter test is
`(group & mask) !== 0`, which is bit-exact on signed ints, and `ALL_LAYERS` (`~0 >>> 0`,
unsigned) coerces to the same bits under `&`. Symmetric writes, validated layer indices, and a
change handler that re-filters live bodies — nothing to report.

`PhysicsWorld` was read for the shape that produced F26 and F32 — state held on the engine side
that the solver never sees — and it is the class that *fixes* it: `_registerMaterial` pairs
every material with every other, and `_reset` clears each material's recorded pairings so a
material outliving a world does not point into a solver nothing steps.

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
