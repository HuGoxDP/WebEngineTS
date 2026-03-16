// src/engine/index.ts
// ============================================
// WebEngineTS - Unity-like API
// ============================================
//
// Usage (like Unity):
//
//   Unity C#:
//     using UnityEngine;
//
//   WebEngineTS:
//     import { Vector3, GameObject, Camera } from 'WebEngineTS';
//
// Everything from a single import — like UnityEngine namespace!
// ============================================

// =====================
// CORE - Engine core
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
// Physics
// =====================
export { Physics } from "./physics/Physics";
export { Ray } from "./core/math/Ray";
export { RaycastHit } from "./physics/RaycastHit";

// =====================
// MATH
// =====================
export { Vector2 } from "./core/math/Vector2";
export { Vector3 } from "./core/math/Vector3";
export { Vector4 } from "./core/math/Vector4";
export { Quaternion } from "./core/math/Quaternion";
export { Matrix4x4 } from "./core/math/Matrix4x4";
export { Bounds } from "./core/math/Bounds";
export { Rect } from "./core/math/Rect";

// =====================
// GRAPHICS
// =====================
export { Color } from "./core/math/Color";
export { Mesh } from "./core/graphics/Mesh";
export { Texture, FilterMode, TextureWrapMode } from "./core/graphics/Texture";
export { Texture2D, TextureFormat } from "./core/graphics/Texture2D";
export { Shader, ShaderPropertyType } from "./core/graphics/Shader";
export { Material } from "./core/graphics/Material";
export { StandardMaterial, MaterialRenderMode } from "./core/graphics/StandardMaterial";
export { UnlitMaterial } from "./core/graphics/UnlitMaterial";

// =====================
// COMPONENTS
// =====================
export { MeshFilter } from "./core/rendering/MeshFilter.ts";
export { Renderer, ShadowCastingMode} from "./core/rendering/Renderer.ts";
export { MeshRenderer } from "./core/rendering/MeshRenderer.ts";
export { LineRenderer, LineAlignment, LineTextureMode } from "./core/components/LineRenderer";
export type { GradientColorKey, CurveKey } from "./core/components/LineRenderer";
export { Camera, CameraClearFlags } from "./core/components/Camera";
export { Light, LightShadows, LightShadowResolution } from "./core/components/Light";
export { DirectionalLight } from "./core/components/DirectionalLight";
export { PointLight } from "./core/components/PointLight";
export { SpotLight} from "./core/components/SpotLight.ts";
export { AmbientLight } from "./core/components/AmbientLight";

// ====================
// CINEMACHINE
// ====================
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
    IScenarioEntryPoint,
} from "./core/scenario/ScenarioTypes";