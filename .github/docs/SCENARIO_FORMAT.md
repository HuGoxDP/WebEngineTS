# Структура ZIP-архіву сценарію

## Загальна структура

```
scenario.zip
├── manifest.json          # Маніфест сценарію (ОБОВ'ЯЗКОВО)
├── assets/                # Папка з ресурсами
│   ├── textures/          # Текстури (PNG, JPG, WebP)
│   │   ├── ground.png
│   │   └── sky.jpg
│   ├── models/            # 3D моделі (GLB, GLTF)
│   │   ├── character.glb
│   │   └── building.glb
│   └── audio/             # Аудіо (MP3, OGG, WAV)
│       └── background.mp3
├── scenes/                # Серіалізовані сцени (JSON)
│   └── main.scene.json
└── scripts/               # Скрипти сценарію
    ├── main.js            # Точка входу (entryPoint)
    ├── player.js          # Додаткові скрипти
    └── utils.js
```

## Маніфест (manifest.json)

```json
{
    "manifestVersion": "1.0",
    "id": "com.example.demo-scenario",
    "name": "Demo Scenario",
    "version": "1.0.0",
    "description": "Демонстраційний сценарій для тестування движка",
    "category": "demo",
    "author": {
        "name": "Your Name",
        "email": "your@email.com"
    },
    "engineVersion": "0.1.0",
    "entryPoint": "main.js",
    "entryScene": "main.scene.json",
    "dependencies": [],
    "metadata": {
        "thumbnail": "assets/textures/thumbnail.png"
    }
}
```

## Точка входу (scripts/main.js)

```javascript
// Отримуємо доступ до контексту сценарію
// scenario - глобальний об'єкт з API движка
// require - функція для імпорту інших скриптів

console.log("Сценарій запущено:", scenario.manifest.name);

// Завантаження ресурсів
async function loadAssets() {
    // Завантаження текстури
    const groundTexture = await scenario.loadTexture("textures/ground.png");
    
    // Завантаження моделі
    const characterModel = await scenario.loadModel("models/character.glb");
    
    console.log("Ресурси завантажено");
}

// Ініціалізація сцени
async function init() {
    await loadAssets();
    
    // Тут логіка створення ігрових об'єктів
    // Використовуючи API движка
}

// Запуск
init().catch(console.error);
```

## Серіалізована сцена (scenes/main.scene.json)

```json
{
    "name": "Main Scene",
    "gameObjects": [
        {
            "name": "Main Camera",
            "transform": {
                "position": [0, 5, -10],
                "rotation": [0, 0, 0, 1],
                "scale": [1, 1, 1]
            },
            "components": [
                {
                    "type": "Camera",
                    "properties": {
                        "fieldOfView": 60,
                        "nearClipPlane": 0.1,
                        "farClipPlane": 1000
                    }
                }
            ]
        },
        {
            "name": "Directional Light",
            "transform": {
                "position": [0, 10, 0],
                "rotation": [0.5, 0, 0, 0.866],
                "scale": [1, 1, 1]
            },
            "components": [
                {
                    "type": "DirectionalLight",
                    "properties": {
                        "color": [1, 1, 1, 1],
                        "intensity": 1.0
                    }
                }
            ]
        }
    ]
}
```

## Життєвий цикл сценарію

1. **Завантаження** - ZIP-архів завантажується в RAM (не на диск)
2. **Парсинг** - Читається manifest.json та валідується
3. **Ініціалізація** - Створюється контекст виконання
4. **Запуск** - Виконується entryPoint (scripts/main.js)
5. **Виконання** - Сценарій працює в ізольованому контексті
6. **Вивантаження** - При виході всі ресурси очищаються з пам'яті

## Безпека

- Скрипти виконуються в ізольованому контексті
- Немає доступу до файлової системи користувача
- Немає доступу до localStorage (окрім спеціального API)
- Всі ресурси зберігаються тільки в RAM
