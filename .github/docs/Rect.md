# Rect - Документація

## Опис
`Rect` — математичний клас для роботи з прямокутниками у 2D просторі. Представляє прямокутну область, визначену позицією та розміром.

## Використання

### Основні застосування:
- **Viewport камери** (Camera.rect)
- **UI елементи** (кнопки, панелі, вікна)
- **Sprite bounds** (межі спрайтів)
- **Texture coordinates** (UV mapping)
- **Screen coordinates** (координати екрану)

---

## Конструктор

```typescript
new Rect(x?: number, y?: number, width?: number, height?: number)
```

**Приклад:**
```typescript
const viewport = new Rect(0, 0, 1920, 1080);
const uiButton = new Rect(100, 200, 150, 50);
const empty = new Rect(); // (0, 0, 0, 0)
```

**Примітка:** Позиція `(x, y)` відповідає **лівому нижньому** куту прямокутника (як в OpenGL).

---

## Властивості

### Основні властивості

#### `x: number`
Координата X лівого краю прямокутника.

```typescript
rect.x = 100;
```

#### `y: number`
Координата Y нижнього краю прямокутника.

```typescript
rect.y = 200;
```

#### `width: number`
Ширина прямокутника.

```typescript
rect.width = 300;
```

#### `height: number`
Висота прямокутника.

```typescript
rect.height = 150;
```

---

### Обчислювані властивості (getters/setters)

#### `xMin: number`
Мінімальна X координата (лівий край).

```typescript
console.log(rect.xMin); // Те ж саме що rect.x
rect.xMin = 50; // Змінює x, зберігаючи xMax
```

#### `xMax: number`
Максимальна X координата (правий край).

```typescript
console.log(rect.xMax); // rect.x + rect.width
rect.xMax = 500; // Змінює width
```

#### `yMin: number`
Мінімальна Y координата (нижній край).

```typescript
console.log(rect.yMin); // Те ж саме що rect.y
```

#### `yMax: number`
Максимальна Y координата (верхній край).

```typescript
console.log(rect.yMax); // rect.y + rect.height
```

#### `position: Vector2`
Позиція прямокутника (лівий нижній кут).

```typescript
rect.position = new Vector2(100, 200);
console.log(rect.x, rect.y); // 100, 200
```

#### `size: Vector2`
Розмір прямокутника.

```typescript
rect.size = new Vector2(300, 150);
console.log(rect.width, rect.height); // 300, 150
```

#### `center: Vector2`
Центр прямокутника.

```typescript
rect.center = new Vector2(500, 300);
// Автоматично обчислює нові x, y
```

#### `min: Vector2`
Мінімальна точка (лівий нижній кут).

```typescript
const minPoint = rect.min; // (xMin, yMin)
```

#### `max: Vector2`
Максимальна точка (правий верхній кут).

```typescript
const maxPoint = rect.max; // (xMax, yMax)
```

---

## Статичні константи

#### `Rect.zero`
Rect з нульовими координатами та розміром.

```typescript
const empty = Rect.zero; // (0, 0, 0, 0)
```

---

## Статичні методи

### Створення Rect

#### `Rect.minMaxRect(xMin, yMin, xMax, yMax)`
Створює Rect з мінімальних та максимальних координат.

```typescript
const rect = Rect.minMaxRect(10, 20, 110, 120);
// x=10, y=20, width=100, height=100
```

#### `Rect.fromCenterSize(center, size)`
Створює Rect з центру та розміру.

```typescript
const center = new Vector2(500, 300);
const size = new Vector2(200, 100);
const rect = Rect.fromCenterSize(center, size);
// x=400, y=250, width=200, height=100
```

#### `Rect.fromPositionSize(position, size)`
Створює Rect з позиції та розміру.

```typescript
const position = new Vector2(100, 200);
const size = new Vector2(300, 150);
const rect = Rect.fromPositionSize(position, size);
```

---

### Операції з Rect

#### `Rect.union(a, b)`
Створює Rect, що містить обидва вказані прямокутники.

```typescript
const rect1 = new Rect(0, 0, 100, 100);
const rect2 = new Rect(50, 50, 100, 100);
const combined = Rect.union(rect1, rect2);
// Містить обидва rect1 і rect2
```

#### `Rect.intersection(a, b)`
Створює Rect, що є перетином двох прямокутників.

```typescript
const rect1 = new Rect(0, 0, 100, 100);
const rect2 = new Rect(50, 50, 100, 100);
const overlap = Rect.intersection(rect1, rect2);
// (50, 50, 50, 50) - перетин

// Якщо немає перетину
const noOverlap = Rect.intersection(rect1, new Rect(200, 200, 50, 50));
// (0, 0, 0, 0) - порожній rect
```

---

### Конвертація координат

#### `Rect.pointToNormalized(rect, point)`
Знаходить нормалізовані координати точки відносно прямокутника.

