// src/engine/index.ts
// ============================================
// WebEngineTS — Unity-like API
// ============================================
//
// TWO import styles (both work simultaneously):
//
//   1. Named imports (RECOMMENDED — tree-shakeable):
//      import { Vector3, GameObject, Camera } from "WebEngineTS";
//
//   2. Namespace import (convenient, NOT tree-shakeable):
//      import WebEngine from "WebEngineTS";
//      const pos = new WebEngine.Vector3(1, 2, 3);
//
//   3. Mixed:
//      import WebEngine, { Vector3 } from "WebEngineTS";
//
// Like Unity's `using UnityEngine;` — everything from one import!
// ============================================

// =====================
// CORE
// =====================
export { GameObject } from "./core/GameObject";
export { Component } from "./core/Component";
export { Transform } from "./core/Transform";
export { Scene } from "./core/Scene";
export { SceneManager } from "./core/SceneManager";
export { Application, GraphicsPowerPreference } from "./core/Application";
export { Time } from "./core/Time";
export { EngineSettings } from "./core/EngineSettings";
export { Behaviour } from "./core/Behaviour";
export { ScriptableBehaviour } from "./core/ScriptableBehaviour";
export { EngineObject } from "./core/EngineObject";
export { Input } from "./core/Input";
export { KeyCode } from "./core/KeyCode";
export { Gamepad, GamepadState, GamepadButton } from "./core/input/Gamepad";
export { Touch, TouchInfo, TouchPhase } from "./core/input/Touch";
export { DeviceSensors } from "./core/input/DeviceSensors";

// =====================
// PLUGINS
// =====================
export { Plugin } from "./core/plugins/Plugin";
export { PluginManager } from "./core/plugins/PluginManager";

// =====================
// REFLECTION / SERIALIZATION
// =====================
export { FieldType } from "./core/reflection/Types";
export type {
    FieldMeta,
    ClassMeta,
    SerializableOptions,
    SerializedFieldOptions,
} from "./core/reflection/Types";
export { TypeRegistry } from "./core/reflection/TypeRegistry";
export type { AnyConstructor } from "./core/reflection/TypeRegistry";
export {
    Serializable,
    SerializedField,
    Range,
    Header,
    Tooltip,
    HideInInspector,
    getClassMeta,
    getAllFields,
} from "./core/reflection/Decorators";
export { ValueSerializer } from "./core/serialization/ValueSerializer";
export type { SerializeContext, DeserializeContext, PendingGORef } from "./core/serialization/ValueSerializer";
export { SceneSerializer } from "./core/serialization/SceneSerializer";
export type {
    SerializedGameObject,
    SerializedComponent,
    SerializedScene,
} from "./core/serialization/SceneSerializer";
export { Prefab } from "./core/serialization/Prefab";

// =====================
// POST-PROCESSING
// =====================
export { PostProcessing } from "./core/postprocessing/PostProcessing";
export { PostEffect } from "./core/postprocessing/PostEffect";
export { BloomEffect } from "./core/postprocessing/BloomEffect";
export { VignetteEffect } from "./core/postprocessing/VignetteEffect";

// =====================
// MATH
// =====================
export { Mathf } from "./core/math/Mathf";
export { AnimationCurve, Keyframe, WrapMode } from "./core/math/AnimationCurve";
export { Vector2 } from "./core/math/Vector2";
export { Vector3 } from "./core/math/Vector3";
export { Vector4 } from "./core/math/Vector4";
export { Quaternion } from "./core/math/Quaternion";
export { Matrix4x4 } from "./core/math/Matrix4x4";
export { Color } from "./core/math/Color";
export { Bounds } from "./core/math/Bounds";
export { Rect } from "./core/math/Rect";
export { Ray } from "./core/math/Ray";

// =====================
// ASSETS (Unity-style Resources API)
// =====================
export { Resources } from "./core/assets/Resources";
export type { IAssetSource } from "./core/assets/Resources";
export { LoadHandle } from "./core/assets/LoadHandle";
export { JsonAsset, TextAsset, BinaryAsset } from "./core/assets/AssetTypes";

