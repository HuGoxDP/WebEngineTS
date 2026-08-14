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
