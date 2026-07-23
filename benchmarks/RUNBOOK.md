# WebEngineTS — Benchmark RUNBOOK

Copy-paste links for every run variant, plus the exact procedure and how many times to run
each configuration. Companion to [`README.md`](./README.md) (which explains each parameter);
this file is the operational checklist for regenerating the paper's performance tables.

**One measurement system.** Optimizations are **not** baked into the scenarios — the scenario
ZIPs are content-only, and every optimization (maxSize / relArc / relSrc / KTX2 / warmup /
dirty) is a **URL flag** on the engine harness. One ZIP per scene; you change the URL, not the
ZIP. All measurement comes from `Benchmark` + `MemoryProfiler` (CSV export).

All links use a **`#` hash** rather than `?`: `serve`'s clean-URL 301 redirect drops the query
string, but a hash survives redirects on any static server (`run.ts` reads `location.search`
first, then the hash). Swap `#`→`?` only if your server preserves query strings.

Base URL (port depends on the server; `npx serve .` uses 3000):

```
http://localhost:3000/benchmarks/index.html
```

---

## 0. One-time setup

### Engine (from the repo root, not `benchmarks/`)

```bash
npm run build            # engine → dist/ (+ standalone bundle)
npm run benchmark:build  # runner  → benchmarks/run.js
npx serve .              # serve the REPO ROOT over http
```

### Scenario ZIPs (in the sibling ScenarioCreator, **PowerShell**)

Build in **PowerShell**, not Git Bash — Git Bash's `tar.exe` mishandles `C:\` archive paths.

```powershell
npm run build -- --scenario Benchscene2_complexmodel,Benchscene3_solarsystem
```