// =====================
// COROUTINES
// =====================
export {
    Coroutine, CoroutineRunner,
    WaitForSeconds, WaitForSecondsRealtime,
    WaitUntil, WaitWhile,
    WaitForEndOfFrame, WaitForFixedUpdate,
} from "./core/Coroutine";
export type { YieldInstruction } from "./core/Coroutine";

// =====================
// GRAPHICS
// =====================
export { Mesh, type MeshCombineInstance } from "./core/graphics/Mesh";
export { Texture, FilterMode, TextureWrapMode } from "./core/graphics/Texture";
export { Texture2D, TextureFormat } from "./core/graphics/Texture2D";
export { Cubemap } from "./core/graphics/Cubemap";
export { Sprite, SpriteBorder } from "./core/graphics/Sprite";
export { Shader, ShaderPropertyType } from "./core/graphics/Shader";
export { Material } from "./core/graphics/Material";
export { StandardMaterial, MaterialRenderMode } from "./core/graphics/StandardMaterial";
export { UnlitMaterial } from "./core/graphics/UnlitMaterial";

// =====================
// RENDER SETTINGS
// =====================
export { RenderSettings, FogMode } from "./core/RenderSettings";

// =====================
// COMPONENTS — Rendering
// =====================
export { MeshFilter } from "./core/rendering/MeshFilter";
export { Renderer, ShadowCastingMode } from "./core/rendering/Renderer";
export { MeshRenderer } from "./core/rendering/MeshRenderer";
export { InstancedMeshRenderer } from "./core/rendering/InstancedMeshRenderer";
export { StaticBatchingUtility } from "./core/rendering/StaticBatchingUtility";
export { LineRenderer, LineAlignment, LineTextureMode } from "./core/components/LineRenderer";
export type { GradientColorKey, CurveKey } from "./core/components/LineRenderer";
export { SpriteRenderer, SpriteBillboardMode } from "./core/components/SpriteRenderer";


// =====================
// Diagnostic
// =====================
export { MemoryProfiler, type MemoryReport } from './core/diagnostics/MemoryProfiler';
export {
    Benchmark,
    type BenchmarkOptions,
    type BenchmarkResult,
    type FrameTimeStats,
} from './core/diagnostics/Benchmark';
export {
    Profiler,
    type ProfilerSample,
    type FramePhaseTimings,
} from './core/diagnostics/Profiler';


// =====================
// COMPONENTS — Camera & Lights
// =====================
export { Camera, CameraClearFlags } from "./core/components/Camera";
export { Light, LightShadows, LightShadowResolution } from "./core/components/Light";
export { DirectionalLight } from "./core/components/DirectionalLight";
export { PointLight } from "./core/components/PointLight";
export { SpotLight } from "./core/components/SpotLight";
export { AmbientLight } from "./core/components/AmbientLight";
export { LODGroup, type LOD } from "./core/components/LODGroup";

// =====================
// CINEMACHINE
// =====================
export { CameraState, CinemachineBlendStyle, CinemachineBody, CinemachineAim } from "./core/cinemachine/CinemachineCore";
export { CinemachineVirtualCamera } from "./core/cinemachine/CinemachineVirtualCamera";
export { CinemachineBrain } from "./core/cinemachine/CinemachineBrain";
export { CinemachineOrbitalBody } from "./core/cinemachine/CinemachineOrbitalBody";
export { CinemachineOrbitalAim } from "./core/cinemachine/CinemachineOrbitalAim";
export { CinemachineFlyBody } from "./core/cinemachine/CinemachineFlyBody";
export { CinemachinePOVAim } from "./core/cinemachine/CinemachinePOVAim";
export { CinemachineFollowBody } from "./core/cinemachine/CinemachineFollowBody";
export { CinemachineHardLookAtAim } from "./core/cinemachine/CinemachineHardLookAtAim";

