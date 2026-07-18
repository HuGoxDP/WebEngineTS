# WebEngineTS — Reproducible benchmark suite

Deterministic, in-repo versions of the three evaluation scenes from the paper, wired to
the engine's `Benchmark` harness. They let the performance tables be regenerated
end-to-end from source, with no external assets.

- **Scene 1 — Procedural primitives grid.** `N` cubes sharing one mesh/material, a fixed
  5% rotating every frame. Isolates per-frame transform overhead.
- **Scene 2 — High-polygon model.** A single procedural high-subdivision sphere generated
  to a target triangle budget (default ~434k), standing in for the paper's imported GLB so
  the geometry workload is reproducible without shipping a large binary.
- **Scene 3 — Solar System.** A sun with point lighting and six orbiting, spinning planets,
  using procedural solid-color materials (no external textures).

All randomness is seeded (`mulberry32`), so each configuration produces identical content
on every run.

## Build & run

```bash
npm run build            # 1. build the engine → dist/ (produces the standalone bundle)
npm run benchmark:build  # 2. bundle the runner → benchmarks/run.js
npx serve .              # 3. serve the repo root over http (any static server works)
```

Then open `benchmarks/index.html` through the server (a `file://` URL will not work —
import maps and ES modules require `http`). For stable numbers, use a Chromium-based
browser (Chrome/Edge) started with `--enable-precise-memory-info` so the JS-heap figure is
accurate, and keep the tab focused.

## Configuration (URL query parameters)

| Param | Scenes | Default | Meaning |
| --- | --- | --- | --- |
| `scene` | — | `1` | Which scene: `1`, `2`, or `3` |
| `count` | 1 | `1000` | Number of primitives (try `100`, `500`, `1000`, `5000`) |
| `instanced` | 1 | `0` | Render the grid via one `InstancedMeshRenderer` (`1`) vs. N MeshRenderers (`0`) |
| `tris` | 2 | `434000` | Target triangle count |
| `warmup` | all | `120` | Warmup frames (discarded) |
| `samples` | all | `600` | Sampled frames |
| `dpr` | all | `1` | Device pixel ratio |
| `shaderWarmup` | all | `1` | Call `Application.warmupShaders()` before sampling (`1`/`0`) |
| `gpu` | all | `high-performance` | GPU hint: `high-performance` (discrete), `low-power` (integrated), `default` |

Examples:

```
benchmarks/index.html?scene=1&count=5000
benchmarks/index.html?scene=1&count=5000&instanced=1
benchmarks/index.html?scene=2&tris=434000
benchmarks/index.html?scene=3&warmup=120&samples=600
```

**GPU instancing demo.** Compare `?scene=1&count=5000` (≈5000 draw calls) with
`?scene=1&count=5000&instanced=1` — the instanced variant renders the whole grid in
**one draw call** (watch the "Draw calls" figure in the overlay). Instances are static in
this mode, so it isolates the draw-call cost rather than per-frame transform work.

## Cross-GPU and mobile testing

The overlay and the exported CSV/JSON record the **active GPU** (`gpu` column), so each run
self-labels which device produced it.

**Dual-GPU laptops (integrated vs. discrete).** The `gpu` query param sets the WebGL
`powerPreference` hint before the renderer is created:

```
benchmarks/index.html?scene=3&gpu=high-performance   # discrete (e.g. NVIDIA)
benchmarks/index.html?scene=3&gpu=low-power           # integrated (e.g. Intel UHD/Iris Xe)
```

Confirm which GPU is actually in use via the "GPU" line in the overlay. The hint alone is
sometimes overridden by the OS — on **Windows**, also pin the browser to a GPU under
*Settings → System → Display → Graphics → (add the browser) → Options*: choose **Power
saving** (integrated) or **High performance** (discrete). Run the same URL under each
setting and export the CSV.

**Phones / tablets.** Serve the repo over your LAN (e.g. `npx serve` bound to `0.0.0.0`,
then open `http://<your-ip>:<port>/benchmarks/index.html` on the device). ES modules and
import maps require `http(s)`, not `file://`. Mobile GPUs transcode KTX2 to **ETC2/ASTC**
rather than desktop BC7 — a good check of the compressed-texture fallback. Lower `count`
for Scene 1 on phones (e.g. `?scene=1&count=1000`).

The overlay shows FPS, frame-time percentiles (mean/median/p95/p99/max/stdDev), JS heap,
**estimated texture VRAM**, GPU resource counts, draw calls, and triangles. Use the
**Download CSV / JSON** buttons to export the result; the last result is also on
`window.__lastBenchmark` for console-driven multi-config runs.

## Notes on fidelity

These scenes reproduce the *workload shape* of the paper's scenes deterministically from
code. Scenes 2 and 3 differ from the paper in using procedural geometry/materials instead
of imported PBR assets, precisely so the benchmark is self-contained and reproducible. To
measure the KTX2 VRAM benefit, load real `.ktx2` textures (the transcoder path is set to
`../public/basis/`) and compare `estimatedTextureVramBytes` against uncompressed images.