For the **KTX2 dual-format** Scene 3 (needs [KTX-Software](https://github.com/KhronosGroup/KTX-Software)
on PATH — auto-detected at `C:\Program Files\KTX-Software\bin`):

```powershell
$env:INCLUDE_SKYBOX = "1"   # also compress the skybox panorama
npm run build -- --scenario Benchscene3_solarsystem --ktx2
```

`--ktx2` runs the scene's `convert_to_ktx2.sh` and packs **both** `.jpg` and `.ktx2` into the
one ZIP, so `&ktx2=0` uses the originals and `&ktx2=1` uses the compressed variants.

Then copy the ZIPs from `ScenarioCreator/ReleaseScenarios/` into
`WebEngineTS/benchmarks/scenarios/` (git-ignored). Ensure the **Basis transcoder** is served at
repo-root `/public/basis/` (required for `&ktx2` and the `scene=ktx2` sanity check).

### Browser / environment

- Chromium (Chrome/Edge) launched with `--enable-precise-memory-info`, else the JS-heap figure
  is quantised.
- **Keep the tab focused** (rAF throttles background tabs); fixed window size; `dpr=1`; laptop
  on AC / max-performance; close other GPU/CPU-heavy apps; idle a few seconds before measuring.
- If `/dist/WebEngineTS.standalone.js` 404s, you served `benchmarks/` instead of the repo root.

Built-in per-load protocol (override only if noted): `warmup=120` discarded, `samples=600`
measured, `dpr=1`, `dirty=0`, `shaderWarmup=0` (both **off** for a clean baseline — enable per
row), `gpu=high-performance`.

---

## 1. Run variants (links)

### Scene 1 — procedural primitives grid → Table 1 (dirty transforms)

Object-count sweep (baseline, dirty off):

```
http://localhost:3000/benchmarks/index.html#scene=1&count=100&dirty=0
http://localhost:3000/benchmarks/index.html#scene=1&count=500&dirty=0
http://localhost:3000/benchmarks/index.html#scene=1&count=1000&dirty=0
http://localhost:3000/benchmarks/index.html#scene=1&count=5000&dirty=0
```

Dirty-flag on/off at each count (A/B — the Table 1 optimization; the effect is real only where
the scene is CPU-bound, i.e. high count and below the refresh cap):

```
http://localhost:3000/benchmarks/index.html#scene=1&count=100&dirty=1
http://localhost:3000/benchmarks/index.html#scene=1&count=500&dirty=1
http://localhost:3000/benchmarks/index.html#scene=1&count=1000&dirty=1
http://localhost:3000/benchmarks/index.html#scene=1&count=5000&dirty=1
```

Read the **`cpu_mean_ms`** and **`update_ms`** columns — dirty transforms cut the Update phase,
which is masked in wall-clock FPS under VSync.

### Scene 2 — real high-poly model (Pug ZIP) → Table 2 (warmup + textures)

`maxSize ∈ {0, 2048, 1024}` × `shaderWarmup ∈ {0, 1}` = 6 configs:

```
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip&maxSize=0&shaderWarmup=0
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip&maxSize=0&shaderWarmup=1
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip&maxSize=2048&shaderWarmup=0
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip&maxSize=2048&shaderWarmup=1
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip&maxSize=1024&shaderWarmup=0
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip&maxSize=1024&shaderWarmup=1
```

Warmup effect is in **`first_render_cpu_ms`** + **`load_ms`** (compile moves into load), not the
steady-state average. **Caveat:** the Pug's textures are embedded in the GLB; verify `maxSize`
actually changes **`estimatedTextureVramBytes`** between 0 and 2048 — if the model loader
decodes GLB textures outside the `Texture2D` path, `maxSize` won't touch them and those rows are
moot (report Scene 2 as a warmup + polygon-throughput result instead).

### Scene 3 — real Solar System (ZIP) → **MAIN incremental table 3.1 → 3.7**

One ZIP, one flag added per row. Base:
`#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip`

```
3.1  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=0
3.2  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048
3.3  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&relArc=1
3.4  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&relArc=1&relSrc=1
3.5  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&relArc=1&relSrc=1&ktx2=1
3.6  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&relArc=1&relSrc=1&ktx2=1&shaderWarmup=1
3.7  http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&relArc=1&relSrc=1&ktx2=1&shaderWarmup=1&dirty=1
```

Row 3.5 needs the **`--ktx2` ZIP** (§0). Key columns: `load_ms`, `first_render_cpu_ms`,
`cpu_mean_ms`, `estimatedTextureVramBytes`, `max_ms`, `stdDev_ms`, `fps`.

### KTX2 — build + compare (the R1 VRAM point)

With the `--ktx2` ZIP in place, compare uncompressed vs compressed **on the same archive**:

```
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&ktx2=0
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&maxSize=2048&ktx2=1
```

Expected trade-off: `ktx2=1` → **`estimatedTextureVramBytes` drops** (the win), while `load_ms`
and heap **rise** (Basis transcoder cost). VRAM is the metric that matters — heap/load are the
paid cost. Transcode sanity (checker renders, not black/magenta) per GPU:

```
http://localhost:3000/benchmarks/index.html#scene=ktx2
http://localhost:3000/benchmarks/index.html#scene=ktx2&gpu=low-power
```

### Cross-device (integrated GPU / phone / 2nd laptop → R1)

Append `&gpu=low-power` for the integrated card; open the same URLs on a phone/other laptop via
the LAN IP (`http://<ip>:3000/...`). The **`gpu`** column in every CSV self-labels the device.

```
…&gpu=high-performance   # discrete
…&gpu=low-power           # integrated
```

The hint is advisory — confirm the overlay "GPU" line (a WARNING prints on mismatch). On
Windows also pin the browser in *Settings → System → Display → Graphics* and fully restart it.

---

## 2. How many times to run

- **One page load = a full sample:** 120 warmup frames discarded, then 600 measured, with
  mean/median/p95/p99/max/stdDev computed. Percentiles within one load are already sound.
- **Scene 1 & Scene 2: 5 reps** per config (reload), **drop the first** (cold JIT/caches),
  report the **median** run.
- **Scene 3 (the main table): 10 reps** per config, drop the first, report **mean ± stdDev**
  (matches the paper's protocol; the baseline's max-frame-time variance is the headline, so it
  needs the extra runs to be stable).
- **A/B pairs** (dirty on/off, ktx2 0/1, warmup 0/1, discrete/low-power): run the two branches
  **back-to-back** and compare — cancels thermal drift.
- Export **Download CSV** after every run (filename auto-encodes scene+flags+GPU+time, so runs
  never collide). Last result is also on `window.__lastBenchmark`.

Minimum matrix for the paper:

| Scene | Configs | Reps |
| --- | --- | --- |
| 1 | `count ∈ {100,500,1000,5000}` × `dirty ∈ {0,1}` (8) | 5, median |
| 2 | `maxSize ∈ {0,2048,1024}` × `shaderWarmup ∈ {0,1}` (6) | 5, median |
| 3 | incremental 3.1→3.7 (7) | **10, mean ± SD** |
| KTX2 | `ktx2 ∈ {0,1}` on Scene 3 + `scene=ktx2` sanity per GPU | 5 (A/B) |
| cross-device | Scene 3 3.1 + 3.7 with `gpu=low-power`, phone, 2nd laptop | 5 each |

**CSV columns → paper tables:** `load_ms`, `cpu_mean_ms`, `fixed_ms`/`update_ms`/`late_ms`/
`render_ms` (phase breakdown), `first_render_cpu_ms`, `mean_ms`/`median_ms`/`p95_ms`/`p99_ms`/
`max_ms`/`stdDev_ms`, `fps`, `jsHeapUsedBytes`, `estimatedTextureVramBytes` (+Geo/RT),
`drawCalls`, `triangles`, `gpu`.

---

## 3. Per-run checklist

1. Tab focused, no other heavy apps, machine idle for a moment.
2. Open the link; wait for the overlay (`measuring…` → results).
3. Check the **GPU** line matches the intended device (no WARNING).
4. **Download CSV.**
5. Reload; repeat (5 total for Scene 1/2, 10 for Scene 3).
6. Drop run #1; record median (Scene 1/2) or mean ± stdDev (Scene 3) of the rest.