// =====================
// PHYSICS
// =====================
export { Physics } from "./physics/Physics";
export { RaycastHit } from "./physics/RaycastHit";
export { Collider } from "./physics/Collider";
export { BoxCollider } from "./physics/BoxCollider";
export { SphereCollider } from "./physics/SphereCollider";
export { CapsuleCollider } from "./physics/CapsuleCollider";
export { Rigidbody, ForceMode, RigidbodyConstraints } from "./physics/Rigidbody";
export { PhysicMaterial } from "./physics/PhysicMaterial";
export { Collision, ContactPoint } from "./physics/Collision";

// =====================
// ANIMATION
// =====================
export { AnimationClip } from "./core/animation/AnimationClip";
export { Animation, AnimationWrapMode } from "./core/animation/Animation";
export { Animator, AnimatorState, AnimatorTransition } from "./core/animation/Animator";

// =====================
// AUDIO
// =====================
export { AudioClip } from "./core/audio/AudioClip";
export { AudioSource, AudioRolloffMode } from "./core/audio/AudioSource";
export { AudioListener } from "./core/audio/AudioListener";
export { AudioManager } from "./core/audio/AudioManager";

// =====================
// POOL
// =====================
export { ObjectPool } from "./core/pool/ObjectPool";
export type { ObjectPoolCallbacks } from "./core/pool/ObjectPool";

// =====================
// PARTICLES
// =====================
export { ParticleSystem, ParticleBurst } from "./core/particles/ParticleSystem";
export { ParticleShape } from "./core/particles/ParticleShape";
export { Gradient } from "./core/particles/Gradient";
export {
    ParticleSimulationSpace,
    ParticleRenderMode,
    ParticleShapeType,
    GradientMode,
} from "./core/particles/ParticleTypes";

// =====================
// UI
// =====================
export { Canvas, CanvasRenderMode, CanvasRepaintMode } from "./core/ui/Canvas";
export {
    CanvasScaler,
    CanvasScaleMode,
    ScreenMatchMode,
    CanvasPhysicalUnit,
} from "./core/ui/CanvasScaler";
export {
    RectTransform,
    RectTransformAxis,
    RectTransformEdge,
} from "./core/ui/RectTransform";
export { UIBehaviour } from "./core/ui/UIBehaviour";
export { UIImage, ImageFillMethod, ImageFillOrigin, ImageType } from "./core/ui/UIImage";
export { UIText, TextAlignment, VerticalAlignment, TextOverflow } from "./core/ui/UIText";
export { Button, ButtonState } from "./core/ui/Button";
export { Selectable, SelectableState } from "./core/ui/Selectable";
export { SelectableTransition, ColorBlock, SpriteState } from "./core/ui/SelectableTransition";
export { Navigation, NavigationMode, NavigationDirection } from "./core/ui/Navigation";
export { VirtualJoystick } from "./core/ui/VirtualJoystick";
export { Slider, SliderDirection } from "./core/ui/Slider";
export { Toggle } from "./core/ui/Toggle";
export { ToggleGroup } from "./core/ui/ToggleGroup";
export { LayoutElement, LayoutUtility } from "./core/ui/LayoutElement";
export type { ILayoutSize } from "./core/ui/LayoutElement";
export {
    LayoutGroup, LinearLayoutGroup, LayoutPadding, LayoutAnchor,
    HorizontalLayoutGroup, VerticalLayoutGroup,
} from "./core/ui/LayoutGroup";
export {
    GridLayoutGroup, GridStartCorner, GridStartAxis, GridConstraint,
} from "./core/ui/GridLayoutGroup";
export { ContentSizeFitter, FitMode } from "./core/ui/ContentSizeFitter";
export { CanvasGroup } from "./core/ui/CanvasGroup";
export { RectMask2D, MaskPadding } from "./core/ui/RectMask2D";
export { ScrollRect, ScrollMovementType } from "./core/ui/ScrollRect";
export { Scrollbar, ScrollbarDirection } from "./core/ui/Scrollbar";
export { Dropdown } from "./core/ui/Dropdown";
export { EventSystem } from "./core/ui/EventSystem";
export { UIEvent } from "./core/ui/UIEvent";
export { PointerEventData } from "./core/ui/PointerEventData";

