# Scenario ZIPs (local, not committed)

Drop **built scenario `.zip` archives here** to benchmark the real, textured paper scenes
via `?scenario=…`. The ZIPs are **git-ignored** — they are scenario *content* and belong in
ScenarioCreator, not in the engine repo (which stays engine-only).

## Where to get them

Build them in the sibling **ScenarioCreator** project, then copy the outputs here:

```bash
# in ../../ScenarioCreator
npm run build:all
# copies (from ScenarioCreator/ReleaseScenarios/):
#   Benchscene2_complexmodel.zip   -> the real high-poly GLB model + textures
#   Benchscene3_solarsystem.zip    -> the real Solar System (planets, skybox, textures)
```

Copy the desired `.zip` into this folder, then run:

```
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene3_solarsystem.zip&gpu=low-power
http://localhost:3000/benchmarks/index.html#scenario=/benchmarks/scenarios/Benchscene2_complexmodel.zip
```

The ZIP is self-contained (assets are inside it), so only the ZIP needs to be served — the
harness resolves `"WebEngineTS"` for the scenario's scripts through the page's import map.

`?scenario=` also accepts an absolute URL, so you can point at a separately-served archive
instead of copying it here.
