// scenarios/SolarSystem/manifest.ts

import type { IScenarioManifest } from "@engine";
import { ScenarioCategory } from "@engine";
import previewImg from "./assets/solar_preview.png";

const manifest: IScenarioManifest = {
    id: "solar-system-2026",
    name: "Сонячна Система",
    description: "Інтерактивна модель орбіт планет навколо Сонця.",
    category: ScenarioCategory.Astronomy,
    previewImage: previewImg,
    version: "1.0.0",
    author: "Кафедра Астрономії",
    main: () => import("./SolarSystemScenario")
};

export default manifest;