# Engine audit — checklist

Every exported class in the engine, split into the ten parts of
[`method.md`](method.md). Extracted from the tree at `48ade91`:
**175 classes across 141 files.**

Tick a class when it has been walked against the failure-shape list in the plan — not when it
merely has a test. A class with tests can still hide a silently-doing-nothing API, which is how
all six known defects survived 1133 green tests.

## Progress

| Part | Area | Classes | Done | Status |
|---|---|---:|---:|---|
| 1 | Core object model and lifecycle | 22 | **22** | **done** |
| 2 | Graphics assets | 11 | **11** | **done** |
| 3 | Rendering and components | 17 | **17** | **done** |
| 4 | Assets and scenario | 12 | 12 | **done** |
| 5 | Physics | 16 | **16** | **done** |
| 6 | UI core | 21 | **21** | **done** |
| 7 | UI controls | 18 | **18** | **done** |
| 8 | Math | 12 | **12** | **done** |
| 9 | Animation and Cinemachine | 17 | **17** | **done** |
| 10 | The tail | 29 | 21 | in progress |
| | **Total** | **175** | **168** | |

**How to mark.** Tick the class, update the part's `Done` count and `Status`
(`not started` → `in progress` → `done`). Defects go in [`findings.md`](findings.md), ideas that
are not defects in [`improvements.md`](improvements.md); each part's **Findings** line just names
the entries, so this file stays a progress table rather than growing into a report.

---

## Part 1 — Core object model and lifecycle (22)

Everything sits on this, and `Transform`, `GameObject`, `Scene` and `EngineObject` have no
direct tests. Watch for: lifecycle order against Unity, deferred vs immediate destroy,
accessor symmetry (`transform.position.x = 1`), registry cleanup on destroy.

- `core/EngineObject.ts` — [x] EngineObject *(registry, destroy, find; F2, F3)*
- `core/GameObject.ts` — [x] GameObject *(activity, lifecycle, destruction; F4)*
- `core/Component.ts` — [x] Component
- `core/Behaviour.ts` — [x] Behaviour *(enable/disable transitions)*
- `core/Transform.ts` — [x] Transform *(hierarchy, accessors; F1)*
- `core/Scene.ts` — [x] Scene *(registry, roots)*
- `core/SceneManager.ts` — [x] SceneManager *(load modes, persistence; F7)*
- `core/Application.ts` — [x] Application *(loop order, fixed phase)*
- `core/Time.ts` — [x] Time *(clocks, fixed phase; F6)*
- `core/Input.ts` — [x] Input *(per-frame edges, focus loss; F8)*
- `core/RenderSettings.ts` — [x] RenderSettings *(symmetric accessors, dirty flags — clean)*
- `core/ScriptableObject.ts` — [x] ScriptableObject *(create, JSON round-trip — clean)*
- `core/ScriptableBehaviour.ts` — [x] ScriptableBehaviour *(coroutine ownership; F5)*
- `core/pool/ObjectPool.ts` — [x] ObjectPool *(double-release guarded, Unity parity — clean)*
- `core/Coroutine.ts` — [x] Coroutine · [x] CoroutineRunner · [x] WaitForSeconds ·
  [x] WaitForSecondsRealtime · [x] WaitUntil · [x] WaitWhile · [x] WaitForEndOfFrame ·
  [x] WaitForFixedUpdate *(scaled vs realtime clocks verified correct)*

**Findings:** F1, F5, F6, F7, F8 (fixed), F2, F3, F4 — see [`findings.md`](findings.md)

---

## Part 2 — Graphics assets (11)

Two defects came out of here in one week, both by accident. Watch for: state lost when a
backing object is replaced, `sharedMaterial` vs `material` clone-on-write, disposal and the
ImageBitmap `.close()` path, the enum-zero shape in `Shader`.

