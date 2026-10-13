# Plan: prefab instances saved as prefab plus changes (E11)

**Status:** **implemented 2026-10-12, Stages 1–10**, one commit per stage (Stage 2 is three, one
per defect). Where the implementation departs from what is written below, the departure is
recorded where it applies: D3, a fourth pre-existing defect (§4.6, Stage 2); the version-2 marker
also covering node-id paths (§5.4, D-2); the Stage 9 refinements; and one limit found in Stage 8
(§11). The open questions in §11 are still the owner's.

*As planned:* commit `7073cfe` (titled "Remove trash") landed the *save* side of this feature and
the pure diff module, but none of the *load* side. At `9ffd1d1`, `tsc -p tsconfig.build.json`
reports 16 errors, all in `SceneSerializer.ts`, and 14 tests fail across three files. Stage 1
restores green without throwing the work away.

This is **E11** in the editor's engine asks (`.claude-shared/PLAN.md` §1.5 item 6;
`WebEngineTSEditor/docs/unity-editor-plan.md` §4), the engine half of the editor's **stage 14**
(prefabs), and the follow-up that `design/unity-parity-plan.md` Stage 4 item 2 deferred: "saving
a variant flattens it … both wait on prefab identity".

Written from the code at `9ffd1d1` and from probes run on a scratch clone with the Stage 1 fixes
applied, not from the commit message. Every behaviour this document calls *verified* was run.

---

## 1. The feature

Unity does not store a prefab instance as a copy. A scene holds a `PrefabInstance` record: which
prefab, plus a list of modifications (property overrides, added objects, added components, removed
components and, since 2022, removed objects). Load rebuilds the instance from the prefab every
time. That is why an edit to the prefab reaches every scene that uses it, while each instance
keeps its own position, name or colour.

`7073cfe` sets out to do the same here. It has four parts.

1. **Node identity.** Every node of a prefab tree has a stable string id
   (`SerializedGameObject.id`, minted by `mintNodeId()`). Live objects remember theirs in
   `GameObject._prefabNodeId`. The root of an instance remembers its link in
   `GameObject._prefabInfo = { source, guid, raw }`.
2. **Prefab plus changes.** `PrefabDiff.compareChanges(prefabTree, instanceTree)` returns
   `PrefabChanges`: value overrides, plus `addedChildren`, `removedChildren`, `addedComponents`
   and `removedComponents`, all addressed by node id. `applyChanges` is its inverse. A nested
   instance is compared as one value: an override with `field: "prefab"` holding its whole link.
3. **Two ways to write an instance.** `SerializeOptions.prefabs` is `"expand"` (default) or
   `"link"`.
   - Expand writes the full tree, plus `prefab: { guid }` on the instance root and `id` on its
     nodes. Reading it needs no prefab.
   - Link writes a *shell* (name, active, transform, id, empty `components` and `children`)
     plus `prefab: { guid, changes }`. Reading it needs the prefab.
4. **Scoped references.** A linked instance is serialized in a context of its own, so a
   reference between two of its objects is the same path as in the prefab file. A reference that
   leaves it carries `scope`: how many enclosing instances out its path is counted from.

## 2. The format

Transforms are elided as `…` below; everything else is the shape the serializer writes.

### 2.1 What is new

Three optional keys, each written only when it means something:

| Key | On | Written when |
|---|---|---|
| `id` | a node | the node belongs to a prefab's tree (§6.1 says exactly which) |
| `prefab` | an instance root | the object is a prefab instance whose prefab has a guid |
| `scope` | a `GameObjectRef` / `ComponentRef` | the reference leaves the linked instance it is written from |

From Stage 6 on, a `path` may also contain **string segments**: node ids (§2.5).

A scene with no prefab instance in it is written **byte for byte as before**. Nothing sets
`_prefabInfo` or `_prefabNodeId` today, so none of these keys can appear. Key order and the
children-before-components walk (which fixes the asset-table order) are unchanged from
`bde23fc` (checked against that commit's `_serializeGO`).

### 2.2 A prefab file

```json
{
  "name": "Tank",
  "version": 2,
  "snapshot": {
    "name": "Tank", "active": true, "transform": …,
    "components": [
      { "type": "Game.Aim", "fields": { "target": { "$type": "GameObjectRef", "path": [0, "k2v0f002"] } } }
    ],
    "children": [
      { "name": "Hull", "active": true, "transform": …, "components": [], "children": [], "id": "k2v0f002" },
      { "name": "Turret", "active": true, "transform": …, "components": [], "children": [], "id": "0uak7004",
        "prefab": { "guid": "guid-turret", "changes": { "overrides": [] } } }
    ],
    "id": "7jixp003"
  }
}
```

- Every node has an id. The nested Turret is a **link**, not a copy: a prefab inside a prefab
  follows its own edits.
- `version: 2` because the file contains a link (§5.4), and — from Stage 6 — because the Aim's
  path holds a node id. A prefab file with neither keeps the `{ name, snapshot }` shape it has
  today.
- A file written before ids existed is read with **legacy ids** derived from position: `~` for
  the root, `~0`, `~1.0` and so on (`PrefabDiff.ensureIds(snapshot, true)`). The same file gets
  the same ids on every load, so an instance saved against one load still matches the next.

### 2.3 A scene, expand mode (the default)

```json
{ "name": "Main", "version": 1, "roots": [
  { "name": "Player", "active": true, "transform": …, "children": [],
    "components": [ { "type": "Game.Aim", "fields": {
      "target": { "$type": "GameObjectRef", "path": [1, 1, 0] } } } ] },
  { "name": "Tank", "active": true, "transform": …, "components": [ … ],
    "children": [
      { "name": "Hull", …, "id": "k2v0f002" },
      { "name": "Turret", …, "children": [ { "name": "Barrel", …, "id": "4xe08002" } ],
        "id": "0uak7004", "prefab": { "guid": "guid-turret" } }
    ],
    "prefab": { "guid": "guid-tank" } }
] }
```

The tree is complete, every reference is a plain path from the scene roots, and there is no
`scope`. A reader that predates all of this sees an ordinary scene and ignores `id` and `prefab`.
`version` stays 1 — unless the scene writes back, as it read them, a placeholder's link or data
whose paths hold node ids (§2.5).

### 2.4 The same scene, link mode

```json
{ "name": "Main", "version": 2, "roots": [
  { "name": "Player", …, "children": [],
    "components": [ { "type": "Game.Aim", "fields": {
      "target": { "$type": "GameObjectRef", "path": [1, "0uak7004", "4xe08002"] } } } ] },
  { "name": "Tank", "active": true, "transform": …, "components": [], "children": [],
    "prefab": { "guid": "guid-tank", "changes": {
      "overrides": [
        { "path": [1], "node": "0uak7004", "component": null, "componentIndex": 0, "field": "prefab",
          "value": { "guid": "guid-turret", "changes": { "overrides": [
            { "path": [0], "node": "4xe08002", "component": "Game.Aim", "componentIndex": 0,
              "field": "target", "value": { "$type": "GameObjectRef", "path": [0], "scope": 2 } } ] } } }
      ],
      "addedChildren": [
        { "parent": "7jixp003", "index": 2, "node": { "name": "Flag", …, "id": "6o3xj006" } } ],
      "addedComponents": [
        { "node": "k2v0f002", "index": 0, "component": { "type": "Game.Aim", "fields": {
          "target": { "$type": "GameObjectRef", "path": [0] } } } } ]
    } } }
] }
```

How to read the references:

- **`scope: 2`.** The Barrel, inside Turret inside Tank, points out to the scene root Player. It
  is counted from two contexts out (§6.1).
- **`[0]` inside `addedComponents`, with no scope.** It points at the Tank instance root, counted
  from the instance itself.
- **Player's `[1, "0uak7004", "4xe08002"]`.** It goes from the scene *into* the nested instance:
  root 1 by position (this file defines the scene's roots), then Turret and Barrel by id (a prefab
  defines those). Until Stage 6 the writer produces `[1, 1, 0]` here, which is what the WIP does
  today.
- `removedChildren: ["<id>"]` and `removedComponents: [{ node, component, componentIndex }]` are
  the two shapes not shown. `unused` (§7.2) is the third.

`Turret` in the example is overridden as one whole-link value. Stage 10 replaces that with
per-field overrides addressed through the nesting. The whole-link form stays readable.

### 2.5 Path segments

A path is read left to right from a starting set of roots:

- **The first segment** is a number: the index into those roots.
- **A later number** is a child index.
- **A later string** is a node id, looked up among the current node's descendants without
  entering a nested instance. The nested instance's own root is checked, since its id belongs to
  the outer prefab; its interior is not, since its ids belong to another prefab and may repeat
  (two Turrets inside one Tank have identical interiors).

Ids are encoded only in link contexts (§6.1); expand mode never turns a reference into a string
segment. *Corrected after review:* it does write back, as it read them, three things that can
hold them — a placeholder's link (§2.6), the data of an unknown component or value (§6.4, which
a legacy prefab file has rewritten to ids, §5.2), and changes kept as `unused` (§7.2). A scene
that holds one of them is version 2 (§5.4), so an expand file is readable by every engine build
only when it holds none of them.