// =====================
// SCENARIO
// =====================
export { Scenario } from "./core/scenario/Scenario";
export { ScenarioBehaviour } from "./core/scenario/ScenarioBehaviour";
export { ScenarioAssets } from "./core/scenario/ScenarioAssets";
export { ScenarioCategory, ScenarioLoadState } from "./core/scenario/ScenarioTypes";
export type {
    IScenarioManifest,
    IScenarioAuthor,
    IScenarioLoadProgress,
    IScenarioContext,
    IAssetProvider,
} from "./core/scenario/ScenarioTypes";

// ============================================
// DEFAULT NAMESPACE EXPORT
// ============================================
// Enables: import WebEngine from "WebEngineTS";
//          const pos = new WebEngine.Vector3(1, 2, 3);
//
// WARNING: Using the namespace object prevents tree-shaking.
// Prefer named imports for production builds.
// ============================================

import { GameObject } from "./core/GameObject";
import { Component } from "./core/Component";
import { Transform } from "./core/Transform";
import { Scene } from "./core/Scene";
import { SceneManager } from "./core/SceneManager";
import { Application, GraphicsPowerPreference } from "./core/Application";
import { Time } from "./core/Time";
import { EngineSettings } from "./core/EngineSettings";
import { Behaviour } from "./core/Behaviour";
import { ScriptableBehaviour } from "./core/ScriptableBehaviour";
import { EngineObject } from "./core/EngineObject";
import { Input } from "./core/Input";
import { KeyCode } from "./core/KeyCode";
import { Gamepad, GamepadState, GamepadButton } from "./core/input/Gamepad";
import { Touch, TouchInfo, TouchPhase } from "./core/input/Touch";
import { DeviceSensors } from "./core/input/DeviceSensors";
import { Plugin } from "./core/plugins/Plugin";
import { PluginManager } from "./core/plugins/PluginManager";
import { FieldType } from "./core/reflection/Types";
import { TypeRegistry } from "./core/reflection/TypeRegistry";
import {
    Serializable, SerializedField, Range, Header, Tooltip, HideInInspector,
    getClassMeta, getAllFields,
} from "./core/reflection/Decorators";
import { ValueSerializer } from "./core/serialization/ValueSerializer";
import { SceneSerializer } from "./core/serialization/SceneSerializer";
import { Prefab } from "./core/serialization/Prefab";

import { PostProcessing } from "./core/postprocessing/PostProcessing";
import { PostEffect } from "./core/postprocessing/PostEffect";
import { BloomEffect } from "./core/postprocessing/BloomEffect";
import { VignetteEffect } from "./core/postprocessing/VignetteEffect";

import { Mathf } from "./core/math/Mathf";
import { AnimationCurve, Keyframe, WrapMode } from "./core/math/AnimationCurve";
import { Vector2 } from "./core/math/Vector2";
import { Vector3 } from "./core/math/Vector3";
import { Vector4 } from "./core/math/Vector4";
import { Quaternion } from "./core/math/Quaternion";
import { Matrix4x4 } from "./core/math/Matrix4x4";
import { Color } from "./core/math/Color";
import { Bounds } from "./core/math/Bounds";
import { Rect } from "./core/math/Rect";
import { Ray } from "./core/math/Ray";

import { Coroutine, CoroutineRunner, WaitForSeconds, WaitForSecondsRealtime, WaitUntil, WaitWhile, WaitForEndOfFrame, WaitForFixedUpdate } from "./core/Coroutine";

import { Resources } from "./core/assets/Resources";
import { LoadHandle } from "./core/assets/LoadHandle";
import { JsonAsset, TextAsset, BinaryAsset } from "./core/assets/AssetTypes";

