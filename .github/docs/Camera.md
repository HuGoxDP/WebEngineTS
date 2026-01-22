# Camera

## 📖 Опис

**Camera** — це компонент для візуалізації сцени. Кожна сцена повинна мати принаймні одну камеру для рендерингу.

Підтримує два режими проекції:
- **Perspective** (перспективна) — об'єкти далі виглядають менше
- **Orthographic** (ортогональна) — паралельна проекція для UI

**Файл:** `src/engine/core/components/Camera.ts`

---

## 🔧 API

### Конструктор

```typescript
const camera = gameObject.addComponent(Camera);
```

### Властивості — Проекція

```typescript
// Режим проекції
camera.orthographic = false;  // true = ortho, false = perspective

// Для perspective режиму
camera.fieldOfView = 60;      // Кут зору у градусах

// Для orthographic режиму
camera.orthographicSize = 5;  // Половина висоти

// Площини відсікання
camera.nearClipPlane = 0.3;   // Близька площина
camera.farClipPlane = 1000;   // Далека площина

// Aspect ratio (автоматично встановлюється з viewport)
camera.aspect = 16 / 9;
```

### Властивості — Viewport та Рендеринг

```typescript
// Viewport (в нормальних координатах 0-1)
camera.viewport = new Rect(0, 0, 1, 1);  // Весь екран

// Фоновий колір
camera.backgroundColor = Color.black;

// Режим очищення
camera.clearFlags = CameraClearFlags.SolidColor;

// Глибина рендерингу (більша = пізніше)
camera.depth = 0;

// Маска culling (які об'єкти рендерити)
camera.cullingMask = 0xffffffff;  // Все
```

### Методи — Конвертація координат

```typescript
// Світові координати → Екранні координати
const screenPos = camera.worldToScreenPoint(worldPosition);
// screenPos.x, screenPos.y — піксельні координати
// screenPos.z — глибина від камери

// Екранні координати → Світові координати
const worldPos = camera.screenToWorldPoint(screenPosition);

// Приклад: скидання на камеру мишки
const mouseX = Input.GetMouseX();
const mouseY = Input.GetMouseY();
const mouseRay = camera.screenToWorldPoint(
    new Vector3(mouseX, mouseY, 10)
);
```

### Методи — Матриці

```typescript
// Отримати проекційну матрицю
const projMatrix = camera.getProjectionMatrix();

// Отримати view матрицю
const viewMatrix = camera.getViewMatrix();

// Матриці передаються в шейдери для рендерингу
```

### Enum — CameraClearFlags

```typescript
enum CameraClearFlags {
    SolidColor = 0,  // Очистити фоновим кольором
    Depth = 1,       // Очистити тільки глибину (для шарування)
    Nothing = 2      // Не очищувати (рідко)
}
```

---

## 💡 Приклади

### Приклад 1: Базова камера

```typescript
const camera = new GameObject("MainCamera");
const cameraComponent = camera.addComponent(Camera);

// Perspective режим (стандартний)
cameraComponent.orthographic = false;
cameraComponent.fieldOfView = 60;
cameraComponent.nearClipPlane = 0.3;
cameraComponent.farClipPlane = 1000;

// Розташування
camera.transform.position = new Vector3(0, 5, 10);
camera.transform.lookAt(Vector3.zero, Vector3.up);  // Дивимось на центр

// Фон
cameraComponent.backgroundColor = Color.black;
```

### Приклад 2: Ортогональна камера для UI

```typescript
const uiCamera = new GameObject("UICamera");
const camera = uiCamera.addComponent(Camera);

// Ортогональна проекція
camera.orthographic = true;
camera.orthographicSize = 5;  // Половина висоти (10 одиниць)

// Над основною камерою
camera.depth = 100;

// Без чистки — рендер поверх основної сцени
camera.clearFlags = CameraClearFlags.Depth;

// Розташування
uiCamera.transform.position = new Vector3(0, 0, 10);
uiCamera.transform.rotation = Quaternion.identity;
```

### Приклад 3: Миша click raycast

```typescript
class ClickDetector extends ScriptableBehaviour {
    private camera: Camera;
    
    onAwake() {
        this.camera = this.gameObject.getComponent(Camera);
    }
    
    onUpdate() {
        if (Input.GetMouseButtonDown(0)) {
            const mouseX = Input.GetMouseX();
            const mouseY = Input.GetMouseY();
            
            // Конвертуємо в 3D позицію перед камерою
            const rayOrigin = this.camera.screenToWorldPoint(
                new Vector3(mouseX, mouseY, this.camera.nearClipPlane)
            );
            
            const rayDirection = rayOrigin
                .subtract(this.camera.gameObject.transform.position)
                .normalize();
            
            console.log("Клік на:", rayOrigin);
            console.log("Напрямок:", rayDirection);
            
            // Можна використовувати для raycast
        }
    }
}
```

### Приклад 4: Динамічна FOV

```typescript
class DynamicFOV extends ScriptableBehaviour {
    private camera: Camera;
    
    onAwake() {
        this.camera = this.gameObject.getComponent(Camera);
    }
    
    onUpdate() {
        // Zoom з мишею
        const scroll = Input.GetMouseScrollDelta();
        this.camera.fieldOfView -= scroll * 5;  // Зменшити FOV = zoom in
        
        // Затиск FOV
        this.camera.fieldOfView = Math.max(10, Math.min(120, 
            this.camera.fieldOfView
        ));
    }
}
```

### Приклад 5: Шарування камер

```typescript
// Основна камера (3D рендеринг)
const mainCamera = new GameObject("MainCamera");
const mainCam = mainCamera.addComponent(Camera);
mainCam.depth = 0;
mainCam.clearFlags = CameraClearFlags.SolidColor;
mainCam.backgroundColor = Color.black;

// UI камера (поверх основної)
const uiCamera = new GameObject("UICamera");
const uiCam = uiCamera.addComponent(Camera);
uiCam.depth = 1;  // Рендериться пізніше
uiCam.clearFlags = CameraClearFlags.Depth;  // Не очищує колір

// UI рендериться над основною сценою!
```

---

## 📊 Perspective vs Orthographic

| Параметр | Perspective | Orthographic |
|----------|-------------|--------------|
| Як налаштовується | fieldOfView | orthographicSize |
| Природність | Реалістично | Плоско |
| Випадок використання | 3D ігри | UI, Map View |
| Далеким об'єктам | Менші | Такі ж |

---

## ⚙️ Координатні системи

### Screen Space (екран)
```
(0, 0) ──────→ (width, 0)
  ↓
  │
(0, height) ──→ (width, height)
```

### World Space (світ)
```
Y ↑
  │  Z ←────┐
  │  ↓      
  │  camera
  └──────→ X
```

### Конвертація
```
Screen Point (екран) ─→ World Point (світ)
screenToWorldPoint()  
```

---

## 🎯 Best Practices

```typescript
// ✅ ДОБРЕ - Одна основна камера
const camera = mainCameraObject.getComponent(Camera);
camera.orthographic = false;
camera.fieldOfView = 60;

// ❌ НЕПРАВИЛЬНО - Камера без GameObject
// Camera потребує GameObject для Transform!

// ✅ ДОБРЕ - Шарування камер
mainCam.depth = 0;   // Зад
uiCam.depth = 1;     // Перед

// ❌ НЕПРАВИЛЬНО - Одна камера у UI і 3D
// Потребують різних режимів!
```

---

## 📋 Related

- [Transform.ts](../Transform.ts) — позиціонування камери
- [Rect.md](./Rect.md) — viewport
- [Color.md](./Color.md) — background color

---

**Дата оновлення:** 15 січня 2026
