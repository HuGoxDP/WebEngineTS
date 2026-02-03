import JSZip from 'jszip';
import { EngineObject } from '../EngineObject';
import type { IScenarioManifest, IScenarioContext, IScenarioLoadProgress } from './ScenarioTypes';
import { ScenarioLoadState } from './ScenarioTypes';

/**
 * Scenario.ts
 * Представляє завантажений сценарій в пам'яті.
 * Аналог Unity AssetBundle - тримається в RAM і очищається при вивантаженні.
 *
 * Життєвий цикл:
 * 1. LoadFromUrl/LoadFromData - завантаження ZIP в пам'ять
 * 2. Initialize - парсинг маніфесту та підготовка
 * 3. Run - запуск точки входу
 * 4. Unload - очищення пам'яті
 */
export class Scenario extends EngineObject {
    // === Статичні властивості ===

    /** Поточний активний сценарій */
    private static _current: Scenario | null = null;

    /** Отримати поточний активний сценарій */
    public static get current(): Scenario | null {
        return this._current;
    }

    // === Властивості екземпляра ===

    /** Маніфест сценарію */
    private _manifest: IScenarioManifest | null = null;

    /** ZIP-архів в пам'яті */
    private _zip: JSZip | null = null;

    /** Поточний стан завантаження */
    private _loadState: ScenarioLoadState = ScenarioLoadState.Unloaded;

    /** Кеш завантажених ресурсів (blob URLs) */
    private _assetCache: Map<string, string> = new Map();

    /** Кеш завантажених скриптів (blob URLs) */
    private _scriptCache: Map<string, string> = new Map();

    /** Колбек прогресу завантаження */
    private _onProgressCallback?: (progress: IScenarioLoadProgress) => void;

    /** Контекст виконання для скриптів */
    private _context: IScenarioContext | null = null;

    // === Конструктор ===

    constructor(name: string = "Scenario") {
        super(name);
    }

    // === Публічний API ===

    /** Отримати маніфест сценарію */
    public get manifest(): IScenarioManifest | null {
        return this._manifest;
    }

    /** Отримати поточний стан */
    public get loadState(): ScenarioLoadState {
        return this._loadState;
    }

    /** Чи завантажений сценарій */
    public get isLoaded(): boolean {
        return this._loadState === ScenarioLoadState.Ready ||
               this._loadState === ScenarioLoadState.Running;
    }

    /** Чи виконується сценарій */
    public get isRunning(): boolean {
        return this._loadState === ScenarioLoadState.Running;
    }

    /**
     * Встановлює колбек для відстеження прогресу завантаження.
     * @param callback Функція, яка викликається при зміні прогресу
     */
    public onProgress(callback: (progress: IScenarioLoadProgress) => void): Scenario {
        this._onProgressCallback = callback;
        return this;
    }

