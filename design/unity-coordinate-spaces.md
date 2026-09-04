# Plan: Unity coordinate spaces — Transform & Camera conversions

**Status:** in progress (started 2026-09-03). Scope is the *transform / camera coordinate
conversion* surface — world/local/screen/viewport spaces and the methods that move points
between them.

**Landed 2026-09-03 (Etaps 1–6, headless parts):** Etap 2 — `worldToScreenPoint().z` is now a
world distance, the surface comes from `Camera.pixelWidth`/`pixelHeight` (fed by `Application`,
`_setPixelSize`) instead of `window`, and the public methods build on `_worldToViewportPoint` via
a shared `_ensureCameraMatrices`. Etap 5 — added `worldToViewportPoint`, `viewportToWorldPoint`,
`screenToViewportPoint`, `viewportToScreenPoint`, `viewportPointToRay`, `cameraToWorldMatrix`.
`screenToWorldPoint`/`screenPointToRay` are now correct for **orthographic** cameras too, via a
shared `_buildRay` modelled on Three's `Raycaster.setFromCamera` (parallel rays from the near
plane, not a fan from the eye).
Etap 4 — `Transform.transformVector`/`inverseTransformVector`, `localToWorldMatrix`/
`worldToLocalMatrix`, `rotateAround`, `forward`/`up`/`right` **setters** (direction → world
rotation, matching Unity's `LookRotation`/`FromToRotation`), and a `Space` param on
`translate`/`rotate` (clearing two `@todo`s); also fixed a latent staleness bug where
`transformPoint` read an un-updated world matrix (new `_ensureWorldMatrix`). Etap 1 — `tests/CoordinateSpaces.test.ts` (19 tests). Etap 3/6
— JSDoc Y-down notes + a `CLAUDE.md` "Coordinate spaces" entry. **Still open:** Etap 0 (visual
mirror check — needs a rendered frame, cannot run headlessly) and F4 (viewport rect, deferred). This is the zone the texture-UV plan
([`unity-coordinates-plan.md`](unity-coordinates-plan.md)) explicitly excluded: *"Not a physics
or transform change. Nothing here touches world axes, handedness or rotation order."* The two
plans are complementary, not overlapping.

---

## 1. Research: how Unity defines its coordinate spaces

### 1.1 Handedness

Unity's **world and local** spaces are **left-handed**: X right, Y up, **Z forward**. But Unity's
**camera (view)** space is **right-handed**, OpenGL convention — *"camera's forward is the negative
Z axis"* — while *"forward is the positive Z axis"* in world space. So Unity itself performs a
`+Z → −Z` conversion between world and view space; the engine's Three.js wrapper does the same
thing for the same reason. Consequence: the view matrix taken from Three.js
(`matrixWorldInverse`) is already Unity-correct — **there is nothing to convert in
`worldToCameraMatrix`.**

`Quaternion.Euler` applies rotations in **ZXY** order (*"Rotations are applied in ZXY order"*).
Three.js defaults to XYZ. Euler-angle order is therefore a separate axis of divergence,
independent of handedness.

Cross-product **algebra** is identical between Unity and Three.js; only the interpretation of the
sign of Z differs. `Cross(right, up) == forward` holds in both. "Left-handedness" shows up not in
vector math but in where the renderer places +Z and in triangle winding / face culling.

### 1.2 The spaces

| Space | Origin | Range | z means |
|---|---|---|---|
| **World** | scene absolute | ±∞, world units | ordinary coordinate |
| **Local (Object)** | the parent's frame | ±∞ | ordinary coordinate |
| **Screen** | **bottom-left** `(0,0)` in Unity | pixels, up to `(w−1, h−1)` | **distance from camera, world units** |
| **Viewport** | **bottom-left** `(0,0)` in Unity | `0..1`, top-right `(1,1)` | **distance from camera, world units** |
| *Camera (View)* | the camera | — | **−Z forward** (OpenGL) |
| *Clip / NDC* | — | `−1..1` after ÷w | — |

Screen and viewport are the same thing up to a scale: `viewport = screen / (width, height)`.

Unity is itself inconsistent about Y: `Input.mousePosition` and `Camera.*` are Y-up from
bottom-left, but IMGUI (`Event.mousePosition`, `GUI.*`) is Y-down from top-left. So Y-down is a
convention Unity uses too, not a heresy.

### 1.3 Transform: TRS and hierarchy

Local matrix is **M = T · R · S** (scale, then rotate, then translate). World matrix is the
product down the ancestor chain: `M_world = M_parent_world · M_local`.

- `localPosition/localRotation/localScale` are the stored values, relative to the parent.
- `position/rotation` are derived by walking the hierarchy; their setters solve the inverse
  (world → local through the parent's inverse matrix).
- **`lossyScale` is an approximation and named so deliberately.** Non-uniform scale combined with
  rotation in the ancestor chain produces a world transform with **shear**, which no single
  `Vector3` can express. Unity returns the best approximation. Practical takeaway: non-uniform
  scale + rotation in a hierarchy is a bug source, not a detail.
- `SetParent(parent, worldPositionStays)` — the flag decides whether world pose is preserved (by
  recomputing local) or the object jumps.

### 1.4 Conversion methods

**Transform** — the three point/vector methods differ only in which of TRS they apply:

| Method | Translate | Rotate | Scale | Use for |
|---|---|---|---|---|
| `TransformPoint` | ✓ | ✓ | ✓ | a position |
| `TransformVector` | ✗ | ✓ | ✓ | a vector whose length means something (an offset, a size) |
| `TransformDirection` | ✗ | ✓ | ✗ | a direction (normal, axis) |

Plus the `InverseTransform*` counterparts and the matrices `localToWorldMatrix` /
`worldToLocalMatrix`.

**Camera** — six converters (all three pairs of spaces) plus two ray builders:
`WorldToScreenPoint`/`ScreenToWorldPoint`, `WorldToViewportPoint`/`ViewportToWorldPoint`,
`ScreenToViewportPoint`/`ViewportToScreenPoint`, `ScreenPointToRay`/`ViewportPointToRay`, and the
matrices `projectionMatrix`, `worldToCameraMatrix`, `cameraToWorldMatrix`.

Trap: `ScreenToWorldPoint`/`ViewportToWorldPoint` **require** an input z — the world-unit distance
in front of the camera at which the result lies. `z = 0` gives the camera's own position, not a
point "on the screen".

---

## 2. Engine audit (findings)

| # | Finding | Where | Status |
|---|---|---|---|
| F1 | Screen space is **Y-down, top-left** (matches DOM/UI/`Input`), but JSDoc claims plain "Equivalent to Unity's `Camera.WorldToScreenPoint`" with no note | `Camera.ts` | doc fix — Etap 3 |
| F2 | `worldToScreenPoint().z` returns `−NDC.z` (≈ −1..1), not Unity's **world-unit distance** | `Camera.ts` | **defect — Etap 2** |
| F3 | Uses `window.innerWidth/Height` instead of the actual render surface | `Camera.ts` | **defect — Etap 2** |
| F4 | `Camera.viewport` (`Rect`) is ignored by conversions | `Camera.ts` | **deferred** — see §4 |
| F5 | Correct projection lives in `@internal _worldToViewportPoint`, not reused by the public methods | `Camera.ts` | **Etap 2** |
| F6 | No tests for any coordinate conversion | `tests/` | **Etap 1** |
| F7 | Handedness compensation is one line, `rotateY(Math.PI)` — a *rotation*, which cannot mirror, so the image is a **horizontal mirror** of Unity's | `Camera.ts` | **FIXED 2026-09-03** — see "F7 in detail" |
| F8 | Missing API: `transformVector`/`inverseTransformVector`, `localToWorldMatrix`/`worldToLocalMatrix`, `rotateAround`, `Space` param; camera viewport family, `viewportPointToRay`, `cameraToWorldMatrix` | — | **Etap 4/5** |

Correct and untouched: `transformPoint`/`transformDirection` (TRS vs R-only is exact),
`worldToCameraMatrix` (correct *because* Unity's view space is also −Z), `cameraLookRotation`.

**F7 in detail.** `rotateY(π)` is a proper rotation, not a reflection; it cannot change
handedness. Starting from Three's default camera (right +X, up +Y, view −Z), a 180° Y turn gives
right **−X**, up +Y, view **+Z**. So the camera correctly looks toward engine/Unity forward (+Z)
but its right axis is −X, whereas Unity's is +X. Prediction: a point at world +X lands on the
**left** of the engine's screen and on the **right** of Unity's — a horizontal mirror. There is no
global compensation (negative scale / Z flip) anywhere in the engine; verified by search.

**Confirmed visually on 2026-09-03** through `coordinate-check/`, with two independent witnesses in
one frame: the chiral "F" rendered backwards, and the row of primitives ran right-to-left (the cube
is authored first, at the leftmost x, and appeared rightmost). The prediction was exact — and
**fixed the same day**; see below.

### Fixing F7 — done 2026-09-03

Mapping a left-handed world onto a right-handed renderer needs a **reflection**
(`diag(1, 1, −1)`, determinant −1), which no rotation can supply — so `rotateY(π)` could never be
tuned into correctness.

The earlier draft of this section listed four routes and called them all expensive, because a
reflection flips triangle winding. **That was wrong about Three.js.** `WebGLRenderer.renderBufferDirect`
computes `frontFaceCW = object.isMesh && object.matrixWorld.determinant() < 0` and hands it to
`setMaterial`, which flips `flipSided` accordingly. Three already compensates, **per object**, for
a reflected model matrix. So mirroring the *content* costs nothing in geometry, index order or
normals.

What shipped:

- **`Scene._contentRoot`** — a `THREE.Group` with scale `(1, 1, −1)` that every root GameObject
  hangs from. Three sees a negative determinant per renderable and flips winding itself, so front
  faces stay front.
- **Cameras cancel it** — the internal Three camera carries a matching `scale(1, 1, −1)` in place
  of the old `rotateY(π)`, so its *view* matrix stays proper. That part matters: Three decides
  winding from the object matrix alone and assumes the view is not reflected, so a camera-side
  mirror would have inverted culling for the whole scene.
- **The boundary conversions** — Three world space is now the mirror of engine world space, so
  anything reading world state back out of an `Object3D` undoes it. `Transform._engineWorldMatrix`
  left-multiplies `matrixWorld` by `S` (negating the third row), which is also *proper*, so
  decomposition gives a correct rotation and `lossyScale` — reading a reflected matrix directly
  makes Three park the negative sign on X arbitrarily. `Camera` converts points on the way in and
  out and composes `S` into `worldToCameraMatrix` / `cameraToWorldMatrix`. `Physics.raycast`
  converts the ray in and the hit point and normal back. `Renderer._computeWorldBounds` undoes it
  the same way as `Transform`.

**Why it was worth the disruption.** The platform teaches chirality-carrying subjects — a B-DNA
double helix is right-handed, molecular stereochemistry and crystal handedness are the content, and
Circuits/Mechanics rely on the right-hand rule. `HelixBuilder` derives its geometry from real
constants (3.4 Å rise, 34.29°/bp, 240° strand offset) rather than tuning by eye, so the mirror was
rendering a *left*-handed helix: a factual error, not a cosmetic one.

**Still to check by eye:** every existing scenario. Content authored against the mirrored engine may
have been compensated by hand, and only looking will tell. `coordinate-check/` is the reference.

## 3. Engine-specific facts that shape the implementation

- **Screen space = canvas-relative CSS pixels, top-left, Y-down.** Ground truth is `Input`:
  `_mousePosition = (clientX − rect.left, clientY − rect.top)` with
  `rect = canvas.getBoundingClientRect()`. Every screen conversion must round-trip with this.
- **The render surface is the canvas, not the window.** `Application` currently forces the canvas
  to fill the window (`_resize` uses `window.innerWidth/Height`), so today they coincide — but an
  embedded host (editor, viewer) breaks that assumption. The fix introduces Unity's real
  `Camera.pixelWidth`/`pixelHeight`, driven by `Application`, so the camera never reads `window`.
- **`_worldToViewportPoint` is already correct** — refreshes matrices, returns 0..1 Y-down plus
  world distance, rejects points at/behind the eye. The public methods should be built on it.
- **Viewport stays Y-down**, consistent with the engine's screen space, and is documented as a
  deliberate deviation from Unity's Y-up viewport — same call as the UI's Y-down origin.

---

## 4. F4 — viewport rect (done 2026-09-03)

Originally deferred because `Camera.viewport` was a stored `Rect` that nothing in the render path
read — honouring it in conversions while rendering ignored it would have added inconsistency. Both
sides now exist:

- **Rendering:** `WebGLRenderBackend.renderScene` applies the camera's rect via
  `setViewport`/`setScissor` (Y-up, Unity's `Camera.rect`). A full rect keeps the old behaviour
  with scissor off; a sub-rect renders and clears only that region.
- **Projection:** `Camera.pixelWidth`/`pixelHeight` are the rect-scaled pixel size (Unity's
  definition), and `Application._resize` sets each camera's aspect from that pixel rect so a
  non-full viewport does not stretch. The `viewport` setter recomputes aspect live.
- **Conversions:** **screen** coordinates are full-surface (they must round-trip with
  `Input.mousePosition`), so screen↔world/viewport go through the rect (`_ndcToScreen`/
  `_screenToNdc`). **Viewport** coordinates are frustum-relative (0..1 across the camera's own
  view), so viewport↔world are rect-independent, exactly NDC remapped.

- **World-space UI:** the internal projection behind `Canvas` was renamed
  `_worldToViewportPoint` → **`_worldToSurfacePoint`** and made rect-aware. The UI overlay spans
  the whole surface, so it needs *surface*-normalized coordinates, not the frustum-relative ones
  the public `worldToViewportPoint` returns — keeping the old name would have left two things
  called "viewport" meaning different spaces. `Canvas`'s distance scaling was corrected too: the
  frustum spans `cssHeight × rect.height`, not the full height.

Pinned by the "viewport rect (F4)" tests in `tests/CoordinateSpaces.test.ts`.

---

## 5. The stages

Order **0 → 1 → 2 is mandatory**; 3–6 are independent afterward.

### Etap 0 — Confirm/deny the mirror (F7)
The one question whose answer changes the scope of everything else. A non-symmetric marker (letter
"F", or three coloured cubes on +X/+Y/+Z), identity-oriented camera, compared to a Unity reference
frame. **Cannot be run headlessly** — needs a rendered frame and human eyes. Pinned numerically by
a characterization test in the meantime.

**Done 2026-09-03.** [`coordinate-check/`](coordinate-check/) — coloured +X/+Y/+Z cubes plus a
chiral cube-"F" and a lit row of every primitive. `npm run build`, serve from the repo root, open
`/design/coordinate-check/`. **Verdict: the mirror is real** — red +X renders left of centre, the
"F" reads backwards, and the primitive row runs right-to-left. See "Fixing F7" above for what
correcting it would cost.

### Etap 1 — Lock behaviour with tests (F6)
Round-trip `world → screen → world`, `transformPoint` under non-uniform hierarchy scale,
`lossyScale` under shear, `transformDirection` ignores scale. Tests asserting the Unity-correct
result where the correct result is known (z = distance, round-trips); characterization where it is
a pinned observation (handedness).

### Etap 2 — Fix projection semantics (F2, F3, F5)
`z` → world distance; surface → `pixelWidth`/`pixelHeight` fed by `Application`; unify the public
methods onto `_worldToViewportPoint`.

### Etap 3 — Decide & document the Y convention (F1)
Keep Y-down (reverting would put a flip back into every hit-test — the C2 argument). Remove the
false "equivalent to Unity" claim; add the note, mirroring `Input.ts`.

### Etap 4 — Complete the Transform API (F8)
`transformVector`/`inverseTransformVector`, `localToWorldMatrix`/`worldToLocalMatrix`,
`rotateAround`, `Space.Self|World` for `translate`/`rotate` (clears two standing `@todo`s), axis-
angle `rotate`. Check ZXY vs XYZ Euler order.

### Etap 5 — Complete the Camera API (F8)
Publish `worldToViewportPoint`; add `viewportToWorldPoint`, `screenToViewportPoint`,
`viewportToScreenPoint`, `viewportPointToRay`, `cameraToWorldMatrix`. Input `z` on `*ToWorldPoint`
is a world-unit distance — the API's sharpest trap.

### Etap 6 — Write it down once (F1, docs)
A "Coordinate spaces" entry in `CLAUDE.md` beside the UI one: what the convention is, how it
differs from Unity, what it costs. State that camera-space −Z is *agreement* with Unity, not a
deviation, so nobody "fixes" it back.

---

## 6. Risk

Same as the UV plan: silent breakage in content nobody inspects before shipping. Mitigated by
Etap 1 preceding every code change, and by building the public methods on the already-verified
`_worldToViewportPoint` rather than re-deriving projection math.

## 7. Related

- [`unity-coordinates-plan.md`](unity-coordinates-plan.md) — the texture-UV convention (C3);
  explicitly excludes transform/handedness, which is this document.
- `CLAUDE.md` → Key Technical Decisions → "Coordinate system", "UI coordinate system — Y down".
