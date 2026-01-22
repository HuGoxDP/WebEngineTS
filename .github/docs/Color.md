# Color

## 📖 Опис

**Color** — це клас для роботи з кольорами у форматі RGBA. Значення компонентів знаходяться в діапазоні від 0.0 до 1.0 (відповідає 0-255 в інших форматах).

Використовується для матеріалів, світел, фонів камери та інших візуальних елементів.

**Файл:** `src/engine/core/graphics/Color.ts`

---

## 🔧 API

### Конструктор

```typescript
// З RGBA компонентами (0.0 - 1.0)
const red = new Color(1, 0, 0, 1);        // Червоний
const white = new Color(1, 1, 1, 1);      // Білий
const transparent = new Color(0, 0, 0, 0);// Прозорий

// За замовчуванням — білий
const defaultColor = new Color();  // (1, 1, 1, 1)
```

### Властивості

```typescript
color.r  // Red (0-1)
color.g  // Green (0-1)
color.b  // Blue (0-1)
color.a  // Alpha / Opacity (0-1)
```

### Методи — Базові операції

```typescript
// Встановити компоненти
color.set(r, g, b, a);

// Копіювання
color.copy(other);
color.clone(): Color;

// Арифметика
color.add(other);           // Адитивне змішування
color.multiply(other);      // Мультиплікативне змішування
color.multiplyScalar(scalar); // Множення на число
```

### Методи — Інтерполяція

```typescript
// Лінійна інтерполяція
color.lerp(target, t);  // 0 <= t <= 1

// Результат: color + (target - color) * t
// t=0 → color, t=1 → target
```

### Методи — Hex формат

```typescript
// Отримати як Hex число (0xRRGGBB)
const hex = color.getHex(): number;  // 0xFF0000 для червоного

// Встановити з Hex числа
color.setHex(0xFF0000);  // Червоний

// Hex формат ігнорує альфа-канал!
```

### Методи — Масиви

```typescript
// Побудова масиву [r, g, b, a]
color.toArray(): [number, number, number, number];

// Будинків: [1, 0, 0, 1] для червоного
```

### Статичні вбудовані кольори

```typescript
Color.white      // (1, 1, 1, 1)
Color.black      // (0, 0, 0, 1)
Color.red        // (1, 0, 0, 1)
Color.green      // (0, 1, 0, 1)
Color.blue       // (0, 0, 1, 1)
Color.yellow     // (1, 0.92, 0.016, 1)
Color.cyan       // (0, 1, 1, 1)
Color.magenta    // (1, 0, 1, 1)
Color.gray       // (0.5, 0.5, 0.5, 1)
Color.clear      // (0, 0, 0, 0) — прозорий
```

---

## 💡 Приклади

### Приклад 1: Встановлення кольору матеріалу

```typescript
const material = new StandardMaterial();

// Варіант 1: RGB прямо
material.albedoColor = new Color(1, 0.5, 0, 1);  // Оранжевий

// Варіант 2: Вбудований колір
material.albedoColor = Color.red;

// Варіант 3: Hex
const color = new Color();
color.setHex(0xFF5500);  // Оранжевий
material.albedoColor = color;
```

### Приклад 2: Інтерполяція кольорів

```typescript
class ColorFader extends ScriptableBehaviour {
    private startColor = Color.red;
    private endColor = Color.blue;
    private material: Material;
    
    onAwake() {
        this.material = this.gameObject
            .getComponent(MeshRenderer)
            .material;
    }
    
    onUpdate() {
        // Плавна зміна кольору
        const progress = (Math.sin(Time.time) + 1) / 2;  // 0 to 1
        
        const lerpedColor = this.startColor.clone()
            .lerp(this.endColor, progress);
        
        this.material.color = lerpedColor;
    }
}
```

### Приклад 3: Адитивне змішування (світло)

