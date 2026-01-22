# Quaternion

## 📖 Опис

**Quaternion** — це клас для роботи з орієнтацією та обертаннями у 3D просторі. На відміну від углів Ейлера, кватерніони уникають gimbal lock та дозволяють плавну інтерполяцію обертань.

Кватерніон представлений як (x, y, z, w) де (x, y, z) — вектор, w — скалярна частина.

**Файл:** `src/engine/core/math/Quaternion.ts`

---

## 🔧 API

### Конструктор

```typescript
// За компонентами
const q = new Quaternion(x, y, z, w);

// За замовчуванням — identiy обертання
const identity = new Quaternion();  // (0, 0, 0, 1)
```

### Властивості

```typescript
quaternion.x  // X компонента
quaternion.y  // Y компонента
quaternion.z  // Z компонента
quaternion.w  // W компонента (скалярна)
```

### Методи — Базові операції

```typescript
// Встановити компоненти
quaternion.set(x, y, z, w);

// Копіювання
quaternion.copy(other);
quaternion.clone(): Quaternion;

// Нормалізація (важлива!)
quaternion.normalize();

// Зворотна орієнтація
quaternion.inverse(): Quaternion;

// Комплексне спряження
quaternion.conjugate(): Quaternion;
```

### Методи — Встановлення з кутів

```typescript
// Від Ейлерових кутів (у градусах)
quaternion.setFromEuler(x, y, z);  // Euler ZYX

// Від осі та кута
quaternion.setFromAxisAngle(axis: Vector3, angle: number);

// Від матриці обертання
quaternion.setFromRotationMatrix(matrix: Matrix4x4);
```

### Методи — Отримання кутів

```typescript
// До Ейлерових кутів (у градусах)
const euler = quaternion.toEulerAngles(): Vector3;  // (pitch, yaw, roll)

// Кут обертання (у градусах)
quaternion.angle: number;
```

### Методи — Множення (композиція обертань)

```typescript
// Множення двох кватерніонів
const combined = quaternion.multiply(other);  // q1 * q2

// Застосування обертання до вектора
const rotated = quaternion.rotateVector(vector);
```

### Методи — Інтерполяція

```typescript
// Сферична лінійна інтерполяція (найкраща для обертань!)
quaternion.slerp(target, t);  // 0 <= t <= 1

// Лінійна інтерполяція (быстрее, але менш гладка)
quaternion.lerp(target, t);

// Бе без затримання t
quaternion.slerpUnclamped(target, t);  // може t > 1
```

### Методи — Спеціальні операції

```typescript
// Обертання до напрямку
quaternion.lookRotation(forward: Vector3, up?: Vector3);

// Обертання від одного напрямку до іншого
Quaternion.fromToRotation(from: Vector3, to: Vector3): Quaternion;

// Плавне обертання
Quaternion.rotateTowards(from, to, maxDelta): Quaternion;
```

### Методи — Масиви

```typescript
// Побудова з масиву [x, y, z, w]
quaternion.fromArray([x, y, z, w]);

// Побудова масиву
quaternion.toArray(): number[];
```

### Статичні константи та фабрики

```typescript
// Тотожна (без обертання)
Quaternion.identity    // (0, 0, 0, 1)

// Від Ейлерових кутів
Quaternion.euler(x, y, z): Quaternion;

// Від осі та кута
Quaternion.angleAxis(angle: number, axis: Vector3): Quaternion;

// Статичні методи для інтерполяції
Quaternion.lerp(a, b, t): Quaternion;
Quaternion.slerp(a, b, t): Quaternion;
```

---

## 💡 Приклади

### Приклад 1: Базова орієнтація

```typescript
// Обертання на 90 градусів навколо Y осі (yaw)
const rotation = Quaternion.angleAxis(90, Vector3.up);

// Застосовуємо до об'єкта
gameObject.transform.rotation = rotation;
```

### Приклад 2: Від Ейлерових кутів

```typescript
// Ейлер: (pitch=30°, yaw=45°, roll=0°)
const euler = new Vector3(30, 45, 0);
const quaternion = Quaternion.euler(euler.x, euler.y, euler.z);

// Або з об'єкта
transform.rotation.setFromEuler(30, 45, 0);
```

