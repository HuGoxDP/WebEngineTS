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