### 2.6 An instance whose prefab is missing

The object is rebuilt from the shell: name, active, transform, id, no components, no children.
`_prefabInfo.raw` keeps the link verbatim, and the writer puts it back verbatim, in either mode.
This is the same contract `MissingComponent` keeps for an unknown type (E6): opening and saving a
file must not delete what it stood for.

### 2.7 A variant file (Stage 8)

```json
{ "name": "Elite Tank", "version": 2, "base": "guid-tank", "changes": { "overrides": [ … ] } }
```

A variant whose base has no guid has nothing to name it by, so it is still flattened to
`{ name, snapshot }`, as today.

## 3. What exists at HEAD

Read in full at `9ffd1d1`. The WIP is coherent; it is unfinished, not wrong.

- **`PrefabOverride.ts`: complete and self-consistent.**
  - The types: `PrefabOverride.node`, `PrefabAddedChild`, `PrefabAddedComponent`,
    `PrefabRemovedComponent`, `PrefabChanges`, `SerializedPrefabLink`, `PrefabInstanceInfo`.
  - `PrefabSource`, which is duck-typed on purpose to keep the `Prefab` → `SceneSerializer` import
    loop broken.
  - `mintNodeId()`, `ensureIds()`, `_index()`.
  - `compareChanges`: nodes matched by id, with a positional fallback when the prefab has none.
  - `applyChanges`: values first; then removed components, highest index first; then removed
    children; then added components and children, lowest index first. A change addressed to a
    node the prefab no longer has is skipped.
  - `compare` and `apply` are kept as wrappers, so the existing 16 override and variant tests
    still pass.
- **`ValueSerializer.ts`: complete on its side.**
  - `SerializeContext.locate?()`, `RefScope`, `DeserializeContext.scopeStack`, and `ref: RefScope`
    on both pending lists.
  - `scope` is written only when it is above 0, and `_scopeOf` reads it back.
- **`SceneSerializer.ts`: the save side is complete; nothing on the load side is written.**
  - `SerializedGameObject.id` and `.prefab`, `SerializeOptions`, and `_serializeForPrefab` (root
    expanded, nested instances as links).
  - `_buildSerializeCtx(roots, link, outer)`. A nested pass shares the outer pass's asset table
    and inline map, and its `locate` walks out through the chain.
  - `_serializeGO`, which chooses per object: placeholder, plain, expand or link.
  - `_serializeInstance`, `_serializeShell`, `_serializeNode`, `_prefabGuid`, `_prefabSourceOf`,
    and `_prefabById`, which is duck-typed.
- **`GameObject.ts`.**
  - The internal fields `_prefabInfo` and `_prefabNodeId`.
  - Public `isPrefabInstance`, `prefabSource`, `prefabNodeId` and `unpackPrefab(completely)`.
  - `_clone` (`Instantiate`) now goes straight through the serializer instead of through a
    throwaway `Prefab`. That is what will let a copy of an instance stay an instance of the same
    prefab.

## 4. What is missing, and why it matters

1. **The load side, all of it.** `_deserializeGO` reads name, active, transform, components and
   children, and ignores `id` and `prefab`. Nothing pushes or pops `scopeStack`, and
   `_resolveRefs` never reads `ref.ref`. *Verified:* a nested instance inside a prefab made with
   `_serializeForPrefab` comes back from `instantiate()` as an empty shell (0 children,
   0 components). An expand-mode instance loses its link on every round trip: undo, Play
   restore, clipboard.
2. **`Prefab` is untouched.**
   - It has no `_resolvedTree()`, so it does not satisfy `PrefabSource`, and nothing ever stamps
     `_prefabInfo`.
   - `fromGameObject` mints no ids, and `fromJSON` does not upgrade legacy files.
   - `getOverrides` serializes the instance with `serializeGameObject`. Once an instance carries a
     guid, that reports a spurious `{ field: "prefab", value: { guid } }` override on every
     untouched instance.
3. **`assetReferences` does not list prefab guids**, although the `SerializeOptions` JSDoc says
   it does. So nothing preloads a nested prefab.
4. **None of the new types are exported** from `index.ts`, so a consumer cannot name the return
   type of `compareChanges`.
