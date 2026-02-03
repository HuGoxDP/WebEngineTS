/**
 * ScenarioTypes.ts
 * Типи та інтерфейси для системи сценаріїв.
 * Аналог Unity AssetBundle / Addressables metadata.
 */

/**
 * Категорія сценарію для класифікації.
 */
export enum ScenarioCategory {
    /** Освітній сценарій */
    Education = "education",
    /** Демонстраційний сценарій */
    Demo = "demo",
    /** Інтерактивний сценарій */
    Interactive = "interactive",
    /** Симуляція */
    Simulation = "simulation",
    /** Тестовий сценарій */
    Test = "test"
}

/**
 * Інформація про автора сценарію.
 */
export interface IScenarioAuthor {
    /** Ім'я автора */
    name: string;
    /** Email автора (опціонально) */
    email?: string;
    /** URL профілю автора (опціонально) */
    url?: string;
}

/**
 * Маніфест сценарію - головний файл опису.
 * Знаходиться в корені ZIP-архіву як manifest.json.
 */
export interface IScenarioManifest {
    /** Версія формату маніфесту (для сумісності) */
    manifestVersion: string;

    /** Унікальний ідентифікатор сценарію */
    id: string;

    /** Назва сценарію для відображення */
    name: string;

    /** Версія сценарію (semver) */
    version: string;

    /** Опис сценарію */
    description?: string;

    /** Категорія сценарію */
    category?: ScenarioCategory;

    /** Автор сценарію */
    author?: IScenarioAuthor;

    /** Мінімальна версія движка */
    engineVersion?: string;

    /**
     * Шлях до файлу точки входу (головного скрипта).
     * Відносно папки scripts/
     * Приклад: "main.js" -> scripts/main.js
     */
    entryPoint: string;

    /**
     * Шлях до початкової сцени (опціонально).
     * Якщо вказано, буде завантажено перед запуском entryPoint.
     */
    entryScene?: string;

    /** Список залежностей сценарію */
    dependencies?: string[];

    /** Додаткові метадані */
    metadata?: Record<string, unknown>;
}

/**
 * Стан завантаження сценарію.
 */
export enum ScenarioLoadState {
    /** Не завантажений */
    Unloaded = "unloaded",
    /** Завантаження в процесі */
    Loading = "loading",
    /** Завантажений і готовий */
    Ready = "ready",
    /** Виконується */
    Running = "running",
    /** Помилка завантаження */
    Error = "error"
}

/**
 * Прогрес завантаження сценарію.
 */
export interface IScenarioLoadProgress {
    /** Поточний стан */
    state: ScenarioLoadState;
    /** Прогрес від 0 до 1 */
    progress: number;
    /** Поточна операція */
    currentOperation: string;
    /** Повідомлення про помилку (якщо є) */
    error?: string;
}

/**
 * Контекст виконання сценарію.
 * Передається в скрипт як глобальний об'єкт.
 */
export interface IScenarioContext {
    /** Маніфест поточного сценарію */
    manifest: IScenarioManifest;
    /** Функція для отримання ресурсу за шляхом */
    getAsset: (path: string) => Promise<unknown>;
    /** Функція для завантаження текстури */
    loadTexture: (path: string) => Promise<unknown>;
    /** Функція для завантаження моделі */
    loadModel: (path: string) => Promise<unknown>;
}
