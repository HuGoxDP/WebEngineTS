import type {IScenarioManifest} from "./ScenarioTypes";
import { Scenario } from "./Scenario";

export class ScenarioRepository {

    // Шукаємо ТІЛЬКИ manifest.ts файли (відносно src/core/scenario/)
    // ../../../ = вихід з src/core/scenario до кореня проекту
    private _manifestsGlob = import.meta.glob('../../../scenarios/**/manifest.ts', { eager: true });

    private _manifests: IScenarioManifest[] = [];

    constructor() {
        this._discoverScenarios();
    }

    private _discoverScenarios() {
        console.log("Scanning for scenarios...");

        for (const path in this._manifestsGlob) {
            try {
                const module = this._manifestsGlob[path] as { default: IScenarioManifest };
                const manifest = module.default;

                // Валідація: перевіряємо, чи є точка входу
                if (!manifest.main) {
                    console.error(`Manifest at ${path} is missing 'main' entry point.`);
                    continue;
                }

                this._manifests.push(manifest);
            } catch (e) {
                console.error(`Error parsing manifest at ${path}:`, e);
            }
        }
    }

    public getAllManifests(): IScenarioManifest[] {
        return this._manifests;
    }

    /**
     * Завантажує код, використовуючи функцію з маніфесту.
     */
    public async loadScenarioCode(id: string): Promise<new () => Scenario> {
        const manifest = this._manifests.find(m => m.id === id);

        if (!manifest) {
            throw new Error(`Scenario not found for ID: ${id}`);
        }

        // Викликаємо функцію main(), яку ми прописали в manifest.ts
        const module = await manifest.main();

        return module.default;
    }
}