import { Mesh } from "./core/graphics/Mesh";
import { Texture, FilterMode, TextureWrapMode } from "./core/graphics/Texture";
import { Texture2D, TextureFormat } from "./core/graphics/Texture2D";
import { Cubemap } from "./core/graphics/Cubemap";
import { Shader, ShaderPropertyType } from "./core/graphics/Shader";
import { Material } from "./core/graphics/Material";
import { StandardMaterial, MaterialRenderMode } from "./core/graphics/StandardMaterial";
import { UnlitMaterial } from "./core/graphics/UnlitMaterial";

import { RenderSettings, FogMode } from "./core/RenderSettings";

import { MeshFilter } from "./core/rendering/MeshFilter";
import { Renderer, ShadowCastingMode } from "./core/rendering/Renderer";
import { MeshRenderer } from "./core/rendering/MeshRenderer";
import { InstancedMeshRenderer } from "./core/rendering/InstancedMeshRenderer";
import { StaticBatchingUtility } from "./core/rendering/StaticBatchingUtility";
import { LineRenderer, LineAlignment, LineTextureMode } from "./core/components/LineRenderer";
import { SpriteRenderer, SpriteBillboardMode } from "./core/components/SpriteRenderer";

import { Camera, CameraClearFlags } from "./core/components/Camera";
import { Light, LightShadows, LightShadowResolution } from "./core/components/Light";
import { DirectionalLight } from "./core/components/DirectionalLight";
import { PointLight } from "./core/components/PointLight";
import { SpotLight } from "./core/components/SpotLight";
import { AmbientLight } from "./core/components/AmbientLight";
import { LODGroup } from "./core/components/LODGroup";

import { CameraState, CinemachineBlendStyle, CinemachineBody, CinemachineAim } from "./core/cinemachine/CinemachineCore";
import { CinemachineVirtualCamera } from "./core/cinemachine/CinemachineVirtualCamera";
import { CinemachineBrain } from "./core/cinemachine/CinemachineBrain";
import { CinemachineOrbitalBody } from "./core/cinemachine/CinemachineOrbitalBody";
import { CinemachineOrbitalAim } from "./core/cinemachine/CinemachineOrbitalAim";
import { CinemachineFlyBody } from "./core/cinemachine/CinemachineFlyBody";
import { CinemachinePOVAim } from "./core/cinemachine/CinemachinePOVAim";
import { CinemachineFollowBody } from "./core/cinemachine/CinemachineFollowBody";
import { CinemachineHardLookAtAim } from "./core/cinemachine/CinemachineHardLookAtAim";

import { Physics } from "./physics/Physics";
import { RaycastHit } from "./physics/RaycastHit";
import { Collider } from "./physics/Collider";
import { BoxCollider } from "./physics/BoxCollider";
import { SphereCollider } from "./physics/SphereCollider";
import { CapsuleCollider } from "./physics/CapsuleCollider";
import { Rigidbody, ForceMode, RigidbodyConstraints } from "./physics/Rigidbody";
import { PhysicMaterial } from "./physics/PhysicMaterial";
import { Collision, ContactPoint } from "./physics/Collision";

import { AnimationClip } from "./core/animation/AnimationClip";
import { Animation, AnimationWrapMode } from "./core/animation/Animation";
import { Animator, AnimatorState, AnimatorTransition } from "./core/animation/Animator";

import { AudioClip } from "./core/audio/AudioClip";
import { AudioSource, AudioRolloffMode } from "./core/audio/AudioSource";
import { AudioListener } from "./core/audio/AudioListener";
import { AudioManager } from "./core/audio/AudioManager";

import { ObjectPool } from "./core/pool/ObjectPool";

import { ParticleSystem, ParticleBurst } from "./core/particles/ParticleSystem";
import { ParticleShape } from "./core/particles/ParticleShape";
import { Gradient } from "./core/particles/Gradient";
import {
    ParticleSimulationSpace,
    ParticleRenderMode,
    ParticleShapeType,
    GradientMode,
} from "./core/particles/ParticleTypes";