```typescript
const rect = new Rect(0, 0, 100, 100);
const point = new Vector2(50, 75);
const normalized = Rect.pointToNormalized(rect, point);
// (0.5, 0.75) - точка на 50% по X, 75% по Y
```

**Використання:** UV mapping, нормалізовані координати UI.

#### `Rect.normalizedToPoint(rect, normalizedPoint)`
Знаходить точку за нормалізованими координатами.

```typescript
const rect = new Rect(0, 0, 100, 100);
const normalized = new Vector2(0.5, 0.5);
const point = Rect.normalizedToPoint(rect, normalized);
// (50, 50) - центр прямокутника
```

---

## Методи екземпляра

### Встановлення значень

#### `set(x, y, width, height)`
Встановлює координати та розмір прямокутника.

```typescript
rect.set(100, 200, 300, 150);
```

#### `copy(other)`
Копіює значення з іншого Rect.

```typescript
const rect2 = new Rect();
rect2.copy(rect1);
```

#### `clone()`
Створює копію цього Rect.

```typescript
const rectCopy = rect.clone();
```

---

### Методи перевірки

#### `contains(point, allowInverse?)`
Перевіряє, чи містить прямокутник вказану точку.

```typescript
const rect = new Rect(0, 0, 100, 100);
const point = new Vector2(50, 50);

if (rect.contains(point)) {
    console.log("Точка всередині!");
}
```

**Параметри:**
- `point: Vector2` - точка для перевірки
- `allowInverse: boolean = false` - чи враховувати від'ємні розміри

**Приклад з від'ємними розмірами:**
```typescript
const invertedRect = new Rect(100, 100, -50, -50);
// Без allowInverse - не працює правильно
// З allowInverse - враховує від'ємні розміри
const contained = invertedRect.contains(point, true);
```

#### `overlaps(other, allowInverse?)`
Перевіряє, чи перетинається цей прямокутник з іншим.

```typescript
const rect1 = new Rect(0, 0, 100, 100);
const rect2 = new Rect(50, 50, 100, 100);

if (rect1.overlaps(rect2)) {
    console.log("Прямокутники перетинаються!");
}
```

**Параметри:**
- `other: Rect` - інший прямокутник
- `allowInverse: boolean = false` - чи враховувати від'ємні розміри

---

### Утилітарні методи

#### `equals(other, epsilon?)`
Порівнює два Rect на рівність з похибкою.

```typescript
if (rect1.equals(rect2, 0.001)) {
    console.log("Прямокутники майже однакові");
}
```

**Параметри:**
- `other: Rect` - Rect для порівняння
- `epsilon: number = 1e-6` - похибка порівняння

#### `toString()`
Повертає рядкове представлення Rect.

```typescript
console.log(rect.toString());
// "Rect(x: 100.00, y: 200.00, width: 300.00, height: 150.00)"
```

---

## Приклади використання

### Viewport камери
```typescript
// Повноекранний viewport
const fullscreen = new Rect(0, 0, 1, 1); // Нормалізовані координати
camera.rect = fullscreen;

// Split-screen (ліва половина)
const leftHalf = new Rect(0, 0, 0.5, 1);
camera1.rect = leftHalf;

// Split-screen (права половина)
const rightHalf = new Rect(0.5, 0, 0.5, 1);
camera2.rect = rightHalf;
```

### UI елементи
```typescript
// Кнопка в центрі екрану
const buttonSize = new Vector2(200, 50);
const screenCenter = new Vector2(1920/2, 1080/2);
const button = Rect.fromCenterSize(screenCenter, buttonSize);

// Перевірка кліку миші
const mousePos = new Vector2(960, 540);
if (button.contains(mousePos)) {
    console.log("Клік по кнопці!");
}
```

### Перевірка перетину UI
```typescript
// Popup вікно
const popup = new Rect(400, 300, 600, 400);

// Перевірка перекриття з іншими елементами
const elements = [
    new Rect(0, 0, 200, 100),
    new Rect(500, 500, 300, 200)
];

for (const element of elements) {
    if (popup.overlaps(element)) {
        console.log("Popup перекриває елемент!");
    }
}
```

### UV Mapping
```typescript
// Прямокутна область текстури
const textureRect = new Rect(0, 0, 256, 256);

// Точка в текстурі (пікселі)
const pixelPos = new Vector2(128, 192);

// Конвертація в UV координати (0-1)
const uv = Rect.pointToNormalized(textureRect, pixelPos);
console.log(uv); // (0.5, 0.75)

// Конвертація назад
const pixel = Rect.normalizedToPoint(textureRect, uv);
console.log(pixel); // (128, 192)
```

