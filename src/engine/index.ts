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

// Математика
export { Vector3 } from "./core/math/Vector3";
export { Vector2 } from "./core/math/Vector2";
export { Quaternion } from "./core/math/Quaternion";

//Graphic
export { Color } from "./core/graphics/Color";
export { Texture, FilterMode, TextureWrapMode } from "./core/graphics/Texture";
export { Mesh, PrimitiveType } from "./core/graphics/Mesh";

// Типи
export { ScenarioCategory } from "../core/scenario/ScenarioTypes.ts";
export type { IScenarioManifest } from "../core/scenario/ScenarioTypes.ts";