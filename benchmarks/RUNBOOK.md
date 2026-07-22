# WebEngineTS — Benchmark RUNBOOK

Copy-paste links for every run variant, plus the exact procedure and how many times to run
each configuration. Companion to [`README.md`](./README.md) (which explains each parameter);
this file is the operational checklist for regenerating the paper's performance tables.

All links use a **`#` hash** rather than `?` on purpose: `serve`'s clean-URL 301 redirect
drops the query string, but a hash survives redirects on any static server. The harness reads
`location.search` first, then `location.hash` (`run.ts`), so `#` always works. If you run a
server that preserves query strings (e.g. `serve` with the committed `serve.json` active), you
may swap `#` for `?`.

Base URL (port depends on the server; `npx serve .` uses 3000):

```
http://localhost:3000/benchmarks/index.html
```

---

## 0. One-time setup (per machine / per pull)

Run everything from the **repository root**, not from `benchmarks/`.

```bash
npm run build            # engine → dist/ (+ standalone bundle)
npm run benchmark:build  # runner  → benchmarks/run.js
npx serve .              # serve the REPO ROOT over http (restart after a pull so serve.json applies)
```

Then open a link below. Preconditions for stable, comparable numbers:

- **Browser:** Chromium-based (Chrome/Edge) launched with `--enable-precise-memory-info`,
  otherwise the JS-heap figure is quantised/inaccurate.
- **Keep the benchmark tab focused** — `requestAnimationFrame` throttles background tabs.
- Fixed window size, `dpr=1` (default), laptop on AC power / max-performance profile.
- Close other GPU/CPU-heavy apps; let the machine idle a few seconds before measuring.
- If `/dist/WebEngineTS.standalone.js` 404s, you served `benchmarks/` instead of the repo
  root — `cd ..` and serve again.

Built-in per-load protocol (no need to set unless overriding): `warmup=120` frames discarded,
`samples=600` frames measured, `dpr=1`, `shaderWarmup=1`, `gpu=high-performance`.

---

## 1. Run variants (links)

### Scene 1 — procedural grid (per-frame transform cost, draw calls)

Count sweep:

```
http://localhost:3000/benchmarks/index.html#scene=1&count=100
http://localhost:3000/benchmarks/index.html#scene=1&count=500
http://localhost:3000/benchmarks/index.html#scene=1&count=1000
http://localhost:3000/benchmarks/index.html#scene=1&count=5000
```

Dirty-flag transform batching (the Scene 1 optimization) — run both, compare medians:

```
http://localhost:3000/benchmarks/index.html#scene=1&count=5000&dirty=1
http://localhost:3000/benchmarks/index.html#scene=1&count=5000&dirty=0
```

GPU instancing (one draw call vs. N) — run both, watch "Draw calls" in the overlay:

```
http://localhost:3000/benchmarks/index.html#scene=1&count=5000&instanced=0
http://localhost:3000/benchmarks/index.html#scene=1&count=5000&instanced=1
```

### Scene 2 — high-poly model (geometry throughput)

```
http://localhost:3000/benchmarks/index.html#scene=2&tris=434000
http://localhost:3000/benchmarks/index.html#scene=2&tris=1000000
```

### Scene 3 — Solar System (lit, multi-object)

```
http://localhost:3000/benchmarks/index.html#scene=3
```

### KTX2 / Basis fallback (compressed-texture transcode check)

```
http://localhost:3000/benchmarks/index.html#scene=ktx2
```

Success = the checker/gradient renders (not black/magenta); "Tex VRAM" shows the *compressed*
footprint. Desktop transcodes to BC7, integrated/mobile to ASTC/ETC2.

### Discrete vs. integrated GPU

Append `&gpu=…` to **any** link above. Example on Scene 3:

```
http://localhost:3000/benchmarks/index.html#scene=3&gpu=high-performance   # discrete
http://localhost:3000/benchmarks/index.html#scene=3&gpu=low-power           # integrated
http://localhost:3000/benchmarks/index.html#scene=3&gpu=default             # OS decides
```

The `powerPreference` hint is advisory. Confirm the "GPU" line in the overlay matches; the
harness prints a WARNING on mismatch. On Windows also pin the browser under *Settings → System
→ Display → Graphics → (add the browser) → Options* (High performance / Power saving) and
**fully quit and reopen** the browser.

### Faithful real scenarios (textured — required for the KTX2 VRAM benefit)

The procedural scenes are asset-free (`estimatedTextureVramBytes` = 0). For real
models/textures/skybox, drop the built ZIPs into `benchmarks/scenarios/` (git-ignored; built
in ScenarioCreator — see [`scenarios/README.md`](./scenarios/README.md)) and load them:

```
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip
```

`#scenario=` overrides `scene`, and combines with `&gpu=…` like any other run.

---

## 2. How many times to run

- **One page load is already a full sample:** the harness discards 120 warmup frames, then
  measures 600 frames and reports mean / median / p95 / p99 / max / stdDev. The percentiles
  *within* a single load are already sound.
- **Repeat each configuration 5×** (reload the page) and **discard the first run** (cold
  JIT / shader / texture caches). Report the **median run**, or **mean ± stdDev across runs**.
  Minimum acceptable is 3; 5 is safer against run-to-run variance (thermal throttling, GC
  pauses, background work).
- For a rock-solid **p99** on the heavy configs (Scene 1 `count=5000`, Scene 2 `tris≥434000`),
  raise `&samples=1000` (~17 s of capture at 60 FPS).
- For any **A/B comparison** (dirty on/off, instanced on/off, discrete/low-power), run the two
  branches **back-to-back under identical conditions** and compare medians — this cancels
  thermal drift that would otherwise bias the delta.
- Export **Download CSV** (or JSON) after every run. The filename auto-encodes
  scene + settings + GPU + a UTC time tag, so repeated runs never collide; the last result is
  also on `window.__lastBenchmark` for console-driven loops.

Suggested minimum matrix for the paper (each cell = 5 reloads, drop first, take median):

| Scene | Configs to capture |
| --- | --- |
| 1 | `count ∈ {100, 500, 1000, 5000}`; then `count=5000` × `dirty ∈ {1,0}`; then `count=5000` × `instanced ∈ {0,1}` |
| 2 | `tris=434000` (add `tris=1000000` if you want a second point) |
| 3 | default |
| ktx2 | one run per GPU (discrete / integrated / phone) — pass/fail + Tex VRAM |
| scenario | `Benchscene2_complexmodel.zip`, `Benchscene3_solarsystem.zip` |

Cross-GPU: re-run the rows you care about with `&gpu=low-power` (and pin the browser to the
integrated GPU in Windows). The `gpu` column in every CSV self-labels the device.

---

## 3. Per-run checklist

1. Tab focused, no other heavy apps, machine idle for a moment.
2. Open the link; wait for the overlay to finish (`measuring…` → results appear).
3. Check the **GPU** line matches the intended device (no WARNING).
4. **Download CSV.**
5. Reload; repeat to 5 runs total.
6. Drop run #1; record median (or mean ± stdDev) of runs 2–5.
