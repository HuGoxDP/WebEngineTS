// src/engine/index.ts
// ============================================
// ThreeJS Engine - Unity-like API
// ============================================
//
// Використання (як у Unity):
//
//   Unity C#:
//     using UnityEngine;
//
//   ThreeJS Engine:
//     import { Vector3, GameObject, Camera } from '@engine';
//
// Все з одного місця - як UnityEngine namespace!
// ============================================

// =====================
// CORE - Ядро двигуна
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

// =====================
// MATH - Математика
// =====================
export { Vector2 } from "./core/math/Vector2";
export { Vector3 } from "./core/math/Vector3";
export { Vector4 } from "./core/math/Vector4";
export { Quaternion } from "./core/math/Quaternion";
export { Matrix4x4 } from "./core/math/Matrix4x4";
export { Bounds } from "./core/math/Bounds";
export { Rect } from "./core/math/Rect";

// =====================
// GRAPHICS - Графіка
// =====================
export { Color } from "./core/graphics/Color";
export { Mesh } from "./core/graphics/Mesh";
export { Texture, FilterMode, TextureWrapMode } from "./core/graphics/Texture";
export { Texture2D, TextureFormat } from "./core/graphics/Texture2D";
export { Shader, ShaderPropertyType } from "./core/graphics/Shader";
export { Material } from "./core/graphics/Material";
export { StandardMaterial, MaterialRenderMode } from "./core/graphics/StandardMaterial";

// =====================
// COMPONENTS - Компоненти
// =====================
export { MeshFilter } from "./core/components/MeshFilter";
export { Renderer, ShadowCastingMode, LightProbeUsage, ReflectionProbeUsage } from "./core/components/Renderer";
export { MeshRenderer } from "./core/components/MeshRenderer";
export { Camera, CameraClearFlags } from "./core/components/Camera";
export { Light, LightShadows, LightShadowResolution } from "./core/components/Light";
export { DirectionalLight } from "./core/components/DirectionalLight";

// =====================
// SCENARIO - Сценарії
// =====================
export { Scenario } from "../core/scenario/Scenario";
export { ScenarioCategory } from "../core/scenario/ScenarioTypes";
export type { IScenarioManifest } from "../core/scenario/ScenarioTypes";

