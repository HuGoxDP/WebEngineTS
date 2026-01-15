# Material

## 📖 Опис

**Material** — це базовий клас для всіх матеріалів. Зберігає посилання на Shader та його властивості (колір, текстури, числові параметри).

Два основні режими:
1. **Shared Material** — спільний ресурс (для оптимізації)
2. **Instance Material** — копія для редагування (як у Unity)

**Файл:** `src/engine/core/graphics/Material.ts`

---

## 🔧 API

### Конструктор

```typescript
// Створення з шейдера
const material = new Material(Shader.Standard);

// Копіювання іншого матеріалу
const copy = new Material(otherMaterial);
```

### Основні властивості

```typescript
material.shader              // Посилання на Shader
material.color              // = getColor("_Color")
material.mainTexture        // = getTexture("_MainTex")
material.mainTextureOffset  // Offset текстури
material.mainTextureScale   // Масштаб (tiling) текстури
material.renderQueue        // Порядок рендерингу (низьче = раніше)
```

### Робота з властивостями — Колір

```typescript
// Отримати колір
const color = material.getColor("_Color");

// Встановити колір
material.setColor("_Color", Color.red);
material.setColor("_EmissionColor", Color.blue);

// Скорочено (тільки для _Color)
material.color = Color.green;
```

### Робота з властивостями — Float

```typescript
// Отримати float
const metallic = material.getFloat("_Metallic");

// Встановити float
material.setFloat("_Metallic", 0.8);
material.setFloat("_Glossiness", 0.6);
```

### Робота з властивостями — Int

```typescript
// Отримати int
const mode = material.getInt("_Mode");

// Встановити int
material.setInt("_Mode", 1);
```

### Робота з властивостями — Vector4

```typescript
// Отримати Vector4
const vec = material.getVector("_CustomVec");

// Встановити Vector4
material.setVector("_CustomVec", new Vector4(1, 0, 0, 1));
```

### Робота з властивостями — Matrix4x4

```typescript
// Отримати матрицю
const mat = material.getMatrix("_CustomMatrix");

// Встановити матрицю
material.setMatrix("_CustomMatrix", Matrix4x4.identity);
```

### Робота з властивостями — Texture

```typescript
// Отримати текстуру
const tex = material.getTexture("_MainTex");

// Встановити текстуру
const texture = await Texture2D.Load("assets/wood.png");
material.setTexture("_MainTex", texture);

// Встановити null (видалити текстуру)
material.setTexture("_MainTex", null);
```

### Робота з UV параметрами текстури

```typescript
// Offset
material.setTextureOffset("_MainTex", new Vector2(0.1, 0.2));
const offset = material.getTextureOffset("_MainTex");  // Vector2(0.1, 0.2)

// Scale (tiling)
material.setTextureScale("_MainTex", new Vector2(2, 2));  // 2x2 повтори
const scale = material.getTextureScale("_MainTex");
```

### Перевірка властивостей

```typescript
// Чи матеріал має властивість?
if (material.hasProperty("_Metallic")) {
    material.setFloat("_Metallic", 0.8);
}
```

### Система Keywords (ключові слова)

```typescript
// Увімкнути режим
material.enableKeyword("CUSTOM_MODE");

// Вимкнути режим
material.disableKeyword("CUSTOM_MODE");

// Перевірити
if (material.isKeywordEnabled("CUSTOM_MODE")) {
    console.log("Режим увімкнений");
}
```

### Копіювання властивостей

```typescript
// Копіює ВСІ властивості з іншого матеріалу
const source = new StandardMaterial();
source.metallic = 0.5;

const target = new Material(Shader.Standard);
target.copyPropertiesFromMaterial(source);
console.log(target.getFloat("_Metallic"));  // 0.5
```

---

## 💡 Приклади

### Приклад 1: Базове використання

```typescript
const material = new Material(Shader.Standard);

// Встановлюємо властивості
material.color = Color.red;
material.setFloat("_Metallic", 0.5);
material.setFloat("_Glossiness", 0.8);

// Використовуємо в рендерері
const renderer = gameObject.addComponent(MeshRenderer);
renderer.material = material;
```