import { Canvas, CanvasRenderMode, CanvasRepaintMode } from "./core/ui/Canvas";
import {
    CanvasScaler,
    CanvasScaleMode,
    ScreenMatchMode,
    CanvasPhysicalUnit,
} from "./core/ui/CanvasScaler";
import {
    RectTransform,
    RectTransformAxis,
    RectTransformEdge,
} from "./core/ui/RectTransform";
import { UIBehaviour } from "./core/ui/UIBehaviour";
import { UIImage, ImageFillMethod, ImageFillOrigin, ImageType } from "./core/ui/UIImage";
import { Sprite, SpriteBorder } from "./core/graphics/Sprite";
import { UIText, TextAlignment, VerticalAlignment, TextOverflow } from "./core/ui/UIText";
import { Button, ButtonState } from "./core/ui/Button";
import { Selectable, SelectableState } from "./core/ui/Selectable";
import { SelectableTransition, ColorBlock, SpriteState } from "./core/ui/SelectableTransition";
import { Navigation, NavigationMode, NavigationDirection } from "./core/ui/Navigation";
import { VirtualJoystick } from "./core/ui/VirtualJoystick";
import { Slider, SliderDirection } from "./core/ui/Slider";
import { Toggle } from "./core/ui/Toggle";
import { ToggleGroup } from "./core/ui/ToggleGroup";
import { LayoutElement } from "./core/ui/LayoutElement";
import {
    LayoutGroup, LinearLayoutGroup, LayoutPadding, LayoutAnchor,
    HorizontalLayoutGroup, VerticalLayoutGroup,
} from "./core/ui/LayoutGroup";
import {
    GridLayoutGroup, GridStartCorner, GridStartAxis, GridConstraint,
} from "./core/ui/GridLayoutGroup";
import { ContentSizeFitter, FitMode } from "./core/ui/ContentSizeFitter";
import { CanvasGroup } from "./core/ui/CanvasGroup";
import { RectMask2D, MaskPadding } from "./core/ui/RectMask2D";
import { ScrollRect, ScrollMovementType } from "./core/ui/ScrollRect";
import { Scrollbar, ScrollbarDirection } from "./core/ui/Scrollbar";
import { Dropdown } from "./core/ui/Dropdown";
import { EventSystem } from "./core/ui/EventSystem";
import { UIEvent } from "./core/ui/UIEvent";
import { PointerEventData } from "./core/ui/PointerEventData";

import { Scenario } from "./core/scenario/Scenario";
import { ScenarioBehaviour } from "./core/scenario/ScenarioBehaviour";
import { ScenarioAssets } from "./core/scenario/ScenarioAssets";
import { ScenarioCategory, ScenarioLoadState } from "./core/scenario/ScenarioTypes";

/**
 * WebEngineTS namespace object.
 *
 * Provides access to all engine classes and enums as properties
 * of a single object. Useful for quick prototyping and UMD builds.
 *
 * @remarks
 * For production builds, prefer named imports for tree-shaking:
 * ```ts
 * import { Vector3, GameObject } from "WebEngineTS";
 * ```
 */
