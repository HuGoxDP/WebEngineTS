import { Application } from "@engine";
import { SceneManager } from "@engine";
import { ScenarioRepository } from "./core/scenario/ScenarioRepository";

// Ініціалізація
const app = new Application(document.getElementById("webgl-canvas") as HTMLCanvasElement);
const repo = new ScenarioRepository();
const manifests = repo.getAllManifests();

// UI Elements
const ui = {
    menu: document.getElementById("menu-screen") as HTMLDivElement,
    grid: document.querySelector(".scenario-grid") as HTMLDivElement,
    app: document.getElementById("app-screen") as HTMLDivElement,
    backBtn: document.getElementById("back-btn") as HTMLButtonElement,
};

// Функція перемикання екранів
function toggleScreen(showGame: boolean) {
    if (showGame) {
        ui.menu.style.display = 'none';
        ui.app.style.display = 'block';
    } else {
        ui.app.style.display = 'none';
        ui.menu.style.display = 'block';

        app.stop();
        SceneManager.loadScene("MenuBackground");
    }
}

// Кнопка "Назад"
ui.backBtn.addEventListener("click", () => {
    toggleScreen(false);
});

// Генерація карток
ui.grid.innerHTML = "";

manifests.forEach((manifest) => {
    const card = document.createElement("div");
    card.className = "card";

    // 1. Створюємо блок зображення
    const imgWrapper = document.createElement("div");
    imgWrapper.className = "card-image-wrapper";

    const img = document.createElement("img");
    img.className = "card-img";
    // Якщо картинки немає в маніфесті, ставимо заглушку
    img.src = manifest.previewImage || "https://via.placeholder.com/400x225?text=No+Preview";
    img.alt = manifest.name;

    // Оверлей з кнопкою Play
    const playOverlay = document.createElement("div");
    playOverlay.className = "play-overlay";
    playOverlay.innerHTML = `<div class="play-icon">▶</div>`;

    imgWrapper.appendChild(img);
    imgWrapper.appendChild(playOverlay);

    // 2. Створюємо блок контенту
    const content = document.createElement("div");
    content.className = "card-content";

    const category = document.createElement("div");
    category.className = "card-category";
    category.innerText = manifest.category; // Physics, Chemistry...

    const title = document.createElement("h3");
    title.innerText = manifest.name;

    const desc = document.createElement("p");
    desc.innerText = manifest.description;

    content.appendChild(category);
    content.appendChild(title);
    content.appendChild(desc);

    // 3. Збираємо картку
    card.appendChild(imgWrapper);
    card.appendChild(content);

    // 4. Обробка кліку
    card.addEventListener("click", async () => {
        console.log(`Starting: ${manifest.name}`);

        // Показуємо екран завантаження або просто перемикаємо
        toggleScreen(true);

        try {
            // Lazy Load коду
            const ScenarioClass = await repo.loadScenarioCode(manifest.id);
            const scenarioInstance = new ScenarioClass();

            // Запуск сцени
            SceneManager.loadScene(manifest.name);
            await scenarioInstance.load();

            app.run();
        } catch (e) {
            console.error(e);
            alert("Помилка завантаження сценарію!");
            toggleScreen(false);
        }
    });

    ui.grid.appendChild(card);
});