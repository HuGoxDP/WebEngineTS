# Texture2D

## 📖 Опис

**Texture2D** — це клас для роботи з 2D текстурами у двигуні. Повна імітація Unity `Texture2D` API.

Дозволяє:
- Створювати текстури з заданими розмірами
- Читати та писати окремі пікселі (`getPixel`, `setPixel`)
- Робити білінійну інтерполяцію пікселів (`getPixelBilinear`)
- Завантажувати текстури з URL
- Кодувати у PNG/JPEG
- Отримувати вбудовані текстури (white, black, gray, normal)

**Файл:** `src/engine/core/graphics/Texture2D.ts`

---

## 🔧 API

### Конструктор

```typescript
// Створення порожної текстури
const texture = new Texture2D(512, 512);  // 512x512 пікселів

// З форматом
const texture = new Texture2D(256, 256, TextureFormat.RGBA32, true);
```

### Властивості

```typescript
texture.width       // Ширина в пікселях (readonly)
texture.height      // Висота в пікселях (readonly)
texture.format      // Формат текстури (readonly)
texture.isReadable  // Чи можна читати пікселі
texture.mipmapCount // Кількість mipmap рівнів
```

### Методи роботи з пікселями

```typescript
// Отримати колір одного пікселя
const color = texture.getPixel(10, 20);

// Встановити колір пікселя
texture.setPixel(10, 20, Color.red);

// Отримати всі пікселі
const allPixels = texture.getPixels();  // Color[]

// Встановити всі пікселі
texture.setPixels([...colors]);

// Білінійна інтерполяція (UV координати 0-1)
const interpolated = texture.getPixelBilinear(0.5, 0.5);

// Застосувати зміни на GPU
texture.apply();
texture.apply(true, false);   // updateMipmaps, makeNoLongerReadable

// Зробити нечитабельною (оптимізація пам'яті)
texture.apply(true, true);
```

### Завантаження та створення

```typescript
// Завантажити з URL (асинхронно)
const texture = await Texture2D.Load("assets/wood.png");

// Створити з масиву кольорів
const colors = new Array(256*256).fill(Color.white);
const texture = Texture2D.CreateFromData(colors, 256, 256);
```

### Кодування

```typescript
// У PNG (дає Data URL)
const pngUrl = texture.encodeToPNG();

// У JPEG з якістю
const jpgUrl = texture.encodeToJPG(0.92);
```

### Вбудовані текстури

```typescript
const white = Texture2D.whiteTexture;    // 1x1 білий
const black = Texture2D.blackTexture;    // 1x1 чорний
const gray = Texture2D.grayTexture;      // 1x1 сірий
const normal = Texture2D.normalTexture;  // 1x1 normal map (0.5, 0.5, 1.0)
```

---

## 📊 TextureFormat

```typescript
enum TextureFormat {
    RGBA32,      // 8-біт на канал (найпоширеніший)
    RGB24,       // Без альфа-каналу
    Alpha8,      // Тільки альфа
    ARGB32,      // Alpha-first
    RGB565,      // Стиснена 16-бітна
    R16,         // 16-біт одна компонента
    RFloat,      // 32-біт float, один канал
    RGFloat,     // 32-біт float, два канали
    RGBAFloat    // 32-біт float, 4 канали (HDR)
}
```

---

## 💡 Примеры

### Приклад 1: Програмне створення текстури

```typescript
// Створяємо білу текстуру з червоним хрестом
const size = 128;
const texture = new Texture2D(size, size);

// Заповнюємо білим
for (let i = 0; i < size * size; i++) {
    texture.setPixel(i % size, Math.floor(i / size), Color.white);
}

// Малюємо червоний горизонтальний крест
for (let x = 0; x < size; x++) {
    texture.setPixel(x, size / 2, Color.red);
    texture.setPixel(size / 2, x, Color.red);
}

// Застосовуємо
texture.apply();
```

### Приклад 2: Завантаження та використання

```typescript
const loader = async () => {
    const brickTexture = await Texture2D.Load("assets/brick.png");
    
    const material = new StandardMaterial();
    material.albedoTexture = brickTexture;
    
    return material;
};
```

### Приклад 3: Білінійна інтерполяція

```typescript
// Для smooth sampling при UV < 0 або UV > 1
const uv = new Vector2(0.5, 0.5);  // Центр текстури
const smoothColor = texture.getPixelBilinear(uv.x, uv.y);

// Це дає більш гладкий результат ніж звичайний getPixel
```

### Приклад 4: Динамічна текстура

```typescript
// Texture, яка оновлюється щокадр
class DynamicTextureUpdater extends ScriptableBehaviour {
    private texture: Texture2D;
    
    onAwake() {
        this.texture = new Texture2D(256, 256);
    }
    
    onUpdate() {
        // Оновлюємо пікселі щокадр
        for (let y = 0; y < 256; y++) {
            for (let x = 0; x < 256; x++) {
                const color = new Color(
                    Math.sin(Time.deltaTime + x / 256) * 0.5 + 0.5,
                    Math.sin(Time.deltaTime + y / 256) * 0.5 + 0.5,
                    0.5,
                    1
                );
                this.texture.setPixel(x, y, color);
            }
        }
        
        // Застосовуємо на GPU
        this.texture.apply(false);
    }
}
```

---

## ⚙️ Внутрішня реалізація

### Three.js mapping

Texture2D використовує `THREE.CanvasTexture` для зберігання пікселів:

```typescript
// Внутрішньо
private _pixels: Color[] | null = null;  // CPU-сторона дані
public _threeTexture: THREE.Texture;      // GPU текстура

// При apply() ми копіюємо Color[] → ImageData → Canvas → THREE.Texture
```

### Zero-Allocation в дії

```typescript
// При завантаженні з URL мініміці копіювання:
public static async Load(url: string): Promise<Texture2D> {
    const texture = new Texture2D(...);
    texture._threeTexture = три.load(url);  // Прямо з THREE.TextureLoader
    return texture;
}
```

---

## 🎯 Випадки використання

| Випадок | Метод |
|---------|-------|
| Albedo карта | `Texture2D.Load("albedo.png")` → `material.albedoTexture` |
| Normal map | `await Texture2D.Load("normal.png")` → `material.normalTexture` |
| Динамічна текстура | `new Texture2D(256, 256)` + `setPixel` + `apply()` |
| Screen capture | `texture.encodeToPNG()` → зберегти/відправити |
| Процедурна текстура | Перлін noise → `setPixels()` → `apply()` |

---

## ⚡ Продуктивність

| Операція | Примітка |
|----------|---------|
| `getPixel` | O(1), але медленна без mipmap |
| `setPixel` | O(1), потребує `apply()` |
| `apply()` | Вагомо (копіює весь масив на GPU) |
| `makeNoLongerReadable` | Звільняє CPU пам'ять |

**Рекомендація:** Для анімованих текстур використовуйте `apply(false, false)` без обновлення mipmaps.

---

## 📋 Related

- [Texture.md](./Texture.md) — базовий клас
- [Material.md](./Material.md) — використання в матеріалах
- [StandardMaterial.md](./StandardMaterial.md) — PBR текстури
- [Color.md](./Color.md) — робота з кольорами

---

**Дата оновлення:** 15 січня 2026
