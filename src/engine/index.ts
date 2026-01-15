// src/engine/index.ts

// Експортуємо класи ядра
export { GameObject } from "./core/GameObject";
export { Component } from "./core/Component";
export { Scenario } from "../core/scenario/Scenario.ts";
export { SceneManager } from "./core/SceneManager";
export { Application } from "./core/Application";
export { Scene } from "./core/Scene";
export { Time } from "./core/Time";

// Компоненти
export { ScriptableBehaviour } from "./core/ScriptableBehaviour";
export { Transform } from "./core/Transform";
export { MeshFilter } from "./core/components/MeshFilter";
export { Renderer, ShadowCastingMode, LightProbeUsage, ReflectionProbeUsage } from "./core/components/Renderer";
export { MeshRenderer } from "./core/components/MeshRenderer";

// Математика
export { Vector3 } from "./core/math/Vector3";
export { Vector2 } from "./core/math/Vector2";
export { Vector4 } from "./core/math/Vector4";
export { Matrix4x4 } from "./core/math/Matrix4x4";
export { Quaternion } from "./core/math/Quaternion";
export { Bounds } from "./core/math/Bounds";
export { Rect } from "./core/math/Rect";

//Graphic
export { Color } from "./core/graphics/Color";
export { Texture } from "./core/graphics/Texture";
export { Texture2D, TextureFormat } from "./core/graphics/Texture2D";
export { FilterMode, TextureWrapMode } from "./core/graphics/Texture";
export { Shader, ShaderPropertyType } from "./core/graphics/Shader";
export { Material } from "./core/graphics/Material";
export { StandardMaterial, MaterialRenderMode } from "./core/graphics/StandardMaterial";

// Типи
export { ScenarioCategory } from "../core/scenario/ScenarioTypes.ts";
export type { IScenarioManifest } from "../core/scenario/ScenarioTypes.ts";