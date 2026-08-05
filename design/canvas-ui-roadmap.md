# Plan: Canvas UI Toolkit — next development round (drafted 2026-08-03)

Execution plan for the `src/engine/core/ui/` subsystem. Round 1 (commit `4a84e99`:
HiDPI surface, `CanvasScaler`, on-demand repaint, topmost hit-testing) is done; this
document covers what round 2+ should be.

Companion to `design/roadmap-2026H2.md`, sequenced independently of it — see §8.

**Status:** Everything through §4.7 landed 2026-08-03 — Stage 0, the rect cache, the
2D affine pipeline (rotation/scale), the full layout API, the `UIEvent` + pointer/drag
surface, `Slider`/`Toggle`/`ToggleGroup`, `UIText` measurement, the layout groups with
`ContentSizeFitter` and `GridLayoutGroup`, and `CanvasGroup` — followed by the control
library (`RectMask2D`, `ScrollRect`, `Scrollbar`, `Sprite`/9-slice, `Dropdown`, radial fill,
`Selectable` transitions + focus, keyboard navigation). §4.8, `AspectRatioFitter` and §6.4
(`WorldSpace`, projected) and §6.2 (shared tint cache) landed 2026-08-05.
Next: §6.1 dirty-rect partial repaint.

---

## 0. Where things stand

Ten files, 56 passing tests (`tests/UI.test.ts`). Stage 0 landed 2026-08-03.