5. **No tests and no docs.** The commit touches no test file and has no CHANGELOG entry. Two
   texts are now stale: `unity-parity-plan.md` Stage 4 ("structural changes are not overrides",
   "prefabs have no ids yet") and the `_createGameObject` JSDoc ("`_clone` round-trips through
   `Prefab`").
6. **Four defects that exist without this feature**, all verified at HEAD with the Stage 1
   fixes applied, and all in this feature's path (D3 was found while Stage 1 was written):
   - **D1 — a destroyed child stays in its parent's child list, and is saved.**
     `GameObject.onDestroy` ends in `Transform.onDestroy`, which removes only the Three.js object.
     `Transform._children` still holds the dead transform. After `child.destroyImmediate()`,
     `parent.transform.childCount` is still 1, and `serializeGameObject(parent).children` is
     still `["C"]`. Deferred `destroy()` ends in the same `onDestroy`.
     - The editor deletes with `destroyImmediate` (`scene.service.ts:45`), so **a deleted child
       comes back, without its components, on the next save or undo.**
     - For E11, a child removed from an instance never reads as removed. It reads as a node whose
       components were all removed.
   - **D2 — an inline asset loses its table entry on the second save.**
     - A scene with a code-built material saves it into `assets`. Loading binds its guid. The
       next save finds the guid, writes a bare `AssetRef`, and no longer emits the table
       (`first.assets = 1`, `second.assets` absent). Reopened in a fresh session, the material is
       pending forever. That reaches editor autosave today.
   - **D2b — the same root causes a false override.** An untouched instance of a prefab with an
     inline material reports `MeshRenderer.sharedMaterial` as overridden. The instance writes
     `path: "inline:StandardMaterial:0:0.65…"`, a pseudo-path minted by `guidForPath`, while the
     prefab tree has none. Every linked instance would store that override and stop following
     the prefab's material.
   - **D3 — a child loads displaced when its parent is away from the origin.** `_deserializeGO`
     set a child's local pose while it was still a root, then parented it with
     `transform.parent = t`, which keeps the *world* pose. The parent's pose was subtracted from
     the child's: a child at local `(0, 0.5, 0)` under a parent at `(1, 2, 3)` loaded at
     `(-1, -1.5, -3)`. Every load, undo and `Instantiate` of such a hierarchy did this, as far back
     as `bde23fc`. For E11 it is fatal: a link-mode shell sets the instance root's pose before its
     children are built. Found by the Stage 1 golden test, which had to keep its parent at the
     origin until the fix.

## 5. Backward compatibility

### 5.1 Old scenes load exactly as before

**How it is guaranteed.** An old file has no `id`, no `prefab` and no `scope`.

- With no `prefab.changes` anywhere, the reader never pushes a scope, so every pending reference
  is recorded as `{ stack: [], scope: 0 }`.
- `_resolveRefs` resolves `scope === stack.length` against the load roots, and `0 === 0`. The
  lookup itself is `_lookupByPath(roots, path)` on an all-number path: the same code, with the
  same input, as before.
- With no `id` or `prefab`, `_prefabNodeId` and `_prefabInfo` stay null. The writer then takes
  the plain branch, so the output is byte-identical.

**How it is tested.**

- The 14 tests that HEAD breaks are exactly the old-format reference round trips. Restoring them
  is Stage 1.
- `MissingComponent.test.ts` loads a hand-written old-format scene, and asserts that a reference
  is written back with no `scope` key.
- Stage 1 adds a golden test: a fixed old-format snapshot with a `GameObjectRef`, a
  `ComponentRef` and a `Nested` value, loaded and saved, must deep-equal the input. Stage 3
  repeats it for a whole scene, inline asset table included, which D2 makes possible.

### 5.2 Old prefab files

`Prefab.fromJSON` gives an id-less snapshot legacy ids. From Stage 6 it also rewrites the file's
positional internal references into id form (§6.3). Both are deterministic, so two loads of the
same file agree. Pinned by "a prefab file without ids gets the same ids on every load".

### 5.3 Asset files

`.mat.json` and `.physicmat.json` are written by `serializeAsset`, which has no instances and no
roots, so nothing here changes them.

That entry point is also where HEAD crashes. *Verified:* with `outer` left undefined, `locate`
reads `undefined.goToPath`, so any asset with an object-valued field throws. Fixed in Stage 1 and
pinned by a test.

### 5.4 Files a reader must refuse rather than misread

A link-mode file read by an engine without the link reader loads hollow and is silently wrong:

- instance roots come back with no components and no children;
- `scope` is ignored, so references resolve from the wrong root;
- string path segments are read as child indices.

**Decision: a scene or prefab file that contains at least one link, or at least one reference
path with a node id in it, is written with `version: 2`; one with neither keeps `version: 1` and
its exact bytes.**

*Refined while implementing Stage 7.* The plan first said "a link" alone. Stage 6 makes every
prefab file's internal references id paths, and a link-mode scene whose instances all fell back
to expand can still hold id paths into them. Neither contains a link, yet both are misread by an
older reader exactly as the third bullet above says. The marker therefore follows what an older
reader would misread, not only links. An ordinary scene saved in the default mode has neither,
so the byte-for-byte promise for it is unchanged. *Corrected after review:* a default-mode save is
still version 2 when it writes back verbatim what holds a link or an id path (§2.5) — so the
editor can meet version 2 before it opts into link mode, as soon as it loads a placeholder or a
legacy prefab whose unknown component holds a reference (§11).

- The reader accepts 1 and 2 (absent means 1) and refuses anything higher with an error that
  names the version.
- That cannot protect an engine that already shipped, because `deserializeScene` has never
  checked versions. Two things limit the exposure:
  - the editor's `_loadSceneText` already refuses any version except 1;
  - link mode is opt-in, and only the editor's file save will use it (§8, D-1).

  Before the editor turns it on, every place that loads its scenes has to be on a release that
  reads version 2. That includes virtual-lab, which runs exported scenarios on its own engine
  (§11).

## 6. Algorithms

### 6.1 Serialize

**Contexts.** The writer's context is the module-private `SceneCtx`. It is the WIP's own type,
which it used and never declared:

```ts
interface SceneCtx extends SerializeContext {
    readonly link: boolean;                 // write instances as links
    readonly outer: SceneCtx | null;        // the pass this one is nested in
    readonly inlined: Map<object, string>;  // inline assets already written, shared with outer
    assetTable: SerializedAsset[];          // shared with outer
    locate(go: GameObject): { path: number[]; scope: number } | null;
}
```

The passes nest in a fixed way:

- `serializeScene` and `serializeGameObject` open a root context (`outer = null`) whose roots are
  the scene roots, or `[go]`.
- `_serializeInstance` opens a child context whose roots are `[instanceRoot]`, with
  `outer = the current context`.

**Locate and scope.** `locate(go)` walks outward from the current context. It returns the first
context whose `goToPath` has `go`, as `{ path, scope: levelsWalked }`, or null if no context has
it. So:

- **Inside a linked instance**, a reference to one of its own objects is `scope` 0, a path from
  the instance root. That is the same path the prefab file has, so it compares equal.
- **Out of an instance**, a reference is `scope` k: k contexts out. That may be the scene, or an
  instance enclosing this one. Scopes are relative, so a link stored inside a prefab file stays
  valid when that prefab is itself nested in a scene.
- **Into an instance from outside**, a reference is an ordinary path in the outer context that
  happens to run into the instance's subtree. It is resolved after the instance has been rebuilt
  (§6.2).
- **Out of the saved subtree.** If no context has the target, `locate` returns null and the
  reference is written as `null`. This is the existing rule, and it is also why a prefab cannot
  hold a scene reference.

**Choosing per object (`_serializeGO`), in order:**

1. **Not an instance**, or the root of `_serializeForPrefab`: write the node.
2. **A placeholder** (`raw` set): write the shell plus the raw link, verbatim. *New:* if objects
   were added under it, warn, because the format cannot hold them (§7.1).
3. **No guid** (a prefab made in code and never saved): write the node, with no link.
4. **Expand mode**, or the prefab is not in memory: write the node plus `prefab: { guid }`, plus
   `unused` if any (§7.2).
5. **Link mode**: `_serializeInstance`. Before diffing:
   - **Mint ids.** Each node in the instance's own namespace that has no `_prefabNodeId` gets
     one on the *live* object. These are the added nodes. *Decided:* without this, every save
     mints fresh random ids for added children (`compareChanges` mints on its snapshot and
     throws them away), so autosave and version control churn. *Corrected after review:* the
     ids are minted in one pass over every root, into every instance that will be written as a
     link, **before anything is written** (`_mintAll`). Minted when the walk reached the
     instance, they came too late for a reference written earlier — an earlier root, or an
     earlier sibling — which then fell back to a child index: saving twice wrote two different
     files, and a later prefab edit could misdirect the first.
   - **Check the shape.** If the instance did something `PrefabChanges` cannot express (a
     reorder, a reparent, or a duplicated id, §7.3), warn and fall back to step 4 for this one
     instance. Nothing is lost; the instance just stops following prefab edits until it is
     reverted.
   - **Diff.** Serialize the instance in its own context, then
     `compareChanges(source._resolvedTree(), expanded)`. Drop the root's `name`,
     `transform.position` and `transform.rotation` overrides, since the shell carries them
     (§7.4). Add `unused`. Write the shell plus `prefab: { guid, changes }`.

**Which nodes carry an `id`.** Write `id(N)` when, within the tree being written, there is an
instance root strictly above N. `_serializeForPrefab` treats its own root as such an instance root.

- That gives the whole scene's ids in `serializeScene`.
- It gives an instance root's interior in `serializeGameObject(instanceRoot)`.
- It gives **no** ids for `serializeGameObject(innerNode)`. A copy of a node from inside an
  instance (Duplicate, paste, `Instantiate`) is therefore a plain object. Unity calls that an
  *added* object, and it cannot collide with the node it was copied from.

**Ids in paths (Stage 6), link contexts only.** Walk the positional path from the context root to
the target:

- every hop up to and including the first instance root is written as a number;
- after that, each namespace on the way contributes one string: the id of the last node on the
  path that belongs to it;
- a hop to a node with no id is written as its child index.

`_serializeForPrefab` pre-mints ids for the new prefab's nodes in a side map, without touching
the source object, so the prefab file's own internal references are written by id too. The same
pass mints the added nodes of every instance nested inside it. The
prefab file and the instance's own context must encode references the same way. Otherwise every
untouched reference would read as an override.

**Assets (Stage 7).** A linked instance's context gets its own asset table. After the diff, only
entries that are referenced from `changes` and that the prefab tree's own `assets` does not carry
are copied into the outer table.

Otherwise the scene would carry a copy of every inline material the prefab owns. Worse,
`_materializeAssets` keeps whichever copy of a guid is bound first, so a stale scene copy could
shadow an edited prefab.

*Corrected after review:* the D2 fix (Stage 2) made **expand** mode do exactly that. An instance's
material rebuilt from the prefab's table is bound under the table's id, and D2 writes every asset
with no file "under the id it already has", so a scene saved in full carried a copy under the
prefab's own id. In a new session, whichever file was read first decided what that id was: a
scene opened before an edited prefab handed every new instance of the prefab the scene's stale
copy, and the other order handed the scene's instance the prefab's. The rule is now that **a
table that is not a prefab's never names an asset by an id a prefab's table uses.**

- `Prefab` records the ids of its tree's `assets` (`SceneSerializer._claimPrefabAssets`), for a
  tree it is made with, reads from a file or takes in `applyInstance`.
- Passes that write a prefab's tree or an instance compared with one (`SceneCtx.prefabIds`:
  `_serializeForPrefab` and every linked instance's own pass) keep the prefab's id, so an
  untouched instance still compares equal. Any other table — a scene's, a snapshot's, an asset
  file's — writes such an asset under an id of its own, kept for the asset so that saving twice
  writes the same file (`_tableGuidOf`). `_carryAssets` renames the same way when a linked
  instance's changes take another prefab's material up into the scene.
- Within the session that wrote it, that id also finds the prefab's asset
  (`AssetDatabase._bindAlias`, dropped with the asset by `_unbind`), so `Instantiate`, undo and
  Play restore still share the prefab's material instead of building a copy, as they did before.
  In a new session it names the scene's copy alone.

### 6.2 Deserialize

`DeserializeContext.scopeStack` holds the instances being rebuilt **as links**, outermost first.
Each entry matches exactly one `SceneCtx` the writer opened in `_serializeInstance`. Expanded
instances are not pushed, because the writer opened no context for them.

**`_deserializeGO(json)`:**

1. **`json.prefab` has `changes`.** Rebuild the instance as a link:
   1. **Cycle check.** If `guid` is already on the chain (the guids of the `scopeStack` entries,
      seeded with the prefab's own guid by `Prefab.instantiate`), make a placeholder and warn.
   2. **Find the prefab.** `source = _prefabById(guid)`. If it is missing, or its
      `_resolvedTree()` throws (a variant with no base loaded), make a placeholder from the
      shell, keep `raw` and warn.
   3. **Apply the changes.** `tree = applyChanges(source._resolvedTree(), changes ∪ unused)`.
      Whatever is addressed to a node the tree lacks goes to `_prefabInfo.unused` (§7.2).
   4. `_materializeAssets(tree.assets)`.
   5. **Create the object.**
      - Name, position and rotation come from the shell. Active and scale come from the tree
        (§7.4).
      - `_prefabNodeId` comes from the shell's `id`: null at top level, or the id in the
        enclosing prefab. **It never comes from the tree's root id.**
      - `_prefabInfo` is set now, so the cycle check below this object can see the guid.
   6. **Build the contents.** Push the object, build components and then children from `tree`
      (nested links recurse into step 1), and pop.
2. **Otherwise**, build as today. Then set `_prefabNodeId = json.id ?? null`. If `json.prefab`
   exists, set `_prefabInfo = { source: _prefabById(guid), guid, raw: null, unused }`.

**Reading a reference.** `ValueSerializer._scopeOf` snapshots `{ stack: scopeStack.slice(), scope }`
into the pending record. It reads `scope` as 0 when it is absent, not a number, or not above 0.

*Decided:* `scopeStack` becomes **optional** in the exported `DeserializeContext`, and `_scopeOf`
treats a missing stack as empty. The type is public (`index.ts:81`), and `ValueSerializer.deserialize`
takes a caller's context. Requiring the field broke every such caller at compile time, and crashed
them at run time, which is exactly the 14 failures.

**The deferred pass (`_resolveRefs`).** It runs once, after every object exists. For each pending
reference, with `{ stack, scope } = ref.ref`:

- `scope < stack.length`: resolve against `[stack[stack.length - 1 - scope]]`;
- `scope === stack.length`: resolve against the load roots;
- `scope > stack.length`: resolve to null. This is a malformed file; it does not throw.

Then `_lookupByPath` walks the path (§2.5). For a component reference it then looks up the
`index`-th component of that type, as today. A reference from outside into an instance works
because this pass runs only after every instance has been rebuilt.

### 6.3 With `PrefabDiff`

The diff stays pure: JSON in, JSON out. Five changes to it:

- **`_index`, `ensureIds` and the positional fallback do not descend below a node that carries
  `prefab`.** In a tree written by `_serializeForPrefab`, such a node is a link shell anyway. In a
  legacy or expanded tree, the interior belongs to another namespace, where legacy `~0` ids repeat.
- **A new pure `PrefabDiff.unused(tree, changes)`.** It returns the overrides, added children and
  added components addressed to node ids that the tree lacks. Removals of nodes that no longer
  exist are moot and are dropped.
- **A new pure `PrefabDiff.inexpressible(tree, instance)`.** It returns the reason, or null: a
  prefab node found under a different parent, matched children out of their prefab order, matched
  components out of their prefab order, or a prefab id that appears twice.
- **`ensureIds(snapshot, true)` also rewrites a legacy file's positional references** (every
  `GameObjectRef` and `ComponentRef` with no scope, in component fields, nested values and
  `MissingComponent` data). A path `[0, a, b]` becomes `[0, "~a.b"]` (Stage 6).
- **Nested instances are compared field by field** when both sides link the same guid. The
  override's `node` becomes an id chain (`"0uak7004/4xe08002"`), and `applyChanges` composes
  through the nesting. Whole-link overrides are still applied when read (Stage 10).

`getOverrides` and every future "is this modified?" query compare the prefab's `_resolvedTree()`
with `_serializeForPrefab(instance)`, never with `serializeGameObject(instance)`. Only
`_serializeForPrefab` writes the root expanded and the nested instances as links, which is the
shape the prefab itself has.

*Corrected after review:* an object whose own nodes have **no ids at all** — one loaded from a
file written before ids, a copy `Instantiate` made before them, or the object a prefab was made
from without `connect` — is compared **by position**, as every object was at `bde23fc`. Minting
fresh ids for it, as the first implementation did, matched none of the prefab's: every child
read as added, every internal reference as an override, and a variant built from
`getOverrides` lost both. `_serializeForPrefab(go, { match })` therefore gives such an object the
prefab's ids at the same places before writing it (stored on the objects only by `getChanges`,
which maps ids to live objects), and `compareChanges`, given an id-less snapshot directly, does
the same to a copy of it and rewrites its positional references to those ids.