const WebEngineTS = {
    // Core
    GameObject, Component, Transform, Scene, SceneManager,
    Application, GraphicsPowerPreference, Time, EngineSettings, Behaviour, ScriptableBehaviour,
    EngineObject, Input, KeyCode,
    Gamepad, GamepadState, GamepadButton,
    Touch, TouchInfo, TouchPhase,
    DeviceSensors,

    // Plugins
    Plugin, PluginManager,

    // Post-processing
    PostProcessing, PostEffect, BloomEffect, VignetteEffect,

    // Reflection / Serialization
    FieldType, TypeRegistry,
    Serializable, SerializedField, Range, Header, Tooltip, HideInInspector,
    getClassMeta, getAllFields,
    ValueSerializer, SceneSerializer, Prefab,

    // Math
    Mathf, AnimationCurve, Keyframe, WrapMode,
    Vector2, Vector3, Vector4, Quaternion, Matrix4x4,
    Color, Bounds, Rect, Ray,

    // Coroutines
    Coroutine, CoroutineRunner,
    WaitForSeconds, WaitForSecondsRealtime,
    WaitUntil, WaitWhile, WaitForEndOfFrame, WaitForFixedUpdate,

    // Assets
    Resources, LoadHandle, JsonAsset, TextAsset, BinaryAsset,

    // Graphics
    Mesh, Texture, FilterMode, TextureWrapMode,
    Texture2D, TextureFormat, Cubemap,
    Shader, ShaderPropertyType,
    Material, StandardMaterial, MaterialRenderMode, UnlitMaterial,

    // Render Settings
    RenderSettings, FogMode,

    // Components — Rendering
    MeshFilter, Renderer, ShadowCastingMode, MeshRenderer, InstancedMeshRenderer,
    StaticBatchingUtility,
    LineRenderer, LineAlignment, LineTextureMode,
    SpriteRenderer, SpriteBillboardMode,

    // Components — Camera & Lights
    Camera, CameraClearFlags,
    Light, LightShadows, LightShadowResolution,
    DirectionalLight, PointLight, SpotLight, AmbientLight,
    LODGroup,

    // Cinemachine
    CameraState, CinemachineBlendStyle, CinemachineBody, CinemachineAim,
    CinemachineVirtualCamera, CinemachineBrain,
    CinemachineOrbitalBody, CinemachineOrbitalAim,
    CinemachineFlyBody, CinemachinePOVAim,
    CinemachineFollowBody, CinemachineHardLookAtAim,

    // Physics
    Physics, RaycastHit, Collider, BoxCollider,
    SphereCollider, CapsuleCollider,
    Rigidbody, ForceMode, RigidbodyConstraints,
    PhysicMaterial, Collision, ContactPoint,

    // Animation
    AnimationClip, Animation, AnimationWrapMode,
    Animator, AnimatorState, AnimatorTransition,

    // Audio
    AudioClip, AudioSource, AudioRolloffMode,
    AudioListener, AudioManager,

    // Pool
    ObjectPool,

    // Particles
    ParticleSystem, ParticleBurst, ParticleShape, Gradient,
    ParticleSimulationSpace, ParticleRenderMode, ParticleShapeType, GradientMode,

    // UI
    Canvas, CanvasRenderMode, CanvasRepaintMode, UIBehaviour,
    RectTransform, RectTransformAxis, RectTransformEdge,
    CanvasScaler, CanvasScaleMode, ScreenMatchMode, CanvasPhysicalUnit,
    UIImage, ImageFillMethod, ImageFillOrigin, ImageType,
    Sprite, SpriteBorder,
    UIText, TextAlignment, VerticalAlignment, TextOverflow,
    Button, ButtonState, Selectable, SelectableState, EventSystem, VirtualJoystick,
    SelectableTransition, ColorBlock, SpriteState,
    Navigation, NavigationMode, NavigationDirection,
    UIEvent, PointerEventData,
    Slider, SliderDirection, Toggle, ToggleGroup,
    LayoutElement, LayoutGroup, LinearLayoutGroup, LayoutPadding, LayoutAnchor,
    GridLayoutGroup, GridStartCorner, GridStartAxis, GridConstraint,
    HorizontalLayoutGroup, VerticalLayoutGroup, ContentSizeFitter, FitMode,
    CanvasGroup, RectMask2D, MaskPadding, ScrollRect, ScrollMovementType,
    Scrollbar, ScrollbarDirection, Dropdown,

    // Scenario
    Scenario, ScenarioBehaviour, ScenarioAssets,
    ScenarioCategory, ScenarioLoadState,
} as const;

export default WebEngineTS;