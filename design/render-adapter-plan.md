# Plan: generalize the render adapter (P2.8)

**Status:** audited 2026-09-03, **not started**. This is the roadmap's P2.8 — the prerequisite for
the WebGPU backend (P1.6) and the item the paper names as a limitation.

Written after measuring the codebase rather than from the roadmap text, because two neighbouring
roadmap claims turned out to be stale (see §5).

---

## 1. What is already generalized — more than the roadmap implies

The **frame seam** is done and engine-typed:

- `RenderBackend` (`rendering/RenderBackend.ts`) is an interface whose entire surface is
  engine types — `setSize`, `setClearColor`, `clear`, `renderScene(Scene, Camera)`, `warmup`,
  `dispose`, plus `stats`, `api` (`GraphicsAPI`), `pixelRatio`, `powerPreference`. No `THREE.*`
  in any signature.
- `WebGLRenderBackend` implements it, and owns context creation, colour management, tone mapping,
  shadow maps, the post-processing branch, shader warmup and (since 2026-09-03) the camera
  viewport rect.
- `Application.backendFactory` already swaps the implementation; `tests/RenderBackend.test.ts`
  drives a fake backend through it, so the seam is exercised, not just declared.

The one WebGL-specific escape hatch, `_internalThreeRenderer`, is `@internal`, is **not** part of
the `RenderBackend` interface, and has exactly three consumers outside the backend
(`Application`'s texture-properties probe, `MemoryProfiler`, `Texture2D`), each of which already
handles its absence. A non-WebGL backend simply does not provide it.

**So "the adapter is un-generalized" is no longer accurate for the frame path.** What remains is a
different seam entirely.

## 2. What is not generalized — resources and the scene graph

**39 of 160 engine files import `three` directly.** By layer:

| Layer | Files |
|---|---|
| `core/graphics` (Texture, Mesh, Material, Shader, Cubemap) | 9 |
| `core/components` (Camera, lights, SpriteRenderer, LODGroup) | 8 |
| `physics` | 5 |
| `core/rendering` (MeshFilter/Renderer, instancing, batching) | 5 |
| `core` (Transform, Application, Scene, RenderSettings) | 4 |
| `core/postprocessing` | 3 |
| `core/animation` | 2 |
| `core/scenario`, `core/particles`, `core/diagnostics` | 1 each |

The types that dominate, by occurrence:

| Type | Uses | Seam |
|---|---|---|
| `THREE.Texture` / `CubeTexture` | 45 | **Resource** |
| `THREE.Mesh` / `BufferGeometry` / `BufferAttribute` | 49 | **Resource** |
| `THREE.Material` / `MeshStandardMaterial` / `MeshBasicMaterial` | 37 | **Resource** |
| `THREE.Object3D` / `Scene` / `Light` | 31 | **Scene graph** |

That is the real P2.8: **every engine resource is a thin wrapper that owns a live Three.js object,
and every scene-graph node is a `THREE.Object3D`.** `Transform._object3D` is the spine — parenting,
world matrices and the internal-child mechanism (`_addInternalChild(obj: THREE.Object3D)`) are all
expressed in Three.js terms.

## 3. Why this cannot be done incrementally-in-place

Half-abstracting is strictly worse than either end state: with two ways to reach the GPU, every
new feature must pick one, and the `instanceof THREE.Mesh` checks that the engine relies on
(`Renderer._syncMaterialToThree`, and the reason consumers install a packed tarball rather than a
symlink — see CLAUDE.md) silently stop matching for whichever objects went through the new path.

So the staging below is ordered so that **each stage leaves exactly one way to reach the GPU**.

## 4. Stages

### Stage 0 — Pin the seam that exists
Extend the fake backend in `tests/RenderBackend.test.ts` into a full no-op backend and assert the
engine runs a frame, loads a scenario and reports diagnostics against it. Today the fake only
covers construction and disposal. **Without this, every later stage is unverifiable.**

### Stage 1 — Resource handles
Give `Texture`, `Mesh` and `Material` an opaque, backend-created handle instead of a public-by-
convention Three.js object. The engine classes stay the source of truth (they already are); what
changes is that `_internalThreeTexture` and friends become `backend.createTexture(descriptor)`.
The backend keeps the Three.js object; nothing above it names one.

This is the largest stage and the one that actually unblocks WebGPU, because textures and buffers
are where the two APIs differ most.

### Stage 2 — Scene-graph nodes
Replace `THREE.Object3D` in `Transform` with an engine node type the backend realizes. This is the
riskiest stage: parenting, `updateWorldMatrix`, the dirty-transform optimization and
`_addInternalChild` all sit on it, and `tests/CoordinateSpaces.test.ts` +
`tests/AncestorChainReparent.test.ts` are the guards.

### Stage 3 — Components stop importing `three`
Mechanical once 1 and 2 land: `components/`, `rendering/`, `animation/`, `particles/` lose their
imports. `physics/` is separate — it wraps a physics engine, not a renderer, and is out of scope.

### Stage 4 — The proof: a second backend
A WebGPU backend that satisfies `RenderBackend` with none of the above changed. Until one exists,
the generalization is unverified by construction.

## 5. Two roadmap claims that are stale (verified 2026-09-03)

- **"the serialization system exists but no built-in component uses it, so a saved scene currently
  loses every built-in component"** (CLAUDE.md → Unity architecture parity). **No longer true.**
  ~40 files carry `@Serializable`: `Camera`, every light, `MeshFilter`, `MeshRenderer`,
  `SpriteRenderer`, `LineRenderer`, `LODGroup`, `Rigidbody`, every collider, `Joint`, and the whole
  UI suite. `Transform` is deliberately excluded from the component loop
  (`SceneSerializer._serializeComponents`) because its pose is written directly onto the
  GameObject as `transform: { position, rotation, scale }` — the same shape Unity uses. Stage 1 of
  `unity-parity-plan.md` is substantially done.
- **"Generalize the Adapter layer (decouple from Three.js)"** reads as though nothing exists. The
  frame seam does — see §1. The accurate statement is that *resources and the scene graph* are
  still Three.js-typed.

## 6. Related

- `CLAUDE.md` → Roadmap → P1.6 (WebGPU), P2.8 (this), P2.9 (OffscreenCanvas)
- `design/unity-parity-plan.md` — serialization/editor track, whose Stage 1 claim §5 corrects
- `design/unity-coordinate-spaces.md` — the coordinate work that hardened `Transform`/`Camera`
  and their tests, which Stage 2 depends on as guards