### 6.4 With `MissingComponent` (E6)

Unknown data is carried as data. Prefabs do not change that.

- **An unknown component in a prefab** becomes a `MissingComponent` in each instance. It is
  written back as `{ type: originalType, fields: originalFields }`, which equals the prefab tree,
  so it reports no override.
- **An override on an unknown component's field** is applied to the JSON before the placeholder
  is built. The placeholder then holds the overridden fields, writes them back, and the next diff
  produces the same override.
- **An added component of an unknown type** stays a `MissingComponent`, and stays an added
  component.
- **A reference *to* one** round-trips by its original type name (`_typeNameOf`), as it does
  today.
- **References *held by* one** are kept as raw JSON. That includes their `scope` and id segments,
  which are relative to the context they were read in. They go stale if that data is copied into
  another context. This is the same documented limit `MissingComponent` already has for
  reordering.
- **A missing *prefab*** is the same contract one level up: the placeholder plus `raw` (§2.6).

## 7. Edge cases

### 7.1 An instance whose prefab asset is missing

The object is a placeholder, and the link is written back verbatim (§2.6). Three decided limits:

- **References into its absent subtree**, or to a component of the placeholder itself (it has
  none), resolve to null, and are lost if the scene is saved while the prefab is missing. The
  loader warns, naming each holder and field. *Corrected after review:* a component reference
  onto the placeholder root was resolved to null with no warning, because the object it names
  exists; it now warns like the rest. Keeping them would
  need a side table, mapping each holder and field to the raw reference, that the writer
  consults. That mechanism has no other use. Preloading (Stage 7) makes the state rare, and the
  editor can show it (`isPrefabAssetMissing`, Stage 9) before a save.
- **Objects or components added under a placeholder** cannot be expressed: a shell has no node
  ids to hang them on. The writer warns. Unity does not allow restructuring a missing-prefab
  instance either; the editor's stage 14 should block it.
- **No late rebuild.** Load the prefab, then reload the scene. That is `MissingComponent`'s model
  ("loading the same scene again produces the real component").

### 7.2 A change pointing at a removed child

The prefab is edited after an instance was saved, and the node an override, added child or added
component was addressed to is gone. `applyChanges` skips it, as the WIP already does.
*Decided:* it is **kept, not dropped**.

- `PrefabDiff.unused` collects it into `_prefabInfo.unused`.
- It is written back as `prefab.unused` in both modes. On the next load it is tried again, so it
  applies once more if the prefab gets the node back.
- The loader warns with the count.

A child the user added under a node the prefab later removed is the user's work. This is Unity's
"unused overrides", which Unity likewise keeps until someone removes them (Stage 9 adds that
removal).

### 7.3 Sibling order

**The order of the instance's own siblings** is a position in the file, so it is written as it
is.

**Order inside an instance** follows the prefab:

- An added child carries its own `index`.
- `compareChanges` matches children by id, so a reorder of the prefab's own children has no
  representation.