```typescript
// Базовий колір об'єкта
const baseColor = new Color(0.5, 0.5, 0.5, 1);

// Світло (адитивне)
const lightColor = new Color(0.2, 0.2, 0, 1);

// Результат освітлення
const litColor = baseColor.clone().add(lightColor);
// Результат: (0.7, 0.7, 0.5, 1) — світліший
```

### Приклад 4: Модуляція (фільтрація)

```typescript
// Текстура колір
const textureColor = new Color(1, 0, 0, 1);  // Червона

// Фільтр
const filterColor = new Color(1, 0.5, 1, 1);  // Рожева

// Результат (мультиплікативно)
const result = textureColor.clone().multiply(filterColor);
// Результат: (1, 0, 1, 1) — magenta
```

### Приклад 5: Прозорість (Alpha Blending)

```typescript
const color = new Color(1, 1, 1, 1);  // Білий, непрозорий

// Стає напівпрозоримим
color.a = 0.5;  // 50% прозоирість

// Повна прозорість
color.a = 0;
```

### Приклад 6: Яскравість

```typescript
// Зменшити яскравість (затемнення)
const darkColor = Color.white.clone()
    .multiplyScalar(0.5);
// Результат: (0.5, 0.5, 0.5, 1) — сірий

// Збільшити яскравість
const brightColor = Color.red.clone()
    .multiplyScalar(1.5);
// Результат: (1.5, 0, 0, 1) — переекспозиція
```

---

## 📊 Таблиця стандартних кольорів

| Назва | RGB | Hex | Випадок використання |
|-------|-----|-----|----------------------|
| white | (1,1,1) | #FFFFFF | Дефолт, нейтральний |
| black | (0,0,0) | #000000 | Тінь, ночь |
| red | (1,0,0) | #FF0000 | Помилка, вибір |
| green | (0,1,0) | #00FF00 | Успіх, ОК |
| blue | (0,0,1) | #0000FF | Інформація |
| yellow | (1,1,0) | #FFFF00 | Попередження |
| cyan | (0,1,1) | #00FFFF | Холодне |
| magenta | (1,0,1) | #FF00FF | Гарячее |
| gray | (0.5,0.5,0.5) | #808080 | Нейтральне |

---

## 🎯 Діапазони значень

| Компонента | Мінімум | Максимум | Значення |
|-----------|--------|---------|---------|
| r, g, b | 0.0 | 1.0 | Нормалізовано |
| a | 0.0 (прозорий) | 1.0 (непрозорий) | Прозорість |

**Примітка:** Three.js внутрішньо конвертує у 0-255 діапазон при передачі в WebGL.

---

## 💡 Цікаві паттерни

### Пульсуючий колір

```typescript
const baseColor = Color.red;
const pulse = Math.sin(Time.time) * 0.5 + 0.5;  // 0-1
const pulsedColor = baseColor.clone().multiplyScalar(pulse);
```

### Міксування трьох кольорів

```typescript
const c1 = Color.red;
const c2 = Color.green;
const c3 = Color.blue;

const mixed = c1.clone()
    .multiplyScalar(0.33)
    .add(c2.clone().multiplyScalar(0.33))
    .add(c3.clone().multiplyScalar(0.34));
```

### Градієнт

```typescript
function getGradientColor(t: number): Color {
    if (t < 0.5) {
        return Color.red.clone().lerp(Color.yellow, t * 2);
    } else {
        return Color.yellow.clone().lerp(Color.green, (t - 0.5) * 2);
    }
}
```

---

## ⚡ Performance Tips

| Операція | Вартість | Рекомендація |
|----------|----------|-------------|
| clone | O(1) | Дешево, робити часто |
| lerp | O(1) | Дешево |
| toArray | O(1) | Дешево |
| Hex операції | O(1) | Дешево |

---

## 📋 Related

- [StandardMaterial.md](./StandardMaterial.md) — використання кольорів у матеріалах
- [Texture2D.md](./Texture2D.md) — робота з пікселями
- [Light.ts (в компонентах)](../Light.ts) — кольори світла

---

**Дата оновлення:** 15 січня 2026