| Area | Present | Missing |
|---|---|---|
| Root | `Canvas` (overlay + **`WorldSpace`**, projected), `CanvasScaler` (3 modes, all Unity-accurate), `CanvasGroup` | depth-occluded world UI (textured quad) |
| Layout | `RectTransform` (full API), `LayoutElement`, Horizontal/Vertical/**Grid** groups, `ContentSizeFitter`, **`AspectRatioFitter`** | anchor presets |
| Graphics | `UIImage` (solid/sprite/radius, atlas sub-rects, 9-slice, tiled, **linear + radial fill**), `Sprite`, `UIText` (wrap, outline, align, preferred sizes, overflow, word breaking) | auto-size, rich text |
| Interaction | `Selectable` base (+ transitions, focus, **keyboard navigation**) under `Button`/`Slider`/`Toggle`/`Scrollbar`/`Dropdown`, `ToggleGroup`, `ScrollRect`, `VirtualJoystick`, `EventSystem`, `UIEvent`, pointer + drag events | `InputField`, gamepad nav |
| Clipping | **`RectMask2D`** (draw + hit-test, follows rotation) | soft edges |
| Repaint | `OnDemand` + `_visualHash`, **event-driven surface sync** | layout dirty flags, dirty-rect partial repaint |
| Draw order | **hierarchy-ordered**, `sortingOrder` first | — |

The subsystem is a **solid HUD toolkit** and a **weak general UI toolkit**. Everything
needed for "score label + button + joystick over a 3D scene" works well. Everything
needed for "the editor lets an author compose a panel" is absent.

## 1. Constraints and assumptions

- [INFERRED] The consumer that most needs this is **WebEngineTSEditor** — a WYSIWYG editor
  needs rotation/scale gizmos, layout groups, and the Unity RectTransform API surface for
  its inspector. Nothing in the engine repo currently forces those.
- **Superseded 2026-08-03:** the original draft sequenced this plan behind the thesis
  evaluation. The user has since directed that UI work proceed on its own merits, so §8 now
  orders by engine value rather than by what feeds the paper. The ⚑ marks are kept only as a
  note of which items happen to also produce publishable numbers.
- Y-down is a **deliberate, permanent** deviation from Unity (`RectTransform` class doc).
  This plan hardens it rather than reversing it — see §3.
- Three.js isolation: the UI subsystem is already 100 % Three-free (it draws through the
  2D context). Every item below must keep it that way. `CanvasRenderMode.WorldSpace` is
  the one item that risks it and is designed accordingly in §6.4.

**Scales used below.** Complexity: **XS** <0.5 d · **S** 0.5–1 d · **M** 2–4 d ·
**L** 1–2 wk · **XL** >2 wk. Priority: **P0** correctness/blocking · **P1** high value ·
**P2** valuable · **P3** long tail. All effort figures are estimates for one developer.

---

## 2. Stage 0 — correctness and a safety net — **DONE (2026-08-03)**

Defects verified by reading the code. These are cheap, and every later stage edits the same
call paths, so they went first.

All items below are implemented; §2.2 was withdrawn on inspection (it matched Unity).
`tests/UI.test.ts` grew 39 → 56 cases, and each fix was confirmed to fail its tests when
reverted. Full suite 315 passing, `tsc --noEmit` clean.

### 2.1 Draw order follows registration, not hierarchy — **DONE** ✅

`Canvas._registerGraphic` (`Canvas.ts:327`) appends, and `_prepare` (`Canvas.ts:465`)
stable-sorts by `sortingOrder`, which is `0` for every element by default. Registration
order therefore *is* draw order.

Failure: `panelImage.enabled = false; panelImage.enabled = true;` re-registers the panel
background at the end of the list, and it now paints over its own children. Same for any
element re-enabled after its siblings.

Fix: sort by `(sortingOrder, hierarchyIndex)`, where `hierarchyIndex` is a depth-first
index over the canvas subtree, recomputed when the canvas's child set changes. Unity's
semantics exactly.

### 2.2 Hit-test blocking — **not a defect; documented instead** ✅

Earlier draft called this a bug: `EventSystem._hitTest` finds the topmost graphic with
`raycastTarget`, returns `_findButton(g.gameObject)` — `null` when that graphic has no
`Button` ancestor — and stops, so a decorative `UIImage` over a `Button` eats the click.

That is **Unity's behaviour**, not a deviation from it. Unity's `PointerInputModule` runs
`ExecuteEvents.ExecuteHierarchy` on `pointerCurrentRaycast.gameObject`, which walks *up*
the hierarchy from the topmost hit and never falls down the sorted raycast list either.
The `raycastTarget` checkbox exists precisely so authors can opt decorative graphics out.
Making the engine fall through would break the Unity-compatibility rule for no gain.

Resolved by documenting the blocking rule on `EventSystem` so it is discoverable rather
than surprising. Ordering *within* the list was genuinely wrong, and §2.1 fixes it for
hit-testing and drawing at once — both read the same sorted array.

### 2.3 A Canvas added after its children never adopts them — **DONE** ✅

`UIBehaviour.onEnable` resolves `this.canvas` once (`UIBehaviour.ts:94`);
`Canvas._revalidateParents` (`Canvas.ts:521`) re-checks only when the parent *identity*
changes. Adding a `Canvas` component to an existing ancestor changes no parent pointer, so
already-enabled descendants stay unregistered and invisible forever.

Fix: on `Canvas.onEnable`, invalidate layout caches and re-run `_revalidateCanvas()` across
the subtree. `RectTransform.invalidateLayoutCache` already exists for exactly this and is
currently documented as a manual step — make it automatic.

### 2.4 Negative canvas lookup is never cached — **DONE** ✅

`RectTransform.canvas` (`RectTransform.ts:109`) guards the cache with
`this._cachedCanvas !== null`. A genuine "no canvas" result therefore re-walks up to 64
ancestors, each with a `getComponent` scan, on **every** access — and `getScreenRect` calls
it once per element per ancestor per frame.

Fix: a separate `_canvasResolved` flag. Two lines.

### 2.5 Only one pointer drives the whole UI — **DONE** ✅

`EventSystem._resolvePointer` (`EventSystem.ts:167`) takes `Touch.touches[0]` and nothing
else. Two fingers on two buttons: one works. Joystick held while pressing a button: the
joystick's own `_pollPointer` owns its finger correctly, but the button path still sees
only finger 0, so a left-thumb joystick blocks every right-thumb button — the exact layout
mobile scenarios use.

Fix: iterate all active touches in `_update`, tracking press state per pointer id
(`Map<pointerId, Button>` instead of the single `_pressedButton`), and keep the mouse as
pointer id `-1`. Bounded by the number of simultaneous touches, so no measurable cost.

### 2.6 Compressed textures render as a silent solid color — **DONE** ✅

`UIImage._spriteImage` (`UIImage.ts:251`) returns `null` for KTX2 textures — correctly, the
2D context cannot draw them — and `_draw` then falls through to `fillStyle`. The user sees
a colored rectangle with no diagnostic. Given KTX2 is a headline feature of this engine,
that is a bad failure mode.

Fix now: warn once per texture. Fix properly: §6.5.

### 2.7 Tests validate a copy of the layout math — **DONE** ✅

`tests/UI.test.ts:82` defines `computeScreenRect`, a hand-written duplicate of
`RectTransform._computeRect`, and the six anchor tests exercise **that** rather than the
engine. The duplicate could diverge from the implementation without a single test failing.

Plus: no coverage at all for `Canvas` repaint/hash decisions, `EventSystem` hit-testing,
`UIBehaviour` registration/re-parenting, or `VirtualJoystick`.

Fix: delete the duplicate, point those tests at real `RectTransform` instances (the file
already proves this works — see "RectTransform layout"), and add cases for §2.1–2.5. This
is the prerequisite that makes stages 1–3 safe; it is listed last in stage 0 only because
the fixes above define what to assert.

---

## 3. The Y-down coordinate system — make the contract explicit

The engine's UI uses **origin top-left, X right, Y down** (CSS/2D-context convention).
Unity uses **bottom-left, Y up**. The choice is right — it removes a flip from every draw
call and every pointer event — but it is currently under-documented and, in two places,
documented *wrongly*. Three concrete problems:

### 3.1 `anchorMin` / `anchorMax` doc comments are inverted — **DONE** ✅

`RectTransform.ts:54-58` reads:

```ts
/** Normalized lower-left anchor corner (0–1 of parent rect). */
public anchorMin: Vector2 = new Vector2(0.5, 0.5);
/** Normalized upper-right anchor corner (0–1 of parent rect). */
public anchorMax: Vector2 = new Vector2(0.5, 0.5);
```

But `_computeRect` (`RectTransform.ts:173`) does `aTop = parentRect.y + anchorMin.y * ph`.
In a Y-down system `anchorMin.y` is the **top** edge, not the lower one. The comments
describe Unity's convention while the code implements the CSS one. Anyone anchoring to the
bottom of a parent will do it backwards on the first attempt.

Same class, `pivot` (line 60-64), *is* documented correctly for Y-down — `(0,0)` = top-left
— which makes the inconsistency inside one file worse, not better.

Fix: rewrite both comments in Y-down terms (`anchorMin` = top-left corner in normalized
parent space, `anchorMax` = bottom-right), and state the Unity delta on each.

### 3.2 The shared `Rect` class documents the opposite convention — **DONE** ✅

`Rect` (`src/engine/core/math/Rect.ts`) is the type every UI rect flows through, and its
docs are Y-up throughout: *"Position corresponds to the bottom-left corner"* (line 13),
`yMin` = *"Minimum Y coordinate (bottom edge)"* (line 66), `yMax` = *"top edge"* (line 77),
`pointToNormalized` returns *"(0,0) for bottom-left corner"* (line 385).

Under UI usage every one of those sentences is false: `yMin` is the top edge, `yMax` the
bottom. The math is unaffected — it is all min/max arithmetic — but the naming actively
misleads, and `Rect` is shared with camera viewports and sprite bounds, which genuinely
are Y-up. So the class cannot simply be re-documented as Y-down.

Fix: document `Rect` as **convention-neutral** (`yMin` = "lower Y coordinate", not "bottom
edge"), and state in `RectTransform` and `Canvas` that UI rects put Y=0 at the top so
`yMin` reads as the top edge there. Add `top`/`bottom` named accessors *in the UI layer*
(not on `Rect`) if call sites read better for it.

### 3.3 There is no single canonical statement of the convention — **DONE** ✅

Today it lives in one class-level JSDoc block on `RectTransform`. `Canvas`,
`UIImage.fillOrigin`, `CanvasScaler` and `EventSystem` never mention it, and neither does
`CLAUDE.md` — where the equivalent 3D fact ("Unity +Z-forward vs Three.js −Z-forward") *is*
recorded under Key Technical Decisions.

Fix: add a "UI coordinate system" entry to `CLAUDE.md` → Key Technical Decisions, and a
`@remarks` cross-reference from `Canvas`, `EventSystem` and each graphic component.

### 3.4 A standing design rule for every item in this plan

Y-down silently changes the *correct* answer for most features in §5–§6. Each must state
its convention in its JSDoc when built:

| Feature | Y-down consequence |
|---|---|
| `VerticalLayoutGroup` | "top to bottom" is +Y; `reverseArrangement` flips to −Y |
| `ScrollRect` | scrolling down = content moves −Y; `normalizedPosition.y` 0 = top (Unity: 0 = bottom) |
| `RectTransform.rotation` | positive angle is **clockwise** on screen (matches the 2D context, opposite of Unity's CCW) |
| `GetWorldCorners` | Unity returns bottom-left→top-left→top-right→bottom-right; the Y-down analogue must be documented, not assumed |
| `ImageFillOrigin` | already correct (`Bottom` offsets by `height - h`) — keep as the reference implementation |
| `AnchorPreset` helpers | preset names ("top-left") must map to the *visual* corner, i.e. `anchorMin`, not the numerically-lower one |

### 3.5 Optional: a Unity-import compatibility helper — **P2, M**

If the editor ever imports Unity-authored layouts (or an author works from Unity muscle
memory), a `UnityLayoutCompat.toEngine(rectTransform)` that flips `anchorMin.y`/`anchorMax.y`
(`1 - y`, swapped) and `pivot.y` would make the conversion one call instead of a per-field
puzzle. Not needed until such an import path exists — listed so the decision is recorded.

---

## 4. Stage 1 — layout core and the performance work

### 4.1 Resolved-rect cache — **DONE (partial)** ✅, follow-up below

`Canvas._prepare` computed a full screen rect for **every** graphic **every** frame, even in
`OnDemand`, purely to decide whether anything moved, and each `_computeRect` recursively
resolved every ancestor — so a tree of *n* elements at depth *d* cost O(n·d) rect
computations per frame for a HUD that had not changed since it was built. `OnDemand` avoided
the *paint*, not the *layout*.

**Shipped:** each `RectTransform` caches its resolved rect plus a 10-scalar snapshot of its
layout inputs and a copy of the parent rect it was built from. A read reuses the cached rect
when neither its own inputs nor its parent's resolved rect moved. Repeated reads within a
frame — draw, hit-test, and any scenario script — now cost comparisons instead of
arithmetic, and a deep chain no longer re-derives every ancestor's geometry per descendant.

**What this deliberately does *not* do, and why.** The original design here short-circuited
*before* walking the parent chain, keyed on a frame counter plus a global change epoch. That
is wrong, and the tests now pin it: the layout inputs are public `Vector2` fields mutated in
place (`rt.anchoredPosition.set(...)`), so there is no setter to hook and an ancestor's move
is undiscoverable without walking up to check it. A child whose own inputs were unchanged
would have returned a stale rect on the frame its parent moved. Reverting to that design
fails four tests, three of them staleness.

So the walk still happens on every read: the win is a constant factor, not the asymptotic
O(n·d) → O(n) the first draft claimed. Getting the asymptotic win needs **write-time**
invalidation, i.e. `anchoredPosition`/`sizeDelta`/`anchorMin`/`anchorMax`/`pivot` becoming
accessors over an observable `Vector2`. That is not a small change: `Vector2` assigns `x`/`y`
as own data properties in its constructor, so a subclass cannot shadow them with accessors —
it needs either a `Proxy` (too slow for this path) or accessors on `Vector2` itself, whose
blast radius is the entire math layer. Tracked as its own item rather than smuggled in here.

**Follow-up — observable `Vector2` for layout inputs — P2, L.** Do it when the math layer is
being touched anyway, or when a profile on real content shows the walk actually costing.
Until then this cache is the correct-by-construction version.

### 4.2 Stop forcing layout every frame — **DONE** ✅

`Canvas._renderFrame` (`Canvas.ts:451`) calls `_syncSurface()` unconditionally, and
`_syncSurface` calls `glCanvas.getBoundingClientRect()` (`Canvas.ts:371`) — a forced style
recalculation, every frame, in a subsystem whose headline feature is not doing work every
frame. The style *writes* are already carefully guarded (`Canvas.ts:383-384` documents
exactly this hazard); the *read* is not.

Fix: drive `_syncSurface` from the events already wired — `ResizeObserver` (`Canvas.ts:252`)
and `scroll` (`Canvas.ts:258`) — plus `visualViewport` resize/scroll for mobile zoom, and a
dirty flag. Keep a low-frequency (e.g. once per second) validation pass as a backstop for
layout changes no observer reports.

Same measurement path as §4.1; on a static HUD this should be visible in CPU frame time on
its own.

### 4.3 Share the resolved rects with the EventSystem — **P1, S**

`EventSystem._hitTest` (`EventSystem.ts:200`) calls `getScreenRect` for each graphic it
tests, having run in the same frame as `Canvas._prepare`, which already computed and cached
exactly those rects in `Canvas._rects`. The layout walk happens twice per frame.

Fix: expose the canvas's rect for a graphic (`Canvas._rectFor(graphic)`) and read it in the
hit-test. Ordering already works — `EventSystem._update` runs before `Canvas._renderAll`
(`Application.ts:579`/`591`), so the rects are from the previous frame's `_prepare`; either
accept one frame of latency (invisible at 60 Hz, and the same latency Unity has) or move the
`_prepare` layout pass ahead of the event pass. Prefer the latter: it also makes hit-testing
agree exactly with what was drawn.

### 4.4 RectTransform rotation and scale — **DONE (2026-08-03)** ✅

Shipped as designed below, with one deviation worth recording: `localRotation` (degrees,
clockwise) and `localScale` (Vector2) live **on `RectTransform`**, not on the sibling
`Transform`. Two reasons. A UI element's 3D transform is meaningless — nothing in the
subsystem reads it — and `Transform.localRotation` / `localScale` / `localEulerAngles` all
return clones, so reading them once per element per frame would allocate in the draw path.
Keeping them as plain fields also lets them join the existing snapshot-based change
detection for free.

`§4.3` fell out of this for free: `Canvas._rects` is gone entirely, and both the paint loop
and the `EventSystem` hit-test now read the RectTransform's own cached local rect, matrix
and bounds.

Original design, for reference:

`Transform.localRotation` and `localScale` on a UI GameObject are **silently ignored** —
verified, zero references to either in `src/engine/core/ui/`. That blocks: any UI animation
with juice (button press pop, panel slide-in with scale), rotating gauges/dials, and a
WYSIWYG editor's rotate/scale gizmos.

This is the one structurally invasive item in the plan. An axis-aligned `Rect` cannot
represent a rotated element, so it touches four call paths:

1. **Layout** — resolve to a 2D affine matrix (`Matrix3x2`-equivalent) per element instead
   of a `Rect`; children compose with the parent's matrix.
2. **Draw** — `Canvas._paint` applies the element matrix via `ctx.setTransform` before
   `_draw`; components keep drawing in their own local rect and need no changes.
3. **Hit-test** — transform the pointer into element-local space by the inverse matrix, then
   run the existing rect test. `UIBehaviour._hitTest`'s signature already takes local-ish
   coordinates, so the override contract survives.
4. **Culling** — `Canvas._paint` (`Canvas.ts:555`) culls on `rect.overlaps`; needs the
   transformed AABB.

Sequence it **after** §4.1, which introduces the caching layer this rides on, and after
§2.7, which provides the tests that catch a regression.

### 4.5 Complete the RectTransform API surface — **DONE (2026-08-03)** ✅

Shipped: `rect`, `offsetMin`/`offsetMax` (+ non-allocating `getOffsetMin`/`getOffsetMax`),
`setSizeWithCurrentAnchors`, `setInsetAndSizeFromParentEdge`, `getLocalCorners`, and the
`RectTransformAxis` / `RectTransformEdge` enums. Anchor presets were **not** added: Unity has
no runtime preset API either, and an editor inspector can derive them from the anchor values
it already edits.

**Found while deriving `offsetMin`: the anchor reference point was wrong.** The engine placed
the pivot at the anchor rect's *centre* (`aLeft + aW * 0.5`); Unity samples the anchor rect
*at the pivot* (`aLeft + pivot.x * aW`), which is what makes `offsetMin = anchoredPosition -
sizeDelta * pivot` hold. The two agree for point anchors and for a centred pivot, which is
every case the existing tests covered — so nothing caught it. They diverge for a stretched
anchor with an off-centre pivot, where the old rule pushed the element off by half the anchor
span: a panel stretched to fill its parent with pivot `(0,0)` sat at `400..1200` on an
800-wide canvas instead of `0..800`.

Fixed to Unity's rule. `offsetMin`/`offsetMax` could not have been defined consistently
otherwise, so this was forced rather than optional.

Missing versus Unity: `rect` (local rect), `offsetMin`/`offsetMax`, `anchoredPosition3D`,
`SetInsetAndSizeFromParentEdge`, `SetSizeWithCurrentAnchors`, `GetWorldCorners`,
`GetLocalCorners`, and anchor presets. The editor's inspector needs `offsetMin/offsetMax`
(that is how Unity presents a stretched element) and the corners (that is how it draws
handles). Cheap once §4.4 lands, since corners fall out of the matrix.

Per §3.4, each needs its Y-down semantics documented rather than copied from Unity.

### 4.6 Layout groups — **P1, L**

`HorizontalLayoutGroup`, `VerticalLayoutGroup`, `GridLayoutGroup`, `ContentSizeFitter`,
`LayoutElement`, `AspectRatioFitter`. Nothing in the toolkit positions anything
automatically today; every element is placed by hand. For an editor-driven toolkit this is
the single largest capability gap.

Depends on a **preferred/min/flexible size protocol** — an `ILayoutElement`-equivalent that
`UIText` and `UIImage` implement (`UIText` needs `preferredWidth`/`preferredHeight`, §6.3),
and a two-pass (measure, then arrange) driver run from `Canvas._prepare` before hashing.
Reverse arrangement and `GridLayoutGroup.startCorner` are where Y-down bites (§3.4).

Build the protocol + `Vertical`/`Horizontal` + `ContentSizeFitter` first (that covers most
real layouts); `Grid` and `AspectRatioFitter` can follow.

**`AspectRatioFitter` landed 2026-08-05**, completing the deferred half. All five Unity
modes (`WidthControlsHeight`, `HeightControlsWidth`, `FitInParent`, `EnvelopeParent`,
`None`), driven from `Application._loop` **after** the groups and `ContentSizeFitter` —
it constrains one axis against the other, so both must have settled first. The Y-down
consequence is not in the arithmetic (which is symmetric) but in *where the letterbox bars
land*: placement follows the pivot, and pivot `(0,0)` is the top-left here, so a
top-pivoted element bars at the bottom. `setAspectFromSize(w, h)` covers the "match this
image" case without the caller dividing by zero on an asset that has not loaded.

### 4.7 `CanvasGroup` — **P1, S**

Subtree `alpha`, `interactable`, `blocksRaycasts`. `Canvas.alpha` exists but is
canvas-wide, so fading one panel means giving it its own canvas — which costs a second
full-screen backing store (§4.8). Cheap to build once §4.4's matrix walk exists (the alpha
multiplies down the same traversal) and constantly needed in practice.

### 4.8 Report overlay canvas memory in `MemoryProfiler` — **DONE (2026-08-05)** ✅

Each `Canvas` allocates its own full-screen backing store at DPR: 1920×1080 at DPR 2 is
~33 MB, and browsers back these with GPU surfaces. `MemoryProfiler` reported texture,
geometry and render-target VRAM but knew nothing about them — so a multi-canvas UI was
invisible in exactly the metric the thesis added to be complete.

**Shipped:** `Canvas.backingStoreBytes` (per canvas) and `Canvas.totalBackingStoreBytes` /
`Canvas.liveCanvasCount` (all canvases) feed `MemoryReport.renderer.estimatedUICanvasBytes`
+ `uiCanvasCount` as a fourth estimate, counted into the VRAM total in `logReport`, the
overlay's Memory tab, and `BenchmarkResult.memory` + its CSV column.

Two decisions worth recording. The count covers **disabled** canvases too — disabling one
hides the surface but does not free it, and the whole point of the metric is to show what a
second canvas actually costs. And `MemoryProfiler` reaches the UI subsystem through
`profilerHooks` (`uiCanvasBytes` / `uiCanvasCount`), the same zero-import registry `Camera`
and `Light` use, so diagnostics still import nothing from `ui/`.

---

## 5. Stage 2 — the component library

Ordered by value per unit of effort for the educational-scenario use case.

| Component | Priority | Complexity | Notes |
|---|---|---|---|
| `Sprite` asset type | P1 | M | Texture + sub-rect + border + pivot. Blocks atlases **and** 9-slice; `UIImage.sprite` is a raw `Texture2D` today |
| 9-slice / `Tiled` image | P1 | M | Depends on `Sprite.border`. Without it, no resolution-independent panel or frame |
| `Slider` | P1 | M | The most-missed control for lab scenarios (parameter input). Needs drag events (§5.1) |
| `Toggle` / checkbox | P1 | S | Trivial once `Selectable` exists |
| `RectMask2D` | P1 | M | Nothing clips to parent bounds today. Prerequisite for `ScrollRect`. Maps to `ctx.clip()` on the element matrix — cheap in the 2D context |
| `ScrollRect` + `Scrollbar` | P2 | L | Needs `RectMask2D` + drag events + inertia |
| `Dropdown` | P2 | M | Needs `ScrollRect` for long lists |
| `InputField` | P3 | L | Caret, selection, clipboard, IME, mobile keyboard. Consider a hidden DOM `<input>` overlay instead of drawing it — far less code, correct IME behaviour for free |
| Radial fill (`Radial90/180/360`) | P2 | S | `ImageFillMethod` has only Horizontal/Vertical; cooldown dials need radial |
| UI tween helpers (fade/color/scale) | P3 | S | Button transitions currently snap; needs §4.4 for scale |

### 5.1 `Selectable` base + a real event surface — **P1, M**

`Button` (`Button.ts`) is a monolith: it draws its own background *and* its own label, its
state is poked by `EventSystem` through a public `_state` field, and `onClick` is a single
nullable callback — assigning it twice silently drops the first listener, which is a
genuine footgun for scenario code that adds a handler in `Start`.

Split into:
- **`Selectable`** — interactable, state machine, transition modes (ColorTint today,
  SpriteSwap once `Sprite` lands), shared by `Button`/`Toggle`/`Slider`/`Dropdown`.
- **A multi-listener event** — `onClick.addListener/removeListener`, Unity's shape. Keep
  the `onClick = fn` assignment working through a setter so existing scenarios do not break.
- **Pointer events on any `UIBehaviour`** — `onPointerDown/Up/Enter/Exit/Click`, plus
  `onBeginDrag/Drag/EndDrag` (required by `Slider` and `ScrollRect`). Today only `Button`
  can react to anything at all.

### 5.2 Compose `Button` from `UIImage` + `UIText` — **P2, M**

`Button._draw` (`Button.ts:91-109`) reimplements both a rounded-rect fill and a centred
text draw, duplicating `UIImage` and `UIText` with no wrapping, no outline, no sprite
background. Unity composes a Button from a child Image + child Text for exactly this reason.

Breaking change for `btn.text` / `btn.fontSize` / `btn.textColor` — keep them as forwarding
accessors to an auto-created child so nothing in existing scenarios breaks. Do this after
§5.1, and only if the editor makes the child hierarchy manageable.

### 5.3 Keyboard / gamepad navigation and focus — **P2, M**

No focus concept exists. Needed for accessibility, for gamepad-driven scenarios, and for the
platform's likely accessibility requirements. Depends on `Selectable`; the automatic
"find nearest selectable in direction" search must use Y-down directions (§3.4).

### 5.4 Accessibility surface — **P3, M**

Canvas-drawn UI is invisible to screen readers by construction. If `testv/virtual-lab` ever
faces an accessibility requirement, the practical answer is a parallel hidden DOM tree
mirroring the UI graph with ARIA roles. Listed so the cost is known before it is demanded,
not because it is scheduled.

---

## 6. Stage 3 — larger bets

### 6.1 Dirty-rect partial repaint — **P2, M**

Today any single change repaints the entire surface: `_paint` clears the whole canvas
(`Canvas.ts:541`) and redraws every visible graphic. A one-character score update costs a
full-HUD redraw.

Fix: track the union of changed elements' rects (previous ∪ current), `clip()` to it, and
redraw only intersecting graphics. Needs §4.1's per-element change detection to know which
those are. Alternative with less machinery: split static and dynamic elements across two
stacked canvases — but that doubles backing-store memory (§4.8), so measure first.

**Design notes from the 2026-08-05 pass** (found while sizing it; not yet implemented):

- The two directions are *not* symmetric, and only one of them has to be exact. Because the
  paint is clipped to the dirty region, **over-including graphics in the redraw is always
  safe** — an extra graphic can only paint inside the clip. What must be exact is the dirty
  region itself: it has to cover everywhere a changed element painted before *and* after.
  So the whole correctness question reduces to "can this element's painted area be bounded?"
- **It cannot, from the layout rect alone.** `UIText` paints outside its rect in ordinary
  configurations: an outline strokes half its width beyond every glyph, `TextOverflow.Overflow`
  spills past the bottom edge, and with `wordWrap` off a long line runs past the right edge
  under `Clip` too (only `Ellipsis` truncates horizontally). `_resolvedBounds` is the rect's
  AABB and knows none of this, so a naive union leaves stale pixels behind — the exact silent
  visual regression §9 warns about.
- Proposed contract: `UIBehaviour._drawOverflow` (canvas units, default `0`), overridden by
  `UIText` as `max(outlineWidth, preferredWidth − rect.width, preferredHeight − rect.height)`
  — all three already available, the last two from §6.3a and cached. A uniform inflation
  over-estimates for centred alignment, which is the safe direction. Reserve `Infinity` for
  "unbounded", meaning a *changed* element of that kind forces a full repaint.
- Also needs: a small AA pad (fractional coordinates touch pixels just outside the AABB);
  full repaint whenever a canvas-level input changes (size, `scaleFactor`, `pixelRatio`,
  `alpha`, sort order, the graphic set, and now the world-space base transform); and
  `_allowCulling === false` graphics always included in the redraw set.
- Per-graphic previous hash + previous bounds have to be stored (the canvas hashes into a
  single value today), and they must be maintained on full repaints too.

### 6.2 Shared tint cache for `UIImage` — **DONE (2026-08-05)** ✅

`_buildTinted` allocated a full-size offscreen canvas **per image instance**, released only
in `onDestroy` — twenty tinted copies of one icon meant twenty full-resolution buffers held
while disabled.

**Shipped:** `TintCache` (`ui/TintCache.ts`), a process-wide store keyed by (texture id,
texture upload version, tint RGB) with a byte budget and LRU eviction
(`UIImage.tintCacheBytes` / `tintCacheCount` / `tintCacheLimitBytes`, default 32 MB, plus
`UIImage.clearTintCache()`). The alternative — dropping the pre-tint and compositing on the
main canvas — was not taken: the 2D context cannot multiply a bitmap by a colour while
drawing it, so it would mean a per-draw offscreen pass instead of a per-tint one.

Two consequences beyond the memory fix:
- **Atlases now pay off for tinting too.** The buffer holds the whole source texture, so
  every sprite drawn from one atlas with one tint shares a single tinted atlas.
- **Alpha left the cache key.** Opacity is applied at draw time via `globalAlpha` and never
  reached the tint pass, but the old key hashed the full colour — so two elements differing
  only in alpha each rebuilt an identical buffer.

Eviction scans for the oldest entry instead of reordering on hit, keeping the lookup itself
write-free; a buffer larger than the entire budget is kept rather than evicted on the spot,
since evicting it would mean rebuilding it on every repaint forever. Entries verify their
(texture, version, tint) triple on hit, so the numeric hash key cannot serve the wrong
bitmap on a collision.

Reported through `profilerHooks.uiTintCacheBytes` into
`MemoryReport.renderer.estimatedUITintCacheBytes`, the overlay's Memory tab and
`BenchmarkResult.memory` — the same treatment §4.8 gave canvas surfaces, and for the same
reason: this memory is invisible to every texture counter.

### 6.3 `UIText` completeness — **P1 for the first two, S each; P3 for rich text, L**

- `preferredWidth` / `preferredHeight` — **required** by `ContentSizeFitter` and layout
  groups (§4.6), so this one is a dependency, not a nicety.
- Overflow modes: ellipsis and clip. Today lines past the bottom edge simply stop being
  drawn (`UIText.ts:112`) with no visual indication, and a single word wider than the rect
  overflows the rect entirely — `_wrapText` (`UIText.ts:178`) never breaks within a word.
- `bestFit` auto-sizing (binary search over font size against the measured cache).
- Rich text (`<b>`, `<color>`) — a real tokenizer plus per-run measurement; L, and rarely
  worth it before everything above.

### 6.4 `CanvasRenderMode.WorldSpace` — **DONE (projected overlay), 2026-08-05** ✅

For the educational domain this was the highest-value item in stage 3: labels and callouts
pinned to parts of a 3D model are the canonical lab-scenario UI, and they had to be faked by
projecting positions in scenario code.

Two implementations were on the table, and the choice mattered for the Three.js isolation
rule:
- **Projected overlay** — keep drawing in 2D, project the world anchor to screen space each
  frame, scale by distance. Cheap, no Three.js in the UI layer, but no perspective on the UI
  plane and no depth occlusion.
- **Textured quad** — render the 2D canvas into a texture on a world-space quad. Correct
  perspective and occlusion, but pulls mesh/material handling into the UI subsystem; must go
  through the existing engine `Texture2D`/`Material` types and stay behind `@internal` sync
  methods, never exposing `THREE.*`.

**Shipped: the projected overlay.** It covers the labelling use case at a fraction of the
cost; the textured quad stays a separate decision, and nothing here forecloses it.

How it fits the existing pipeline: layout, drawing, hit-testing and culling were already
expressed in *canvas units*, so world space needed no new geometry path — only a
**canvas-level base transform** (`_baseScale` + `_baseOffsetX/Y`, canvas units → CSS px)
that overlay mode leaves as identity-with-scale. `_paint` folds it into the single
`setTransform` it already issued, and `screenToCanvasPoint` inverts it, so hit-testing
agrees with drawing for free. `Canvas._updateTransforms()` runs from `Application._loop`
before the event pass, so a click and the paint that follows use the same projection.

API: `worldSize` (the authored canvas rect), `worldScale` (world units per canvas unit,
default `0.01` — the same reason Unity's world canvases carry a 0.01 Transform scale),
`worldPivot` (which point of the rect lands on the anchor), `distanceScaling`,
`worldCamera` (falls back to `Camera.main`), plus the read-backs `worldDistance` and
`isRenderable`.

Decisions worth recording:
- **`distanceScaling = false` is the billboard mode** and is not a Unity feature. A label
  that shrinks to nothing when the student zooms out is useless, so constant-pixel-size is a
  first-class option rather than a script users have to write.
- **An anchor behind the camera makes the canvas non-renderable**, not mirrored: `isRenderable`
  goes false and the canvas neither paints nor hit-tests. `EventSystem` checks the same flag.
- **`CanvasScaler` is ignored in world space** (`scaleFactor` forced to 1). Its scale modes
  match the screen resolution, which would fight a projection; Unity draws the same line.
- **The clear went to surface space.** `_paint` cleared through the canvas transform, which
  in world space covers only part of the surface — it now clears the full backing store.
- **Y-down (per §3.4):** `worldPivot` `(0.5, 1)` is the rect's **bottom** edge, so that is
  what floats a callout *above* its anchor.
- **Prerequisite patch:** `Camera._worldToViewportPoint` / `Camera._frustumHeightAt`
  (`@internal`, engine types only). The existing `worldToScreenPoint` allocates a `Vector3`
  per call and measures against `window.innerWidth/Height` rather than the render canvas,
  which is wrong for an embedded viewport; it was left alone rather than changed under a UI
  task.

Known limitation, by construction: **no depth occlusion.** A label pinned to the far side of
a model draws over it. Scenarios that care must hide it themselves (a raycast against the
model is the usual test) — or the textured quad becomes worth building.

### 6.5 Compressed-texture sprites — **P2, L**

The proper fix for §2.6. Either keep a CPU-side copy of the source image for
UI-flagged textures (memory cost, defeats KTX2's purpose), or decode on demand for UI use.
Realistically: **document that UI sprites should not be KTX2**, warn at runtime, and revisit
only if a scenario actually needs it.

### 6.6 Serialization of UI components — **P2, M** (engine-wide, not UI-specific)

No UI component carries `@Serializable`/`@SerializeField` — but neither does any other
built-in component; the reflection system (`src/engine/core/reflection/`) is entirely
opt-in and currently used by nothing in `src/engine/core/`. So this is a **general engine
gap that happens to block the UI editor**, and it should be scoped as one engine-wide task,
not solved locally for UI. Flagged here because the editor will hit it first through UI.

---

## 7. Master task table

⚑ = feeds the thesis evaluation (§8).

| # | Task | Pri | Cx | Depends on |
|---|---|---|---|---|
| ~~2.1~~ | ~~Draw order by hierarchy, not registration~~ | **done** | S | — |
| ~~2.2~~ | ~~Hit-test falls through~~ — withdrawn, matches Unity | **n/a** | — | — |
| ~~2.7~~ | ~~Tests against the real `RectTransform` + gaps~~ | **done** | S | — |
| ~~3.1~~ | ~~Fix inverted `anchorMin`/`anchorMax` docs~~ | **done** | XS | — |
| ~~3.2~~ | ~~Make `Rect` docs convention-neutral~~ | **done** | S | — |
| ~~4.2~~ | ~~Stop `getBoundingClientRect` every frame~~ | **done** | S | — |
| ~~2.3~~ | ~~Canvas adopts pre-existing descendants~~ | **done** | S | — |
| ~~2.4~~ | ~~Cache the negative canvas lookup~~ | **done** | XS | — |
| ~~2.5~~ | ~~Multi-touch pointer routing~~ | **done** | M | — |
| ~~3.3~~ | ~~Canonical coordinate-system doc~~ (in `CLAUDE.md`) | **done** | XS | — |
| ~~4.1~~ | ~~Resolved-rect cache~~ (constant-factor; see §4.1) | **done** | M | — |
| ~~4.3~~ | ~~Share resolved rects with `EventSystem`~~ (both read the RectTransform cache) | **done** | XS | — |
| ~~4.4~~ | ~~RectTransform rotation + scale~~ | **done** | L | — |
| ~~4.5~~ | ~~Full RectTransform API surface~~ + anchor-reference fix | **done** | M | — |
| ~~4.6~~ | ~~Layout groups + size protocol + `GridLayoutGroup`~~ | **done** | L | — |
| ~~4.6b~~ | ~~`AspectRatioFitter`~~ (all five Unity modes) | **done** | S | 4.6 |
| ~~4.7~~ | ~~`CanvasGroup`~~ | **done** | S | — |
| ~~4.8~~ | ~~Overlay canvas memory in `MemoryProfiler`~~ ⚑ | **done** | S | — |
| ~~5.0a~~ | ~~`Sprite` asset type~~ (atlas sub-rects + border) | **done** | M | — |
| ~~5.0b~~ | ~~9-slice / tiled image~~ | **done** | M | — |
| ~~5.0c~~ | ~~`Slider`~~ | **done** | M | — |
| ~~5.0d~~ | ~~`Toggle`~~ + `ToggleGroup` (radio behaviour) | **done** | S | — |
| ~~5.0e~~ | ~~`RectMask2D`~~ | **done** | M | — |
| 5.1a | ~~Multi-listener `UIEvent` + pointer/drag events~~ | **done** | M | — |
| ~~5.1b~~ | ~~`Selectable` base + transition modes + focus~~ | **done** | M | — |
| ~~6.3a~~ | ~~`UIText` preferred sizes + overflow/ellipsis + word breaking~~ | **done** | S | — |
| ~~2.6~~ | ~~Warn on compressed-texture sprites~~ | **done** | XS | — |
| 3.5 | Unity-import layout compat helper | P2 | M | 3.1–3.3 |
| ~~5.0f~~ | ~~`ScrollRect` + `Scrollbar`~~ | **done** | L | — |
| ~~5.0g~~ | ~~`Dropdown`~~ | **done** | M | — |
| ~~5.0h~~ | ~~Radial fill methods~~ | **done** | S | — |
| 5.2 | Compose `Button` from Image + Text | P2 | M | 5.1, 5.0a |
| ~~5.3~~ | ~~Keyboard navigation + focus~~ (gamepad still open) | **done** | M | — |
| 6.1 | Dirty-rect partial repaint | P2 | M | 4.1 |
| ~~6.2~~ | ~~Shared tint cache~~ (+ LRU bound, profiler visibility) | **done** | M | — |
| ~~6.4~~ | ~~`WorldSpace` render mode (projected)~~ | **done** | L | 4.4 |
| 6.5 | Compressed-texture sprite support | P2 | L | 2.6 |
| 6.6 | Serializable components (engine-wide) | P2 | M | — |
| 5.0i | `InputField` | P3 | L | 5.1, 5.3 |
| 5.0j | UI tween helpers | P3 | S | 4.4 |
| 5.4 | Accessibility / ARIA mirror | P3 | M | 5.3 |
| 6.3b | Rich text | P3 | L | 6.3a |

Rough totals: stage 0 ≈ 4–5 days · stage 1 ≈ 4–5 weeks · stage 2 ≈ 5–6 weeks ·
stage 3 ≈ 4+ weeks.

---

## 8. Sequencing

Ordered by engine value. (An earlier draft sequenced this behind the thesis evaluation;
that constraint has been lifted — see §1.)

1. ~~**Stage 0** — correctness and the test safety net.~~ **Done 2026-08-03.** Everything
   after this edits the same call paths, and §2.7's tests are what make those edits safe.
2. **§4.1 layout dirty flags**, then **§4.3** (share rects with the EventSystem). The
   largest optimization available, and the caching layer §4.4 rides on. Do it before
   anything structural, because it changes how every rect is resolved.
3. **§4.4 rotation + scale** → **§4.5 full RectTransform API**. The invasive pair: `Rect`
   becomes a 2D affine matrix through layout, draw, hit-test and culling. Nothing else
   should be in flight while this lands.
4. **§5.1 `Selectable` + pointer/drag events** → **§4.6 layout groups** (with §6.3a
   preferred sizes as its prerequisite) → **§4.7 `CanvasGroup`**, **§5.0e `RectMask2D`**.
   This is the block that turns a HUD toolkit into a UI toolkit and unblocks
   WebEngineTSEditor's UI authoring.
5. **§5.0a `Sprite`** → **§5.0b 9-slice** → **§5.0c/d Slider + Toggle**. The component
   library, once the foundation under it is stable.
6. Stage 3 (§6) as appetite allows; **§6.4 WorldSpace** is the highest-value item there for
   the educational domain and the one most worth pulling forward.

**§4.8** (overlay canvas memory in `MemoryProfiler`) was independent of all of the above and
was slotted in on 2026-08-05.

## 9. Risks

- **§4.1 and §4.4 are breaking API changes.** Converting `RectTransform`'s public
  `Vector2` fields to observable accessors changes assignment semantics
  (`rt.anchoredPosition.x = 5` must still invalidate). Every consumer (ScenarioCreator
  content, `testv/virtual-lab` scenarios, the editor) goes through `npm run release:local`,
  so breakage surfaces at once — but the scenario ZIPs already shipped will not be rebuilt.
  Mitigate: keep the field assignment path working via a proxy or an explicit
  `setAnchoredPosition`, and version-gate if a shipped ZIP is found to depend on it.
- **§4.4 (rotation/scale) touches every draw and hit-test path.** Land §2.7's tests first;
  without them a regression here is silent and visual.
- **§4.6 (layout groups) is where scope grows without limit.** Cap the first pass at the
  measure/arrange protocol + Vertical/Horizontal + `ContentSizeFitter`; defer Grid.
- **§5.2 and §5.1 are behaviour changes to `Button`**, the single most-used UI component in
  existing scenarios. Forwarding accessors are mandatory, not optional.
- **Doing any of this instead of the thesis measurements is the real risk.** §8 exists to
  make that trade-off explicit rather than accidental.
