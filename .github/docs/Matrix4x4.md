# Matrix4x4

## 📖 Опис

**Matrix4x4** — це клас для роботи з 4x4 матрицями трансформацій. Використовується для комбінування позицій, обертань та масштабів.

Матриця розташована як 16 компонент (m00 до m33):
```
| m00 m01 m02 m03 |
| m10 m11 m12 m13 |
| m20 m21 m22 m23 |
| m30 m31 m32 m33 |
```

**Файл:** `src/engine/core/math/Matrix4x4.ts`

---

## 🔧 API

### Конструктор

```typescript
// За елементами (16 чисел)
const m = new Matrix4x4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
);

// За замовчуванням — тотожна матриця
const identity = new Matrix4x4();
```

### Властивості

```typescript
matrix.m00, matrix.m01, ..., matrix.m33  // Елементи матриці
```

### Методи — Базові операції

```typescript
// Встановити елементи
matrix.set(m00, m01, ..., m33);

// Копіювання
matrix.copy(other);
matrix.clone(): Matrix4x4;

// Множення матриць
matrix.multiply(other): Matrix4x4;

// Транспонування (рядки ↔ стовпці)
matrix.transpose(): Matrix4x4;

// Обернення (A * A⁻¹ = I)
matrix.inverse(): Matrix4x4;

// Визначник (для перевірки обернення)
matrix.determinant(): number;
```

### Методи — TRS (Translation, Rotation, Scale)

```typescript
// Встановити з позиції, обертання та масштабу
matrix.setTRS(
    position: Vector3,
    rotation: Quaternion,
    scale: Vector3
);

// Створити нову матрицю з TRS
Matrix4x4.CreateTRS(
    position: Vector3,
    rotation: Quaternion,
    scale: Vector3
): Matrix4x4;
```

### Методи — Екстракція компонентів

```typescript
// Отримати позицію
matrix.extractPosition(): Vector3;

// Отримати обертання
matrix.extractRotation(): Quaternion;

// Отримати масштаб
matrix.extractScale(): Vector3;
```

### Методи — Специфічні трансформації

```typescript
// Матриця трансляції (переміщення)
Matrix4x4.CreateTranslation(x, y, z): Matrix4x4;

// Матриця масштабування
Matrix4x4.CreateScale(x, y, z): Matrix4x4;

// Матриця обертання з Quaternion
Matrix4x4.CreateRotation(quaternion: Quaternion): Matrix4x4;

// Матриця обертання з Ейлера
Matrix4x4.CreateRotationEuler(x, y, z): Matrix4x4;

// Матриця обертання з осі та кута
Matrix4x4.CreateRotationAxisAngle(axis: Vector3, angle: number): Matrix4x4;
```

### Методи — Проекцій (для камер)

```typescript
// Перспективна проекція
Matrix4x4.CreatePerspective(
    fieldOfView: number,  // Градуси
    aspect: number,       // width/height
    nearPlane: number,
    farPlane: number
): Matrix4x4;

// Ортогональна проекція
Matrix4x4.CreateOrthographic(
    width: number,
    height: number,
    nearPlane: number,
    farPlane: number
): Matrix4x4;

// LookAt матриця (дивитись на точку)
Matrix4x4.CreateLookAt(
    position: Vector3,
    target: Vector3,
    up: Vector3
): Matrix4x4;
```

### Методи — Масиви та конвертація

```typescript
// Побудова з масиву [16 елементів]
matrix.fromArray(array: number[]);

// Побудова масиву
matrix.toArray(): number[];
```

### Статичні константи

```typescript
Matrix4x4.identity  // Тотожна (не робить нічого)
Matrix4x4.zero      // Нульова (все стає 0)
```

---

## 💡 Приклади

### Приклад 1: TRS матриця для об'єкта

```typescript
const position = new Vector3(5, 2, 3);
const rotation = Quaternion.euler(45, 90, 0);
const scale = new Vector3(1, 1, 1);

const worldMatrix = Matrix4x4.CreateTRS(position, rotation, scale);
// Матриця, яка трансформує локальні координати в світові
```

### Приклад 2: Перспективна проекція камери

