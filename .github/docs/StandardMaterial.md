# StandardMaterial

## 📖 Опис

**StandardMaterial** — це PBR (Physically Based Rendering) матеріал. Найпотужніший та найгнучкіший матеріал у двигуні.

Відповідає Unity `Standard` шейдеру і внутрішньо використовує `THREE.MeshStandardMaterial`.

**Файл:** `src/engine/core/graphics/StandardMaterial.ts`

---

## 🎨 PBR Workflow

```
Albedo (базовий колір)
    ↓
Metallic (метал чи пластик?) + Smoothness (гладкий чи шорсткий?)
    ↓
Normal Map (мікродеталі)
    ↓
Occlusion (куточки в тіні)
    ↓
Emission (самосвічення)
    ↓
= Реалістичний результат!
```

---

## 🔧 API

### Конструктор

```typescript
// Новий Standard матеріал
const material = new StandardMaterial();
```

### Albedo (базовий колір та текстура)

```typescript
// Колір
material.albedoColor = Color.white;

// Текстура
const texture = await Texture2D.Load("assets/wood_albedo.png");
material.albedoTexture = texture;

// Комбінація: фінальний колір = albedoColor * albedoTexture
```

### Metallic Workflow

```typescript
// Металічність (0 = діелектрик, 1 = чистий метал)
material.metallic = 0;      // Дерево
material.metallic = 1;      // Метал

// Гладкість (0 = дуже шорсткий, 1 = дзеркально гладкий)
material.smoothness = 0.5;  // Матове дерево
material.smoothness = 1.0;  // Полірована сталь

// Текстура Metallic+Roughness
// Red = Metallic, Green = Smoothness
material.metallicTexture = metallicMap;

// Масштаб карти гладкості
material.glossMapScale = 1.0;

// Допоміжний метод для встановлення обох відразу
material.setMetallic(metallic, smoothness);
```

### Normal Mapping (деталі поверхні)

```typescript
// Normal map текстура
material.normalTexture = await Texture2D.Load("assets/normal.png");

// Сила ефекту (0 = без ефекту, 1 = максимум)
material.normalScale = 1.0;
```

### Height / Parallax Mapping (3D ефект)

```typescript
// Height map (контрастність = глибина)
material.heightTexture = await Texture2D.Load("assets/height.png");

// Сила паралакс ефекту
material.heightScale = 0.1;

// Більше = більше 3D ефекту, але повільніше
```

### Ambient Occlusion (затіняння кутків)

```typescript
// AO текстура (чорне = затінено)
material.occlusionTexture = aoMap;

// Сила ефекту (0 = без, 1 = максимум)
material.occlusionStrength = 1.0;
```

### Emission (самосвічення)

```typescript
// Колір світла
material.emissionColor = Color.green;

// Текстура які місця світяться
material.emissionTexture = emissionMap;

// Допоміжний метод
material.setEmission(Color.blue, intensity);
```

### Detail Textures (дрібні деталі)

```typescript
// Додаткова текстура для мікро-деталей
material.detailAlbedoTexture = detailMap;

// Normal деталей
material.detailNormalTexture = detailNormal;

// Маска до яких місць застосовувати деталі
material.detailMask = detailMaskMap;
```

### Rendering Mode

```typescript
// Непрозорий (за замовчуванням)
material.renderMode = MaterialRenderMode.Opaque;

// Обрізання по альфа (наприклад листя дерева)
material.renderMode = MaterialRenderMode.Cutout;
material.alphaCutoff = 0.5;  // Поріг (0-1)

// Плавне затухання прозорості
material.renderMode = MaterialRenderMode.Fade;

// Повна прозорість (вода, скло)
material.renderMode = MaterialRenderMode.Transparent;

// Допоміжний метод
material.makeTransparent(alpha);
```

---

## 💡 Приклади

### Приклад 1: Цегла

```typescript
const material = new StandardMaterial();

// Завантажуємо текстури для цегли
const albedo = await Texture2D.Load("assets/brick_albedo.png");
const normal = await Texture2D.Load("assets/brick_normal.png");
const ao = await Texture2D.Load("assets/brick_ao.png");

// Налаштовуємо
material.albedoTexture = albedo;
material.normalTexture = normal;
material.normalScale = 1.0;
material.occlusionTexture = ao;
material.occlusionStrength = 0.8;

// Цегла не блискуча
material.metallic = 0;
material.smoothness = 0.2;
```

### Приклад 2: Полірована сталь

