// src/engine/index.ts

// Експортуємо класи ядра
export { GameObject } from "./core/GameObject";
export { Component } from "./core/Component";
export { Scenario } from "../core/scenario/Scenario.ts";
export { SceneManager } from "./core/SceneManager"; // Якщо потрібно для переходів
export { Application } from "./core/Application";
export { Scene } from "./core/Scene";

// Компоненти
export { ScriptableBehaviour } from "./core/ScriptableBehaviour";
export { Transform } from "./core/Transform";

// Математика
export { Vector3 } from "./core/math/Vector3";
export { Quaternion } from "./core/math/Quaternion";
export { Time } from "./core/Time";

// Типи
export { ScenarioCategory } from "../core/scenario/ScenarioTypes.ts";
export type { IScenarioManifest } from "../core/scenario/ScenarioTypes.ts";