### Приклад 3: Дивитись на об'єкт

```typescript
const camera = gameObject.transform;
const target = player.transform;

const direction = target.position.subtract(camera.position);
const lookRotation = Quaternion.lookRotation(direction);

camera.rotation = lookRotation;
```

### Приклад 4: Плавна інтерполяція обертання

```typescript
class RotatingObject extends ScriptableBehaviour {
    private startRot: Quaternion;
    private endRot: Quaternion;
    private rotationSpeed = 1;
    
    onAwake() {
        this.startRot = Quaternion.identity;
        this.endRot = Quaternion.euler(0, 360, 0);
    }
    
    onUpdate() {
        const t = (Time.time % 4) / 4;  // 0 to 1, loop
        
        // Плавне обертання (краще за lerp)
        this.gameObject.transform.rotation = 
            Quaternion.slerp(this.startRot, this.endRot, t);
    }
}
```

### Приклад 5: Комбінація обертань

```typescript
// Обертання 1: вколо X на 30°
const rotX = Quaternion.angleAxis(30, Vector3.right);

// Обертання 2: вколо Y на 45°
const rotY = Quaternion.angleAxis(45, Vector3.up);

// Комбінувати
const combined = rotY.multiply(rotX);

transform.rotation = combined;
```

### Приклад 6: Від одного напрямку до іншого

```typescript
const forward = Vector3.forward;
const newForward = new Vector3(1, 0, 1).normalize();

// Обчислити обертання
const rotation = Quaternion.fromToRotation(forward, newForward);

// Застосувати
transform.rotation = rotation;
```

---

## 📊 Порівняння з Ейлеровими кутами

| Аспект | Ейлер (x, y, z) | Кватерніон (x, y, z, w) |
|--------|---|---|
| Інтуїтивність | ✅ Легше розуміти | ❌ Складно уявити |
| Gimbal Lock | ❌ Проблема при певних кутах | ✅ Немає проблеми |
| Інтерполяція | ❌ Непередбачуво | ✅ Плавна |
| Композиція | ❌ Складна | ✅ Проста (множення) |
| Пам'ять | 12 байт (3 float) | 16 байт (4 float) |

---

## ⚠️ Поширені помилки

### ❌ Неправильно: Інтерполяція Ейлера

```typescript
// ПЛОХО! Неправильна інтерполяція
const euler1 = new Vector3(0, 0, 0);
const euler2 = new Vector3(0, 360, 0);
const lerped = Vector3.lerp(euler1, euler2, 0.5);
// Результат дивний (180, 180, 0) замість (0, 180, 0)
```

### ✅ Правильно: SLERP для обертань

```typescript
// ДОБРЕ!
const q1 = Quaternion.identity;
const q2 = Quaternion.euler(0, 360, 0);
const slerped = Quaternion.slerp(q1, q2, 0.5);
// Плавна інтерполяція
```

### ❌ Неправильно: Забуття нормалізації

```typescript
// ПЛОХО! Кватерніон може стати невалідним
quaternion.x += 0.1;
quaternion.y += 0.2;
// Тепер |q| != 1!
```

### ✅ Правильно: Нормалізувати після змін

```typescript
// ДОБРЕ!
quaternion.x += 0.1;
quaternion.y += 0.2;
quaternion.normalize();  // Забезпечити |q| = 1
```

---

## 🎯 Використання в різних сценаріях

| Сценарій | Метод |
|----------|-------|
| Обертання на кут | `Quaternion.angleAxis(angle, axis)` |
| Дивитись на точку | `Quaternion.lookRotation(direction)` |
| Плавна ротація | `Quaternion.slerp(a, b, t)` |
| Від Ейлера | `Quaternion.euler(x, y, z)` |
| До Ейлера | `quaternion.toEulerAngles()` |

---

## 📋 Related

- [Vector3.md](./Vector3.md) — осі обертання
- [Matrix4x4.md](./Matrix4x4.md) — матриці обертання
- [Transform.md (в ядрі)](../Transform.ts) — використання в Transform

---

**Дата оновлення:** 15 січня 2026
