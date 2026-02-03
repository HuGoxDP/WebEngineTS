# Plan: Roadmap до Production-Ready Unity-like WebEngine

**TL;DR:** Проект має ~90% базових класів рендерингу, але відсутні критичні системи для повноцінного "рушія": Input, UI, Physics, завантаження моделей, Ray-casting, Events. План фокусується на завершенні **мінімально-необхідного** для створення інтерактивних сценаріїв: Input → Raycasting → Events → UI → GLB-імпорт → Build system → Демо-сценарій.

---

## Поточний стан проекту

### ✅ Реалізовано (90%)
- **Ядро:** GameObject, Component, Transform, Scene, SceneManager, Time
- **Математика:** Vector2, Vector3, Vector4, Quaternion, Matrix4x4, Bounds, Rect, Color
- **Графіка:** Mesh, Texture, Texture2D, Shader, Material, StandardMaterial
- **Компоненти:** MeshFilter, MeshRenderer, Renderer, Camera, Light, DirectionalLight, LineRenderer
- **Сценарії:** Scenario, ScenarioAssets, ScenarioTypes (завантаження ZIP-архівів)

### ❌ Відсутнє (критичне для інтерактивності)
- Input System (клавіатура, миша)
- Raycasting / Physics.Raycast
- Event System (IPointerClick, IPointerEnter)
- UI System (Canvas, Button, Text, Image)
- Повна інтеграція GLB/GLTF моделей
- Build система для бібліотеки (npm package)

---

## Steps

### 1. Додати Build Script для бібліотеки
**Файли:** `package.json`, `tsconfig.build.json`, `rollup.config.js`

- Додати `rollup` або `esbuild` для збірки в один `.js` bundle (UMD/ESM) + `.d.ts`
- Замінити `noEmit: true` на вивід в `dist/`
- Експортувати глобальний `Engine` namespace для використання на Angular-сайті
- Команди: `npm run build:lib` → `dist/engine.js` + `dist/engine.d.ts`

```bash
npm install -D rollup @rollup/plugin-typescript rollup-plugin-dts
```

---

### 2. Реалізувати Input System
**Файли:** `src/engine/core/Input.ts`

Створити клас `Input` (статичний) з методами:
- `getKey(keyCode: KeyCode): boolean` — чи натиснута клавіша
- `getKeyDown(keyCode: KeyCode): boolean` — чи щойно натиснули
- `getKeyUp(keyCode: KeyCode): boolean` — чи щойно відпустили
- `getMouseButton(button: number): boolean` — стан кнопки миші
- `getMouseButtonDown(button: number): boolean`
- `getMouseButtonUp(button: number): boolean`
- `mousePosition: Vector2` — позиція миші в пікселях
- `mouseDelta: Vector2` — рух миші за кадр
- `mouseScrollDelta: Vector2` — прокрутка

**Інтеграція:**
- Підписка на `window.addEventListener('keydown'/'mousedown'/'mousemove')` в `Application.ts`
- Виклик `Input._endFrame()` в кінці кожного кадру для скидання Down/Up станів

---

### 3. Реалізувати Ray та Raycasting
**Файли:** `src/engine/core/math/Ray.ts`, `src/engine/core/Physics.ts`

**Ray клас:**
```typescript
class Ray {
    origin: Vector3;
    direction: Vector3;
    getPoint(distance: number): Vector3;
}
```

**Physics (статичний клас):**
```typescript
class Physics {
    static raycast(ray: Ray, maxDistance?: number): RaycastHit | null;
    static raycastAll(ray: Ray, maxDistance?: number): RaycastHit[];
}

interface RaycastHit {
    point: Vector3;
    normal: Vector3;
    distance: number;
    collider: Collider; // або gameObject
    transform: Transform;
}
```

**Camera.ScreenPointToRay():**
- Додати метод в `Camera.ts` для конвертації screen coordinates → Ray
- Обгортка над `THREE.Raycaster`

---

### 4. Реалізувати Event System (Click/Hover)
**Файли:** `src/engine/core/EventSystem.ts`, `src/engine/core/IPointerHandlers.ts`

**Інтерфейси:**
```typescript
interface IPointerClickHandler {
    onPointerClick(eventData: PointerEventData): void;
}

interface IPointerEnterHandler {
    onPointerEnter(eventData: PointerEventData): void;
}

interface IPointerExitHandler {
    onPointerExit(eventData: PointerEventData): void;
}
```

**EventSystem компонент:**
- Кожен кадр робить `Physics.Raycast()` з `Camera.ScreenPointToRay(Input.mousePosition)`
- Відстежує поточний об'єкт під курсором
- Викликає `onPointerEnter`/`onPointerExit` при зміні
- При кліку викликає `onPointerClick` на всіх компонентах з інтерфейсом