### Обрізання області (Clipping)
```typescript
// Viewport
const viewport = new Rect(0, 0, 1920, 1080);

// Елемент, що виходить за межі
const element = new Rect(1800, 1000, 300, 200);

// Обрізаємо до viewport
const clipped = Rect.intersection(viewport, element);
console.log(clipped); // (1800, 1000, 120, 80)
```

### Динамічні координати
```typescript
// Адаптивний UI
class UIPanel {
    private rect: Rect;
    
    updateForResolution(screenWidth: number, screenHeight: number) {
        // Панель завжди в правому нижньому куті
        const panelWidth = 300;
        const panelHeight = 200;
        
        this.rect = new Rect(
            screenWidth - panelWidth - 10,
            10,
            panelWidth,
            panelHeight
        );
    }
}
```

---

## Продуктивність

### Оптимізації

1. **Використовуйте примітивні типи:**
   ```typescript
   // Rect зберігає примітивні number, не Vector2
   // Це швидше і ефективніше по пам'яті
   const rect = new Rect(0, 0, 100, 100);
   ```

2. **Кешуйте обчислювані властивості:**
   ```typescript
   // Погано - створює нові об'єкти кожен раз
   if (rect.center.equals(other.center)) { ... }
   
   // Добре - використовуємо примітивні порівняння
   const c1 = rect.center;
   const c2 = other.center;
   if (c1.x === c2.x && c1.y === c2.y) { ... }
   ```

3. **Швидка перевірка перетину:**
   ```typescript
   // Rect.overlaps() використовує всього 4 порівняння
   // Це O(1) складність
   ```

### Складність алгоритмів

| Метод | Складність | Опис |
|-------|------------|------|
| `contains()` | O(1) | 4 порівняння |
| `overlaps()` | O(1) | 4 порівняння |
| `union()` | O(1) | 4 Math.min/max |
| `intersection()` | O(1) | 4 Math.min/max + перевірка |
| `pointToNormalized()` | O(1) | 2 ділення |
| `normalizedToPoint()` | O(1) | 2 множення + додавання |

---

## Координатні системи

### Unity vs OpenGL
Rect використовує систему координат з **лівим нижнім** кутом як початком (0, 0):

```
(0, height)          (width, height)
    ┌──────────────────┐
    │                  │
    │    Rect          │
    │                  │
    └──────────────────┘
(0, 0)               (width, 0)
```

### Конвертація з екранних координат
```typescript
// Екранні координати (лівий верхній кут = (0, 0))
function screenToRect(screenX: number, screenY: number, screenHeight: number): Vector2 {
    return new Vector2(screenX, screenHeight - screenY);
}

// Назад в екранні
function rectToScreen(rectY: number, screenHeight: number): number {
    return screenHeight - rectY;
}
```

---

## Зв'язок з Unity

Цей клас повністю імітує Unity `Rect`:
- Ті ж властивості (`x`, `y`, `width`, `height`, `xMin`, `xMax`, тощо)
- Ті ж методи (`Contains`, `Overlaps`)
- Той же статичний API (`MinMaxRect`)

**Відмінності:**
- TypeScript замість C#
- Методи з малої літери (`contains` замість `Contains`)
- Параметр `allowInverse` явно вказується
- Додаткові методи: `union`, `intersection`, `pointToNormalized`, `normalizedToPoint`

**Те ж саме:**
- Позиція відповідає лівому нижньому куту (OpenGL стиль)
- Підтримка від'ємних розмірів через `allowInverse`
- Геттери/сеттери для min/max/center/size

---

## Типові помилки

### Помилка 1: Плутанина з системою координат
```typescript
// НЕПРАВИЛЬНО - думаєте що y=0 вгорі
const button = new Rect(100, 0, 200, 50); // Буде внизу екрану!

// ПРАВИЛЬНО
const button = new Rect(100, screenHeight - 50, 200, 50); // Вгорі
```

### Помилка 2: Забули про від'ємні розміри
```typescript
const rect = new Rect(100, 100, -50, -50); // Від'ємний розмір!

// НЕПРАВИЛЬНО
rect.contains(point); // Працює не так як очікується

// ПРАВИЛЬНО
rect.contains(point, true); // allowInverse = true
```

### Помилка 3: Модифікація геттерів
```typescript
// НЕПРАВИЛЬНО - center повертає новий об'єкт
rect.center.x = 100; // Не змінить rect!

// ПРАВИЛЬНО
rect.center = new Vector2(100, rect.center.y);
// АБО
const newCenter = rect.center;
newCenter.x = 100;
rect.center = newCenter;
```

---

## Див. також
- [Vector2](./Vector2.md) — 2D вектори
- [Bounds](./Bounds.md) — 3D обмежувальні коробки (аналог для 3D)
- [Camera](../components/Camera.md) — Viewport
- [UI System](../ui/README.md) — UI елементи (майбутнє)
- [Sprite](../graphics/Sprite.md) — 2D графіка (майбутнє)
