# Answers to consumer reports

Three repositories keep a list of things the engine could not do. This is the engine's reply to
all three, resolved on **2026-08-20** against the working tree at that date.

| Source | Found against |
|---|---|
| `ScenarioCreator/docs/ENGINE-GAPS.md` | `0.1.0-local.1786479071411` |
| `testv/virtual-lab/docs/upstream/webenginets.md` | `0.1.0-local.1786569427449` |
| `WebEngineTS-Benchmarks/tasks/webenginets.md` | `0.1.0-local.1787076714566` |

Each list was written against a build older than the current one, and **five of the nine items
were already fixed** by the time they were re-checked. That is worth saying plainly: the lists
are accurate reports of the builds they were made against, and re-verifying before acting on one
is the difference between fixing something and re-fixing it.

---

## Already fixed before this pass

| Item | Where it stands now |
|---|---|
| **SC-1** `PhysicMaterial.friction` never reaches a contact | Fixed. `PhysicsWorld` registers a `CANNON.ContactMaterial` per material pair, and exposes `defaultFriction` / `defaultRestitution` for the global fallback. |
| **SC-2** `Slider` has no `setValueWithoutNotify` | Fixed. `Slider.setValueWithoutNotify` exists, matching `Toggle`, `Dropdown` and `Scrollbar`. |
| **VL-3** Asset URLs joined onto the manifest directory | Fixed. `StreamingAssetSource._resolveUrl` resolves with `new URL(url, base)`, making a root-relative base absolute against the document first. The `/a/manifests//a/objects/…` 404 is named in the code comment. |
| **VL-5a** `Application.version` is a fixed literal | Fixed. It now reads `BuildInfo.version`, so it carries the real stamp. |
| **BM-E1..E4** benchmark items | Done 2026-08-19/20 — see the commits referencing E1–E4. |

---

## Fixed in this pass

### VL-4a — a scenario could open the diagnostics overlay on a student

`MemoryProfiler.diagnosticsAllowed` is a host-level policy that scenario code cannot get past.
While it is `false`, `showOverlay`, `toggleOverlay` and `enableToggle` are inert and an overlay
already on screen is taken down.

The platform's workaround — closing the overlay after load and holding the line with an E2E test
— was a race the engine should not have made it run. `snapshot()` deliberately still works: it
puts nothing on screen, and a host may want the numbers without the panel.

```ts
// Platform startup, before any scenario is loaded:
MemoryProfiler.diagnosticsAllowed = new URLSearchParams(location.search).has("diag");
```

### VL-4b — the report could not say what a texture was transcoded to

`MemoryReport.renderer.textureFormats` is a tally of live textures by the GPU format they
actually ended up in: `{ BC7: 3, ETC2: 8, RGBA8: 1 }`. A KTX2 asset that reads `RGBA8` did not
transcode. The target differs per device, so this is something only the running engine can
report.

### SC-3 — `maxSize` silently did nothing on the KTX2 path

Two changes. The `maxSize` documentation now states exactly which loaders honour it and which
cannot, and `fromKTX2ArrayBuffer` says so once per run when a cap is set and ignored.

Not implemented, deliberately: selecting a smaller KTX2 mip level as the base would be a
behaviour change for every consumer, and the benchmark suite is proceeding on the documented
behaviour. The measured table in `ENGINE-GAPS.md` — the whole `ktx2=1` row reading one number —
stays correct; it now has a stated reason.

---

## Not the engine's to fix

### VL-2 — the basis transcoder needs `'unsafe-eval'`

**The engine does not ship `basis_transcoder.js`.** There is no copy in this repository and the
build does not vendor one. `Texture2D.ktx2TranscoderPath` is a URL the *host* serves, and the
file itself comes from `three/examples/jsm/libs/basis/` — it is three.js's Emscripten build, so
`-s DYNAMIC_EXECUTION=0` is a request to make upstream, not a change the engine can apply.

What the engine can do, and now does, is not pretend otherwise: the `ktx2TranscoderPath`
documentation says where the file comes from. A host that needs a strict CSP has two options
that do not involve the engine — serve a transcoder built without the eval path if one becomes
available upstream, or keep the policy and accept that KTX2 does not transcode, which is what
Virtual Lab chose.

The choice is now visible rather than silent: `textureFormats` will read `RGBA8` for a KTX2
asset that failed to transcode, so a deployment can detect the condition instead of inferring it.

---

## Open, with the investigation recorded

### VL-1 — the streamed path reported ~2.9× the texture VRAM of the ZIP path

**Not reproduced from the engine side.** This is the item the platform most wanted answered, so
the negative result is worth being precise about rather than quiet.

What was tested: the same files, under the same paths, with the same decoder, loaded through a
plain in-memory source and through a `StreamingAssetSource`. Cache entries and estimated VRAM
come out **identical**, and loading one path twice retains one texture, not two. That is pinned
by `tests/SourceVramParity.test.ts`, so if the engine's own machinery ever starts double-counting
by delivery path, a test says so.

So the difference is not in `Resources` plus a source. It is somewhere the harness above them
is: how the scenario asks for its textures on each path, or an object that one path retains and
the other does not.

**What would settle it.** `MemoryReport.renderer` now carries `liveTextures` alongside
`textures`, and the two count deliberately different sets — engine texture objects, uploaded or
not, versus GPU uploads. Re-run the comparison and read both:

- `liveTextures` differs, `textures` matches → the streamed path really is retaining more
  texture objects, and they are ones nothing has drawn. That is a leak, and the count localises
  it.
- `liveTextures` matches too → the same textures are being estimated at different sizes. Then
  `textureFormats` says whether a format differs, and the remaining variable is dimensions.

Either answer names the next place to look, which the previous report could not. If it turns out
to be the first, please send the two `liveTextures` figures back — that is enough to act on.

---

## Note for all three lists

Every entry here was re-checked against the current source before being answered, and five were
already closed. Before acting on an item in one of these files, re-verify it: the engine moves
faster than the lists, and the header of each file already says which build it describes.