---

### 5. Реалізувати UI System
**Файли:** `src/engine/core/ui/` (нова папка)

**Компоненти:**

| Клас | Опис |
|------|------|
| `Canvas` | Контейнер UI (Screen Space Overlay / World Space) |
| `RectTransform` | Transform з anchor, pivot, sizeDelta |
| `CanvasRenderer` | Рендер UI елементів |
| `Text` | Текст (через `troika-three-text` або CSS overlay) |
| `Image` | Спрайт/картинка |
| `Button` | Кнопка з onClick callback |
| `Slider` | Повзунок |
| `InputField` | Текстове поле |

**Підхід:**
- Для простоти можна використати HTML overlay (`position: absolute`) для UI
- Або повноцінний 3D UI через `troika-three-text` + custom meshes

---

### 6. Інтегрувати GLB/GLTF завантаження
**Файли:** `src/engine/core/scenario/ScenarioAssets.ts`

Завершити метод `convertGLTFToGameObject()`:
- Рекурсивно конвертувати `THREE.Object3D` → `GameObject`
- Для кожного `THREE.Mesh` додавати `MeshFilter` + `MeshRenderer`
- Конвертувати `THREE.Material` → `StandardMaterial`
- Витягувати текстури з GLTF та створювати `Texture2D`
- Підтримка анімацій (опціонально, Phase 2)

**Експорт в контекст сценарію:**
```typescript
// В scripts/main.js сценарію:
const model = await assets.loadModel('robot.glb');
model.transform.position = new Vector3(0, 0, 0);
```

---

### 7. Створити демо-сценарій
**Файли:** `examples/demo-scenario/` (нова папка)

**Структура ZIP:**
```
demo-scenario.zip
├── manifest.json
├── scripts/
│   └── main.js
└── assets/
    ├── textures/
    │   └── crate.png
    └── models/
        └── robot.glb
```

**Демонстрація можливостей:**
- Створення примітивів (куб, сфера)
- Завантаження текстури та моделі
- UI кнопка з onClick
- Обробка наведення миші на об'єкти
- Рух камери через Input

---

## Further Considerations

### Фізика (Colliders/Rigidbody)
**Питання:** Чи потрібна фізика для освітніх сценаріїв?

**Варіанти:**
1. Тільки Collision Detection (без симуляції) — BoxCollider, SphereCollider + Physics.Raycast
2. Повна фізика через Rapier.js або Cannon-es
3. Нічого — для освітніх демо достатньо Raycasting

**Рекомендація:** Спочатку тільки Colliders для Raycasting, без Rigidbody.

---

### Audio
**Питання:** Чи потрібен звук?

**Якщо так:**
- `AudioListener` (один на сцену, на камері)
- `AudioSource` (компонент на GameObject)
- `AudioClip` (завантажений аудіо-файл)
- Обгортка над Web Audio API

---

### Animations
**Питання:** Чи потрібна Animation система?

**Якщо GLB моделі мають анімації:**
- `Animator` (компонент, керує анімаціями)
- `AnimationClip` (один кліп анімації)
- `AnimatorController` (state machine)
- Обгортка над `THREE.AnimationMixer`

---

## Пріоритети реалізації

| Пріоритет | Система | Необхідність |
|-----------|---------|--------------|
| 🔴 Критичний | Build System | Без цього не можна використовувати на сайті |
| 🔴 Критичний | Input | Без цього немає інтерактивності |
| 🔴 Критичний | Raycasting | Для вибору об'єктів мишею |
| 🟡 Високий | Event System | Для обробки кліків |
| 🟡 Високий | GLB Import | Для реальних моделей |
| 🟢 Середній | UI System | Можна обійтись HTML overlay |
| ⚪ Низький | Physics | Для освітніх демо не критично |
| ⚪ Низький | Audio | Опціонально |
| ⚪ Низький | Animations | Опціонально |

---

## Очікуваний результат

Після виконання плану користувач зможе:

1. ✅ Підключити `engine.js` до Angular-сайту
2. ✅ Створити ZIP-сценарій з власним кодом
3. ✅ Створювати 3D об'єкти (примітиви + завантажені моделі)
4. ✅ Додавати текстури та матеріали
5. ✅ Обробляти кліки та наведення миші
6. ✅ Створювати UI елементи (кнопки, текст)
7. ✅ Керувати камерою через клавіатуру/мишу

---

## Команди для початку

```bash
# Встановити залежності для збірки
npm install -D rollup @rollup/plugin-typescript @rollup/plugin-node-resolve rollup-plugin-dts

# Для UI тексту (опціонально)
npm install troika-three-text
```

---

**Дата створення:** 03 лютого 2026