```typescript
const material = new StandardMaterial();

material.albedoColor = new Color(0.5, 0.5, 0.5, 1);  // Сіра

// Чистий метал
material.metallic = 1.0;

// Дзеркально гладкий
material.smoothness = 1.0;

// Без нормалів (ідеально гладкий)
material.normalScale = 0;
```

### Приклад 3: Emisive об'єкт (ліхтар)

```typescript
const material = new StandardMaterial();

// Жовтий ліхтар
material.albedoColor = Color.yellow;

// Світить жовто
material.setEmission(Color.yellow, 2.0);

// Не блискуча з-за жару
material.smoothness = 0.3;
```

### Приклад 4: Прозоре скло

```typescript
const material = new StandardMaterial();

material.renderMode = MaterialRenderMode.Transparent;

// Майже білий (мало кольору)
material.albedoColor = new Color(0.95, 0.95, 1.0, 0.3);

// Метал + гладкість не впливають на скло

// Нормали для фактури
material.normalTexture = glassNormalMap;
material.normalScale = 0.5;
```

### Приклад 5: Дерево з листям (Cutout)

```typescript
const material = new StandardMaterial();

// Текстура листя з прозорим фоном
material.albedoTexture = leafTexture;

// Обрізаємо прозоре
material.renderMode = MaterialRenderMode.Cutout;
material.alphaCutoff = 0.5;

// Normal для реалізму
material.normalTexture = leafNormal;

// Натуральне дерево
material.metallic = 0;
material.smoothness = 0.4;
```

### Приклад 6: Програмна зміна

```typescript
class DynamicGlow extends ScriptableBehaviour {
    private material: StandardMaterial;
    
    onAwake() {
        const renderer = this.gameObject.getComponent(MeshRenderer);
        this.material = renderer.material as StandardMaterial;
    }
    
    onUpdate() {
        // Пульсує свічення
        const intensity = Math.sin(Time.time) * 0.5 + 0.5;
        this.material.setEmission(Color.green, intensity * 2);
    }
}
```

---

## 📊 Таблиця налаштувань для різних матеріалів

| Матеріал | Metallic | Smoothness | Normal | Emission |
|----------|----------|-----------|--------|----------|
| Цегла | 0 | 0.1-0.2 | 1.0 | (0,0,0) |
| Дерево | 0 | 0.3-0.4 | 0.8 | (0,0,0) |
| Сталь | 1.0 | 0.7-1.0 | 0.2 | (0,0,0) |
| Пластик | 0 | 0.8-0.9 | 0.5 | (0,0,0) |
| Скло | 0 | 1.0 | 0.3 | (0,0,0) |
| Ліхтар | 0.2 | 0.4 | 0.3 | > 1.0 |
| Вода | 0 | 0.95 | 0.8 | (0,0,0) |

---

## ⚙️ Поширені помилки

### ❌ Неправильна логіка Metallic

```typescript
// ПЛОХО! Цегла не може бути металом
material.metallic = 0.5;      // Дивна комбінація
material.smoothness = 0.8;    // Блискуча цегла? Дивно
```

### ✅ Правильно: Дотримуйтесь реальності

```typescript
// ДОБРЕ! Цегла — це діелектрик
material.metallic = 0;        // Не метал
material.smoothness = 0.2;    // Шорсткий
```

### ❌ Неправильна інтенсивність Emission

```typescript
// ПЛОХО! Нереально яскравий
material.setEmission(Color.white, 10.0);
```

### ✅ Правильно: Реалістичні значення

```typescript
// ДОБРЕ! (для світлого об'єкта)
material.setEmission(Color.yellow, 2.0);

// ДОБРЕ! (для тьмавіших об'єктів)
material.setEmission(Color.red, 0.5);
```

---

## 🎯 Performance Tips

| Операція | Вартість | Рекомендація |
|----------|----------|-------------|
| Albedo Color | Дешевле | Використовувати |
| Albedo Texture | Нормально | Завжди |
| Normal Map | Нормально | Рекомендується |
| Metallic/Smoothness | Дешево | Завжди |
| Height Map | Дорого | Тільки для важних об'єктів |
| Detail Maps | Дорого | Вибірково |
| Emission | Залежить | Для ночей мінімізувати |

---

## 📋 Related

- [Material.md](./Material.md) — базовий API матеріалів
- [Shader.md](./Shader.md) — система шейдерів
- [Texture2D.md](./Texture2D.md) — завантаження текстур
- [MeshRenderer.md](./MeshRenderer.md) — застосування матеріалу

---

**Дата оновлення:** 15 січня 2026