- Unity forbids it: "Children of a Prefab instance cannot be deleted or moved, and components
  cannot be reordered" (deletion has been allowed since 2022).

*Decided:* `inexpressible` detects a reorder, a reparent, or a component reorder. That instance is
then written expanded, with a warning, instead of being silently normalized. The editor should
refuse the operation the way Unity does.

*Corrected after review:* an instance written expanded **inside a linked one** was lost. The
outer prefab keeps it as a link — a shell with nothing under it — so the outer diff recorded a
whole-link override `{ guid }`, which carries no subtree, and compared no children against the
empty shell: the nested instance came back empty. `compareChanges` now records such a node as
**removed and added again under the same id** (`addedChildren` carries the whole expanded
node), which `applyChanges` rebuilds exactly. Where the node cannot be named by id — inside a
nested instance the outer prefab itself holds expanded, compared by position — the outer
instance falls back to expanded as well (`_dropsContents`), with a warning. The same replacement
is what `getChanges`, `createVariant` and `Prefab.fromGameObject` of an object holding such an
instance record.

### 7.4 Two sources of truth for the root

In link mode the shell holds name, active and transform, and `changes` can hold root overrides of
the same fields. *Decided:*

- **The shell wins for name, position and rotation.** Those are Unity's *default overrides*,
  which never follow the prefab.
- **Active and scale come from the tree:** the prefab plus root overrides. The writer drops the
  three redundant root overrides and keeps the others.

So a prefab edit to the root's scale reaches an instance that did not override it, as in Unity.

### 7.5 The same prefab nested twice

The two nested roots are two different nodes of the outer prefab, so they get different ids in
its namespace. Their interiors have identical ids, but `_index` and the path lookup never enter a
nested interior, so the ids do not collide.

This is also why an instance root's `_prefabNodeId` is never the prefab's own root id (§6.2,
step 1.5): both nested roots would carry the same one.

### 7.6 A reference from an outer object into a nested instance

Player → Barrel, in §2.4.

- In expand mode it is a scene path.
- In link mode it is the root index, then ids.
- It resolves in the deferred pass against the load roots, after Tank and its Turret have both
  been rebuilt.
- From Stage 6 on, it survives the Tank prefab gaining a child in front of Turret. A positional
  path would have silently retargeted it.

### 7.7 Positional references and shape changes (the reason for Stage 6)

*Verified.* Take a prefab whose root aims at its second child, and an instance that removed the
first child. Diffing them reports the untouched `target` field as an override, because its path
moved from `[0,1]` to `[0,0]`.

With positional paths, any removal or insertion inside an instance turns every later reference
into an override. That makes those fields read as modified and freezes them against prefab
edits. A later prefab edit then retargets the frozen ones silently. Unity addresses these objects
by fileID, which never shifts. Node ids are this engine's fileIDs.

### 7.8 Cycles

A prefab that contains itself, directly or through others, is guarded in three places:

- **The reader** checks the guid chain (§6.2).
- **`decodePrefab` preloading.** `Resources` dedupes in-flight loads, so a cycle would await its
  own promise and hang. Guids being decoded are tracked and skipped with a warning.
  *Corrected after review:* the guids were one set shared by every load, so any prefab some
  *other* caller was still decoding read as a cycle: loading a Tank while a Turret load waited
  on its material skipped the Turret with a false warning, and the Tank's Turret came back a
  placeholder. Each decode now records which files it is waiting on (`AssetFiles`'
  `decoding`), and a reference is skipped only when waiting on it would wait, through that
  graph, on the file being decoded. Any other in-flight load is awaited.
- **`Prefab.applyInstance`** refuses an instance that contains its own prefab. That is the only
  authoring path that can create a cycle; a new prefab has no guid for anything to point back to.

### 7.9 A prefab with no guid

The link cannot be written, because there is nothing to name the prefab by. The instance is saved
as a plain tree, as today. *Decided, not fixed.* A session-only guid would let undo keep the link,
but it would put ids into files that no other session can resolve. The editor writes the prefab
file before it makes instances, so it never hits this.

### 7.10 `unpackPrefab` on a nested instance

Unpacking a nested instance would clear its id in the outer prefab, and the outer instance would
then read as "removed plus added". Unity's `UnpackPrefabInstance` only accepts an outermost
instance root. *Decided:* unpacking a nested root throws, and the error names the outermost root.

## 8. Decisions

These resolve the open questions both analyses raised. Each says why.

