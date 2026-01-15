# Shader

## 📖 Опис

**Shader** — це система для управління шейдерами у двигуні. Замість написання GLSL, користувач вибирає вбудований шейдер і матеріал використовує його властивості.

**Ключова ідея:** Three.js — це внутрішній рендер-ядро. Користувач працює тільки з `Shader` класом і відповідними `Material` класами.

**Файл:** `src/engine/core/graphics/Shader.ts`

---

## 🎯 Архітектура

```
Shader (Unity-like абстракція)
   ↓
Material (використовує Shader)
   ↓
THREE.Material (внутрішній Three.js)
   ↓
WebGL
```

---

## 🔧 API

### Вбудовані шейдери

```typescript
// PBR — фізично-коректний матеріал (рекомендується)
const shader = Shader.Standard;

// Без освітлення (найшвидший)
const shader = Shader.Unlit;

// Просте Lambertian освітлення
const shader = Shader.Diffuse;

// Blinn-Phong з відблисками
const shader = Shader.Specular;

// Прозорий Standard
const shader = Shader.Transparent;

// Legacy просте освітлення
const shader = Shader.VertexLit;
```

### Пошук шейдера

```typescript
// За ім'ям
const shader = Shader.Find("Standard");
if (shader) {
    console.log(shader.shaderName);  // "Standard"
}

// Перевірка підтримки
if (shader.isSupported) {
    // використовувати шейдер
}
```

### Властивості шейдера

```typescript
// Отримати тип властивості
const propType = shader.getPropertyType("_Color");
if (propType === ShaderPropertyType.Color) {
    console.log("Це колір!");
}

// Перевірити наявність властивості
if (shader.hasProperty("_Metallic")) {
    console.log("Standard шейдер має Metallic!");
}

// Знайти індекс властивості
const index = shader.findPropertyIndex("_MainTex");
```

---

## 📊 ShaderPropertyType

```typescript
enum ShaderPropertyType {
    Color,      // RGB/RGBA колір
    Vector,     // Vector4 (x, y, z, w)
    Float,      // Одне дійсне число
    Range,      // Float в діапазоні (0-1)
    Texture,    // Посилання на текстуру
    Int         // Ціле число
}
```

---

## 📋 Вбудовані шейдери та їх властивості

### 1. Standard (PBR)

**Використовує:** `THREE.MeshStandardMaterial`

```typescript
const shader = Shader.Standard;

// Властивості:
shader.hasProperty("_Color");              // ✅ Альбедо колір
shader.hasProperty("_MainTex");            // ✅ Альбедо текстура
shader.hasProperty("_Metallic");           // ✅ Металічність (0-1)
shader.hasProperty("_MetallicGlossMap");   // ✅ Metallic + Roughness текстура
shader.hasProperty("_Glossiness");         // ✅ Гладкість = 1 - Roughness
shader.hasProperty("_BumpMap");            // ✅ Normal map
shader.hasProperty("_BumpScale");          // ✅ Сила normal map
shader.hasProperty("_OcclusionMap");       // ✅ AO текстура
shader.hasProperty("_OcclusionStrength");  // ✅ Сила AO
shader.hasProperty("_EmissionColor");      // ✅ Колір свічення
shader.hasProperty("_EmissionMap");        // ✅ Текстура свічення
```

### 2. Unlit (базовий без освітлення)

**Використовує:** `THREE.MeshBasicMaterial`

```typescript
const shader = Shader.Unlit;

// Властивості:
shader.hasProperty("_Color");     // ✅ Колір
shader.hasProperty("_MainTex");   // ✅ Текстура
```

### 3. Diffuse (Lambert освітлення)

**Використовує:** `THREE.MeshLambertMaterial`

```typescript
const shader = Shader.Diffuse;

// Властивості:
shader.hasProperty("_Color");           // ✅ Колір
shader.hasProperty("_MainTex");         // ✅ Текстура
shader.hasProperty("_EmissionColor");   // ✅ Свічення
shader.hasProperty("_EmissionMap");     // ✅ Текстура свічення
```

### 4. Specular (Blinn-Phong)

**Використовує:** `THREE.MeshPhongMaterial`

```typescript
const shader = Shader.Specular;

// Властивості:
shader.hasProperty("_Color");           // ✅ Колір
shader.hasProperty("_MainTex");         // ✅ Текстура
shader.hasProperty("_SpecColor");       // ✅ Колір відблиску
shader.hasProperty("_Shininess");       // ✅ Гострота відблиску
shader.hasProperty("_BumpMap");         // ✅ Normal map
shader.hasProperty("_BumpScale");       // ✅ Сила normal map
shader.hasProperty("_EmissionColor");   // ✅ Свічення
shader.hasProperty("_EmissionMap");     // ✅ Текстура свічення
```

