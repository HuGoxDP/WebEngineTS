# Texture

## 📖 Опис

**Texture** — це абстрактний базовий клас для всіх типів текстур. Використовується як основа для Texture2D, RenderTexture та інших похідних класів.

Текстура зберігається на GPU та використовується матеріалами для візуальних ефектів.

**Файл:** `src/engine/core/graphics/Texture.ts`

---

## 🔧 API

### Властивості

```typescript
texture.width: number;          // Ширина в пікселях (readonly)
texture.height: number;         // Висота в пікселях (readonly)
texture.filterMode: FilterMode; // Фільтрація при масштабуванні
texture.wrapMode: TextureWrapMode; // Повторення за межами
texture.anisoLevel: number;     // Анізотропна фільтрація (0-16)
texture.mipMapBias: number;     // Зміщення mipmap рівня
```

### Методи — UV операції

```typescript
// Встановити offset текстури (зсув)
texture.setOffset(x: number, y: number);

// Встановити tiling (повтори на текстурі)
texture.setTiling(x: number, y: number);

// Приклад:
// setOffset(0.5, 0) — зсув на половину вправо
// setTiling(2, 2) — 2x2 повтори текстури
```

### Статичні методи (Factory)

```typescript
// Завантажити текстуру з URL (внутрішньо)
// Використовуйте Texture2D.Load замість цього!
```

---

## 📊 FilterMode — Фільтрація

```typescript
enum FilterMode {
    // Point sampling — найбліжший піксель (8-бітний эффект)
    Point,
    
    // Bilinear — лінійна інтерполяція між 4 пікселями
    Bilinear,
    
    // Trilinear — також інтерполює між mipmap рівнями
    Trilinear
}
```

### Відмінності FilterMode

| Mode | Якість | Швидкість | Випадок |
|------|--------|-----------|---------|
| Point | Низька (квадрати) | Найшвидше | 8-біт графіка, пікселі-арт |
| Bilinear | Хороша | Нормально | Переважаючий вибір |
| Trilinear | Найкраще | Повільніше | Високоякісні текстури |

---

## 📊 TextureWrapMode — Повторення

```typescript
enum TextureWrapMode {
    // Повтор текстури за межами [0,1]
    Repeat,
    
    // Обрізання — крайній піксель продовжується
    Clamp,
    
    // Дзеркало — дзеркальне повторення
    Mirror
}
```

### Візуалізація WrapMode

```
Texture: [A B C]
     U:   0 0.5 1

Repeat:  A B C | A B C | A B C   (цикл)
Clamp:   A A B | C C C | C C C   (розтягнення краю)
Mirror:  A B C | C B A | A B C   (дзеркало)
```

---

## 🎯 AnisotropicLevel

Анізотропна фільтрація покращує якість текстур при виглядінні під кутом.

```typescript
texture.anisoLevel = 1;   // Вимкнено (швидко)
texture.anisoLevel = 2;   // 2x анізотропія
texture.anisoLevel = 4;   // 4x анізотропія (рекомендовано)
texture.anisoLevel = 8;   // 8x анізотропія
texture.anisoLevel = 16;  // 16x анізотропія (максимум, повільно)
```

---

## 💡 Приклади

### Приклад 1: Встановлення фільтрації

```typescript
const texture = await Texture2D.Load("assets/wood.png");

// Висока якість
texture.filterMode = FilterMode.Trilinear;
texture.anisoLevel = 4;

// Або бистра рендеринг
texture.filterMode = FilterMode.Bilinear;
texture.anisoLevel = 1;
```

### Приклад 2: Повторення текстури

```typescript
// Цегляна стіна — повтор
texture.wrapMode = TextureWrapMode.Repeat;

// Бордюр — обрізання
texture.wrapMode = TextureWrapMode.Clamp;

// Зеркальна симетрія
texture.wrapMode = TextureWrapMode.Mirror;
```

### Приклад 3: Зміщення та масштабування

```typescript
const material = new StandardMaterial();

// Анімована текстура — прокрутка
material.setTextureOffset("_MainTex", 
    new Vector2(Time.time * 0.5, 0)
);

// Масштабування (zoom)
material.setTextureScale("_MainTex", 
    new Vector2(2, 2)  // 2x збільшення
);
```

---

## 📊 MipMap

MipMap — це набір зменшених копій текстури для оптимізації на далекій відстані.

```
Original: 512x512
MipMap 1: 256x256  (половина)
MipMap 2: 128x128
MipMap 3: 64x64
...
MipMap N: 1x1
```

**Переважай:** триліная фільтрація з мипмапом для найліпшої якості на всіх відстанях!

---

## ⚡ Performance Tips

| Параметр | Вплив | Рекомендація |
|----------|-------|-------------|
| FilterMode | Низько | Bilinear = баланс |
| WrapMode | Найнизько | Repeat дешевше |
| AnisoLevel | Середньо | 2-4 достатньо |
| MipMap | Високо | Завжди включати |
| TextureSize | Критичний | Оптимізувати! |

---

## 📋 Related

- [Texture2D.md](./Texture2D.md) — 2D текстури (розширення)
- [Material.md](./Material.md) — використання в матеріалах
- [StandardMaterial.md](./StandardMaterial.md) — текстури для PBR

---

**Дата оновлення:** 15 січня 2026