| # | Question | Decision | Why |
|---|---|---|---|
| D-1 | Who writes link mode? | **Opt-in, forever.** Only the editor's file save passes `{ prefabs: "link" }`. Undo, Play, autosave, clipboard and `Instantiate` stay on expand, and the engine default stays expand. | Expand is self-contained and synchronous to read, which every in-memory caller needs. A link is a property of a file on disk, so the caller that writes files opts in. |
| D-2 | Mark link files? | **`version: 2`** on scene and prefab files that contain a link or a node-id reference path. Readers accept 1 and 2 and refuse higher. Files with neither stay `version: 1`, byte for byte. | A hollow load, or a reference followed to the wrong object, is silent data loss. The marker makes at least the editor, and every future engine, refuse instead. (§5.4; refined in Stage 7 to cover id paths.) |
| D-3 | Missing prefab | Placeholder from the shell, `raw` kept and written back verbatim, a warning, and `isPrefabAssetMissing` (Stage 9). No late rebuild. | The E6 contract one level up (§7.1). |
| D-4 | What does `assetReferences` list? | Prefabs **needed to rebuild**: links with `changes`, link values in `field: "prefab"` overrides, a variant's `base`. Not expand-mode `{ guid }` markers. | Its JSDoc defines the answer as "what a loader has to have in memory before it rebuilds one". An expand instance is complete, and `prefabSource` resolves lazily once the prefab arrives. |
| D-5 | Id-based addressing? | **Yes, before link mode is announced.** String path segments, written in link contexts only (§2.5, §6.1). | Positional paths turn shape changes into spurious overrides and silently retarget after prefab edits (§7.7). Doing it before the format is frozen costs nothing in compatibility; doing it after means two encodings forever. |
| D-6 | Per-field overrides through nesting | **Yes, as Stage 10**, after link mode ships. The whole-link override stays readable. | The whole-link form rebuilds correctly. It only stops an outer prefab's later edits to a nested instance from reaching an outer instance that touched it. The change is additive, so it does not hold the format. |
| D-7 | An instance root's `_prefabNodeId` | **null at top level; its id in the enclosing prefab when nested; never the prefab's own root id.** | The same prefab nested twice would otherwise put two equal ids into one namespace (§7.5). |
| D-8 | Variant format | **`{ name, version: 2, base, changes }`** with full `PrefabChanges`, written when the base has a guid. A variant whose base has none is flattened, as today. | E5 gave prefabs guids, which is what the deferral in `unity-parity-plan.md` Stage 4 waited for. Shape changes are as much a variant's business as an instance's. |
| D-9 | The pre-existing defects | **Fixed first**, one patch each: D1 (a destroyed child), D2 (inline asset identity, which also removes D2b) and D3 (a child's local pose on load). | Each one corrupts what this feature reads or writes. One concern per patch keeps them reviewable and revertible. |
| D-10 | Copies of nodes inside an instance | **They drop the ids of every namespace not wholly inside the copy** (§6.1). A copy of an instance root keeps the link and its interior ids. | Unity: a duplicate of an inner node is an added object. It also makes duplicate ids impossible by construction rather than by checking. |
| D-11 | Does `Instantiate` keep the link? | **Yes**, as the WIP does. | Duplicate and paste in the editor use the same snapshot path and must keep it. A runtime that never asks loses nothing. Unity's player has no prefab connection at all, so there is nothing to diverge from at run time. |
| D-12 | `DeserializeContext.scopeStack` | **Optional**, defaulting to empty. | The exported type must not break callers, and a missing stack *is* the old behaviour. |
| D-13 | Shell versus tree at the root | Shell for name, position and rotation; tree for active and scale. | §7.4 |
| D-14 | Changes that no longer apply | Kept as `unused`. | §7.2 |
| D-15 | Reorder or reparent inside an instance | That instance falls back to expand, with a warning. | §7.3 |

## 9. Stages

Each stage leaves `tsc` (build and test configs) clean and every test passing, and lands with its
own tests. Link mode is not announced in the CHANGELOG, and is not meant for files on disk, until
Stage 7 completes its format. Between stages it only writes what the stage's tests read back.

**Ordering note.** Per `ENGINE-GAPS.md` ("How to use this file", rule 4), if a benchmark campaign
is in flight when D1 or D2 is ready, hold them: they change behaviour.

### Stage 1 — Restore green

Finish what `7073cfe` started, with no new behaviour. `.claude/settings.json` (added in the same
commit) runs a typecheck at every Stop, so this goes first.

The 16 compile errors, all in `src/engine/core/serialization/SceneSerializer.ts`, as
`tsc -p tsconfig.build.json` prints them:

| At | Error | Cause | Fix |
|---|---|---|---|
| 298:37 | TS2554 *Expected 3 arguments, but got 1* | `serializeAsset` calls `_buildSerializeCtx([])`. The signature gained `link` and `outer` and this call site was missed. At run time `outer` is undefined, `locate` reads `undefined.goToPath`, and any asset with an object-valued field throws. | `_buildSerializeCtx([], false, null)` |
| 376:15 | TS2741 *Property 'scopeStack' is missing* | `DeserializeContext` gained `scopeStack`, and `_newContext()`, the only place that builds one, was not updated. This is also the run-time cause of all 14 failures: `_scopeOf` calls `ctx.scopeStack.slice()` for every reference it reads. | `scopeStack: []` in `_newContext()`. Also make the field optional and default it in `_scopeOf` (D-12). |
| 400:16, 401:8, 416:32, 418:20, 425:29, 497:54, 535:16, 567:56 | TS2304 *Cannot find name 'SceneCtx'* (8) | Used throughout and never declared. | Declare the module-private interface of §6.1 after the imports. It is not exported, so the `.d.ts` does not change. |
| 423:22, 432:33, 433:30, 433:37, 443:27, 461:27 | TS7006 *implicit any*: `go`, `component`, `owner`, `component`, `value`, `asset` (6) | A cascade of the missing type: the literal annotated `SceneCtx` gets no contextual type, so its arrow parameters are untyped. | None. They go away with `SceneCtx`. |

Also in this stage, the `_createGameObject` JSDoc: `_clone` now reaches this module directly, not
through `Prefab`.

The 14 failing tests, all of which must pass again:

- `tests/Serialization.test.ts`, *SceneSerializer — GameObject cross-references (Phase 11b)*:
  - scene round-trip preserves a sibling GameObject reference;
  - reference to a child GameObject round-trips.
- `tests/Serialization.test.ts`, *SceneSerializer — component references*:
  - a ScrollRect keeps pointing at its content after a round trip;
  - a Selectable keeps its target graphic;
  - a Toggle keeps its group, so radio behaviour survives a load;
  - the right one is picked when a GameObject carries two of a type;
  - an array of component references round-trips;
  - an untyped component field is a reference, not a null GameObject;
  - a LODGroup round-trips its levels and their renderers;
  - a level with several renderers keeps all of them, in order;
  - a whole scene keeps references that cross between roots.
- `tests/CinemachinePostSerialization.test.ts`, *Cinemachine components*:
  - a virtual camera keeps its settings and the objects it follows and looks at;
  - a reference to the transform of a child object finds it again.
- `tests/MissingComponent.test.ts`, *a component whose class is not registered*:
  - can still be pointed at by a component that is known.

**Done when:**

- `npx tsc --noEmit` is clean with both `-p tsconfig.build.json` and `-p tsconfig.test.json`;
- `npm test` passes in full: 129 files and 1919 tests plus the three new ones in §10;
- `npm run build` succeeds.

*Verified in a scratch clone of `9ffd1d1`:* the three source fixes alone give a clean typecheck
on both configs and 129/129 files, 1919/1919 tests.

No CHANGELOG entry. Nothing a consumer can observe changes: the new public API exists but nothing
makes an instance yet, and an optional field on an exported type breaks nobody.

### Stage 2 — The defects the feature stands on

Three commits, D1, D2 and D3 (§4.6). D3 was not in the original plan; it was found by the
Stage 1 golden test and is fixed the same way, on its own.

- **D1.** `GameObject` destruction removes the transform from its parent's `_children`, so
  `childCount`, `getChild`, sibling indices and the serializer all stop seeing it. This matches
  Unity, where a destroyed child is gone from the hierarchy (at once for `DestroyImmediate`, at
  end of frame for `Destroy`).
- **D2.** An asset with no file behind it is always written inline under the guid it already has.
  - "No file" means the guid has no path, or a pseudo-path minted by `inlineAsset`.
  - `inlineAsset` reuses `AssetDatabase.guidOf(asset)` instead of minting a new one each save.
  - An inline `AssetRef` never carries `path`.
  - This fixes D2 and D2b together; they are one cause.
- **D3.** `_deserializeGO` parents each child with `setParent(t, false)`, keeping the local pose
  it read. The Stage 1 golden moves its parent off the origin again.

**Done when:**

- D1, D2 and D3 have their tests (§10);
- the whole suite is green;
- the CHANGELOG has three *Fixed* entries. D1's must say that the editor's deleted children
  reappeared on save.

### Stage 3 — Instance-ness survives a round trip (expand mode)

- **Reading.** The reader restores `_prefabNodeId` from `id`, and `_prefabInfo` from
  `prefab: { guid }` (and from `unused`, §7.2).
- **Copies.** The writer applies the id rule of §6.1, so copies of inner nodes carry no ids.
- **`Prefab`** gets a public `@internal` `_resolvedTree()` (today's private `_resolved`), so it
  satisfies `PrefabSource` by shape.
- **Docs.** The JSDoc of `isPrefabInstance` and `prefabNodeId` states D-7.

**Done when:**

- a scene saved with `prefab: { guid }` and ids loads back with `isPrefabInstance` true and every
  `prefabNodeId` restored, and saves back deep-equal;
- the old-format scene golden test passes;
- the copy rules hold.

Nothing stamps instances yet, so the tests start from JSON.

### Stage 4 — Link mode: prefab plus changes, with scopes

- **The reader.** The link branch of §6.2: `scopeStack` push and pop, scoped `_resolveRefs`, the
  placeholder, `unused`, the cycle check, the prefab tree's assets, and the root rule (D-13).
- **The writer.** Minting live ids for added nodes, dropping the three default root overrides,
  writing `unused`, and the `inexpressible` fallback.
- **`PrefabDiff`.** Namespace-bounded `_index`, `ensureIds` and positional fallback; `unused`;
  `inexpressible`.

**Done when:**

- a hand-written link scene, over a prefab bound with `AssetDatabase._bindGuid`, rebuilds
  completely;
- saving it in link mode writes back deep-equal JSON;
- the scope, placeholder, unused, cycle, root-rule and fallback tests of §10 pass.

### Stage 5 — Prefabs have identity, and instances know their prefab

- **`fromGameObject`.** Uses `_serializeForPrefab`, so nested instances are links, which Stage 4
  can now read. Then `ensureIds`. The source object is not modified.
- **`fromJSON`.** Legacy ids.
- **Stamping.** `instantiate`, `instantiateWithOverrides` and `revert` set
  `_prefabInfo = { source: this, guid: AssetDatabase.guidOf(this), … }`, keep the node ids, and
  set the root's id to null.
- **`revert`** puts the new instance back at the old sibling index.
- **`getOverrides`** compares against `_serializeForPrefab(instance)`.
- **`unpackPrefab`** refuses a nested root (§7.10).
- **Exports.** `index.ts` exports `SerializeOptions`, `PrefabChanges`, `PrefabAddedChild`,
  `PrefabAddedComponent`, `PrefabRemovedComponent` and `SerializedPrefabLink`.

**Done when:**

- the identity tests pass;
- the 16 existing tests in *Prefab — per-instance overrides* pass **unchanged**;
- `MissingComponent`'s "is carried by a prefab and by a copy" passes;
- a prefab made from an object that holds an instance instantiates in full. This is the
  regression for the hollow shell in §4.1.

CHANGELOG *Added*: `isPrefabInstance`, `prefabSource`, `prefabNodeId`, `unpackPrefab`, prefab node
ids, and instances that keep their link through save and load. Update `unity-parity-plan.md`
Stage 4 item 1: structural changes now *are* recorded, as `PrefabChanges`.

### Stage 6 — References by node id

- **Writer.** String segments in link contexts; `_serializeForPrefab` pre-mints ids in a side map.
- **Reader.** The lookup of §2.5.
- **Legacy files.** `ensureIds(…, true)` rewrites the old positional references.
- **Types.** `PendingGORef.path` and the pending-list paths become `(number | string)[]`.

**Done when:**

- a reference into an instance survives the prefab gaining a child in front of its target;
- removing a sibling inside an instance no longer turns untouched references into overrides
  (§7.7);
- expand output contains no string segment.

CHANGELOG *Changed*: the exported pending-reference path type.

### Stage 7 — What a link-mode file needs: references, preloading, version

- **`assetReferences`** lists prefab guids per D-4.
- **`decodePrefab`** preloads the nested prefabs it lists, with the in-flight cycle guard (§7.8).
- **Versions.** `version: 2` is written per D-2 and readers refuse unknown versions;
  `SerializedScene.version` becomes `1 | 2`.
- **Assets.** The instance asset-table rule of §6.1.

**Done when:**

- a scene with a linked instance lists its prefab;
- loading a prefab file loads the prefabs nested in it;
- two prefab files that contain each other load without hanging;
- versions are written and refused as specified;
- a linked instance does not copy its prefab's inline material into the scene.

CHANGELOG *Added*: `SerializeOptions.prefabs: "link"`, the version-2 file format, and the
missing-prefab placeholder. CHANGELOG *Changed*: the `SerializedScene.version` type. From here on,
the editor can opt in, subject to §11.

### Stage 8 — Variants keep their base

- `createVariant(base, overrides | PrefabChanges)`.
- `_resolvedTree` resolves through `applyChanges`.
- `toJSON` and `fromJSON` use the D-8 format, with the base resolved lazily through
  `AssetDatabase`.
- `decodePrefab` preloads the base.
- Instantiating a variant whose base is not loaded throws an error that names the base. A linked
  instance of such a variant becomes a placeholder.
- Fix the `Prefab.toJSON` JSDoc.

**Done when:**

- a variant saved with an id-bearing base reloads as a variant and follows edits to its base;
- the existing "saving a variant flattens it" test still passes, renamed to state its condition:
  the base it uses has no guid.

Update `unity-parity-plan.md` Stage 4 item 2.

### Stage 9 — What the editor's stage 14 calls

- **Finding instances.** `GameObject.prefabInstanceRoot` and `outermostPrefabInstanceRoot` (the
  blue rows in the Hierarchy) and `isPrefabAssetMissing`.
- **Reading changes.** `Prefab.getChanges(instance)`. Its node ids map to live objects through
  `prefabNodeId`, which is what drives bold fields and added-object markers.
- **Applying and reverting.**
  - `Prefab.applyInstance(instance)` writes the instance into the prefab's tree (or into a
    variant's changes), and refuses cycles. Other instances follow on their next link round trip.
  - `Prefab.revertOverride(instance, override)` reverts in place for a value, so the object keeps
    its identity, and rebuilds for a shape change.
- **Housekeeping.** `Prefab.removeUnusedOverrides(instance)`.
- **Connecting.** `Prefab.fromGameObject(go, name, { connect: true })` makes the source an
  instance of the prefab made from it. This is Unity's `SaveAsPrefabAssetAndConnect`.

**Done when:** each has its test, and the editor plan's stage 14 lists no engine gap.

*As implemented (2026-10-12), four refinements:*

- **`revertOverride` works in place for shape changes too**, not by rebuilding the instance: an
  added child or component is removed, a removed one is built again from the prefab at its
  place, and a nested instance's whole-link override rebuilds only that nested instance. A
  rebuild of the whole instance would have dropped every reference from inside it to the rest of
  the scene, and every reference into it.
- **`applyInstance` does not apply the root's name, position and rotation**, the same three
  fields the shell keeps (D-13). Applying an instance moved in the scene would otherwise move
  the prefab.
- **`getChanges` leaves out those three root overrides** too, so it lists exactly what a link
  save records. `getOverrides` still lists every value.
- **`PrefabDiff.applyChanges` is idempotent.** "Other instances follow on their next link round
  trip" means: save in link mode *before* the apply, apply, reload that save. The applied
  instance is then rebuilt from the new prefab plus its own pre-apply changes, which the prefab
  now holds; an added child whose id the prefab has, or an added component identical to the one
  at its place, is therefore skipped instead of added twice. Saving the other instances in link
  mode *after* the apply without reloading would record their old state as overrides; the
  `applyInstance` JSDoc says so.

The editor plan's own stage-14 row lives in another repository and is not changed from here.

### Stage 10 — Nested overrides, field by field

Per D-6 and §6.3.

*As implemented:* `compareChanges(prefab, instance, resolve?)` takes a resolver from guid to
prefab tree; the engine passes one everywhere it compares (the link writer, `getOverrides`,
`getChanges`, a variant's `applyInstance`). Two links to the same loaded prefab with the same
`unused` are expanded and compared as trees, the result's ids prefixed with the nested
instance's id. Anything else — no resolver, a prefab not loaded, a different prefab, an override
inside an expanded nested instance that only a path can address — stays one whole-link
override. A nested root's active state and scale come from its tree (D-13), so for a nested
instance compared field by field they are recorded inside it, not on its shell. `revertOverride`
follows a nested id into the nested instance and reverts there, against the nested tree as the
outer prefab defines it.

*Corrected after review:* the shells' active state and scale were still compared whenever the two
links were equal. The outer prefab's shell caches what the nested prefab had when the outer one
was saved, so once the nested prefab rescaled or hid its root, every untouched instance reported
`transform.scale` or `active` on each nested root, link saves wrote those overrides (which loading
ignores), and `revertOverride` applied the stale shell value. A nested root kept as a link is now
never compared on its shell for those two fields — its link decides them — and reverting one
addressed to it takes the value from its own prefab (`SceneSerializer._linkTree`).

*Corrected after review:* `applyChanges` first composed by adding the `"outer/inner"` changes to
the nested link's own and applying the result in its fixed order — values, then removals, then
additions. A change aimed at a child or component the **outer prefab added** to the nested
instance therefore found nothing when its value was applied, and a removal of one was undone by
the addition that followed: an edit inside an added child came back as the prefab had it (with a
false "no longer has" warning), and a deleted added child or component returned, through a link
round trip and through a variant alike. `applyChanges(tree, changes, resolve)` now rewrites the
nested link as the difference between the nested prefab's tree and that tree with the link's own
changes and then the instance's applied, so the added objects are part of what the changes land
on. Without `resolve`, or with the nested prefab not loaded, it falls back to adding them, which
is exact only for the nested prefab's own objects. A prefab already being expanded further out is
not expanded again, so two prefab files that change something inside each other cannot recurse.

**Done when:**

- an edit to an outer prefab's nested override reaches an outer instance that changed a
  *different* field of the same nested instance;
- a file written with whole-link overrides still loads.

## 10. Test plan

Each test is named as it will appear. New files are `tests/PrefabInstances.test.ts` (Stages 3–4),
`tests/PrefabIdentity.test.ts` (5), `tests/PrefabReferences.test.ts` (6) and
`tests/PrefabEditing.test.ts` (9–10). The rest extend existing files.

### Stage 1

- `Serialization.test.ts`, *SceneSerializer — format unchanged by prefab support*:
  - **"a scene with no prefab instance is written exactly as before."** Pins the key order and the
    absence of `id`, `prefab` and `scope`, as a deep-equal against a literal.
  - **"a reference read through a context with no scope stack resolves from the roots."** Pins
    D-12: a caller-built `DeserializeContext` without the field.
- `AssetFiles.test.ts`:
  - **"an asset file with an untyped object field is written."** HEAD threw on `goToPath`.

### Stage 2

- `GameObjectLifecycle.test.ts`:
  - **"a destroyed child leaves its parent's children"**: `childCount` and `getChild`.
  - **"a destroyed child is not written into a saved scene."**
- `AssetFiles.test.ts`:
  - **"a scene saved twice still carries its inline material."** Clear the loaded assets and
    reload; the material is present.
  - **"an inline material keeps its id from one save to the next."**
  - **"an inline asset reference carries no path."**
- `Serialization.test.ts`, *Prefab — per-instance overrides*:
  - **"an untouched instance of a prefab with an inline material has no overrides"** (D2b).
- `Serialization.test.ts`, *SceneSerializer — GameObject round trip*:
  - **"a child keeps its local pose when its parent is away from the origin"** (D3).

### Stage 3

`PrefabInstances.test.ts`:

- **"an instance saved in full records its prefab and loads back as an instance."**
- **"node ids survive a save and a load."**
- **"a nested instance stays an instance through an undo-style round trip."**
- **"a copy of a node inside an instance carries no ids"** (D-10).
- **"a copy of an instance root keeps its link and its interior ids."**
- **"an instance whose prefab is not loaded still reports its link."** `isPrefabInstance` true,
  `prefabSource` null.
- **"a scene from before prefab links loads and saves unchanged."** A whole-scene golden, with an
  inline asset table and references.

### Stage 4

`PrefabInstances.test.ts`:

- **"a linked instance is rebuilt from its prefab plus its changes."**
- **"saving a rebuilt instance in link mode writes back the same changes."** A deep-equal round
  trip.
- **"an edit to the prefab reaches a linked instance on its next load; its own overrides stay."**
- **"a reference inside an instance to its own object resolves inside that instance"** (scope 0).
- **"a reference out of a nested instance counts its scope outward."** Barrel to Player is
  `scope: 2`.
- **"a reference from outside into a nested instance finds it."**
- **"a link inside an expanded instance counts its scope past it."** Only links are pushed.
- **"a reference scoped deeper than its stack resolves to null."**
- **"added and removed children and components round-trip through a scene."**
- **"an instance whose prefab is missing becomes a placeholder and is written back verbatim."**
  With the warning.
- **"objects added under a placeholder are reported when it is saved."**
- **"a change addressed to a node the prefab no longer has is kept, and applies again when the
  node returns."**
- **"a prefab that contains itself becomes a placeholder instead of recursing."**
- **"the shell's name, position and rotation win; scale and active follow the prefab."**
- **"reordering prefab children inside an instance saves that instance in full."** With the
  warning.
- **"a prefab's own inline material is there when a linked instance is rebuilt."**

### Stage 5

`PrefabIdentity.test.ts`:

- **"an instantiated prefab is an instance of it."** `prefabSource` is the prefab and
  `prefabNodeId` is null.
- **"every node of a prefab made from an object has an id, and the object is left as it was."**
- **"a prefab file without ids gets the same ids on every load."**
- **"an instance and its prefab agree node by node."**
- **"a prefab made from an object holding an instance keeps it as a link, and instantiates it in
  full."** The hollow-shell regression.
- **"an untouched instance has no overrides, nested instances included."**
- **"the same prefab nested twice keeps the two apart."**
- **"instantiating an instance gives another instance of the same prefab"** (D-11).
- **"duplicating a node inside an instance gives an added object."**
- **"revert keeps the sibling index and the link."**
- **"unpacking removes the link and the ids and leaves nested instances; unpacking completely
  removes those too."**
- **"unpacking a nested instance is refused."**

Unchanged and still passing: the 16 tests in `Serialization.test.ts` *Prefab — per-instance
overrides*, and `MissingComponent.test.ts` "is carried by a prefab and by a copy".

New in `MissingComponent.test.ts`:

- **"a prefab instance keeps an unknown component of its prefab without reporting an override."**

### Stage 6

`PrefabReferences.test.ts`:

- **"a reference into an instance is written by node id in link mode."**
- **"it still finds its target after the prefab gains a child in front of it."**
- **"removing a sibling inside an instance does not turn untouched references into overrides."**
- **"an override that holds a reference survives the prefab being reordered."**
- **"a legacy prefab's positional references are read as node ids."**
- **"an id is looked for only inside its own instance."** Legacy `~0` ids repeat across nesting.
- **"expand mode never writes an id into a path."**

### Stage 7

`AssetFiles.test.ts` and `PrefabInstances.test.ts`:

- **"a scene with a linked instance lists its prefab as something to load first."**
- **"an expanded instance's prefab is not listed."**
- **"a prefab file lists the prefabs nested in it, and loading it loads them."**
- **"two prefab files that contain each other load without hanging."**
- **"a scene with a link is written as version 2; one without stays version 1."**
- **"a file of a version the engine does not know is refused."**
- **"a linked instance does not copy its prefab's inline material into the scene."**

### Stage 8

`Serialization.test.ts` *Prefab — per-instance overrides* and `AssetFiles.test.ts`:

- **"saving a variant of a prefab with an id keeps its base."**
- **"a variant whose base has no id is still flattened."** This is the existing flatten test,
  renamed.
- **"an edit to the base reaches a variant loaded from a file."**
- **"a variant can add and remove children."**
- **"loading a variant loads its base first."**
- **"instantiating a variant whose base is not loaded names the base."**

### Stage 9

`PrefabEditing.test.ts`:

- **"prefabInstanceRoot finds the instance a node belongs to; outermostPrefabInstanceRoot crosses
  nesting."**
- **"a missing prefab is reported as missing."**
- **"getChanges reports added and removed children by node id."**
- **"applying an instance writes it into the prefab, and other instances follow on reload."**
- **"applying an instance that contains its own prefab is refused."**
- **"reverting one override restores that field in place and keeps the others."**
- **"connecting makes the source an instance of the prefab made from it."**
- **"removing unused overrides drops what no longer applies."**

### Stage 10

`PrefabEditing.test.ts`:

- **"a change inside a nested instance is recorded field by field."**
- **"an edit to the outer prefab's nested override reaches an instance that changed another field
  of it."**
- **"a whole-link override from an earlier file is still read."**

## 11. Open — needs the owner

- **When the editor turns link mode on.** That needs every engine that will read the editor's
  scenes to be on a release that reads version 2. virtual-lab runs exported scenarios on its own
  engine, so this is a release-coordination call. It also needs the editor's `_loadSceneText`
  (`commands.service.ts:614`) to accept version 2. Until both are true, the editor stays on expand,
  which Stage 3 already makes link-preserving. *Corrected after review:* accepting version 2 is
  needed earlier than that. A default-mode save is version 2 when it writes back a placeholder's
  link, an unknown component's data with node ids, or `unused` changes (§2.5), so once the editor
  can load a prefab file it can write an autosave it then refuses to reopen.
- **Component identity.** Components have no ids; a `ComponentRef` is a type plus an index.
  Removing the first of two same-type components in an instance is recorded as field overrides on
  #0 plus a removal of #1. The rebuild is right, but the "modified" markers and per-override
  revert are wrong for that case. Unity gives components fileIDs too. Adding ids changes the
  format of every scene, not just of prefabs, so it is a separate decision. It is best taken
  before the editor's stage 16 (diff-based undo), which would build on it.
- **A prefab made from another prefab's instance shares that prefab's inline asset ids** (found
  in review, verified). `Prefab.fromGameObject(instance)` writes the instance's material — rebuilt
  from the first prefab's table — under that table's id, so two prefab files name one id, and in a
  new session whichever is instantiated first decides the material of both. Scenes no longer do
  this (§6.1, Assets); between prefab files it needs to know which prefab owns an id, not only
  that some prefab does, so it is left to the owner with the variant case below.
- **A variant cannot carry an inline asset it introduces** (found in Stage 8, verified).
  `getOverrides` returns values without the instance's asset table, so an override that gives an
  instance a code-built material is an `AssetRef` to an id nothing binds: through
  `instantiateWithOverrides` or a variant it comes back `null`, and a variant file has no `assets`
  to put it in. A linked instance in a scene does not have the problem — Stage 7 carries the
  assets its changes need into the scene's table. Fixing it for variants means giving a variant
  file an `assets` table and `createVariant` a way to receive one; it is a format addition, so it
  is left to the owner. Until then, give a variant's materials files of their own.
- **Bookkeeping.** E11 has no row in `.claude-shared/ENGINE-GAPS.md` yet. The editor plan says
  rows are added when the stage reaches them, so the row goes in when Stage 1 starts. D1 is an
  engine defect found by the engine; it belongs in this repo's CHANGELOG, not in the gap index.

## 12. Related

- `design/unity-parity-plan.md` → Stage 4: prefab overrides and variants, whose deferral this
  plan picks up. Stage 2: asset ids (E5), which give prefabs their guids.
- `WebEngineTSEditor/docs/unity-editor-plan.md` → §4 E11, and stages 14 and 16.
- `.claude-shared/PLAN.md` → §1.5 item 6.
- `src/engine/core/serialization/MissingComponent.ts` → the E6 contract that §2.6 and §6.4
  extend.
- `design/render-adapter-plan.md`: the structure this document follows.
