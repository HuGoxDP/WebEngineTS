# Renderer

## 📖 Опис

**Renderer** — це абстрактний базовий клас для всіх рендерерів у системі. Управляє матеріалами, тінями, сортуванням та іншими налаштуваннями рендерингу.

Не використовується напряму — замість цього використовуйте конкретні класи як **MeshRenderer**.

**Файл:** `src/engine/core/components/Renderer.ts`

---

## 🔧 API

### Матеріали — Shared vs Instance

```typescript
const renderer = gameObject.getComponent(MeshRenderer);

// Shared матеріал (спільний)
renderer.sharedMaterial = metalMaterial;

// Instance матеріал (копія для редагування)
const editMat = renderer.material;
editMat.color = Color.red;  // Впливає тільки на цей рендерер
```

### Масив матеріалів (Multi-Material)

```typescript
// Для об'єктів з кількома підмешами (SubMeshes)

// Shared матеріали
renderer.sharedMaterials = [mat1, mat2, mat3];

// Instance матеріали
renderer.materials = [
    new StandardMaterial(),
    new Material(Shader.Unlit),
    new StandardMaterial()
];

// Отримати матеріал за індексом
const mat = renderer.getMaterial(0);

// Встановити матеріал за індексом
renderer.setMaterial(1, newMaterial);
```

### Bounds (обмежувальна коробка)

```typescript
// Bounds у світовому просторі
const worldBounds = renderer.bounds;
console.log(worldBounds.center);     // Центр
console.log(worldBounds.size);       // Розмір

// Bounds у локальному просторі об'єкта
const localBounds = renderer.localBounds;
renderer.localBounds = newBounds;
```

### Налаштування рендерингу

```typescript
// Видимість
renderer.isVisible;  // readonly

// Тіні
renderer.receiveShadows = true;              // Отримувати тіні
renderer.shadowCastingMode = ShadowCastingMode.On;  // Відкидати тіні

enum ShadowCastingMode {
    Off,         // Не відкидає тіні
    On,          // Нормально відкидає
    TwoSided,    // Обидві сторони
    ShadowsOnly  // Тільки тіні, без геометрії
}
```

### Сортування (Rendering Order)

```typescript
// Sorting Layer (більше значення = пізніше малюється)
renderer.sortingLayerID = 0;
renderer.sortingLayerName = "Default";

// Order в межах layer
renderer.sortingOrder = 0;

// Masking (quale objects render на яких камерах)
renderer.renderingLayerMask = 1;  // Bit mask
```

### Light Probes (освітлення від проб)

```typescript
renderer.lightProbeUsage = LightProbeUsage.BlendProbes;

enum LightProbeUsage {
    Off,                // Без light probes
    BlendProbes,        // Інтерполяція між пробами
    UseProxyVolume,     // З proxy volume
    CustomProvided      // Користувацькі
}
```

### Reflection Probes (відбивання)

```typescript
renderer.reflectionProbeUsage = ReflectionProbeUsage.BlendProbes;

enum ReflectionProbeUsage {
    Off,                        // Без probes
    BlendProbes,                // Базова інтерполяція
    BlendProbesAndSkybox,       // З skybox fallback
    Simple                      // Найбліжча probe
}
```

---

## 💡 Приклади

### Приклад 1: Базове налаштування рендерера

```typescript
const renderer = gameObject.addComponent(MeshRenderer);

// Встановлюємо матеріал
renderer.sharedMaterial = new StandardMaterial();

// Налаштовуємо тіні
renderer.receiveShadows = true;
renderer.shadowCastingMode = ShadowCastingMode.On;

// Сортування
renderer.sortingOrder = 0;
```

### Приклад 2: Multi-Material об'єкт

```typescript
class MultiMaterialCube {
    create() {
        // Куб з 6 різними матеріалами для 6 граней
        const renderer = gameObject.addComponent(MeshRenderer);
        
        renderer.materials = [
            redMaterial,
            greenMaterial,
            blueMaterial,
            yellowMaterial,
            cyanMaterial,
            magentaMaterial
        ];
    }
}
```

