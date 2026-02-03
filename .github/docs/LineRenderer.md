# 📏 LineRenderer

**Файл:** `src/engine/core/components/LineRenderer.ts`  
**Наслідує:** `Renderer`  
**Unity Equivalent:** `UnityEngine.LineRenderer`

---

## 📋 Опис

`LineRenderer` - компонент для малювання ліній у 3D просторі. Дозволяє створювати лінії з градієнтом кольору, зміною ширини та різними налаштуваннями вирівнювання.

---

## 🎯 Використання

### Базовий приклад

```typescript
import { GameObject, LineRenderer, Vector3, Color } from "@engine";

// Створюємо об'єкт з LineRenderer
const lineObj = new GameObject("MyLine");
const line = lineObj.addComponent(LineRenderer);

// Встановлюємо кількість точок
line.positionCount = 4;

// Встановлюємо позиції
line.setPosition(0, new Vector3(0, 0, 0));
line.setPosition(1, new Vector3(5, 2, 0));
line.setPosition(2, new Vector3(10, 0, 0));
line.setPosition(3, new Vector3(15, 3, 0));

// Налаштовуємо ширину
line.startWidth = 0.5;
line.endWidth = 0.1;

// Налаштовуємо колір
line.startColor = Color.red;
line.endColor = Color.blue;
```

### Швидке створення лінії

```typescript
// Лінія з двох точок
line.setLine(new Vector3(0, 0, 0), new Vector3(10, 5, 0));
```

### Масив точок

```typescript
const points = [
    new Vector3(0, 0, 0),
    new Vector3(2, 1, 0),
    new Vector3(4, 0, 0),
    new Vector3(6, 2, 0),
    new Vector3(8, 0, 0)
];

line.setPositions(points);
```

### Замкнута лінія (loop)

```typescript
line.loop = true; // Остання точка з'єднається з першою
```

### Градієнт кольорів

```typescript
import { GradientColorKey } from "@engine";

const gradient: GradientColorKey[] = [
    { color: Color.red, time: 0 },
    { color: Color.yellow, time: 0.5 },
    { color: Color.green, time: 1 }
];

line.setColorGradient(gradient);
```

---

## 📦 Властивості

### Позиції

| Властивість | Тип | За замовчуванням | Опис |
|-------------|-----|------------------|------|
| `positionCount` | `number` | `0` | Кількість точок у лінії |

### Ширина

| Властивість | Тип | За замовчуванням | Опис |
|-------------|-----|------------------|------|
| `startWidth` | `number` | `1.0` | Ширина на початку лінії |
| `endWidth` | `number` | `1.0` | Ширина в кінці лінії |
| `widthMultiplier` | `number` | `1.0` | Множник ширини |

### Колір

| Властивість | Тип | За замовчуванням | Опис |
|-------------|-----|------------------|------|
| `startColor` | `Color` | `Color.white` | Колір на початку |
| `endColor` | `Color` | `Color.white` | Колір в кінці |

### Налаштування

| Властивість | Тип | За замовчуванням | Опис |
|-------------|-----|------------------|------|
| `useWorldSpace` | `boolean` | `true` | Використовувати світові координати |
| `loop` | `boolean` | `false` | Замикати лінію |
| `alignment` | `LineAlignment` | `View` | Режим вирівнювання |
| `textureMode` | `LineTextureMode` | `Stretch` | Режим текстурування |
| `numCornerVertices` | `number` | `0` | Вершини для згладжування кутів |
| `numCapVertices` | `number` | `0` | Вершини для закінчень |

---

## 🔧 Методи

### Позиції

| Метод | Опис |
|-------|------|
| `getPosition(index: number): Vector3` | Отримати позицію за індексом |
| `setPosition(index: number, position: Vector3): void` | Встановити позицію за індексом |
| `getPositions(): Vector3[]` | Отримати всі позиції |
| `setPositions(positions: Vector3[]): void` | Встановити всі позиції |
| `setLine(start: Vector3, end: Vector3): void` | Швидко створити лінію з 2 точок |
| `clear(): void` | Очистити всі точки |

### Градієнти

| Метод | Опис |
|-------|------|
| `setColorGradient(keys: GradientColorKey[]): void` | Встановити градієнт кольорів |
| `setWidthCurve(keys: CurveKey[]): void` | Встановити криву ширини |

---

## 📊 Enums

### LineAlignment

```typescript
enum LineAlignment {
    View = 0,        // Лінія повернута до камери (billboard)
    TransformZ = 1   // Лінія в локальному просторі Transform
}
```

### LineTextureMode

```typescript
enum LineTextureMode {
    Stretch = 0,              // Текстура розтягується
    Tile = 1,                 // Текстура повторюється
    DistributePerSegment = 2, // По сегментах
    RepeatPerSegment = 3      // Повторюється по сегментах
}
```

---

## 🎨 Типи

### GradientColorKey

```typescript
interface GradientColorKey {
    color: Color;  // Колір
    time: number;  // Позиція (0-1)
}
```

### CurveKey

```typescript
interface CurveKey {
    value: number; // Значення
    time: number;  // Позиція (0-1)
}
```

---

## 💡 Приклади

### Малювання орбіти

```typescript
function createOrbit(radius: number, segments: number = 64): void {
    const orbit = new GameObject("Orbit");
    const line = orbit.addComponent(LineRenderer);
    
    line.positionCount = segments;
    line.loop = true;
    line.startWidth = 0.05;
    line.endWidth = 0.05;
    line.startColor = new Color(0.5, 0.5, 0.5, 0.5);
    line.endColor = new Color(0.5, 0.5, 0.5, 0.5);
    
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        line.setPosition(i, new Vector3(x, 0, z));
    }
}
```

### Траєкторія руху

```typescript
class TrailScript extends ScriptableBehaviour {
    private _line: LineRenderer | null = null;
    private _history: Vector3[] = [];
    public maxPoints: number = 50;
    
    public override start(): void {
        this._line = this.getComponent(LineRenderer);
    }
    
    public override update(): void {
        // Додаємо поточну позицію
        this._history.push(this.transform.position.clone());
        
        // Обмежуємо кількість точок
        if (this._history.length > this.maxPoints) {
            this._history.shift();
        }
        
        // Оновлюємо лінію
        if (this._line) {
            this._line.setPositions(this._history);
        }
    }
}
```

---

## ⚠️ Обмеження

1. **Ширина лінії** - в WebGL ширина лінії обмежена можливостями браузера (часто 1px)
2. **Текстурування** - поки що не підтримується повністю

---

## 🔗 Пов'язані класи

- [Renderer](./Renderer.md) - Базовий клас
- [Color](./Color.md) - Клас кольору
- [Vector3](./Vector3.md) - Клас вектора
