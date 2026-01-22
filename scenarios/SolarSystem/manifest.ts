import {type IScenarioManifest, ScenarioCategory } from "@engine";

// 1. Імпортуємо картинку (Vite сам розбереться зі шляхом)
import previewImg from "./assets/solar_preview.png";

// 2. Експортуємо маніфест
const manifest: IScenarioManifest = {
    id: "solar-system-2026",
    name: "Сонячна Система",
    description: "Інтерактивна модель орбіт планет.",
    category: ScenarioCategory.Astronomy,

    // Використовуємо імпортовану картинку
    previewImage: previewImg,

    version: "1.0.0",
    author: "Кафедра Астрономії",

    // 3. Явно вказуємо, де лежить код (Точка входу)
    // Це Lazy Load: файл завантажиться тільки коли ми викличемо цю функцію
    main: () => import("./SolarSystemScenario.ts")
};

export default manifest;