- `core/graphics/Material.ts` — [x] Material *(property accessors; F10)*
- `core/graphics/StandardMaterial.ts` — [x] StandardMaterial
- `core/graphics/UnlitMaterial.ts` — [x] UnlitMaterial
- `core/graphics/Shader.ts` — [x] Shader *(enum-zero shape already guarded — clean)*
- `core/graphics/Texture.ts` — [x] Texture *(referent index, disposal)*
- `core/graphics/Texture2D.ts` — [x] Texture2D *(release path; F9)*
- `core/graphics/Cubemap.ts` — [x] Cubemap *(release path; F9)*
- `core/graphics/Mesh.ts` — [x] Mesh · [x] SubMesh *(thin wrapper — clean)*
- `core/graphics/Sprite.ts` — [x] Sprite · [x] SpriteBorder *(Y-down documented — clean)*

**Findings:** F9, F10 — see [`findings.md`](findings.md)

---

## Part 3 — Rendering and components (17)

Watch for: asymmetric accessors beyond the two already known (`MeshFilter.mesh`,
`Camera.backgroundColor`), light property → Three.js sync completeness, enabled/disabled and
layer culling. `LineRenderer` also carries an open TODO and a Ukrainian comment at line 581.

- `core/rendering/Renderer.ts` — [x] Renderer *(clone-on-write verified against Unity)*
- `core/rendering/MeshFilter.ts` — [x] MeshFilter *(mesh/sharedMesh is Unity-correct; F12)*
- `core/rendering/MeshRenderer.ts` — [x] MeshRenderer *(via Renderer + shape sweeps)*
- `core/rendering/InstancedMeshRenderer.ts` — [x] InstancedMeshRenderer *(capacity growth, carry-over, flag order — clean)*
- `core/rendering/StaticBatchingUtility.ts` — [x] StaticBatchingUtility *(re-batching; F13)*
- `core/rendering/ShaderWarmup.ts` — [x] ShaderWarmup *(35 lines, one delegation — clean)*
- `core/rendering/WebGLRenderBackend.ts` — [x] WebGLRenderBackend *(stats reuse documented; F14)*
- `core/components/Camera.ts` — [x] Camera *(fallback returns; F10)*
- `core/components/Light.ts` — [x] Light *(setter→backend sync; F11)*
- `core/components/DirectionalLight.ts` — [x] DirectionalLight *(shadow camera reached — clean)*
- `core/components/PointLight.ts` — [x] PointLight *(clean)*
- `core/components/SpotLight.ts` — [x] SpotLight *(clamping, inner≤outer — clean)*
- `core/components/AmbientLight.ts` — [x] AmbientLight *(no setters — clean)*
- `core/components/LODGroup.ts` — [x] LODGroup · [x] LOD *(registry removes on disable and destroy — clean)*
- `core/components/LineRenderer.ts` — [x] LineRenderer *(fallback returns; F10 — open TODO and non-English comment remain)*
- `core/components/SpriteRenderer.ts` — [x] SpriteRenderer *(all 10 setters sync — clean)*

**Findings:** F10, F11, F12, F13, F14 — see [`findings.md`](findings.md)

---

## Part 4 — Assets and scenario (12)

Rewritten heavily over two weeks, and two of the four consumer reports landed here. Watch for:
refcount correctness across `load`/`prefetch`/`reload`/`release`/`unloadUnused`, further
double-decode paths, blob-URL lifetime, unload leaving registries populated, the manifest
parser against input it has not seen.

- `core/assets/Resources.ts` — [x] Resources *(refcounts, destruction funnel, source lifetime; F15, F16)*
- `core/assets/StreamingAssetSource.ts` — [x] StreamingAssetSource *(queue, disposal; F20)*
- `core/assets/ZipAssetSource.ts` — [x] ZipAssetSource *(clean)*
- `core/assets/TextureStreaming.ts` — [x] TextureStreaming *(pass state; F19)*
- `core/assets/AssetDatabase.ts` — [x] AssetDatabase *(identity lifetime; F15)*
- `core/assets/LoadHandle.ts` — [x] LoadHandle *(F17)*
- `core/assets/AssetTypes.ts` — [x] JsonAsset · [x] TextAsset *(F18)* · [x] BinaryAsset
- `core/scenario/Scenario.ts` — [x] Scenario *(run/unload lifetime; F23, F24)*
- `core/scenario/ScenarioAssets.ts` — [x] ScenarioAssets *(prefab semantics; F25)*
- `core/scenario/ScenarioBehaviour.ts` — [x] ScenarioBehaviour *(loop entry; F21, F22)*

