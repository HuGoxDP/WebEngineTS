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
  never in the engine repo.
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
- Rendering: `src/engine/core/rendering/` — MeshFilter, MeshRenderer, InstancedMeshRenderer, SpriteRenderer, LineRenderer
- Components: `src/engine/core/components/` — Camera, Light types (Directional, Point, Spot, Ambient)
- Physics: `src/engine/core/physics/` — Physics raycasting, Collider, BoxCollider
- Cinemachine: `src/engine/core/cinemachine/` — CinemachineBrain, VirtualCamera, Body/Aim strategies
- Scenario: `src/engine/core/scenario/` — ZIP-based content pipeline (Scenario, ScenarioAssets, ScenarioBehaviour)
- Assets: `src/engine/core/assets/` — Resources API, LoadHandle
- Diagnostics: `src/engine/core/diagnostics/` — MemoryProfiler

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

## Roadmap / Next Steps

Prioritized plan for continued engine work. Driven by peer-review feedback on the
thesis paper (submission 76) and the paper's own "future work" section. Rationale is
kept here so future sessions understand *why* each item exists.

### P0 — Paper-critical, pure engine work (address reviewers R1 & R3)
1. **GPU/VRAM diagnostics** *(in progress — start here)*. Extend `MemoryProfiler` to
   surface Three.js `renderer.info.memory` (geometries, textures) and estimate
   per-texture VRAM bytes accounting for format (uncompressed RGBA8 vs. KTX2-transcoded
   BC7/ASTC/ETC2). Reviewers asked for a direct VRAM metric — KTX2's main benefit is
   VRAM reduction, which the JS-heap metric cannot show. Keep the public API free of
   `THREE.*` types (return engine-side plain structs/numbers).
2. **Reproducible benchmark harness** *(done 2026-07-16)*. `Benchmark`
   (`diagnostics/Benchmark.ts`) does warmup + frame-time percentiles
   (mean/median/p95/p99/max/stdDev) + memory snapshot (heap, GPU counts, estimated
   texture VRAM, draw calls, triangles) via rAF, with JSON/CSV export. The three paper
   scenes (procedural grid, high-poly model, Solar System) are deterministic in-repo code
   under `benchmarks/` (seeded, asset-free), bundled via `npm run benchmark:build` and run
   from `benchmarks/index.html` over the standalone bundle. Closes R3's reproducibility gap.
   Scenes 2/3 use procedural geometry/materials instead of imported PBR assets (documented
   in `benchmarks/README.md`).
3. **Integrated-graphics readiness**. Verify `KTX2Loader` transcode targets and fallback
   (ASTC/ETC2) work on Intel Iris Xe class hardware; run the harness there.

### P1 — Future-work features named in the paper
4. Static geometry batching / GPU instancing (draw-call reduction). *GPU instancing done
   (2026-07-16):* `InstancedMeshRenderer` (`rendering/InstancedMeshRenderer.ts`) draws N
   copies of one mesh+material in a single draw call via `THREE.InstancedMesh` (engine-typed
   per-instance TRS/color API, Three.js hidden). Benchmark Scene 1 exposes it via
   `?instanced=1`. *Remaining:* static mesh merging (`BufferGeometryUtils.mergeGeometries`)
   and automatic batching of existing MeshRenderers.
5. Level-of-detail (LOD) system.
6. WebGPU backend.

### P2 — Architecture enabling P1
7. Generalize the Adapter layer (decouple from Three.js) — prerequisite for the WebGPU
   backend; the un-generalized adapter is listed as a limitation in the paper.
8. OffscreenCanvas-based rendering.

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
