

// The Application is created only when a scenario starts.
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

// Switches between the menu and the game view.
function toggleScreen(showGame: boolean): void {
    if (showGame) {
        ui.menu.style.display = 'none';
        ui.app.style.display = 'block';
    } else {
        ui.app.style.display = 'none';
        ui.menu.style.display = 'block';

        // Stop the engine if it is running.
        if (app) {
            app.stop();
        }

        // Unload the scenario.
        if (currentScenario) {
            currentScenario.unload();
            currentScenario = null;
        }
    }
}

// Updates the loading progress bar.
function updateProgress(progress: number, text: string): void {
    if (ui.progressBar) {
        ui.progressBar.style.width = `${progress * 100}%`;
    }
    if (ui.progressText) {
        ui.progressText.textContent = text;
    }
}

// Loads a scenario from a picked file.
async function loadScenarioFromFile(file: File): Promise<void> {
    try {
        updateProgress(0, "Loading scenario...");

        // Create the scenario.
        currentScenario = new Scenario();

        // Hook up progress reporting.
        currentScenario.onProgress((progress) => {
            updateProgress(progress.progress, progress.currentOperation);

            if (progress.state === ScenarioLoadState.Error) {
                console.error("[Main] Load failed:", progress.error);
                alert(`Failed to load the scenario: ${progress.error}`);
            }
        });

        // Load from the File object.
        const data = await file.arrayBuffer();
        await currentScenario.loadFromData(data);

        console.log("[Main] Scenario loaded:", currentScenario.manifest?.name);

        // Start the engine and the scenario.
        startApp();
        await currentScenario.run();

    } catch (error) {
        console.error("[Main] Error:", error);
        alert(`Error: ${error}`);
    }
}

// Loads a scenario from a URL. Exported so a host page can call it.
export async function loadScenarioFromUrl(url: string): Promise<void> {
    try {
        updateProgress(0, "Loading scenario from URL...");

        // Load the scenario.
        currentScenario = await Scenario.load(url);

        console.log("[Main] Scenario loaded:", currentScenario.manifest?.name);

        // Start the engine and the scenario.
        startApp();
        await currentScenario.run();

    } catch (error) {
        console.error("[Main] Error:", error);
        alert(`Error: ${error}`);
    }
}

// The Back button.
ui.backBtn?.addEventListener("click", () => {
    toggleScreen(false);
});

// File-picker handler.
ui.fileInput?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        loadScenarioFromFile(file);
    }
});

// The Load Scenario button.
ui.loadBtn?.addEventListener("click", () => {
    ui.fileInput?.click();
});

// Creates the Application and starts it.
function startApp(): void {
    if (!app) {
        const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
        app = new Application(canvas);
    }

    // Hide the menu and show the game view.
    toggleScreen(true);

    app.run();
}

// Wait for the window to finish loading.
window.addEventListener("load", () => {
    console.log("[Engine] Unity-like 3D engine initialised");
    console.log("[Engine] Load a scenario ZIP to begin");

    // For testing, a scenario can be loaded straight from a URL:
    // loadScenarioFromUrl("/scenarios/demo.zip");
});