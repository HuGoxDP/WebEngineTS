# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# WebEngineTS

Unity-like 3D game engine in TypeScript wrapping Three.js as a hidden backend.
Master's thesis project ("Unity for Web"). Scenario authors import only from `"WebEngineTS"` and never interact with Three.js directly.

## Ecosystem / Related Projects

This repo is **only the engine** — a consumable npm library. It must NOT contain scenario
*content*, catalog/platform UI, or the scenario editor. Sibling projects (under
`C:\Users\Work\WebstormProjects\`) consume the engine; the engine never imports from or
depends on any of them.

- **ScenarioCreator** — build pipeline compiling scenario source in `Scenarios/` into
  distributable `.zip` archives (`ReleaseScenarios/`). Consumes the engine as a packed
  tarball (`WebEngineTS-0.1.0.tgz`, a `file:` dependency). Scenario **content** lives here,
  never in the engine repo. **Planned to be retired** once WebEngineTSEditor/app's authoring
  + export pipeline replaces it — scenarios will then be created directly in the editor
  instead of hand-written + built by this CLI pipeline. Until then it's kept in sync the
  same way as the other consumers (see below).
- **testv/virtual-lab** — the educational platform (own git repo): Angular `frontend`
  ("university-mock") + `backend` + `db` + `nginx` + docker-compose. The frontend is the
  scenario catalog + viewer; it downloads scenario ZIPs and runs them via
  `Application.loadScenarioFromBuffer`, resolving `"WebEngineTS"` through an import map to
  `WebEngineTS.standalone.js`. Consumes the engine tarball.
- **WebEngineTSEditor** — the graphical scenario editor. `app/` is the Angular editor app
  (extracted from this repo; consumes the engine via `file:../../WebEngineTS`); `design/` is
  the JSX/CSS design mockup guiding its redesign. Consumes the engine like any other host.

Data flow: **engine → tarball / standalone bundle → consumers**. The scenario *runtime*
(`src/engine/core/scenario/`) stays in the engine; scenario *content* and the *authoring UI*
do not. The Angular editor formerly under `editor/` has been moved to `WebEngineTSEditor/app/`
— this repo no longer contains any editor code.

### Keeping consumers in sync

Run `npm run release:local` (`scripts/release-local.mjs`) after any engine change meant to
reach a consumer. It builds, packs, and pushes to all three consumers above in one step:

1. Builds `dist/`.
2. Packs the tarball with a **temporary unique version** (`0.1.0-local.<timestamp>`) stamped
   into `package.json` just for `npm pack`, then immediately restores the committed
   `package.json` — the engine's working tree and git history are never touched. This
   guarantees every pack is genuinely new content, so a plain `npm install` (or a stale
   lockfile) in a consumer can never silently reuse an old build.
3. Renames the packed tarball to the stable `WebEngineTS-0.1.0.tgz` before copying it into
   ScenarioCreator and `testv/virtual-lab/frontend`, so their `package.json` dependency specs
   never need editing even though the *content* changes every run.
4. Reinstalls the dependency **explicitly** in each already-set-up consumer (`npm install
   <tgz-or-path>`) as defense in depth. `WebEngineTSEditor/app` uses `file:../../WebEngineTS`
   (the dist folder directly, no tarball) and is skipped until it has a `node_modules/` (i.e.
   until someone has run `npm install` there at least once).

`--no-install` builds/packs/copies without reinstalling (useful to just refresh the tarball).
One-directional; the engine still imports from no consumer.

**Why not `npm link` / npm workspaces for live linking?** Rejected for this engine
specifically — see "Local linking vs. packed tarballs" in Key Technical Decisions below.

**`testv/virtual-lab` git hygiene:** `frontend/node_modules` and `frontend/.angular` were
force-added before `.gitignore` covered them; they've since been untracked (`git rm --cached`,
working tree untouched). `frontend/WebEngineTS-0.1.0.tgz` **is** intentionally committed there
(no registry to fetch it from at deploy time) — don't gitignore it.

## Build & Dev

```bash
npm run build          # Rollup → dist/ (ESM, CJS, standalone, .d.ts)
npm run dev            # Rollup watch mode
npm run typecheck      # tsc --noEmit (strict mode)
npm run clean          # rm -rf dist
npm run benchmark:build # bundle benchmarks/run.ts → benchmarks/run.js (needs dist/ built first)
```

- Reproducible benchmark suite lives in `benchmarks/` (deterministic paper scenes + `Benchmark`
  harness, run from `benchmarks/index.html` over the standalone bundle). See `benchmarks/README.md`.

- Entry point: `src/engine/index.ts`
- Build config: `rollup.config.mjs` + `tsconfig.build.json`
- Output: `dist/WebEngineTS.esm.js`, `dist/WebEngineTS.cjs.js`, `dist/WebEngineTS.standalone.js` (Three.js bundled), `dist/WebEngineTS.d.ts`
- Tests: Vitest (`npm test` → `vitest run`); specs live in `tests/*.test.ts`

## Source Layout

- Entry: `src/engine/index.ts` (public API barrel), `src/engine/main.ts` (dev entry, not part of library)
- Core: `src/engine/core/` — Application, GameObject, Component, Transform, Behaviour, ScriptableBehaviour, Scene, SceneManager, Time, Input
- Math: `src/engine/core/math/` — Vector2/3/4, Quaternion, Matrix4x4, Color, Bounds, Rect, Mathf, AnimationCurve
- Graphics: `src/engine/core/graphics/` — Material system, Shader, Texture/Texture2D/Cubemap, Mesh
- Rendering: `src/engine/core/rendering/` — MeshFilter, MeshRenderer, InstancedMeshRenderer, StaticBatchingUtility, SpriteRenderer, LineRenderer
- Components: `src/engine/core/components/` — Camera, Light types (Directional, Point, Spot, Ambient), LODGroup
- Physics: `src/engine/core/physics/` — Physics raycasting, Collider, BoxCollider
- Cinemachine: `src/engine/core/cinemachine/` — CinemachineBrain, VirtualCamera, Body/Aim strategies
- Scenario: `src/engine/core/scenario/` — ZIP-based content pipeline (Scenario, ScenarioAssets, ScenarioBehaviour)
- Assets: `src/engine/core/assets/` — Resources API, LoadHandle
- Diagnostics: `src/engine/core/diagnostics/` — MemoryProfiler
- UI: `src/engine/core/ui/` — Canvas (2D overlay), CanvasScaler, RectTransform, UIImage,
  UIText, Button, VirtualJoystick, EventSystem. Drawn through the 2D context, not Three.js:
  the overlay is a separate `<canvas>` sized at the device pixel ratio and transformed once
  per repaint, so components draw in canvas units. `Canvas.repaintMode` defaults to
  `OnDemand` — the canvas hashes each graphic's rect plus its `_visualHash()` and skips the
  repaint when nothing changed. A `UIBehaviour` subclass that does not override
  `_visualHash()` returns `NaN` and is treated as always-changed, so opting out is safe.

## Architecture — Critical Rules

### Three.js Isolation (MOST IMPORTANT)
- Public APIs (parameters, return types, generics) must NEVER expose `THREE.*` types
- Three.js is permitted ONLY inside `private` / `@internal` methods
- If you find `THREE` in a public signature — flag it, propose refactor FIRST, don't just patch
- Conversion to Three.js happens in private sync methods: `_syncToThree`, `_setInternalRenderObject`, `_internalThreeMaterial`, etc.

### Engine-First Design
- Engine classes (`Vector3`, `Quaternion`, `Color`, `Material`) are the single source of truth
- All subsystems communicate through engine types, never Three.js types
- Three.js objects are internal mirrors, synced in private methods

### Game Loop (per frame in Application._loop)
`FixedUpdate` (0–N times at fixed timestep) → `Update` → `LateUpdate` → Render (`Camera.main`) → `Input._resetFrame()`

Each step runs components first, then the active scenario.

### Unity-Compatible Behavior
- Naming, lifecycle order, semantics follow Unity conventions
- Component lifecycle: `Awake → OnEnable → Start → FixedUpdate → Update → LateUpdate → OnDisable → OnDestroy`
- `sharedMaterial` = shared reference (mutations affect all users); `material` = auto-clone on first write
- `clone()` = deep copy, no shared references remain
- Reference standard: Unity 6 / 2022+ LTS APIs, Cinemachine 3.x

### Dual Export Pattern
`index.ts` provides both named exports (`import { Vector3 } from "WebEngineTS"`, tree-shakeable) and a default namespace export (`import WebEngine from "WebEngineTS"; new WebEngine.Vector3()`).

## Code Conventions

### TypeScript
- Strict mode throughout, no `any` without inline comment explaining why
- `PascalCase` for types and public properties
- `camelCase` for locals
- `_camelCase` for private fields

### Zero-Allocation Math
- Optional `out?` parameter for vector/matrix results
- Static cached instances for intermediates (e.g., `private static _tmp = new Vector3()`)
- `Object.freeze` on exported constants
- Never allocate in hot paths (Update, LateUpdate, FixedUpdate)

### JSDoc
- Write JSDoc ONLY on `public` and `protected` members
- Do NOT write inline comments inside method bodies unless logic is genuinely non-obvious
- Never annotate self-evident code like `const x = position.x; // get x`
- Mark engine internals with `@internal` JSDoc tag

### Completeness
- Every declared function/property/field must have a real implementation
- If something can't be implemented yet — write the stub with `// TODO: <what's missing and why>`
- Never leave an empty body without a `// TODO`

### All comments and identifiers in English

## Workflow

### Plan → TODO → implement
1. Start with a short plan (approach, files touched, order) before writing code.
2. Turn the plan into an explicit TODO list; only then start implementing.
3. If part of the plan cannot be implemented now, leave a `// TODO: <what's missing and why>`
   (or a tracked TODO item) — never silently skip it or fake the behaviour.

### Before editing any file:
1. List the target file's imports
2. For each dependency — verify it is current; if it needs changes, patch it FIRST
3. Present patches deepest-dependency first, target last
4. Never modify a target while any of its dependencies are stale

### Research-first for non-trivial features:
1. Search how Unity implements the equivalent feature — API shape, lifecycle, edge cases
2. Search how Three.js handles the underlying rendering concern
3. Write a short plan reconciling the two: Unity API on top, Three.js hidden beneath
4. Only then proceed to code

### One concern per patch
- If a request would touch unrelated subsystems — decline that part, explain why, propose narrower scope
- Never silently modify a file that wasn't discussed — flag it as a prerequisite

## Key Technical Decisions

- **Coordinate system**: Unity +Z-forward vs Three.js −Z-forward; cameras use `CameraState.cameraLookRotation()` with Shepperd's method
- **Cinemachine first-frame**: Always Cut on first activation (blending from null CameraState causes camera at origin)
- **Texture GPU upload timing**: `releaseSourceImage()` uses a two-frame countdown (`_releaseCountdown = 2`) to ensure GPU upload completes before CPU data is released
- **ImageBitmap leak**: Three.js `dispose()` does not call `.close()` on ImageBitmap sources — engine handles this in `Texture.onDestroy()`
- **Batch loading**: `Resources.tryLoad()` wraps individual loads instead of `Promise.all` (which fails entire batch on single missing asset)
- **Scenario script pre-linking**: All `.js` files in a scenario ZIP are topologically sorted by dependency, relative import specifiers are rewritten to Blob URLs, bare specifiers (e.g. `"WebEngineTS"`) are left for the host import map. Entry point brand-checked via `__scenarioBehaviour` marker (not `instanceof`, which breaks across bundle copies)
- **Circular deps**: Use `import type` for engine asset types in interfaces
- **Single profiling system**: performance/memory measurement lives ONLY in the engine
  (`MemoryProfiler` + `Benchmark`, driven by `benchmarks/run.ts`). Scenario *content* must
  never embed its own benchmark harness or optimization toggles — the harness drives the
  optimizations via URL params and measures from the outside.
- **Local linking vs. packed tarballs**: consumers install the engine via packed `.tgz`
  (`file:` dep) rather than `npm link` / npm workspaces symlinking. `three` is a
  peerDependency and the engine's rendering code relies on `instanceof THREE.Mesh`-style
  checks throughout (e.g. `Renderer._syncMaterialToThree`); a symlinked engine can resolve
  its own `node_modules/three` instead of the consumer's hoisted copy depending on the
  bundler, silently loading **two** THREE.js instances and breaking those checks. Packing
  copies the engine's actual published shape (three external, resolved from the consumer's
  own `node_modules`), so there is exactly one `three` instance — matching how a real npm
  install would behave. Symlinks would also not survive into `testv/virtual-lab`'s Docker
  build context. See `scripts/release-local.mjs` / the Ecosystem section above.

## Roadmap / Next Steps

Prioritized plan for continued engine work. Driven by peer-review feedback on the
thesis paper (submission 76) and the paper's own "future work" section. Rationale is
kept here so future sessions understand *why* each item exists.

### P0 — Paper-critical, pure engine work (address reviewers R1 & R3)
1. **GPU/VRAM diagnostics** *(done 2026-07-16)*. `MemoryProfiler` surfaces
   `renderer.info.memory` (geometries, textures) plus engine-side VRAM estimates:
   per-texture bytes accounting for format (uncompressed RGBA8 vs. KTX2-transcoded
   BC7/ASTC/ETC2, `Texture._estimateVramBytes` via `_TextureMemory.ts`) and per-mesh
   vertex/index buffer bytes (`Mesh._estimateVramBytes`). `MemoryReport.renderer` exposes
   `estimatedTextureVramBytes` + `estimatedGeometryVramBytes` + `estimatedRenderTargetVramBytes`
   (shadow maps per shadow-casting light via scene traversal, plus post-processing ping-pong
   buffers); `Benchmark` includes all three in its snapshot/CSV and the overlay shows a total.
   Reviewers asked for a direct VRAM metric (KTX2's main benefit is VRAM reduction, invisible
   in the JS heap). Public API is free of `THREE.*` types.
   The diagnostics also surface **measured main-thread CPU frame time** (`Application.cpuFrameTime`
   = busy ms per loop, distinct from the VSync-capped frame interval) in `MemoryProfiler`
   (report + overlay `% of frame`) and `Benchmark` (`cpuFrameMsMean` + CSV). Note: browsers
   cannot report OS-level CPU%/RAM — JS heap + this CPU frame time are the available metrics.
2. **Reproducible benchmark harness** *(done 2026-07-16)*. `Benchmark`
   (`diagnostics/Benchmark.ts`) does warmup + frame-time percentiles
   (mean/median/p95/p99/max/stdDev) + memory snapshot (heap, GPU counts, estimated
   texture VRAM, draw calls, triangles) via rAF, with JSON/CSV export. The three paper
   scenes (procedural grid, high-poly model, Solar System) are deterministic in-repo code
   under `benchmarks/` (seeded, asset-free), bundled via `npm run benchmark:build` and run
   from `benchmarks/index.html` over the standalone bundle. Closes R3's reproducibility gap.
   The procedural Scenes 1–3 are asset-free (quick/deterministic); for faithful, texture/VRAM-
   meaningful runs `?scenario=<zip-url>` loads the real ScenarioCreator ZIPs
   (`Benchscene2/3`, models + textures + skybox) via `Application.loadScenarioFromUrl` — the
   ZIPs stay in ScenarioCreator (git-ignored under `benchmarks/scenarios/`), keeping the engine
   repo content-free. Scene 1 exposes the dirty-flag optimization via `?dirty=0/1`.
3. **Integrated-graphics readiness**. *Harness enabled (2026-07-18):* `Application.powerPreference`
   (`GraphicsPowerPreference` enum) selects the WebGL GPU hint (discrete vs. integrated) at
   context creation; the benchmark exposes it via `?gpu=high-performance|low-power|default`,
   and the active GPU (unmasked renderer) is recorded in `MemoryReport.gpu` / `BenchmarkResult.gpu`
   / CSV so runs self-label. *Remaining (needs hardware):* actually run the harness on the
   integrated GPU (Intel UHD/Iris Xe) and a phone, and verify KTX2 transcodes to ASTC/ETC2 there.

### P1 — Future-work features named in the paper
4. Static geometry batching / GPU instancing (draw-call reduction). *Done (2026-07-16):*
   (a) `InstancedMeshRenderer` (`rendering/InstancedMeshRenderer.ts`) draws N copies of one
   mesh+material in a single draw call via `THREE.InstancedMesh` (engine-typed per-instance
   TRS/color API, Three.js hidden); Benchmark Scene 1 exposes it via `?instanced=1`.
   (b) `Mesh.combine(instances)` (`graphics/Mesh.ts`) bakes transforms and merges several
   static meshes into one geometry (`BufferGeometryUtils.mergeGeometries`) — Unity-style
   static batching, one draw call for many static objects.
   (c) `StaticBatchingUtility` (`rendering/StaticBatchingUtility.ts`) auto-detects existing
   MeshRenderers sharing a material and batches each group into one mesh (via `Mesh.combine`),
   disabling the originals — Unity-style `StaticBatchingUtility.Combine`. **P1.4 complete.**
5. Level-of-detail (LOD) system. *Done (2026-07-16):* `LODGroup`
   (`components/LODGroup.ts`) picks a detail level from the object's on-screen size
   (`size / frustumHeightAtDistance`, Unity screen-relative-height semantics) against
   `Camera.main`, disabling other levels' renderers and culling below the smallest
   threshold. Driven per-frame by `LODGroup._updateAll()` in `Application._loop` (same
   registry pattern as Animation/ParticleSystem).
6. WebGPU backend.
7. **Manifest-driven asset streaming / LOD streaming / progressive loading.** The monolithic
   scenario ZIP blocks LOD streaming, progressive first paint, preloading, cross-scenario
   dedup, and partial updates. Move to a manifest + content-addressed, individually-fetchable
   assets loaded through a streaming `IAssetSource` (the `Resources`/`ScenarioAssets` seam),
   with `LODGroup` gating on streamed asset LODs and VRAM-budget eviction. Spans engine +
   platform + editor; single-ZIP path stays. Full design + staged rollout (0–4) in
   [`design/asset-streaming-proposal.md`](design/asset-streaming-proposal.md).

### P2 — Architecture enabling P1
8. Generalize the Adapter layer (decouple from Three.js) — prerequisite for the WebGPU
   backend; the un-generalized adapter is listed as a limitation in the paper.
9. OffscreenCanvas-based rendering.

Note: paper-text-only fixes (abstract tense, deployment scale, comparison with
three-game-engine / Rogue Engine / Needle Engine, user study) are tracked separately and
are **not** engine tasks.

## Dependencies

- Runtime: `three` (peer dep ≥0.160.0), `jszip`, `tslib`, `reflect-metadata`
- Build: `rollup`, `@rollup/plugin-typescript`, `@rollup/plugin-node-resolve`, `@rollup/plugin-commonjs`, `rollup-plugin-dts`
- Types: `@types/three`, `@types/node`

## Communication

- Respond in Ukrainian or Russian when the user writes in those languages
- Be concise and decisive — bullet points for lists, prose for reasoning
- When intent is ambiguous: list assumptions as [INFERRED], state decision, proceed
