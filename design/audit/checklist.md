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
| 4 | Assets and scenario | 12 | 10 | in progress |
| 5 | Physics | 16 | 0 | not started |
| 6 | UI core | 21 | 0 | not started |
| 7 | UI controls | 18 | 0 | not started |
| 8 | Math | 12 | 0 | not started |
| 9 | Animation and Cinemachine | 17 | 0 | not started |
| 10 | The tail | 29 | 0 | not started |
| | **Total** | **175** | **60** | |

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
- `core/scenario/Scenario.ts` — [ ] Scenario
- `core/scenario/ScenarioAssets.ts` — [ ] ScenarioAssets
- `core/scenario/ScenarioBehaviour.ts` — [x] ScenarioBehaviour *(loop entry; F21, F22)*

**Findings:** F15–F22 — see [`findings.md`](findings.md)

---

## Part 5 — Physics (16)

One silent no-op already found here, and the same shape — *the engine writes a field cannon
never reads* — is plausible anywhere the two models meet. Trace every property to the code that
consumes it.

- `physics/Physics.ts` — [ ] Physics
- `physics/PhysicsWorld.ts` — [ ] PhysicsWorld
- `physics/Rigidbody.ts` — [ ] Rigidbody
- `physics/Collider.ts` — [ ] Collider
- `physics/BoxCollider.ts` — [ ] BoxCollider
- `physics/SphereCollider.ts` — [ ] SphereCollider
- `physics/CapsuleCollider.ts` — [ ] CapsuleCollider
- `physics/PhysicMaterial.ts` — [ ] PhysicMaterial
- `physics/LayerCollisionMatrix.ts` — [ ] LayerCollisionMatrix
- `physics/Collision.ts` — [ ] Collision · [ ] ContactPoint
- `physics/RaycastHit.ts` — [ ] RaycastHit
- `physics/Joint.ts` — [ ] Joint · [ ] FixedJoint · [ ] HingeJoint · [ ] SpringJoint

**Findings:** none yet — see [`findings.md`](findings.md)

---

## Part 6 — UI core (21)

Watch for: the Y-down contract actually stated in each JSDoc as the repo requires, layout
invalidation and the once-per-frame driver order, hit-testing under rotation and masks, a
repaint hash missing a field that affects drawing.

- `core/ui/Canvas.ts` — [ ] Canvas
- `core/ui/CanvasScaler.ts` — [ ] CanvasScaler
- `core/ui/CanvasGroup.ts` — [ ] CanvasGroup
- `core/ui/RectTransform.ts` — [ ] RectTransform
- `core/ui/RectMask2D.ts` — [ ] RectMask2D · [ ] MaskPadding
- `core/ui/UIBehaviour.ts` — [ ] UIBehaviour
- `core/ui/EventSystem.ts` — [ ] EventSystem
- `core/ui/PointerEventData.ts` — [ ] PointerEventData
- `core/ui/UIEvent.ts` — [ ] UIEvent
- `core/ui/TintCache.ts` — [ ] TintCache
- `core/ui/LayoutElement.ts` — [ ] LayoutElement · [ ] LayoutUtility
- `core/ui/ContentSizeFitter.ts` — [ ] ContentSizeFitter
- `core/ui/AspectRatioFitter.ts` — [ ] AspectRatioFitter
- `core/ui/GridLayoutGroup.ts` — [ ] GridLayoutGroup
- `core/ui/LayoutGroup.ts` — [ ] LayoutGroup · [ ] LayoutPadding · [ ] LinearLayoutGroup ·
  [ ] HorizontalLayoutGroup · [ ] VerticalLayoutGroup

**Findings:** none yet — see [`findings.md`](findings.md)

---

## Part 7 — UI controls (18)

The `Slider` gap was found by tabulating the family. Do that first: put `WithoutNotify`,
`interactable`, `onValueChanged` and the transition hooks side by side across all of these and
see who is missing what.

- `core/ui/Selectable.ts` — [ ] Selectable
- `core/ui/SelectableTransition.ts` — [ ] ColorBlock · [ ] SpriteState
- `core/ui/Navigation.ts` — [ ] Navigation
- `core/ui/Button.ts` — [ ] Button
- `core/ui/Slider.ts` — [ ] Slider
- `core/ui/Toggle.ts` — [ ] Toggle
- `core/ui/ToggleGroup.ts` — [ ] ToggleGroup
- `core/ui/Scrollbar.ts` — [ ] Scrollbar
- `core/ui/Dropdown.ts` — [ ] Dropdown
- `core/ui/InputField.ts` — [ ] InputField
- `core/ui/ScrollRect.ts` — [ ] ScrollRect
- `core/ui/VirtualJoystick.ts` — [ ] VirtualJoystick
- `core/ui/UIImage.ts` — [ ] UIImage
- `core/ui/UIText.ts` — [ ] UIText
- `core/ui/RichText.ts` — [ ] RichText
- `core/ui/UITween.ts` — [ ] UITween · [ ] UITweenHandle

**Findings:** none yet — see [`findings.md`](findings.md)

---

## Part 8 — Math (12)

Cheapest confidence per hour in the plan — exhaustive tests are quick here. `Vector2/3/4`,
`Color`, `Bounds` and `Rect` have none today. Watch for: the `out?` contract and whether
aliasing (`a.add(b, a)`) is safe, static temporaries leaking across nested calls, frozen
constants, `Object.freeze` on typed arrays, zero-length normalize, degenerate bounds.

