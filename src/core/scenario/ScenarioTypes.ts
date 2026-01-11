import { Scenario } from "./Scenario";

export const ScenarioCategory = {
    Physics: "Physics",
    Chemistry: "Chemistry",
    Biology: "Biology",
    Astronomy: "Astronomy",
    Demo: "Demo"
} as const;

export type ScenarioCategory = typeof ScenarioCategory[keyof typeof ScenarioCategory];

export interface IScenarioManifest {
    id: string;
    name: string;
    description: string;
    category: ScenarioCategory;

    /** * URL картинки.
     * Ми будемо отримувати його через import image from './assets/...'
     */
    previewImage: string;

    version: string;
    author?: string;

    /**
     * Точка входу. Явне посилання на файл коду.
     * Це вирішує проблему "Scenario code not found".
     */
    main: () => Promise<{ default: new () => Scenario }>;
}