# 📦 Система Імпортів

## 📖 Опис

ThreeJS Engine використовує **Unity-style імпорти** — все з одного місця `@engine`, точно як `using UnityEngine;` у Unity C#.

---

## 🎯 Unity-Style Імпорти

### Unity C#
```csharp
using UnityEngine;

public class MyScript : MonoBehaviour
{
    void Start()
    {
        Vector3 pos = new Vector3(1, 2, 3);
        Color color = Color.red;
        Camera cam = Camera.main;
    }
}
```

### ThreeJS Engine (TypeScript)
```typescript
import {
    Vector3,
    Color,
    Camera,
    ScriptableBehaviour
} from "@engine";

class MyScript extends ScriptableBehaviour {
    onAwake(): void {
        const pos = new Vector3(1, 2, 3);
        const color = Color.red;
        const cam = this.gameObject.getComponent(Camera);
    }
}
```

---

## 📦 Що Доступно з @engine

### 🔧 CORE — Ядро

```typescript
import {
    GameObject,          // Ігровий об'єкт
    Component,           // Базовий компонент
    Transform,           // Трансформації
    Scene,               // Сцена
    SceneManager,        // Менеджер сцен
    Application,         // Додаток
    Time,                // Час (deltaTime, time)
    Behaviour,           // Базовий behaviour
    ScriptableBehaviour, // Скриптовий компонент
    EngineObject,        // Базовий об'єкт движка
    EngineSettings       // Налаштування
} from "@engine";
```

### 📐 MATH — Математика

```typescript
import {
    Vector2,             // 2D вектор
    Vector3,             // 3D вектор
    Vector4,             // 4D вектор
    Quaternion,          // Обертання
    Matrix4x4,           // Матриця 4x4
    Bounds,              // Обмежувальна коробка
    Rect                 // Прямокутник 2D
} from "@engine";
```

### 🎨 GRAPHICS — Графіка

```typescript
import {
    Color,               // Колір (RGBA)
    Mesh,                // Геометрія
    Texture,             // Базова текстура
    Texture2D,           // 2D текстура
    Shader,              // Шейдер
    Material,            // Матеріал
    StandardMaterial,    // PBR матеріал
    
    // Enums
    FilterMode,          // Point, Bilinear, Trilinear
    TextureWrapMode,     // Repeat, Clamp, Mirror
    TextureFormat,       // RGBA32, RGB24, etc.
    ShaderPropertyType,  // Color, Vector, Float, Texture
    MaterialRenderMode   // Opaque, Cutout, Fade, Transparent
} from "@engine";
```

### 🔩 COMPONENTS — Компоненти

```typescript
import {
    MeshFilter,          // Зберігає меш
    Renderer,            // Базовий рендерер
    MeshRenderer,        // Рендерить меш
    Camera,              // Камера
    Light,               // Базове світло
    DirectionalLight,    // Сонячне світло
    
    // Enums
    CameraClearFlags,    // SolidColor, Depth, Nothing
    ShadowCastingMode,   // Off, On, TwoSided, ShadowsOnly
    LightShadows,        // None, Hard, Soft
    LightShadowResolution, // Low, Medium, High, VeryHigh
    LightProbeUsage,
    ReflectionProbeUsage
} from "@engine";
```

### 📜 SCENARIO — Сценарії

```typescript
import {
    Scenario,            // Базовий клас сценарію
    ScenarioCategory     // Категорії (Physics, Astronomy, etc.)
} from "@engine";

import type { IScenarioManifest } from "@engine";
```

---

## 💡 Приклади

### Приклад 1: Простий Сценарій

```typescript
import {
    Scenario,
    Vector3,
    Color,
    Camera,
    DirectionalLight,
    MeshRenderer,
    MeshFilter,
    Mesh,
    StandardMaterial
} from "@engine";

export default class MyScenario extends Scenario {
    public async init(): Promise<void> {
        // Створюємо куб
        const cube = this.createGameObject("Cube");
        cube.addComponent(MeshFilter).sharedMesh = Mesh.createCube();
        cube.addComponent(MeshRenderer).material = new StandardMaterial();
        
        // Створюємо камеру
        const cam = this.createGameObject("Camera");
        cam.addComponent(Camera);
        cam.transform.position = new Vector3(0, 5, 10);
        
        // Створюємо світло
        const light = this.createGameObject("Light");
        light.addComponent(DirectionalLight);
    }
}
```

### Приклад 2: Скриптовий Компонент

```typescript
import {
    ScriptableBehaviour,
    Vector3,
    Time
} from "@engine";

class RotatingCube extends ScriptableBehaviour {
    public speed: number = 90;

    onUpdate(): void {
        // Обертаємо об'єкт на speed градусів за секунду
        const rotation = this.gameObject.transform.localEulerAngles;
        rotation.y += this.speed * Time.deltaTime;
        this.gameObject.transform.localEulerAngles = rotation;
    }
}
```

### Приклад 3: Матеріали та Текстури

```typescript
import {
    StandardMaterial,
    Color,
    Texture2D
} from "@engine";

// Створюємо PBR матеріал
const material = new StandardMaterial();
material.albedoColor = Color.red;
material.metallic = 0.8;
material.smoothness = 0.6;

// З текстурою
const texture = await Texture2D.Load("assets/brick.png");
material.albedoTexture = texture;
```

---

## 📊 Порівняння з Unity

| Unity C# | ThreeJS Engine |
|----------|----------------|
| `using UnityEngine;` | `import { ... } from "@engine";` |
| `Vector3` | `Vector3` |
| `Color.red` | `Color.red` |
| `Quaternion.Euler(x,y,z)` | `Quaternion.fromEuler(x,y,z)` |
| `Camera.main` | `scene.getMainCamera()` |
| `MonoBehaviour` | `ScriptableBehaviour` |
| `Start()` | `onAwake()` |
| `Update()` | `onUpdate()` |
| `Time.deltaTime` | `Time.deltaTime` |
| `GetComponent<T>()` | `getComponent(T)` |

---

## ✅ Best Practices

### ✅ ПРАВИЛЬНО — Організовані імпорти

```typescript
import {
    // Core
    Scenario,
    Time,
    ScriptableBehaviour,
    
    // Math
    Vector3,
    Quaternion,
    
    // Graphics
    Color,
    Mesh,
    StandardMaterial,
    
    // Components
    Camera,
    MeshRenderer,
    DirectionalLight
} from "@engine";
```

### ❌ НЕПРАВИЛЬНО — Глибокі шляхи

```typescript
// НЕ РОБІТЬ ТАК!
import { Vector3 } from "@engine/core/math/Vector3";
import { Camera } from "@engine/core/components/Camera";
```

---

## 🎯 Підсумок

**Unity-style імпорти:**
- ✅ Один `@engine` для всього
- ✅ Як `using UnityEngine;` 
- ✅ Чистий та читаємий код
- ✅ IDE автозаповнення працює

```typescript
// Все що потрібно - один рядок імпорту!
import { Vector3, Color, Camera, ... } from "@engine";
```

---

**Дата оновлення:** 15 січня 2026  
**Статус:** ✅ Unity-Style Imports