### 5. Transparent (прозорий Standard)

**Використовує:** `THREE.MeshStandardMaterial` з `transparent=true`

```typescript
const shader = Shader.Transparent;

// Властивості те ж, що Standard
// Але з автоматичною альфа-прозорістю
```

### 6. VertexLit (Legacy просте)

**Використовує:** `THREE.MeshPhongMaterial` (спрощений)

```typescript
const shader = Shader.VertexLit;

// Властивості:
shader.hasProperty("_Color");         // ✅ Колір
shader.hasProperty("_MainTex");       // ✅ Текстура
shader.hasProperty("_Shininess");     // ✅ Гострота
```

---

## 💡 Приклади

### Приклад 1: Перевірка шейдера перед використанням

```typescript
const material = new StandardMaterial();

if (material.shader.isSupported) {
    console.log(`Використовуємо: ${material.shader.shaderName}`);
} else {
    console.error("Шейдер не підтримується!");
}
```

### Приклад 2: Динамічна зміна шейдера

```typescript
const material = new Material(Shader.Unlit);

// Пізніше змінюємо на Standard
material.shader = Shader.Standard;
material.setFloat("_Metallic", 0.8);
material.setFloat("_Glossiness", 0.6);
```

### Приклад 3: Перевірка властивостей

```typescript
const shader = Shader.Find("Standard");

if (shader) {
    // Перевіряємо наявність та тип
    if (shader.hasProperty("_Metallic")) {
        const type = shader.getPropertyType("_Metallic");
        if (type === ShaderPropertyType.Float) {
            console.log("Можемо встановлювати float значення");
        }
    }
}
```

### Приклад 4: Вибір шейдера за умовою

```typescript
function createMaterialForPlatform(isPowerful: boolean) {
    if (isPowerful) {
        // Багатофункціональний PBR
        return new StandardMaterial();
    } else {
        // Легкий шейдер для мобілки
        return new Material(Shader.Unlit);
    }
}
```

---

## 🔗 Внутрішній mapping на Three.js

| Наш Shader | THREE.Material | WebGL Feature |
|-----------|-----------------|---------------|
| Standard | MeshStandardMaterial | PBR (Metallic) |
| Unlit | MeshBasicMaterial | Constant color |
| Diffuse | MeshLambertMaterial | Diffuse per-vertex |
| Specular | MeshPhongMaterial | Blinn-Phong |
| Transparent | MeshStandardMaterial | Alpha blending |
| VertexLit | MeshPhongMaterial | Simplified |

---

## ⚠️ Обмеження

### Які операції ЗАБОРОНЕНІ

```typescript
// ❌ Не можна писати GLSL напряму
// ❌ Не можна міксити різні WebGL версії
// ❌ Не можна змінювати внутрішні THREE.Material параметри
```

### Як правильно робити

```typescript
// ✅ Використовувати Material API
const material = new StandardMaterial();
material.albedoColor = Color.red;
material.metallic = 0.5;

// ✅ Якщо потрібна більше гнучкості — використовувати Keywords
material.enableKeyword("CUSTOM_MODE");
```

---

## 📊 Тип шейдера та дефолтні параметри

| Шейдер | Дефолтний колір | Дефолтна текстура | Особливість |
|--------|-----------------|-------------------|------------|
| Standard | Білий | Білий (1x1) | PBR |
| Unlit | Білий | Білий | Без освітлення |
| Diffuse | Білий | Білий | Просто |
| Specular | Білий | Білий | З відблисками |
| Transparent | Напівпрозорий | Білий | Alpha blending |
| VertexLit | Білий | Білий | Legacy |

---

## 🎯 Рекомендації

### Коли використовувати який шейдер?

| Сценарій | Рекомендація |
|----------|-------------|
| 3D персонажі, предмети | **Standard** (найкращий результат) |
| UI, спрайти, 2D | **Unlit** (найшвидший) |
| Стара гра, legacy код | **VertexLit** |
| Прозорі об'єкти (вода, скло) | **Transparent** |
| Стіни, землі, декорації | **Standard** або **Diffuse** |
| Спеціальні ефекти | **Custom Material** з Keywords |

---

## 📋 Related

- [Material.md](./Material.md) — як використовувати Shader в Material
- [StandardMaterial.md](./StandardMaterial.md) — розширення для PBR
- [Texture2D.md](./Texture2D.md) — текстури для шейдерів

---

**Дата оновлення:** 15 січня 2026