**Findings:** F15–F25 — see [`findings.md`](findings.md)

---

## Part 5 — Physics (16)

One silent no-op already found here, and the same shape — *the engine writes a field cannon
never reads* — is plausible anywhere the two models meet. Trace every property to the code that
consumes it.

- `physics/Physics.ts` — [x] Physics *(raycast, overlap; F28, F29)*
- `physics/PhysicsWorld.ts` — [x] PhysicsWorld *(clean)*
- `physics/Rigidbody.ts` — [x] Rigidbody *(gravity; F26)*
- `physics/Collider.ts` — [x] Collider *(shape offset; F27)*
- `physics/BoxCollider.ts` — [x] BoxCollider *(F27)*
- `physics/SphereCollider.ts` — [x] SphereCollider *(F27)*
- `physics/CapsuleCollider.ts` — [x] CapsuleCollider *(F27)*
- `physics/PhysicMaterial.ts` — [x] PhysicMaterial *(clean; F32 is its caller)*
- `physics/LayerCollisionMatrix.ts` — [x] LayerCollisionMatrix *(clean)*
- `physics/Collision.ts` — [x] Collision · [x] ContactPoint *(clean)*
- `physics/RaycastHit.ts` — [x] RaycastHit *(non-English JSDoc: F12)*
- `physics/Joint.ts` — [x] Joint · [x] FixedJoint · [x] HingeJoint *(F30)* · [x] SpringJoint *(F31)*

**Findings:** F26–F32 — see [`findings.md`](findings.md)

---

## Part 6 — UI core (21)

Watch for: the Y-down contract actually stated in each JSDoc as the repo requires, layout
invalidation and the once-per-frame driver order, hit-testing under rotation and masks, a
repaint hash missing a field that affects drawing.

- `core/ui/Canvas.ts` — [x] Canvas *(repaint hash; F33)*
- `core/ui/CanvasScaler.ts` — [x] CanvasScaler *(clean)*
- `core/ui/CanvasGroup.ts` — [x] CanvasGroup *(clean)*
- `core/ui/RectTransform.ts` — [x] RectTransform *(lookup caches; F41)*
- `core/ui/RectMask2D.ts` — [x] RectMask2D *(clean; F33 is its consumer)* · [x] MaskPadding
- `core/ui/UIBehaviour.ts` — [x] UIBehaviour *(ancestor chains; F40)*
- `core/ui/EventSystem.ts` — [x] EventSystem *(release ordering; F42)*
- `core/ui/PointerEventData.ts` — [x] PointerEventData *(clean)*
- `core/ui/UIEvent.ts` — [x] UIEvent *(clean)*
- `core/ui/TintCache.ts` — [x] TintCache *(lifetime; F34)*
- `core/ui/LayoutElement.ts` — [x] LayoutElement · [x] LayoutUtility *(size protocol; F37)*
- `core/ui/ContentSizeFitter.ts` — [x] ContentSizeFitter *(clean; see I5)*
- `core/ui/AspectRatioFitter.ts` — [x] AspectRatioFitter *(clean)*
- `core/ui/GridLayoutGroup.ts` — [x] GridLayoutGroup *(row constraint; F38)*
- `core/ui/LayoutGroup.ts` — [x] LayoutGroup · [x] LayoutPadding · [x] LinearLayoutGroup *(F39)* ·
  [x] HorizontalLayoutGroup · [x] VerticalLayoutGroup

**Findings:** F33–F42 — see [`findings.md`](findings.md)

---

## Part 7 — UI controls (18)

