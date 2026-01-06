import { Application } from "./core/Application";
import { SceneManager } from "./core/SceneManager";
import { Scenario } from "./core/components/Scenario";

// === ІМПОРТ СЦЕНАРІЇВ (Це єдине місце, яке змінюється при додаванні нових) ===
import { SolarSystemScenario } from "./scenarios/SolarSystemScenario";
// import { V8EngineScenario } from "./scenarios/V8EngineScenario";

// Список доступних сценаріїв
const scenarios: Scenario[] = [
    new SolarSystemScenario(),
    // new V8EngineScenario(),
];

// === ІНІЦІАЛІЗАЦІЯ ДВИГУНА ===
const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
const app = new Application(canvas);
app.run();

// === UI ЛОГІКА ===
const ui = {
    menu: document.getElementById("menu-screen") as HTMLDivElement,
    grid: document.querySelector(".scenario-grid") as HTMLDivElement,
    app: document.getElementById("app-screen") as HTMLDivElement,
    backBtn: document.getElementById("back-btn") as HTMLButtonElement,
};

function loadScenario(scenario: Scenario) {
    console.log(`Loading scenario: ${scenario.name}`);

    // 1. Приховати меню
    ui.menu.style.display = "none";
    ui.app.style.display = "block";

    // 2. Очистити сцену через двигун
    SceneManager.loadScene(scenario.name);

    // 3. Запустити логіку сценарію (вона створить об'єкти)
    scenario.init();
}

function openMenu() {
    ui.app.style.display = "none";
    ui.menu.style.display = "flex";
    SceneManager.loadScene("Menu"); // Очищення пам'яті
}

// === ГЕНЕРАЦІЯ КНОПОК ===
// Очищаємо старі кнопки (якщо були в HTML)
ui.grid.innerHTML = "";

scenarios.forEach((scenario) => {
    // Створюємо картку
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    title.innerText = scenario.name;

    const desc = document.createElement("p");
    desc.innerText = "Натисніть для запуску";

    card.appendChild(title);
    card.appendChild(desc);

    // Додаємо обробник подій
    card.addEventListener("click", () => loadScenario(scenario));

    ui.grid.appendChild(card);
});

ui.backBtn.addEventListener("click", openMenu);