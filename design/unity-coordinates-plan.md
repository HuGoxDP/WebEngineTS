# Plan: one coordinate convention, Unity's

**Status:** planned, not started. **Do not begin before the thesis is submitted (24 August 2026).**
Every item here changes rendered output, and several change it in ways only a human looking at a
screen can confirm.

The engine advertises Unity semantics — `CLAUDE.md` names Unity 6 / 2022 LTS as the reference —
but it currently carries **four** conventions at once, three of them inherited from Three.js by
accident rather than by decision. Each has already cost a debugging session, and two were found
only because a benchmark scene rendered wrongly.

---

## 1. What actually differs today

| # | Axis | Unity | Engine today | Decided? |
|---|---|---|---|---|
| C1 | Forward direction | +Z | +Z in the API; Three.js is −Z underneath | **Yes** — converted in `CameraState.cameraLookRotation()` |
| C2 | UI origin | bottom-left, Y up | **top-left, Y down** | **Yes, deliberately and permanently** — see `CLAUDE.md`, "UI coordinate system" |
| C3 | Texture V origin | bottom-left (`flipY = true` equivalent) | **both**, depending on the loader | **No** — this is the open one |
| C4 | Primitive orientation | `Plane` is XZ/+Y, `Quad` is XY | fixed 2026-08-22 (`createPlane`) | **Yes**, now correct |

C1 and C2 are settled and documented; C2 in particular is a *good* deviation, argued and pinned.
C4 was a defect and is fixed. **C3 is the whole of this plan.**

## 2. C3 — the texture orientation split

Three loaders, two conventions, no way to ask:

| Path | `flipY` | Why |
|---|---|---|
| `Texture2D.fromArrayBuffer`, canvas textures | `true` | Three.js default; flips so V=0 is the bottom, matching Unity and the engine's own primitives |
| `GLTFLoader` textures | `false` | glTF puts the UV origin top-left |
| `Texture2D.fromKTX2ArrayBuffer` | `false` | **Not a choice.** `CompressedTexture` forces it — block-compressed data cannot be flipped on upload |

The consequences already observed:

- A separately-loaded map on a glTF-imported mesh samples **upside down**. On Benchscene2 that
  measured as a max channel Δ of **173** against the embedded reference — a different picture.
- The same asset shipped as `.ktx2` samples correctly. So **the file format changes the image**,
  which turned the two arms of a KTX2 A/B into two different scenes rather than one scene in two
  formats.
- Content currently normalises this itself, reaching past the public API into the Three.js
  texture — a documented violation of the engine's own first rule.

`Texture.flipVertically` (2026-08-22) lets content say it through the API instead. That closes the
rule violation; it does not settle the convention.

### The forcing constraint

**KTX2 cannot be `true`.** Any unified convention must therefore be `flipY = false`, i.e. the
UV origin at the **top-left**, matching glTF and matching the UI's Y-down choice (C2). Unity's
texture convention is the one the engine cannot keep, and the reason is a file format, not a
preference.

That is worth stating plainly in the thesis's limitations if the paper claims Unity-convention
parity: the engine follows Unity everywhere it can, and compressed textures are where it cannot.

## 3. The migration, in the order it must happen

Each stage is independently shippable and independently verifiable. Do not merge stages.

### Stage 0 — a visual reference, before changing anything

Nothing below can be verified by unit tests alone: the failure mode is "the picture is wrong",
and the engine has no rendering test. Build the harness first.

- A page that renders one instance of every `Mesh.create*` primitive, each with a **non-symmetric,
  orientation-revealing** texture (numbers, or a letter F — a checkerboard proves nothing).
- The same for a glTF import, a KTX2 texture, a sprite, and a UI image.
- Capture reference screenshots **before** any change and commit them.

Cost: ~0.5 day. Skipping it is how a silent flip reaches production content.

### Stage 1 — make the convention explicit and measurable

- `Texture.flipVertically` — **done** (2026-08-22).
- Add a read-only `Texture.uvOrigin` reporting `TopLeft` / `BottomLeft`, so a scenario and the
  diagnostics can see which convention a texture actually carries.
- Extend `MemoryReport.renderer.textureFormats` with an orientation tally, or add a sibling field.
  A run then self-labels its conventions the way it already self-labels its transcode formats.

### Stage 2 — move the engine's own geometry to top-left

The mechanical core. Every built-in primitive generates its own UVs (12 sites in `Mesh.ts`, each
with a different formula) written for `flipY = true`.

**Do not edit the twelve formulas.** Apply `v → 1 − v` once, in a single shared helper called at
the end of each builder, so the transform is provably uniform and reviewable in one place. Then:

- `Texture2D.fromArrayBuffer` and the canvas-backed constructors set `flipY = false`.
- `Mesh.fromThreeGeometry` keeps glTF UVs **unchanged** — they are already top-left.
- Sprite and UI paths: audit separately. `SpriteRenderer` already expresses flips as negative
  texture repeat, which interacts with this and must be re-checked, not assumed.

Verify against Stage 0's screenshots. Every primitive must be pixel-identical to its reference;
the glTF and KTX2 cases must *become* identical to each other, which they are not today.

### Stage 3 — remove the workarounds

- Delete `_matchGltfOrientation` from `Benchscene2_complexmodel/scripts/Scenario.ts`, and the
  equivalent in any scenario that grew one.
- Re-run the KTX2 A/B and confirm the arms differ only by transcode noise **without** any content
  compensation.
- `flipVertically` stays as public API — a host loading a texture from an outside pipeline still
  needs it — but needing it becomes the exception.

### Stage 4 — state it once, where it cannot be missed

- `CLAUDE.md` gains a "Texture coordinate system" entry beside the UI one, with the same shape:
  what the convention is, why it differs from Unity, and what that costs.
- The KTX2 constraint is named as the *reason*, so the next person does not try to "fix" it back.

## 4. What this is not

**Not a change to C1 or C2.** The camera conversion works and is tested; the UI's Y-down origin is
a deliberate, argued, documented choice that removes a flip from every draw call and every
hit-test. Neither is in scope, and re-opening C2 in particular would be a regression dressed as
consistency.

**Not a physics or transform change.** Nothing here touches world axes, handedness or rotation
order.

## 5. Risk, and why the order matters

The whole risk is silent breakage in content nobody looks at before it ships — `Molecules`, `DNA`,
`Crystals`, `AtomStructure`, `solar-system`. All of them texture engine primitives.

That is precisely why Stage 0 comes first and why Stage 2 uses one shared transform instead of
twelve edits. It is also why none of this is being done before the submission: the two rendering
defects fixed on 22 August were each invisible until something drew them, and there is no budget
for a third.

**Estimate:** ~2–3 days including Stage 0, most of it verification rather than code.

## 6. Related

- `CLAUDE.md` → Key Technical Decisions → "Coordinate system", "UI coordinate system — Y points DOWN"
- `.claude-shared/ENGINE-GAPS.md` → G4
- `ScenarioCreator/docs/ENGINE-GAPS.md` §6 — the measurement that found it