### Приклад 2: Завантаження текстури

```typescript
const material = new StandardMaterial();

// Завантажуємо асинхронно
const texture = await Texture2D.Load("assets/brick.png");

// Встановлюємо
material.mainTexture = texture;

// Додаємо tiling
material.mainTextureScale = new Vector2(2, 2);
```

### Приклад 3: Shared vs Instance

```typescript
// Shared материал (спільний для всіх об'єктів)
const sharedMat = new StandardMaterial();

// Об'єкт 1 — використовує Shared
const renderer1 = obj1.getComponent(MeshRenderer);
renderer1.sharedMaterial = sharedMat;  // Прямо посилання

// Об'єкт 2 — використовує Instance (копія)
const renderer2 = obj2.getComponent(MeshRenderer);
renderer2.material = sharedMat;  // Копіюється!

// Тепер ми можемо змінювати renderer2.material без впливу на інші
renderer2.material.color = Color.blue;

// А sharedMat залишається червоним
console.log(sharedMat.color);  // Все ще червоний
```

### Приклад 4: Динамічна зміна властивостей

```typescript
class AnimatedMaterial extends ScriptableBehaviour {
    private material: Material;
    
    onAwake() {
        this.material = this.gameObject
            .getComponent(MeshRenderer)
            .material;  // Instance копія!
    }
    
    onUpdate() {
        // Пульсує по X
        const scale = Math.sin(Time.time) * 0.5 + 1;
        this.material.setTextureScale("_MainTex", new Vector2(scale, 1));
    }
}
```

### Приклад 5: Keywords для варіантів матеріалу

```typescript
const material = new StandardMaterial();

// Для ночі
material.enableKeyword("NIGHT_MODE");
material.emissionColor = new Color(0.1, 0.1, 0.15, 1);

// Для дня
material.disableKeyword("NIGHT_MODE");
material.emissionColor = Color.black;
```

---

## ⚙️ Внутрішня реалізація

### Mapping на Three.js

```typescript
// Користувач:
material.setColor("_Color", Color.red);

// Внутрішньо:
this._threeMaterial.color.setHex(color.getHex());
this._threeMaterial.opacity = color.a;
```

### Zero-Allocation

```typescript
// Користувач:
const color = material.getColor("_Color");

// Внутрішньо робимо копію (не повертаємо reference!)
return this._properties.get("_Color").clone();
```

---

## 🎯 Поширені помилки

### ❌ Неправильно: Мутація Shared

```typescript
// ПЛОХО! Змінює всі об'єкти що використовують sharedMaterial
renderer.sharedMaterial.color = Color.blue;
```

### ✅ Правильно: Використовування Instance

```typescript
// ДОБРЕ! Змінює тільки цей рендерер
renderer.material.color = Color.blue;
```

### ❌ Неправильно: Прямий доступ до Three.js

```typescript
// ЗАБОАРЕНЕНО!
renderer.material._threeMaterial.map = someTexture;
```

### ✅ Правильно: Використовування API

```typescript
// ДОБРЕ!
renderer.material.setTexture("_MainTex", someTexture);
```

---

## 📊 Таблиця типів властивостей

| Тип | Метод Get | Метод Set | Приклад |
|-----|-----------|-----------|---------|
| Color | getColor | setColor | `_Color`, `_EmissionColor` |
| Float | getFloat | setFloat | `_Metallic`, `_Glossiness` |
| Int | getInt | setInt | `_Mode` |
| Vector4 | getVector | setVector | Користувацькі |
| Matrix | getMatrix | setMatrix | Користувацькі |
| Texture | getTexture | setTexture | `_MainTex`, `_BumpMap` |

---

## 🔗 Related

- [Shader.md](./Shader.md) — як вибрати шейдер
- [StandardMaterial.md](./StandardMaterial.md) — розширення для PBR
- [MeshRenderer.md](./MeshRenderer.md) — як використовувати Material в рендері

---

**Дата оновлення:** 15 січня 2026