### Приклад 3: Анімація матеріалу

```typescript
class AnimatingRenderer extends ScriptableBehaviour {
    private renderer: Renderer;
    
    onAwake() {
        this.renderer = this.gameObject.getComponent(MeshRenderer);
    }
    
    onUpdate() {
        // Змінюємо колір матеріалу (Instance копія!)
        const mat = this.renderer.material;
        const hue = Time.time * 60;  // Обертаємо по кольорах
        
        mat.color = Color.fromHSV(hue, 1, 1);
    }
}
```

### Приклад 4: Видимість за умовою

```typescript
// Скривати рендерер
renderer.shadowCastingMode = ShadowCastingMode.Off;
// (Для повної невидимості потрібна камера з culling mask)

// Або просто вимкнути компонент
renderer.enabled = false;  // Вимкнення компонента
```

### Приклад 5: Перевірка чи всередині камери

```typescript
class CullingCheck extends ScriptableBehaviour {
    onUpdate() {
        const renderer = this.gameObject.getComponent(MeshRenderer);
        
        if (renderer.isVisible) {
            console.log("Цей об'єкт видно!");
        } else {
            console.log("Цей об'єкт поза камерою");
        }
    }
}
```

---

## 🎭 Enums

### ShadowCastingMode

```typescript
enum ShadowCastingMode {
    Off,         // Не відкидає, не отримує
    On,          // Відкидає і отримує
    TwoSided,    // Обидві сторони трикутників відкидають
    ShadowsOnly  // Тільки тіні (не видно самого об'єкта)
}
```

### LightProbeUsage

```typescript
enum LightProbeUsage {
    Off,                // Без світлу від probes
    BlendProbes,        // Інтерполює між 4 найблизшими пробами
    UseProxyVolume,     // Використовує AABB proxy volume
    CustomProvided      // Користувач встановлює вручну
}
```

### ReflectionProbeUsage

```typescript
enum ReflectionProbeUsage {
    Off,                        // Без відбивань
    BlendProbes,                // Змішує 2 найблизші probes
    BlendProbesAndSkybox,       // З fallback на skybox
    Simple                      // Найбліжча probe
}
```

---

## 🔗 Діаграма спадщинності

```
Behaviour (увімкнення/вимкнення)
    ↓
Renderer (базові налаштування)
    ↓
MeshRenderer (рендеринг мешів)
LineRenderer (рендеринг ліній)
SpriteRenderer (рендеринг спрайтів)
...
```

---

## ⚠️ Поширені помилки

### ❌ Неправильно: Мутація Shared

```typescript
// ПЛОХО! Впливає на всі об'єкти
renderer.sharedMaterial.color = Color.blue;
```

### ✅ Правильно: Instance

```typescript
// ДОБРЕ! Безпечно
renderer.material.color = Color.blue;
```

### ❌ Неправильно: Забуття Array

```typescript
// ПЛОХО! Присвоєння одного матеріалу не замінює масив
renderer.materials = [mat1, mat2];
renderer.sharedMaterial = mat3;  // Це НЕ замінює масив!
```

### ✅ Правильно: Ясні намірения

```typescript
// ДОБРЕ! Явне використання array
const mats = renderer.materials;
mats[0] = mat3;
renderer.materials = mats;
```

---

## 📊 Таблиця налаштувань

| Налаштування | Тип | Для чого |
|-------------|-----|---------|
| material | Material | Один матеріал |
| materials[] | Material[] | Багато матеріалів |
| shadowCastingMode | Enum | Тіні |
| receiveShadows | bool | Отримувати тіні |
| sortingOrder | int | Порядок малювання |
| bounds | Bounds | Обмежувальна коробка |
| lightProbeUsage | Enum | Динамічне освітлення |

---

## 📋 Related

- [MeshRenderer.md](./MeshRenderer.md) — конкретна реалізація
- [Material.md](./Material.md) — система матеріалів
- [Bounds.md](./Bounds.md) — математика bounds

---

**Дата оновлення:** 15 січня 2026
