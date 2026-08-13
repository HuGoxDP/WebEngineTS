# Improvement ideas

Things noticed during the audit that are **not defects** — the code does what it says, and
nothing is broken. Kept separate from [`findings.md`](findings.md) so a defect never gets lost
among suggestions, and so "we could also…" never blocks a fix.

Each entry says what it would buy and what it would cost, because an idea without a cost is a
wish. Nothing here is scheduled; the handoff boundary
([`../handoff-boundary.md`](../handoff-boundary.md)) still governs whether
engine work happens at all, and an audit produces defects — improvements queue behind evidence.

| # | Part | Idea | Size |
|---|---|---|---|
| I1 | 1 | Cancellable / inspectable delayed destroy | S, rides on F2 |
| I2 | 1 | `Transform` accessor pairs that avoid the clone-and-write-back dance | M, API addition |
| I3 | — | A host-level diagnostics lock | S, asked for by virtual-lab |
| I4 | — | Report the transcoded GPU texture format | M, asked for by virtual-lab |

---

## I1. Cancellable delayed destroy (Part 1)

**Now.** `EngineObject.Destroy(obj, 2)` schedules a `setTimeout` nothing holds. It cannot be
cancelled, inspected, or made to survive a pause — the last of which is F2.

**Idea.** If F2 is fixed with a per-frame pending list, a handle falls out of it almost free:
`const h = EngineObject.Destroy(obj, 2); h.cancel()`. Unity has no such thing, so this is an
addition rather than parity — which is exactly why it is here and not in `findings.md`.

**Cost.** A returned object where the API currently returns `void`, and a decision about what
happens to pending destroys across a scene change. Do it *with* F2 or not at all; retrofitting
later means touching the same code twice.

## I2. Transform accessors that avoid the clone dance (Part 1)

**Now.** Every vector getter returns a clone, so moving an object reads:

```ts
const p = transform.position;
p.y += 1;
transform.position = p;
```

That matches Unity — `Vector3` is a struct there — and the JSDoc documents it. Not a defect.

**Idea.** Add the mutating helpers Unity also has, so the common cases stop needing the dance:
`translate(x, y, z)` and `rotate(x, y, z)` in local or world space. Unity has both, so this is
parity that is simply missing rather than invention.

**Cost.** Small, but it widens `Transform`, which is already the largest class in `core`. Worth
checking first whether scenario code actually does the dance often — if the ten scenarios barely
reparent or translate imperatively, this buys little.

## I3. A host-level diagnostics lock

**Asked for by** `testv/virtual-lab/docs/upstream/webenginets.md` §4a.

**Now.** `MemoryProfiler.showOverlay()` is callable from scenario code, and one scenario called
it — so the platform's flagship scenario showed students an FPS/VRAM overlay. The platform
worked around it by closing the overlay after load when `?diag=1` is absent, and holds the line
with an E2E test.

**Idea.** `MemoryProfiler.setEnabled(false)` that scenario code cannot override, so a host
embedding content it does not control can say "diagnostics are not available in this
deployment" and have it stick.

**Cost.** Small in code. The real question is what "cannot override" means when a scenario is
arbitrary engine code in the same realm — an honest answer is "a scenario can still reach the
class", so the lock is a policy for well-behaved content, not a sandbox. Worth saying so in the
JSDoc rather than implying a guarantee.

## I4. Report the transcoded GPU texture format

**Asked for by** `testv/virtual-lab/docs/upstream/webenginets.md` §4b.

**Now.** `MemoryReport` carries `estimatedTextureVramBytes` but no format, and `TextureFormat`
is the authoring enum (`RGBA32`, `RGB24`, …) with no compressed GPU formats. So "did KTX2
actually transcode, and to what?" is answerable only by inference — comparing VRAM against what
an uncompressed fallback would give. That works, the gap is ~8×, but it is a proxy.

**Idea.** Carry the resolved format per texture, or a tally (`{ BC7: 3, ETC2: 8, RGBA8: 1 }`).

**Why it is more than a nicety.** It turns the paper's KTX2 claim from an inferred measurement
into an observed one, and it is the only tool a host has for verifying a pipeline whose failure
mode is silent. That makes it the strongest candidate on this page.

**Cost.** Medium. The transcoded format lives on the Three.js texture after `KTX2Loader`
resolves it; surfacing it means a new engine-typed enum (the authoring `TextureFormat` must not
grow GPU formats — they are different things) and a decision about what to report for textures
that never went through a transcoder.