```typescript
const projMatrix = Matrix4x4.CreatePerspective(
    60,           // 60° FOV
    16 / 9,       // 16:9 aspect
    0.1,          // Near plane
    1000          // Far plane
);

// Цю матрицю використовує камера для рендерингу
```

### Приклад 3: Комбінація трансформацій

```typescript
// Матриця 1: переміщення
const translateMatrix = Matrix4x4.CreateTranslation(5, 0, 0);

// Матриця 2: обертання
const rotateMatrix = Matrix4x4.CreateRotationAxisAngle(
    Vector3.up,
    90
);

// Комбіновані: спочатку обертання, потім переміщення
const combined = translateMatrix.multiply(rotateMatrix);
```

### Приклад 4: Екстракція компонентів

```typescript
const matrix = Matrix4x4.CreateTRS(
    new Vector3(10, 0, 0),
    Quaternion.euler(0, 45, 0),
    new Vector3(2, 2, 2)
);

// Отримаємо назад:
const pos = matrix.extractPosition();      // (10, 0, 0)
const rot = matrix.extractRotation();      // 45° вколо Y
const scale = matrix.extractScale();       // (2, 2, 2)
```

### Приклад 5: Камера lookAt

```typescript
const cameraPos = new Vector3(0, 5, 10);
const targetPos = new Vector3(0, 0, 0);    // Дивимось на центр сцени
const upVector = Vector3.up;

const viewMatrix = Matrix4x4.CreateLookAt(
    cameraPos,
    targetPos,
    upVector
);

// Ця матриця змінює світові координати в координати камери
```

### Приклад 6: Множення матриць для трансформацій

```typescript
// 2 об'єкти в ієрархії
const parentMatrix = Matrix4x4.CreateTRS(
    new Vector3(5, 0, 0),
    Quaternion.identity,
    Vector3.one
);

const localChildMatrix = Matrix4x4.CreateTRS(
    new Vector3(2, 0, 0),
    Quaternion.identity,
    Vector3.one
);

// Світова матриця дитини = батько × дитина
const worldChildMatrix = parentMatrix.multiply(localChildMatrix);
```

---

## 📊 Типи матриць

| Матриця | Опис | Метод |
|---------|------|-------|
| Identity | Без змін | `Matrix4x4.identity` |
| Translation | Переміщення | `CreateTranslation` |
| Scale | Масштабування | `CreateScale` |
| Rotation | Обертання | `CreateRotation` |
| TRS | Позиція+Обертання+Масштаб | `CreateTRS` |
| Perspective | Камера (перспектива) | `CreatePerspective` |
| Orthographic | Камера (орто) | `CreateOrthographic` |
| LookAt | Дивитись на точку | `CreateLookAt` |

---

## 🎯 Порядок операцій

```
Локальні координати вершини
    ↓ × Model Matrix (TRS)
Світові координати
    ↓ × View Matrix (LookAt)
Координати камери
    ↓ × Projection Matrix (Perspective)
Координати екрану (Normalized Device Coordinates)
    ↓ × Viewport Transformation
Піксельні координати на екрані
```

---

## ⚡ Performance Tips

| Операція | Вартість | Рекомендація |
|----------|----------|-------------|
| multiply | O(64) | Кешувати результати |
| inverse | Contains determinant | Дорого, мінімізувати |
| extractPosition | O(1) | Дешево |
| extractScale | Contains sqrt | Відносно дорого |
| CreatePerspective | O(1) | Кешувати |

---

## ⚠️ Поширені помилки

### ❌ Неправильно: Неправильний порядок множення

```typescript
// ПЛОХО! Результат дивний
const wrong = child.multiply(parent);
```

### ✅ Правильно: Батько × дитина

```typescript
// ДОБРЕ! Дитина трансформується в просторі батька
const correct = parent.multiply(child);
```

### ❌ Неправильно: Забуття нормалізації масштабу при обертанні

```typescript
// ПЛОХО! Матриця може стати невалідною
matrix.extractScale();  // Перевіряємо...
matrix.setTRS(...);     // Встановлюємо без нормалізації
```

---

## 📋 Related

- [Vector3.md](./Vector3.md) — позиції та напрямки
- [Quaternion.md](./Quaternion.md) — обертання
- [Transform.ts (в ядрі)](../Transform.ts) — використання в Transform

---

**Дата оновлення:** 15 січня 2026