- `core/math/Vector2.ts` — [ ] Vector2
- `core/math/Vector3.ts` — [ ] Vector3
- `core/math/Vector4.ts` — [ ] Vector4
- `core/math/Quaternion.ts` — [ ] Quaternion
- `core/math/Matrix4x4.ts` — [ ] Matrix4x4
- `core/math/Color.ts` — [ ] Color
- `core/math/Bounds.ts` — [ ] Bounds
- `core/math/Rect.ts` — [ ] Rect
- `core/math/Ray.ts` — [ ] Ray
- `core/math/Mathf.ts` — [ ] Mathf
- `core/math/AnimationCurve.ts` — [ ] AnimationCurve · [ ] Keyframe

**Findings:** none yet — see [`findings.md`](findings.md)

---

## Part 9 — Animation and Cinemachine (17)

Both drive transforms per frame. Cinemachine has **zero** tests across 11 classes. Watch for:
blend weights not summing to 1, a transition consuming a trigger twice, the documented
first-frame Cut behaviour actually holding, damping at very small and very large steps.

- `core/animation/Animation.ts` — [ ] Animation
- `core/animation/AnimationClip.ts` — [ ] AnimationClip
- `core/animation/Animator.ts` — [ ] Animator · [ ] AnimatorState · [ ] AnimatorTransition
- `core/animation/BlendTree.ts` — [ ] BlendTree
- `core/cinemachine/CinemachineBrain.ts` — [ ] CinemachineBrain
- `core/cinemachine/CinemachineCore.ts` — [ ] CameraState · [ ] CinemachineBody ·
  [ ] CinemachineAim
- `core/cinemachine/CinemachineVirtualCamera.ts` — [ ] CinemachineVirtualCamera
- `core/cinemachine/CinemachineFollowBody.ts` — [ ] CinemachineFollowBody
- `core/cinemachine/CinemachineOrbitalBody.ts` — [ ] CinemachineOrbitalBody
- `core/cinemachine/CinemachineFlyBody.ts` — [ ] CinemachineFlyBody
- `core/cinemachine/CinemachineHardLookAtAim.ts` — [ ] CinemachineHardLookAtAim
- `core/cinemachine/CinemachineOrbitalAim.ts` — [ ] CinemachineOrbitalAim
- `core/cinemachine/CinemachinePOVAim.ts` — [ ] CinemachinePOVAim

**Findings:** none yet — see [`findings.md`](findings.md)

---

## Part 10 — The tail (29)

Watch for: the diagnostics numbers themselves — `MemoryProfiler` sums *engine* objects while a
host compares against `renderer.info`, and that mismatch is what made the 2.9× report
ambiguous. Also serializer round-trips for every `FieldType`, and audio disposal.

- `core/diagnostics/MemoryProfiler.ts` — [ ] MemoryProfiler
- `core/diagnostics/Profiler.ts` — [ ] Profiler
- `core/diagnostics/Benchmark.ts` — [ ] Benchmark
- `core/serialization/SceneSerializer.ts` — [ ] SceneSerializer
- `core/serialization/ValueSerializer.ts` — [ ] ValueSerializer
- `core/serialization/Prefab.ts` — [ ] Prefab
- `core/serialization/PrefabOverride.ts` — [ ] PrefabDiff
- `core/reflection/TypeRegistry.ts` — [ ] TypeRegistry
- `core/audio/AudioManager.ts` — [ ] AudioManager
- `core/audio/AudioSource.ts` — [ ] AudioSource
- `core/audio/AudioListener.ts` — [ ] AudioListener
- `core/audio/AudioClip.ts` — [ ] AudioClip
- `core/particles/ParticleSystem.ts` — [ ] ParticleSystem · [ ] ParticleBurst
- `core/particles/ParticleShape.ts` — [ ] ParticleShape
- `core/particles/Gradient.ts` — [ ] Gradient · [ ] GradientColorKey · [ ] GradientAlphaKey
- `core/postprocessing/PostProcessing.ts` — [ ] PostProcessing
- `core/postprocessing/PostEffect.ts` — [ ] PostEffect
- `core/postprocessing/BloomEffect.ts` — [ ] BloomEffect
- `core/postprocessing/VignetteEffect.ts` — [ ] VignetteEffect
- `core/input/Touch.ts` — [ ] Touch · [ ] TouchInfo
- `core/input/Gamepad.ts` — [ ] Gamepad · [ ] GamepadState
- `core/input/DeviceSensors.ts` — [ ] DeviceSensors
- `core/plugins/PluginManager.ts` — [ ] PluginManager
- `core/plugins/Plugin.ts` — [ ] Plugin

**Findings:** none yet — see [`findings.md`](findings.md)

---

## Not on this list

Exported **enums, interfaces, types and free functions** are not ticked separately — they are
covered as part of the class that uses them. Two exceptions worth naming, since neither has a
class to hide behind:

- `core/graphics/ShaderSource.ts` and `core/ui/UIUtils.ts` export functions only. Walk them with
  Part 2 and Part 6 respectively.
- `core/reflection/Decorators.ts` exports the `@Serializable` / `@SerializedField` family. Walk
  it with Part 10, alongside `TypeRegistry`.
