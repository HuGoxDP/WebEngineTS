# WebEngineTS

A Unity-like 3D game engine for the web, written in TypeScript and built on top of
[Three.js](https://threejs.org/) as a fully hidden rendering backend. Scenario authors
work only with high-level engine types (`GameObject`, `Component`, `Transform`, `Material`,
lifecycle hooks) and never touch Three.js directly.

> Master's thesis project — "Unity for Web". Distributed as an npm library.

---

## Prerequisites

- **Node.js ≥ 18** (Rollup 4 and the toolchain require it)
- **npm** (ships with Node)
- The engine has a **peer dependency on `three` ≥ 0.160.0**. When you consume the library
  from another project, install `three` there yourself. For building the engine in this
  repo, all dependencies are installed by `npm install`.

## Install

```bash
git clone <repo-url>
cd WebEngineTS
npm install
```

## Build

```bash
npm run build
```

This runs Rollup (`rollup.config.mjs` + `tsconfig.build.json`) and produces four artifacts
in `dist/`:

| Output | Format | Three.js | Intended consumer |
| --- | --- | --- | --- |
| `WebEngineTS.esm.js` | ES module | external | Bundler-based apps (Angular, Vite, webpack) |
| `WebEngineTS.cjs.js` | CommonJS | external | Node.js tooling / SSR |
| `WebEngineTS.standalone.js` | ES module | **bundled** | Browser `<script type="importmap">` (scenario Blob URLs) |
| `WebEngineTS.d.ts` | Types | — | A single bundled type-declaration file |

For the `esm`/`cjs` builds `three` is marked **external** — the host application provides it.
The `standalone` build bundles `three` (and `jszip`, `tslib`) so a plain HTML page can resolve
`import ... from "three"` and `from "WebEngineTS"` through an import map with no bundler.

The public entry point is `src/engine/index.ts`.

## Other scripts

```bash
npm run dev         # Rollup watch mode — rebuilds dist/ on change
npm run typecheck   # tsc --noEmit (strict mode), no emit
npm test            # Run the Vitest unit-test suite once
npm run docs        # Generate API docs into docs/ via TypeDoc
npm run clean       # Remove dist/
```

The editor (Angular app under `editor/`) is a separate workspace with its own scripts
(`npm run editor`, `editor:build`, `editor:install`) and is **not** part of the engine
library build.

## KTX2 / Basis textures (runtime asset)

The engine supports GPU-compressed KTX2/Basis Universal textures. Decoding needs the Basis
WASM transcoder at runtime — and the **host serves it**, not the engine bundle. It is not
vendored here: it ships with Three.js at `node_modules/three/examples/jsm/libs/basis/`
(`basis_transcoder.js`, `basis_transcoder.wasm`).

Copy those two files into your app's static directory and point the loader at the URL they
are served from, before loading any KTX2 texture:

```ts
import { Texture2D } from "WebEngineTS";

Texture2D.ktx2TranscoderPath = "/assets/basis/"; // must end with a slash
```

**The path is a URL, not a folder path**, and getting it wrong fails late and quietly: the
404 only happens once a scenario actually loads a compressed texture. Check it against where
your build publishes static files — Angular's `src/assets`, for instance, is served at
`/assets/`, not at the root.

Keep the transcoder in step with `three`: the loader and the transcoder are versioned
together, and an older transcoder fails at runtime in ways that look like a corrupt texture.
`npm run release:local` copies the current one into each consumer that serves it, so this
stays true without anyone remembering it.

## Using the library

```ts
import { Application, GameObject, Camera, Vector3 } from "WebEngineTS";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const app = new Application(canvas);

const cameraObj = new GameObject("Main Camera");
cameraObj.addComponent(Camera);
cameraObj.transform.position = new Vector3(0, 1, -10);

app.run();
```

Both import styles are supported:

```ts
// Named imports (tree-shakeable — preferred for production)
import { Vector3 } from "WebEngineTS";

// Default namespace (handy for prototyping / UMD-style use)
import WebEngine from "WebEngineTS";
const v = new WebEngine.Vector3();
```

## Diagnostics

Two diagnostic utilities are exported for profiling and reproducible benchmarking:

```ts
import { MemoryProfiler, Benchmark } from "WebEngineTS";

// On-screen overlay: press the backtick (`) key to toggle
MemoryProfiler.enableToggle();

// One-shot console report (JS heap, GPU resources, estimated texture VRAM)
MemoryProfiler.logReport();

// Measure frame-time percentiles + memory, then export to CSV
const result = await Benchmark.run({ label: "My Scene", warmupFrames: 120, sampleFrames: 600 });
Benchmark.downloadCSV(result, "my-scene.csv");
```

`MemoryProfiler` reports an **estimated texture VRAM** figure that accounts for KTX2/Basis
compression — the JS heap metric alone cannot reveal it. `Benchmark` samples the real frame
interval via `requestAnimationFrame` (the engine loop must be running) and exports JSON/CSV.

## Project layout

```
src/engine/
  index.ts              Public API barrel (entry point)
  core/                 Application, GameObject, Component, Transform, Scene, Time, Input
    math/               Vector2/3/4, Quaternion, Matrix4x4, Color, Bounds, Mathf, ...
    graphics/           Material system, Shader, Texture/Texture2D/Cubemap, Mesh
    rendering/          MeshFilter, MeshRenderer, SpriteRenderer, LineRenderer
    components/         Camera, Directional/Point/Spot/Ambient lights
    physics/            Raycasting, Colliders, Rigidbody (cannon-es)
    cinemachine/        CinemachineBrain, VirtualCamera, Body/Aim strategies
    scenario/           ZIP-based content pipeline
    assets/             Resources API, LoadHandle
    diagnostics/        MemoryProfiler, Benchmark
tests/                  Vitest unit tests
```

See [`CLAUDE.md`](./CLAUDE.md) for architecture rules, conventions, and the development roadmap.

## License

MIT