The `Slider` gap was found by tabulating the family. Do that first: put `WithoutNotify`,
`interactable`, `onValueChanged` and the transition hooks side by side across all of these and
see who is missing what.

- `core/ui/Selectable.ts` — [x] Selectable *(navigation; F46)*
- `core/ui/SelectableTransition.ts` — [x] ColorBlock · [x] SpriteState *(clean)*
- `core/ui/Navigation.ts` — [x] Navigation *(clean)*
- `core/ui/Button.ts` — [x] Button *(clean)*
- `core/ui/Slider.ts` — [x] Slider *(clean)*
- `core/ui/Toggle.ts` — [x] Toggle *(clean)*
- `core/ui/ToggleGroup.ts` — [x] ToggleGroup *(clean)*
- `core/ui/Scrollbar.ts` — [x] Scrollbar *(clean)*
- `core/ui/Dropdown.ts` — [x] Dropdown *(focus; F43)*
- `core/ui/InputField.ts` — [x] InputField *(family gap; F45)*
- `core/ui/ScrollRect.ts` — [x] ScrollRect *(content lifetime; F44)*
- `core/ui/VirtualJoystick.ts` — [x] VirtualJoystick *(clean)*
- `core/ui/UIImage.ts` — [x] UIImage *(clean; hash checked in part 6)*
- `core/ui/UIText.ts` — [x] UIText *(rich line height; F47)*
- `core/ui/RichText.ts` — [x] RichText *(clean)*
- `core/ui/UITween.ts` — [x] UITween · [x] UITweenHandle *(F35)*

**Findings:** F43–F47 — see [`findings.md`](findings.md)

---

## Part 8 — Math (12)

Cheapest confidence per hour in the plan — exhaustive tests are quick here. `Vector2/3/4`,
`Color`, `Bounds` and `Rect` have none today. Watch for: the `out?` contract and whether
aliasing (`a.add(b, a)`) is safe, static temporaries leaking across nested calls, frozen
constants, `Object.freeze` on typed arrays, zero-length normalize, degenerate bounds.

- `core/math/Vector2.ts` — [x] Vector2 *(F49; F12 open)*
- `core/math/Vector3.ts` — [x] Vector3 *(aliasing checked; F12 open)*
- `core/math/Vector4.ts` — [x] Vector4 *(F49; F12 open)*
- `core/math/Quaternion.ts` — [x] Quaternion *(aliasing checked; F12 open)*
- `core/math/Matrix4x4.ts` — [x] Matrix4x4 *(aliasing checked)*
- `core/math/Color.ts` — [x] Color *(F49; F12 open)*
- `core/math/Bounds.ts` — [x] Bounds *(clean; JSDoc translated)*
- `core/math/Rect.ts` — [x] Rect *(F49)*
- `core/math/Ray.ts` — [x] Ray *(normalization contract; F51)*
- `core/math/Mathf.ts` — [x] Mathf *(rounding; F48)*
- `core/math/AnimationCurve.ts` — [x] AnimationCurve *(wrapping verified)* · [x] Keyframe *(F50)*

**Findings:** F48–F51, and F12's math half — see [`findings.md`](findings.md)

---

## Part 9 — Animation and Cinemachine (17)

Both drive transforms per frame. Cinemachine has **zero** tests across 11 classes. Watch for:
blend weights not summing to 1, a transition consuming a trigger twice, the documented
first-frame Cut behaviour actually holding, damping at very small and very large steps.

- `core/animation/Animation.ts` — [x] Animation *(clean; exemplary teardown)*
- `core/animation/AnimationClip.ts` — [x] AnimationClip *(clean)*
- `core/animation/Animator.ts` — [x] Animator *(triggers verified; F64)* · [x] AnimatorState · [x] AnimatorTransition
- `core/animation/BlendTree.ts` — [x] BlendTree *(weights verified)*
- `core/cinemachine/CinemachineBrain.ts` — [x] CinemachineBrain *(F54; first-frame Cut verified)*
- `core/cinemachine/CinemachineCore.ts` — [x] CameraState *(F56)* · [x] CinemachineBody ·
  [x] CinemachineAim
