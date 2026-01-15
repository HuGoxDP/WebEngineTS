# Vector4 - Документація

## Опис
`Vector4` — математичний клас для роботи з 4D векторами в движку. Представляє вектор з чотирма компонентами: `x`, `y`, `z`, `w`.

## Використання

### Основні застосування:
- **RGBA кольори** (red, green, blue, alpha)
- **Однорідні координати** в графіці (homogeneous coordinates)
- **Шейдерні параметри** (uniform vec4)
- **Математичні обчислення** в 4D просторі

---

## Конструктор

```typescript
new Vector4(x?: number, y?: number, z?: number, w?: number)
```

**Приклад:**
```typescript
const v1 = new Vector4(1, 2, 3, 4);
const v2 = new Vector4(); // (0, 0, 0, 0)
```

---

## Статичні константи

| Властивість | Значення | Опис |
|-------------|----------|------|
| `Vector4.zero` | `(0, 0, 0, 0)` | Нульовий вектор |
| `Vector4.one` | `(1, 1, 1, 1)` | Одиничний вектор |
| `Vector4.positiveInfinity` | `(∞, ∞, ∞, ∞)` | Позитивна нескінченність |
| `Vector4.negativeInfinity` | `(-∞, -∞, -∞, -∞)` | Негативна нескінченність |

**Приклад:**
```typescript
const zero = Vector4.zero;
const one = Vector4.one;
```

---

## Статичні методи

### Арифметичні операції

#### `Vector4.add(a, b, out?)`
Додає два вектори.

```typescript
const v1 = new Vector4(1, 2, 3, 4);
const v2 = new Vector4(5, 6, 7, 8);
const result = Vector4.add(v1, v2); // (6, 8, 10, 12)
```

#### `Vector4.subtract(a, b, out?)`
Віднімає вектори (a - b).

```typescript
const diff = Vector4.subtract(v2, v1); // (4, 4, 4, 4)
```

#### `Vector4.multiply(a, b, out?)`
Покомпонентне множення векторів.

```typescript
const v1 = new Vector4(2, 3, 4, 5);
const v2 = new Vector4(1, 2, 3, 4);
const result = Vector4.multiply(v1, v2); // (2, 6, 12, 20)
```

#### `Vector4.multiplyScalar(v, scalar, out?)`
Множення вектора на число.

```typescript
const scaled = Vector4.multiplyScalar(v1, 2); // (2, 4, 6, 8)
```

#### `Vector4.divideScalar(v, scalar, out?)`
Ділення вектора на число.

```typescript
const divided = Vector4.divideScalar(v1, 2); // (0.5, 1, 1.5, 2)
```

---

### Інтерполяція

#### `Vector4.lerp(a, b, t, out?)`
Лінійна інтерполяція між двома векторами. `t` обмежено в діапазоні [0, 1].

```typescript
const v1 = new Vector4(0, 0, 0, 0);
const v2 = new Vector4(10, 10, 10, 10);
const mid = Vector4.lerp(v1, v2, 0.5); // (5, 5, 5, 5)
```

#### `Vector4.lerpUnclamped(a, b, t, out?)`
Лінійна інтерполяція без обмеження `t`.

```typescript
const extrapolated = Vector4.lerpUnclamped(v1, v2, 1.5); // (15, 15, 15, 15)
```

---

### Геометричні методи

#### `Vector4.dot(a, b)`
Скалярний добуток векторів.

```typescript
const v1 = new Vector4(1, 2, 3, 4);
const v2 = new Vector4(5, 6, 7, 8);
const dot = Vector4.dot(v1, v2); // 1*5 + 2*6 + 3*7 + 4*8 = 70
```

#### `Vector4.distance(a, b)`
Відстань між векторами.

```typescript
const dist = Vector4.distance(v1, v2);
```

#### `Vector4.distanceSquared(a, b)`
Квадрат відстані (швидше, без кореня).

```typescript
const sqrDist = Vector4.distanceSquared(v1, v2);
```

#### `Vector4.normalize(v, out?)`
Повертає нормалізований вектор (довжина = 1).

```typescript
const normalized = Vector4.normalize(v1);
```

---

### Утилітарні методи

#### `Vector4.max(a, b, out?)`
Повертає вектор з максимальними компонентами.

```typescript
const v1 = new Vector4(1, 5, 3, 7);
const v2 = new Vector4(4, 2, 6, 1);
const max = Vector4.max(v1, v2); // (4, 5, 6, 7)
```

#### `Vector4.min(a, b, out?)`
Повертає вектор з мінімальними компонентами.

```typescript
const min = Vector4.min(v1, v2); // (1, 2, 3, 1)
```

#### `Vector4.project(vector, onNormal, out?)`
Проектує вектор на інший вектор.

```typescript
const projected = Vector4.project(v1, v2);
```

---

## Методи екземпляра

### Встановлення значень

#### `set(x, y, z, w)`
Встановлює компоненти вектора.

```typescript
const v = new Vector4();
v.set(1, 2, 3, 4); // (1, 2, 3, 4)
```

#### `setX(x)`, `setY(y)`, `setZ(z)`, `setW(w)`
Встановлює окремі компоненти.

```typescript
v.setX(10).setY(20); // (10, 20, 3, 4)
```

#### `copy(v)`
Копіює значення з іншого вектора.

```typescript
const v2 = new Vector4();
v2.copy(v1);
```

#### `clone()`
Створює копію вектора.

