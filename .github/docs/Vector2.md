# Vector2

## 📖 Опис

**Vector2** — це клас для роботи з 2D векторами (x, y). Використовується для UV координат, позицій у UI, текстурних offset/tiling та інших 2D операцій.

Реалізує Zero-Allocation Pattern для уникнення зайвих алокацій пам'яті.

**Файл:** `src/engine/core/math/Vector2.ts`

---

## 🔧 API

### Конструктор

```typescript
// З компонентами
const v = new Vector2(1, 2);  // x=1, y=2

// Копія
const v2 = v.clone();
```

### Властивості

```typescript
vector.x  // Компонента X
vector.y  // Компонента Y
```

### Методи — Базові операції

```typescript
// Встановити компоненти
vector.set(x, y);

// Копіювання
vector.copy(other);           // Копіює з іншого вектора
vector.clone(): Vector2;      // Клон цього вектора

// Арифметика
vector.add(other);            // v += other
vector.subtract(other);       // v -= other
vector.multiply(scalar);      // v *= scalar
vector.divide(scalar);        // v /= scalar
vector.scale(scalar);         // v *= scalar (alias)
vector.negate();              // v = -v
```

### Методи — Нормалізація

```typescript
vector.normalize();           // Зробити одиничним
vector.magnitude: number;     // Довжина вектора
vector.sqrMagnitude: number;  // Довжина²ивал (швидше)
```

### Методи — Скалярний добуток

```typescript
Vector2.dot(a, b): number;   // Скалярний добуток (a · b)
```

### Методи — Інтерполяція

```typescript
// Лінійна інтерполяція (зупиняється на t=1)
vector.lerp(target, t);       // v = v + (target - v) * t

// Лінійна інтерполяція без затримання (може вийти за межи)
Vector2.lerpUnclamped(a, b, t): Vector2;
```

### Методи — Відстані

```typescript
// Відстань між векторами
Vector2.distance(a, b): number;

// Кут між векторами (у градусах)
Vector2.angle(from, to): number;
```

### Методи — Min/Max/Clamp

```typescript
// Компонентно найменше
Vector2.min(a, b): Vector2;

// Компонентно найбільше
Vector2.max(a, b): Vector2;

// Затиск у діапазон [min, max]
vector.clamp(min, max);
```

### Методи — Перпендикуляр

```typescript
// Перпендикулярний вектор (повернут на 90°)
vector.perpendicular(): Vector2;
```

### Методи — Масиви

```typescript
// Побудова з масиву
vector.fromArray([x, y]);

// Побудова масиву
vector.toArray(): number[];   // [x, y]
```

### Статичні константи

```typescript
Vector2.zero      // (0, 0)
Vector2.one       // (1, 1)
Vector2.up        // (0, 1)
Vector2.down      // (0, -1)
Vector2.left      // (-1, 0)
Vector2.right     // (1, 0)
```

---

## 💡 Приклади

### Приклад 1: UV координати

```typescript
// Текстура 1x1, вибираємо точку на текстурі
const uv = new Vector2(0.5, 0.5);  // Центр

// Встановлюємо tiling/offset
uv.multiply(2);  // 2x2 повтори
console.log(uv); // (1, 1)
```

### Приклад 2: Напрямок руху

```typescript
// Грайл рухається вправо-вгору
const direction = new Vector2(1, 1);
direction.normalize();  // (0.707, 0.707)

// Рух
const speed = 5;
direction.scale(speed * Time.deltaTime);
```

### Приклад 3: Відстань до гравця

```typescript
const playerPos = new Vector2(10, 10);
const enemyPos = new Vector2(15, 12);

const distance = Vector2.distance(playerPos, enemyPos);
if (distance < 5) {
    console.log("Враг близько!");
}
```

### Приклад 4: Лінійна інтерполяція

```typescript
const startPos = new Vector2(0, 0);
const endPos = new Vector2(10, 10);
const progress = 0.5;

const currentPos = Vector2.lerp(startPos, endPos, progress);
console.log(currentPos); // (5, 5)
```

### Приклад 5: Перпендикулярний вектор

```typescript
const forward = new Vector2(1, 0);
const right = forward.perpendicular();
console.log(right); // (0, 1) — вверх
```

---

## 📊 Таблиця операцій

| Операція | Результат | Приклад |
|----------|-----------|---------|
| add | v1 + v2 | (1,2) + (3,4) = (4,6) |
| subtract | v1 - v2 | (5,5) - (2,3) = (3,2) |
| multiply | v * scalar | (2,3) * 2 = (4,6) |
| divide | v / scalar | (4,6) / 2 = (2,3) |
| normalize | v / \|v\| | (3,4) → (0.6,0.8) |
| dot | v1·v2 | (1,0)·(0,1) = 0 |
| distance | \|v1-v2\| | \|(3,0)-(0,0)\| = 3 |

---

## ⚡ Performance Tips

| Операція | Вартість | Рекомендація |
|----------|----------|-------------|
| dot product | O(1) | Дешево, використовувати |
| normalize | Contains sqrt | Оптимізувати |
| distance | Contains sqrt | Мінімізувати |
| sqrMagnitude | O(1) | Краще за distance |

---

## 📋 Related

- [Vector3.md](./Vector3.md) — 3D вектори
- [Vector4.md](./Vector4.md) — 4D вектори (колір, шейдер)
- [Rect.md](./Rect.md) — 2D прямокутник (x, y, width, height)

---

**Дата оновлення:** 15 січня 2026
