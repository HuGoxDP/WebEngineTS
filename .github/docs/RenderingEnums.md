# RenderingEnums

## 📖 Опис

**RenderingEnums** — це файл з енумераціями та konstant'ами для рендерингу. Містить налаштування для шейдерів, матеріалів, текстур та інших графічних опцій.

**Файл:** `src/engine/core/graphics/RenderingEnums.ts`

---

## 📊 FilterMode

Як фільтрувати текстури при масштабуванні:

```typescript
enum FilterMode {
    Point = 0,      // Найближчий піксель (pixelated look)
    Bilinear = 1,   // Лінійна інтерполяція (гладко)
    Trilinear = 2   // З мипмапом (найліпше)
}
```

**Використання:**
```typescript
texture.filterMode = FilterMode.Trilinear;
```

**Порівняння:**

| Mode | Вид | Швидкість | Якість |
|------|-----|----------|--------|
| Point | Кубики (8-біт) | ⚡ Найшвидше | ⭐ |
| Bilinear | Гладко | ⚡⚡ Нормально | ⭐⭐⭐ |
| Trilinear | Гладко видалено | ⚡⚡⚡ Повільніше | ⭐⭐⭐⭐ |

---

## 🔄 TextureWrapMode

Як повторювати текстуру за межами координат [0, 1]:

```typescript
enum TextureWrapMode {
    Repeat = 0,    // Цикл (повтор)
    Clamp = 1,     // Розтягнення краю
    Mirror = 2     // Дзеркальне відбиття
}
```

**Використання:**
```typescript
texture.wrapMode = TextureWrapMode.Repeat;
```

**Візуалізація:**

```
Текстура: R G B (три пікселі)

Repeat:   R G B | R G B | R G B   ← цикл
Clamp:    R R G | B B B | B B B   ← край розтягується
Mirror:   R G B | B G R | R G B   ← дзеркало
```

**Випадки використання:**

| Mode | Випадок |
|------|---------|
| Repeat | Цегляні стіни, дерево, трава |
| Clamp | Бордюри, UI елементи |
| Mirror | Симетричні об'єкти, вода |

---

## 🎨 Інші важливі enum'и (з інших класів)

### ShadowCastingMode (Renderer)

```typescript
enum ShadowCastingMode {
    Off = 0,        // Не відкидає тіні
    On = 1,         // Звичайне відкидання тіней
    TwoSided = 2,   // Обидві сторони трикутників
    ShadowsOnly = 3 // Тільки тіні (невидимі об'єкти)
}
```

### LightProbeUsage (Renderer)

```typescript
enum LightProbeUsage {
    Off = 0,                 // Без light probes
    BlendProbes = 1,         // Інтерполяція між пробами
    UseProxyVolume = 2,      // AABB proxy volume
    CustomProvided = 3       // Користувацькі дані
}
```

### ReflectionProbeUsage (Renderer)

```typescript
enum ReflectionProbeUsage {
    Off = 0,                        // Без reflection
    BlendProbes = 1,                // Змішування двох проб
    BlendProbesAndSkybox = 2,       // З skybox fallback
    Simple = 3                      // Найбліжча проба
}
```

### CameraClearFlags (Camera)

```typescript
enum CameraClearFlags {
    SolidColor = 0,  // Фоновий колір
    Depth = 1,       // Очистити тільки глибину
    Nothing = 2      // Не очищувати (обычно неправильно)
}
```

### LightShadows (Light)

```typescript
enum LightShadows {
    None = 0,  // Без тіней
    Hard = 1,  // Жорсткі краї
    Soft = 2   // М'які краї
}
```

### LightShadowResolution (Light)

```typescript
enum LightShadowResolution {
    Low = 0,       // 512x512 (швидко)
    Medium = 1,    // 1024x1024 (нормально)
    High = 2,      // 2048x2048 (гарно)
    VeryHigh = 3   // 4096x4096 (дорого)
}
```

### MaterialRenderMode (StandardMaterial)

```typescript
enum MaterialRenderMode {
    Opaque = 0,      // Непрозорий
    Cutout = 1,      // Obрізування (листя, трава)
    Fade = 2,        // Плавне затухання
    Transparent = 3  // Повна прозорість
}
```

### MeshTopology (Mesh)

```typescript
enum MeshTopology {
    Triangles = 0,  // Трикутники (стандартно)
    Quads = 1,      // Чотирикутники
    Lines = 2,      // Лінії
    LineStrip = 3,  // Зв'язана лінія (змій)
    Points = 4      // Точки (хмара частинок)
}
```