```typescript
const v2 = v1.clone();
```

---

### Арифметичні операції (мутуючі)

#### `add(v)`, `subtract(v)`, `multiply(v)`, `divide(v)`
Виконують операції з поточним вектором.

```typescript
v1.add(v2); // Змінює v1
```

#### `multiplyScalar(scalar)`, `divideScalar(scalar)`
Множення/ділення на число.

```typescript
v1.multiplyScalar(2); // Подвоює всі компоненти
```

---

### Геометричні методи

#### `magnitude()`
Повертає довжину вектора.

```typescript
const length = v1.magnitude();
```

#### `sqrMagnitude()`
Повертає квадрат довжини (швидше).

```typescript
const sqrLength = v1.sqrMagnitude();
```

#### `normalize()`
Нормалізує вектор (змінює поточний).

```typescript
v1.normalize(); // Довжина стає 1
```

#### `normalized()`
Повертає нормалізовану копію (не змінює оригінал).

```typescript
const normalized = v1.normalized();
```

#### `dot(v)`
Скалярний добуток.

```typescript
const dot = v1.dot(v2);
```

---

### Утилітарні методи

#### `equals(v, epsilon?)`
Перевіряє рівність векторів з похибкою.

```typescript
if (v1.equals(v2, 0.001)) {
    console.log("Вектори майже однакові");
}
```

#### `distanceTo(v)`, `distanceToSquared(v)`
Відстань до іншого вектора.

```typescript
const dist = v1.distanceTo(v2);
```

#### `lerp(v, t)`, `lerpUnclamped(v, t)`
Інтерполяція (змінює поточний вектор).

```typescript
v1.lerp(v2, 0.5); // v1 тепер посередині між v1 та v2
```

#### `clamp(min, max)`
Обмежує компоненти між мінімальними та максимальними значеннями.

```typescript
const min = new Vector4(0, 0, 0, 0);
const max = new Vector4(10, 10, 10, 10);
v1.clamp(min, max);
```

#### `clampMagnitude(maxLength)`
Обмежує довжину вектора.

```typescript
v1.clampMagnitude(5); // Довжина не більше 5
```

#### `negate()`
Інвертує вектор (множить на -1).

```typescript
v1.negate(); // (-x, -y, -z, -w)
```

---

### Конвертація

#### `toString()`
Повертає рядкове представлення.

```typescript
console.log(v1.toString()); // "(1.00, 2.00, 3.00, 4.00)"
```

#### `toArray()`
Повертає масив `[x, y, z, w]`.

```typescript
const arr = v1.toArray(); // [1, 2, 3, 4]
```

#### `fromArray(array, offset?)`
Встановлює значення з масиву.

```typescript
v1.fromArray([10, 20, 30, 40]); // (10, 20, 30, 40)
```

---

## Zero-Allocation Pattern

Багато статичних методів підтримують параметр `out` для уникнення створення нових об'єктів:

```typescript
const result = new Vector4();

// Замість створення нового об'єкта
const v3 = Vector4.add(v1, v2);

// Використовуємо існуючий
Vector4.add(v1, v2, result); // Результат записується в result
```

Це покращує продуктивність у критичних місцях (game loop, physics, rendering).

---

## Приклади використання

### Колір RGBA
```typescript
const red = new Vector4(1, 0, 0, 1); // Червоний, повністю непрозорий
const blue = new Vector4(0, 0, 1, 0.5); // Синій, напівпрозорий

const purple = Vector4.lerp(red, blue, 0.5); // Фіолетовий
```

### Шейдерні параметри
```typescript
// Передача параметрів у шейдер
const materialProperties = new Vector4(
    0.5,  // metallic
    0.8,  // roughness
    1.0,  // ao
    1.0   // intensity
);
```

### Однорідні координати
```typescript
const point3D = new Vector4(x, y, z, 1); // Точка
const direction = new Vector4(x, y, z, 0); // Напрямок
```

---

## Продуктивність

1. **Використовуйте `sqrMagnitude()` замість `magnitude()`** для порівнянь:
   ```typescript
   // Погано
   if (v1.magnitude() < v2.magnitude()) { ... }
   
   // Добре
   if (v1.sqrMagnitude() < v2.sqrMagnitude()) { ... }
   ```

2. **Використовуйте параметр `out`** у циклах:
   ```typescript
   const temp = new Vector4();
   for (let i = 0; i < 1000; i++) {
       Vector4.add(v1, v2, temp); // Без нових об'єктів
   }
   ```

3. **Мутуючі методи швидші** за статичні:
   ```typescript
   // Повільніше
   v1 = Vector4.add(v1, v2);
   
   // Швидше
   v1.add(v2);
   ```

---

## Зв'язок з Unity

Цей клас повністю імітує Unity `Vector4`:
- Ті ж властивості (`x`, `y`, `z`, `w`)
- Ті ж статичні константи (`zero`, `one`, тощо)
- Ті ж методи (`dot`, `lerp`, `normalize`, тощо)
- Той же API для інтерполяції та обчислень

**Відмінності:**
- TypeScript замість C#
- Параметр `out` замість `ref` для оптимізації

---

## Див. також
- [Vector2](./Vector2.md) — 2D вектори
- [Vector3](./Vector3.md) — 3D вектори
- [Color](../graphics/Color.md) — Кольори (альтернатива для RGBA)
- [Quaternion](./Quaternion.md) — Обертання
