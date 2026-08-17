# Engine audit

A class-by-class hunt for defects across all 175 classes of the engine.

| Document | What it is |
|---|---|
| [`method.md`](method.md) | Why the audit exists, how to run a part, and the failure shapes to hunt |
| [`checklist.md`](checklist.md) | Every class, in ten parts, ticked as it is walked |
| [`findings.md`](findings.md) | Defects found, with evidence and a fix |
| [`improvements.md`](improvements.md) | Ideas that are not defects |

## Why

Every engine defect of the last two weeks was found by a **consumer**, not by the engine — and
1143 green tests caught none of them. The suite tests what was built deliberately, and the
defects were all things that silently did nothing. A test written from the implementation cannot
find a behaviour the implementation never had.

So this is not "read the code carefully". It is a hunt for the specific failure shapes this
codebase actually produces, listed in [`method.md`](method.md).

## Progress

**175 of 175 classes walked — the walk is complete.** 74 findings: **63 closed**, 7 partly closed
with the remainder named in their entry, and 4 still open. Every open one is listed below.
The walk is finished; the open list is now the work. Live counts are in [`checklist.md`](checklist.md#progress); the
summary below is updated when a part changes state.

| Part | Area | Classes | State |
|---|---|---:|---|
| 1 | Core object model and lifecycle | 22 | **done** — 8 findings, 5 fixed |
| 2 | Graphics assets | 11 | **done** — 2 findings |
| 3 | Rendering and components | 17 | **done** — 5 findings |
| 4 | Assets and scenario | 12 | **done** — 11 findings, 9 fixed |
| 5 | Physics | 16 | **done** — 7 findings, 5 fixed |
| 6 | UI core | 21 | **done** — 10 findings, 9 fixed |
| 7 | UI controls | 18 | **done** — 5 findings, 5 addressed |
| 8 | Math | 12 | **done** — 4 findings, 2 fixed, 2 documented |
| 9 | Animation and Cinemachine | 17 | **done** — 6 findings, all fixed |
| 10 | The tail | 29 | **done** — 17 findings, 15 fixed |

### Still open

| # | What | Why it is still open |
|---|---|---|
| F2 | `Destroy(obj, delay)` counts wall-clock, not game time | Needs a game-time scheduler; `Time.timeScale = 0` must hold the delay |
| F3 | `FindObjectsOfType` does not filter by active | Doc corrected; changing the semantics would move behaviour under existing scenarios |
| F4 | `Awake` fires on `addComponent` to an inactive object | Unity defers it to activation; the deferral needs a pending queue |
| F5 | Coroutines pause instead of stopping on deactivation | Half fixed — the remaining half is Unity's stop-on-disable |
| F9 | `releaseSourceImage` has no upload guard | Documented; the guard needs a real GPU-upload signal, not a frame count |
| F12 | 674 lines of non-English comments in public JSDoc | Mechanical but large; `Bounds` done, the rest is a sweep of its own |
| F22 | One failing script stops the whole frame | Needs per-callback isolation with a policy for repeat offenders |
| F25 | Cloning a GameObject | Refuses loudly and names `Prefab.fromGameObject().instantiate()`; a real clone waits on Stage 1 |
| F29 | `overlapSphere` tests origins, not shapes | Needs real shape queries, which is a physics feature rather than a fix |
| F31 | `SpringJoint` is a rigid rod | Documented as such; a real spring is a solver change |
| F50 | Weighted tangents are stored and never applied | Documented; applying them changes the shape of authored curves |

## The loop

1. Take the next unticked class in the current part.
2. Read it against **Unity's documented behaviour**, not against our implementation. That is
   what found the reparenting defect; our code was self-consistent and wrong.
3. Walk it against the failure shapes in [`method.md`](method.md).
4. Write tests for what looks wrong, and **negative-control each one** — break the fix, watch
   the test fail, restore. Two tests in this project passed for the wrong reason.
5. Fix defects in their own commit, with the test that catches them.
6. Record: tick the class in [`checklist.md`](checklist.md), add the entry to
   [`findings.md`](findings.md), and put non-defect ideas in
   [`improvements.md`](improvements.md).
7. Before changing behaviour, **check the blast radius against real content** — the ten
   scenarios in ScenarioCreator are the population. The reparenting fix was safe because none of
   the 45 `.parent =` uses depended on the old behaviour, and that was established before the
   change, not argued after.

## What this does not cover

Performance and visual correctness. Nothing here catches "the shadow is in the wrong place" —
that needs a browser and an eye. The audit is for behaviour that can be asserted in a test.
