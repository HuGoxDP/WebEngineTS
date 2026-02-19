

// Ініціалізація - Application створюється лише при запуску сценарію
import {Application, Scenario, ScenarioLoadState} from "WebEngineTS";

let app: Application | null = null;
let currentScenario: Scenario | null = null;

// UI Elements
const ui = {
    menu: document.getElementById("menu-screen") as HTMLDivElement,
    app: document.getElementById("app-screen") as HTMLDivElement,
    backBtn: document.getElementById("back-btn") as HTMLButtonElement,
    loadBtn: document.getElementById("load-scenario-btn") as HTMLButtonElement | null,
    fileInput: document.getElementById("scenario-file") as HTMLInputElement | null,
    progressBar: document.getElementById("progress-bar") as HTMLDivElement | null,
    progressText: document.getElementById("progress-text") as HTMLSpanElement | null,
};

// Функція перемикання екранів
function toggleScreen(showGame: boolean): void {
    if (showGame) {
        ui.menu.style.display = 'none';
        ui.app.style.display = 'block';
    } else {
        ui.app.style.display = 'none';
        ui.menu.style.display = 'block';

        // Зупиняємо двигун якщо він працює
        if (app) {
            app.stop();
        }

        // Вивантажуємо сценарій з пам'яті
        if (currentScenario) {
            currentScenario.unload();
            currentScenario = null;
        }
    }
}

// Оновлення прогресу завантаження
function updateProgress(progress: number, text: string): void {
    if (ui.progressBar) {
        ui.progressBar.style.width = `${progress * 100}%`;
    }
    if (ui.progressText) {
        ui.progressText.textContent = text;
    }
}

// Завантаження сценарію з файлу
async function loadScenarioFromFile(file: File): Promise<void> {
    try {
        updateProgress(0, "Завантаження сценарію...");

        // Створюємо новий сценарій
        currentScenario = new Scenario();

        // Встановлюємо колбек прогресу
        currentScenario.onProgress((progress) => {
            updateProgress(progress.progress, progress.currentOperation);

            if (progress.state === ScenarioLoadState.Error) {
                console.error("[Main] Помилка завантаження:", progress.error);
                alert(`Помилка завантаження сценарію: ${progress.error}`);
            }
        });

        // Завантажуємо з File
        const data = await file.arrayBuffer();
        await currentScenario.loadFromData(data);

        console.log("[Main] Сценарій завантажено:", currentScenario.manifest?.name);

        // Запускаємо движок та сценарій
        startApp();
        await currentScenario.run();

    } catch (error) {
        console.error("[Main] Помилка:", error);
        alert(`Помилка: ${error}`);
    }
}

// Завантаження сценарію з URL (експортовано для використання ззовні)
export async function loadScenarioFromUrl(url: string): Promise<void> {
    try {
        updateProgress(0, "Завантаження сценарію з URL...");

        // Завантажуємо сценарій
        currentScenario = await Scenario.load(url);

        console.log("[Main] Сценарій завантажено:", currentScenario.manifest?.name);

        // Запускаємо движок та сценарій
        startApp();
        await currentScenario.run();

    } catch (error) {
        console.error("[Main] Помилка:", error);
        alert(`Помилка: ${error}`);
    }
}

// Кнопка "Назад"
ui.backBtn?.addEventListener("click", () => {
    toggleScreen(false);
});

// Обробник вибору файлу
ui.fileInput?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        loadScenarioFromFile(file);
    }
});

// Кнопка завантаження сценарію
ui.loadBtn?.addEventListener("click", () => {
    ui.fileInput?.click();
});

// Створення та запуск додатку
function startApp(): void {
    if (!app) {
        const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
        app = new Application(canvas);
    }

    // Приховати меню та показати гру
    toggleScreen(true);

    app.run();
}

// Дочекайтеся завантаження вікна
window.addEventListener("load", () => {
    console.log("[Engine] Unity-like 3D Engine ініціалізовано");
    console.log("[Engine] Завантажте ZIP-архів сценарію для початку");

    // Для тестування можна завантажити сценарій з URL:
    // loadScenarioFromUrl("/scenarios/demo.zip");
});