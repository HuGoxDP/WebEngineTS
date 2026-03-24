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
export { Application } from "./core/Application";
export { Time } from "./core/Time";
export { EngineSettings } from "./core/EngineSettings";
export { Behaviour } from "./core/Behaviour";
export { ScriptableBehaviour } from "./core/ScriptableBehaviour";
export { EngineObject } from "./core/EngineObject";
export { Input } from "./core/Input";
export { KeyCode } from "./core/KeyCode";

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
export { Mesh } from "./core/graphics/Mesh";
export { Texture, FilterMode, TextureWrapMode } from "./core/graphics/Texture";
export { Texture2D, TextureFormat } from "./core/graphics/Texture2D";
export { Cubemap } from "./core/graphics/Cubemap";
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
export { LineRenderer, LineAlignment, LineTextureMode } from "./core/components/LineRenderer";
export type { GradientColorKey, CurveKey } from "./core/components/LineRenderer";
export { SpriteRenderer, SpriteBillboardMode } from "./core/components/SpriteRenderer";

// =====================
// COMPONENTS — Camera & Lights
// =====================
export { Camera, CameraClearFlags } from "./core/components/Camera";
export { Light, LightShadows, LightShadowResolution } from "./core/components/Light";
export { DirectionalLight } from "./core/components/DirectionalLight";
export { PointLight } from "./core/components/PointLight";
export { SpotLight } from "./core/components/SpotLight";
export { AmbientLight } from "./core/components/AmbientLight";

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
import { Application } from "./core/Application";
import { Time } from "./core/Time";
import { EngineSettings } from "./core/EngineSettings";
import { Behaviour } from "./core/Behaviour";
import { ScriptableBehaviour } from "./core/ScriptableBehaviour";
import { EngineObject } from "./core/EngineObject";
import { Input } from "./core/Input";
import { KeyCode } from "./core/KeyCode";

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
import { LineRenderer, LineAlignment, LineTextureMode } from "./core/components/LineRenderer";
import { SpriteRenderer, SpriteBillboardMode } from "./core/components/SpriteRenderer";

import { Camera, CameraClearFlags } from "./core/components/Camera";
import { Light, LightShadows, LightShadowResolution } from "./core/components/Light";
import { DirectionalLight } from "./core/components/DirectionalLight";
import { PointLight } from "./core/components/PointLight";
import { SpotLight } from "./core/components/SpotLight";
import { AmbientLight } from "./core/components/AmbientLight";

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
    Application, Time, EngineSettings, Behaviour, ScriptableBehaviour,
    EngineObject, Input, KeyCode,

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
    MeshFilter, Renderer, ShadowCastingMode, MeshRenderer,
    LineRenderer, LineAlignment, LineTextureMode,
    SpriteRenderer, SpriteBillboardMode,

    // Components — Camera & Lights
    Camera, CameraClearFlags,
    Light, LightShadows, LightShadowResolution,
    DirectionalLight, PointLight, SpotLight, AmbientLight,

    // Cinemachine
    CameraState, CinemachineBlendStyle, CinemachineBody, CinemachineAim,
    CinemachineVirtualCamera, CinemachineBrain,
    CinemachineOrbitalBody, CinemachineOrbitalAim,
    CinemachineFlyBody, CinemachinePOVAim,
    CinemachineFollowBody, CinemachineHardLookAtAim,

    // Physics
    Physics, RaycastHit,

    // Scenario
    Scenario, ScenarioBehaviour, ScenarioAssets,
    ScenarioCategory, ScenarioLoadState,
} as const;

export default WebEngineTS;