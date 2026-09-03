# Etap 0 — visual handedness check (F7)

> **Result, 2026-09-03: the mirror is REAL.** Red **+X** renders left of centre, the "F" reads
> backwards, and the primitive row runs right-to-left. F7 is confirmed. What fixing it would cost
> is written up under "Fixing F7" in [`../unity-coordinate-spaces.md`](../unity-coordinate-spaces.md).
> This page stays as the regression check for whenever that fix lands.

A tiny in-browser scene whose only job is to answer, by eye, the one question the test suite
cannot: **is the rendered image horizontally mirrored versus Unity?** (design note
[`../unity-coordinate-spaces.md`](../unity-coordinate-spaces.md), finding **F7**).

The characterization test `tests/CoordinateSpaces.test.ts` already pins that world **+X** projects
to the **left** of screen numerically. This page shows the same thing on a real GPU frame, which
is the only way to confirm it is an actual *mirror* and not just a coordinate quirk.

## Run

ES-module imports need an HTTP server; opening the file directly (`file://`) will not work.

```bash
npm run build                       # produces dist/WebEngineTS.standalone.js
npx http-server . -p 8080 -c-1      # or: python -m http.server 8080   — from the REPO ROOT
```

Then open <http://localhost:8080/design/coordinate-check/>.

## What to look for

The camera sits on −Z looking toward **+Z** (engine/Unity forward), upright.

| | Unity (expected) | Mirrored (F7 confirmed) |
|---|---|---|
| red **+X** cube | on the **right** | on the **left** |
| green **+Y** cube | up | up (flip is horizontal only) |
| blue **+Z** cube | centre, far | centre, far |
| yellow **F** (bars point +X) | bars point **right**, reads correctly | bars point **left**, reads backwards |

If red **+X** is on the **left** and the **F** reads backwards, the engine renders a horizontal
mirror of Unity — F7 is real, and the fix (mirror the scene, or replace the projection matrix
instead of `rotateY(π)`) becomes a scoped follow-up. If red **+X** is on the right, F7 is a false
alarm and the characterization test's expectation should be revisited.

The bottom row renders every `Mesh.create*` primitive, lit, so you can also confirm they show
front faces (correct winding), not inside-out.

## Scope

This checks **handedness only**. It is independent of the texture-UV convention
([`../unity-coordinates-plan.md`](../unity-coordinates-plan.md)) and of the Transform/Camera
conversion work — none of those touch `rotateY(π)`, winding or world axes, so this picture is the
same before and after them.