### IndexFormat (Mesh)

```typescript
enum IndexFormat {
    UInt16 = 0,  // 16-біт (до 65K вершин)
    UInt32 = 1   // 32-біт (до 4B вершин)
}
```

### TextureFormat (Texture2D)

```typescript
enum TextureFormat {
    RGBA32 = 0,      // 32-біт (8-біт на канал) - стандарт
    RGB24 = 1,       // 24-біт без alpha
    Alpha8 = 2,      // Тільки alpha
    ARGB32 = 3,      // Alpha first
    RGB565 = 4,      // Стиснена 16-біт
    R16 = 5,         // 16-біт один канал
    RFloat = 6,      // 32-біт float один канал (HDR)
    RGFloat = 7,     // 32-біт float два канали
    RGBAFloat = 8    // 32-біт float 4 канали (32 байти!)
}
```

### ShaderPropertyType (Shader)

```typescript
enum ShaderPropertyType {
    Color = 0,   // RGB/RGBA колір
    Vector = 1,  // Vector4
    Float = 2,   // Число
    Range = 3,   // Float [0-1]
    Texture = 4, // Посилання на текстуру
    Int = 5      // Ціле число
}
```

---

## 💡 Приклади використання

### Приклад 1: Налаштування текстури для стіни

```typescript
const brickTexture = await Texture2D.Load("assets/brick.png");

// Стіна має повторюватися
brickTexture.wrapMode = TextureWrapMode.Repeat;

// Гарна якість на всіх відстанях
brickTexture.filterMode = FilterMode.Trilinear;
brickTexture.anisoLevel = 4;

const material = new StandardMaterial();
material.albedoTexture = brickTexture;
```

### Приклад 2: Прозорі листя

```typescript
const leafMaterial = new StandardMaterial();

// Режим обрізування для листя дерева
leafMaterial.renderMode = MaterialRenderMode.Cutout;
leafMaterial.alphaCutoff = 0.5;

leafMaterial.albedoTexture = await Texture2D.Load("leaf.png");
leafMaterial.albedoTexture.wrapMode = TextureWrapMode.Clamp;
```

### Приклад 3: Динамічне кольорування

```typescript
// Режим оновлення тіней
renderer.shadowCastingMode = ShadowCastingMode.On;

// Отримання тіней від інших об'єктів
renderer.receiveShadows = true;
```

### Приклад 4: Вода (mirror effect)

```typescript
const waterMaterial = new StandardMaterial();

// Дзеркальне текстурування
waterMaterial.mainTextureScale = new Vector2(1, 1);
waterMaterial.setTextureOffset(
    "_MainTex",
    new Vector2(Time.time * 0.1, 0)  // Прокрутка
);

// Дзеркало
const waterTexture = await Texture2D.Load("water.png");
waterTexture.wrapMode = TextureWrapMode.Mirror;
waterMaterial.albedoTexture = waterTexture;
```

---

## 📊 Таблиця використання enum'ів

| Enum | Клас | Властивість |
|------|------|-------------|
| FilterMode | Texture | filterMode |
| TextureWrapMode | Texture | wrapMode |
| ShadowCastingMode | Renderer | shadowCastingMode |
| MaterialRenderMode | StandardMaterial | renderMode |
| MeshTopology | Mesh | topology (SubMesh) |
| LightShadows | Light | shadows |
| CameraClearFlags | Camera | clearFlags |

---

## 🎯 Рекомендовані налаштування

### Для якості (якісні графіки):
```typescript
texture.filterMode = FilterMode.Trilinear;
texture.anisoLevel = 4;
material.renderMode = MaterialRenderMode.Opaque;
```

### Для мобілки (швидкість):
```typescript
texture.filterMode = FilterMode.Bilinear;
texture.anisoLevel = 1;
material.renderMode = MaterialRenderMode.Opaque;
```

### Для прозорості:
```typescript
material.renderMode = MaterialRenderMode.Transparent;
renderer.shadowCastingMode = ShadowCastingMode.Off;
```

---

## 📋 Related

- [Texture.md](./Texture.md) — FilterMode, TextureWrapMode
- [StandardMaterial.md](./StandardMaterial.md) — MaterialRenderMode
- [Renderer.md](./Renderer.md) — ShadowCastingMode, LightProbeUsage
- [Mesh.md](./Mesh.md) — MeshTopology, IndexFormat

---

**Дата оновлення:** 15 січня 2026