    /**
     * Завантажує сценарій з URL.
     * ZIP-архів завантажується в пам'ять (RAM).
     * @param url URL до ZIP-архіву сценарію
     */
    public async loadFromUrl(url: string): Promise<void> {
        this.updateProgress(ScenarioLoadState.Loading, 0, "Downloading scenario...");

        try {
            // Завантажуємо ZIP як ArrayBuffer
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download scenario: ${response.status} ${response.statusText}`);
            }

            const totalSize = parseInt(response.headers.get('content-length') || '0');
            const reader = response.body?.getReader();

            if (!reader) {
                throw new Error("Failed to read response body");
            }

            // Читаємо з прогресом
            const chunks: Uint8Array[] = [];
            let receivedSize = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                receivedSize += value.length;

                if (totalSize > 0) {
                    const progress = receivedSize / totalSize * 0.5; // 50% на завантаження
                    this.updateProgress(ScenarioLoadState.Loading, progress, "Downloading...");
                }
            }

            // Об'єднуємо чанки в один ArrayBuffer
            const data = new Uint8Array(receivedSize);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.length;
            }

            // Завантажуємо з даних
            await this.loadFromData(data.buffer);

        } catch (error) {
            this.updateProgress(ScenarioLoadState.Error, 0, "Failed", String(error));
            throw error;
        }
    }

    /**
     * Завантажує сценарій з ArrayBuffer.
     * Використовується коли ZIP вже завантажено (наприклад, з File input).
     * @param data ArrayBuffer з ZIP-даними
     */
    public async loadFromData(data: ArrayBuffer): Promise<void> {
        this.updateProgress(ScenarioLoadState.Loading, 0.5, "Parsing ZIP archive...");

        try {
            // Парсимо ZIP в пам'ять
            this._zip = await JSZip.loadAsync(data);

            this.updateProgress(ScenarioLoadState.Loading, 0.6, "Reading manifest...");

            // Читаємо маніфест
            const manifestFile = this._zip.file('manifest.json');
            if (!manifestFile) {
                throw new Error("Manifest file (manifest.json) not found in ZIP archive");
            }

            const manifestJson = await manifestFile.async('string');
            this._manifest = JSON.parse(manifestJson) as IScenarioManifest;

            // Валідація маніфесту
            this.validateManifest(this._manifest);

            this.updateProgress(ScenarioLoadState.Loading, 0.8, "Preparing assets...");

            // Оновлюємо ім'я об'єкта
            this.name = this._manifest.name;

            // Створюємо контекст виконання
            this._context = this.createContext();

            this.updateProgress(ScenarioLoadState.Ready, 1, "Ready");

            console.log(`[Scenario] Loaded: ${this._manifest.name} v${this._manifest.version}`);

        } catch (error) {
            this.updateProgress(ScenarioLoadState.Error, 0, "Failed to parse", String(error));
            throw error;
        }
    }

    /**
     * Запускає виконання сценарію.
     * Знаходить і виконує точку входу (entryPoint).
     */
    public async run(): Promise<void> {
        if (!this.isLoaded || !this._manifest || !this._zip) {
            throw new Error("Scenario is not loaded. Call loadFromUrl or loadFromData first.");
        }

        if (this.isRunning) {
            console.warn("[Scenario] Scenario is already running");
            return;
        }

        // Вивантажуємо попередній сценарій
        if (Scenario._current && Scenario._current !== this) {
            Scenario._current.unload();
        }

        Scenario._current = this;
        this._loadState = ScenarioLoadState.Running;

        try {
            // Завантажуємо і виконуємо точку входу
            const entryPath = `scripts/${this._manifest.entryPoint}`;
            const entryFile = this._zip.file(entryPath);

            if (!entryFile) {
                throw new Error(`Entry point not found: ${entryPath}`);
            }

            const scriptContent = await entryFile.async('string');

            // Виконуємо скрипт в ізольованому контексті
            await this.executeScript(scriptContent, this._manifest.entryPoint);

            console.log(`[Scenario] Running: ${this._manifest.name}`);

        } catch (error) {
            this._loadState = ScenarioLoadState.Error;
            throw error;
        }
    }

    /**
     * Вивантажує сценарій з пам'яті.
     * Очищає всі ресурси та кеші.
     */
    public unload(): void {
        console.log(`[Scenario] Unloading: ${this.name}`);

        // Очищаємо blob URLs для ресурсів
        for (const blobUrl of this._assetCache.values()) {
            URL.revokeObjectURL(blobUrl);
        }
        this._assetCache.clear();

        // Очищаємо blob URLs для скриптів
        for (const blobUrl of this._scriptCache.values()) {
            URL.revokeObjectURL(blobUrl);
        }
        this._scriptCache.clear();

        // Очищаємо ZIP з пам'яті
        this._zip = null;
        this._manifest = null;
        this._context = null;

        // Оновлюємо стан
        this._loadState = ScenarioLoadState.Unloaded;

        // Очищаємо поточний сценарій
        if (Scenario._current === this) {
            Scenario._current = null;
        }

        // Викликаємо GC
        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
        }
    }

    /**
     * Отримує ресурс з архіву за шляхом.
     * @param path Шлях до ресурсу відносно папки assets/
     */
    public async getAsset(path: string): Promise<Blob> {
        if (!this._zip) {
            throw new Error("Scenario is not loaded");
        }

        const assetPath = `assets/${path}`;
        const file = this._zip.file(assetPath);

        if (!file) {
            throw new Error(`Asset not found: ${assetPath}`);
        }

        const data = await file.async('arraybuffer');
        return new Blob([data]);
    }

    /**
     * Отримує URL для ресурсу (blob URL).
     * URL зберігається в кеші і буде звільнений при unload.
     * @param path Шлях до ресурсу відносно папки assets/
     */
    public async getAssetUrl(path: string): Promise<string> {
        // Перевіряємо кеш
        if (this._assetCache.has(path)) {
            return this._assetCache.get(path)!;
        }

        const blob = await this.getAsset(path);
        const url = URL.createObjectURL(blob);

        // Зберігаємо в кеш
        this._assetCache.set(path, url);

        return url;
    }

    // === Приватні методи ===

    /**
     * Валідація маніфесту.
     */
    private validateManifest(manifest: IScenarioManifest): void {
        if (!manifest.manifestVersion) {
            throw new Error("Manifest is missing 'manifestVersion'");
        }
        if (!manifest.id) {
            throw new Error("Manifest is missing 'id'");
        }
        if (!manifest.name) {
            throw new Error("Manifest is missing 'name'");
        }
        if (!manifest.version) {
            throw new Error("Manifest is missing 'version'");
        }
        if (!manifest.entryPoint) {
            throw new Error("Manifest is missing 'entryPoint'");
        }
    }

    /**
     * Створює контекст виконання для скриптів сценарію.
     */
    private createContext(): IScenarioContext {
        return {
            manifest: this._manifest!,
            getAsset: (path: string) => this.getAsset(path),
            loadTexture: (path: string) => this.loadTexture(path),
            loadModel: (path: string) => this.loadModel(path)
        };
    }

    /**
     * Завантажує текстуру з архіву.
     */
    private async loadTexture(path: string): Promise<HTMLImageElement> {
        const url = await this.getAssetUrl(path);

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load texture: ${path}`));
            img.src = url;
        });
    }

    /**
     * Завантажує 3D модель з архіву.
     * TODO: Реалізувати повноцінне завантаження через GLTFLoader
     */
    private async loadModel(path: string): Promise<unknown> {
        const blob = await this.getAsset(path);
        // TODO: Інтеграція з ModelLoader
        console.log(`[Scenario] Model loading requested: ${path}, size: ${blob.size} bytes`);
        return blob;
    }

    /**
     * Виконує скрипт в ізольованому контексті.
     * @param code Код скрипта
     * @param filename Ім'я файлу для debug
     */
    private async executeScript(code: string, filename: string): Promise<void> {
        // Створюємо обгортку для скрипта з контекстом
        const wrappedCode = `
            (async function(scenario, require) {
                ${code}
            })
        `;

        try {
            // Компілюємо скрипт
            const scriptFn = eval(wrappedCode);

            // Функція require для імпорту інших скриптів сценарію
            const scenarioRequire = async (path: string) => {
                return this.requireScript(path);
            };

            // Виконуємо з контекстом
            await scriptFn(this._context, scenarioRequire);

        } catch (error) {
            console.error(`[Scenario] Script error in ${filename}:`, error);
            throw error;
        }
    }

    /**
     * Імпортує додатковий скрипт з архіву.
     */
    private async requireScript(path: string): Promise<unknown> {
        if (!this._zip) {
            throw new Error("Scenario is not loaded");
        }

        const scriptPath = path.startsWith('scripts/') ? path : `scripts/${path}`;
        const file = this._zip.file(scriptPath);

        if (!file) {
            throw new Error(`Script not found: ${scriptPath}`);
        }

        const code = await file.async('string');

        // Виконуємо як модуль і повертаємо exports
        const exports: Record<string, unknown> = {};
        const wrappedCode = `
            (function(exports, scenario, require) {
                ${code}
            })
        `;

        const scriptFn = eval(wrappedCode);
        await scriptFn(exports, this._context, (p: string) => this.requireScript(p));

        return exports;
    }

    /**
     * Оновлює прогрес завантаження.
     */
    private updateProgress(
        state: ScenarioLoadState,
        progress: number,
        operation: string,
        error?: string
    ): void {
        this._loadState = state;

        if (this._onProgressCallback) {
            this._onProgressCallback({
                state,
                progress,
                currentOperation: operation,
                error
            });
        }
    }

    /**
     * Очищення ресурсів при знищенні об'єкта.
     */
    protected override onDestroy(): void {
        this.unload();
    }

    // === Статичні методи (фабричні) ===

    /**
     * Створює і завантажує сценарій з URL.
     * @param url URL до ZIP-архіву
     */
    public static async load(url: string): Promise<Scenario> {
        const scenario = new Scenario();
        await scenario.loadFromUrl(url);
        return scenario;
    }

    /**
     * Створює і завантажує сценарій з ArrayBuffer.
     * @param data ArrayBuffer з ZIP-даними
     * @param name Опціональна назва сценарію
     */
    public static async loadFromBuffer(data: ArrayBuffer, name?: string): Promise<Scenario> {
        const scenario = new Scenario(name);
        await scenario.loadFromData(data);
        return scenario;
    }

    /**
     * Створює і завантажує сценарій з File об'єкта.
     * Зручно для <input type="file">.
     * @param file File об'єкт з ZIP-архівом
     */
    public static async loadFromFile(file: File): Promise<Scenario> {
        const data = await file.arrayBuffer();
        return this.loadFromBuffer(data, file.name);
    }
}