- `core/cinemachine/CinemachineVirtualCamera.ts` — [x] CinemachineVirtualCamera *(F52, F53)*
- `core/cinemachine/CinemachineFollowBody.ts` — [x] CinemachineFollowBody *(F55)*
- `core/cinemachine/CinemachineOrbitalBody.ts` — [x] CinemachineOrbitalBody *(F55)*
- `core/cinemachine/CinemachineFlyBody.ts` — [x] CinemachineFlyBody *(clean)*
- `core/cinemachine/CinemachineHardLookAtAim.ts` — [x] CinemachineHardLookAtAim *(F52)*
- `core/cinemachine/CinemachineOrbitalAim.ts` — [x] CinemachineOrbitalAim *(F52)*
- `core/cinemachine/CinemachinePOVAim.ts` — [x] CinemachinePOVAim *(F57)*

**Findings:** F52–F57 — see [`findings.md`](findings.md)

---

## Part 10 — The tail (29)

Watch for: the diagnostics numbers themselves — `MemoryProfiler` sums *engine* objects while a
host compares against `renderer.info`, and that mismatch is what made the 2.9× report
ambiguous. Also serializer round-trips for every `FieldType`, and audio disposal.

- `core/diagnostics/MemoryProfiler.ts` — [x] MemoryProfiler *(counter semantics; F60)*
- `core/diagnostics/Profiler.ts` — [ ] Profiler
- `core/diagnostics/Benchmark.ts` — [ ] Benchmark
- `core/serialization/SceneSerializer.ts` — [x] SceneSerializer *(F67)*
- `core/serialization/ValueSerializer.ts` — [x] ValueSerializer *(round-trips verified)*
- `core/serialization/Prefab.ts` — [x] Prefab *(F67)*
- `core/serialization/PrefabOverride.ts` — [ ] PrefabDiff
- `core/reflection/TypeRegistry.ts` — [x] TypeRegistry *(F65)*
- `core/audio/AudioManager.ts` — [x] AudioManager *(F66)*
- `core/audio/AudioSource.ts` — [x] AudioSource *(F58)*
- `core/audio/AudioListener.ts` — [x] AudioListener *(clean)*
- `core/audio/AudioClip.ts` — [ ] AudioClip
- `core/particles/ParticleSystem.ts` — [x] ParticleSystem *(teardown verified)* · [ ] ParticleBurst
- `core/particles/ParticleShape.ts` — [ ] ParticleShape
- `core/particles/Gradient.ts` — [x] Gradient *(F59)* · [x] GradientColorKey · [x] GradientAlphaKey
- `core/postprocessing/PostProcessing.ts` — [x] PostProcessing *(F61)*
- `core/postprocessing/PostEffect.ts` — [x] PostEffect *(clean)*
- `core/postprocessing/BloomEffect.ts` — [ ] BloomEffect
- `core/postprocessing/VignetteEffect.ts` — [ ] VignetteEffect
- `core/input/Touch.ts` — [x] Touch *(F62)* · [x] TouchInfo
- `core/input/Gamepad.ts` — [x] Gamepad *(polled, no listeners)* · [x] GamepadState
- `core/input/DeviceSensors.ts` — [x] DeviceSensors *(listeners balanced)*
- `core/plugins/PluginManager.ts` — [x] PluginManager *(F63)*
- `core/plugins/Plugin.ts` — [x] Plugin *(clean)*

**Findings:** F58–F67 — see [`findings.md`](findings.md)

---

## Not on this list

Exported **enums, interfaces, types and free functions** are not ticked separately — they are
covered as part of the class that uses them. Two exceptions worth naming, since neither has a
class to hide behind:

- `core/graphics/ShaderSource.ts` and `core/ui/UIUtils.ts` export functions only. Walk them with
  Part 2 and Part 6 respectively.
- `core/reflection/Decorators.ts` exports the `@Serializable` / `@SerializedField` family. Walk
  it with Part 10, alongside `TypeRegistry`.
