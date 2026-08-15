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

**130 of 175 classes walked — parts 1 to 8 complete.** Live counts are in [`checklist.md`](checklist.md#progress); the
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
| 9 | Animation and Cinemachine | 17 | next |
| 10 | The tail | 29 | not started |

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
