# Vector3 - Тривимірні Вектори

## Опис

`Vector3` — це математичний клас для роботи з тривимірними векторами. Він є одним із найважливіших класів у 3D двигуні, оскільки використовується для:

- **Позицій об'єктів** у 3D просторі
- **Напрямків** (forward, up, right)
- **Швидкостей та прискорень** у фізиці
- **Нормалей поверхонь** для освітлення
- **Розмірів та масштабів** об'єктів
- **Обертань** (у поєднанні з Quaternion)

Клас реалізує **Zero-Allocation Pattern** через опціональний параметр `out`, що дозволяє уникати зайвих виділень пам'яті у критичних для продуктивності місцях (наприклад, в `Update()` циклі).

---

## Створення Vector3

### Конструктор

```typescript
new Vector3(x?: number, y?: number, z?: number)
```

**Параметри:**
- `x` - Координата X (за замовчуванням 0)
- `y` - Координата Y (за замовчуванням 0)
- `z` - Координата Z (за замовчуванням 0)

**Приклади:**

```typescript
// Нульовий вектор
const v1 = new Vector3(); // (0, 0, 0)

// Вектор з конкретними координатами
const v2 = new Vector3(1, 2, 3); // (1, 2, 3)

// Позиція об'єкта
const position = new Vector3(10, 5, -3);
```

---

## Статичні Константи

### Базові напрямки

| Константа | Значення | Опис |
|-----------|----------|------|
| `Vector3.zero` | `(0, 0, 0)` | Нульовий вектор |
| `Vector3.one` | `(1, 1, 1)` | Одиничний вектор (для масштабу) |
| `Vector3.up` | `(0, 1, 0)` | Вгору (Unity координати) |
| `Vector3.down` | `(0, -1, 0)` | Вниз |
| `Vector3.left` | `(-1, 0, 0)` | Ліворуч |
| `Vector3.right` | `(1, 0, 0)` | Праворуч |
| `Vector3.forward` | `(0, 0, 1)` | Вперед (Z+) |
| `Vector3.back` | `(0, 0, -1)` | Назад (Z-) |
| `Vector3.positiveInfinity` | `(∞, ∞, ∞)` | Позитивна нескінченність |
| `Vector3.negativeInfinity` | `(-∞, -∞, -∞)` | Негативна нескінченність |

**Приклади:**

```typescript
// Рух вгору
transform.position.add(Vector3.up.multiplyScalar(speed * Time.deltaTime));

// Початкова позиція
gameObject.transform.position = Vector3.zero;

// Напрямок вперед камери
const forward = camera.transform.forward;
```

---

## Статичні Методи

### Арифметичні операції

#### `Vector3.add(a, b, out?)`

Додає два вектори.

```typescript
static add(a: Vector3, b: Vector3, out?: Vector3): Vector3
```

**Приклад:**

```typescript
const a = new Vector3(1, 2, 3);
const b = new Vector3(4, 5, 6);

// Створює новий вектор
const result = Vector3.add(a, b); // (5, 7, 9)

// Використовує існуючий вектор (оптимізація!)
const temp = new Vector3();
Vector3.add(a, b, temp); // temp = (5, 7, 9), без нової алокації
```

#### `Vector3.subtract(a, b, out?)`

Віднімає вектори (a - b).

```typescript
const direction = Vector3.subtract(target.position, transform.position);
```

#### `Vector3.multiply(a, b, out?)`

Покомпонентне множення векторів (scale).

```typescript
const scaled = Vector3.multiply(new Vector3(1, 2, 3), new Vector3(2, 2, 2));
// Результат: (2, 4, 6)
```

#### `Vector3.multiplyScalar(v, scalar, out?)`

Множення вектора на число.

```typescript
const velocity = new Vector3(1, 0, 0);
const speed = 10;
const movement = Vector3.multiplyScalar(velocity, speed); // (10, 0, 0)
```

#### `Vector3.divideScalar(v, scalar, out?)`

Ділення вектора на число. **Увага:** якщо scalar = 0, повертає нульовий вектор.

```typescript
const normalized = Vector3.divideScalar(velocity, velocity.magnitude());
```

---

### Інтерполяція

#### `Vector3.lerp(a, b, t, out?)`

Лінійна інтерполяція між векторами. Параметр `t` обмежується до `[0, 1]`.

```typescript
static lerp(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3
```

**Приклад:**

```typescript
const start = new Vector3(0, 0, 0);
const end = new Vector3(10, 0, 0);

// Рух об'єкта
transform.position = Vector3.lerp(start, end, Time.time * 0.5);

// t = 0   → (0, 0, 0)
// t = 0.5 → (5, 0, 0)
// t = 1   → (10, 0, 0)
```

#### `Vector3.lerpUnclamped(a, b, t, out?)`

Лінійна інтерполяція **без обмеження** параметра `t`.

```typescript
// t може бути < 0 або > 1
const extrapolated = Vector3.lerpUnclamped(start, end, 1.5); // (15, 0, 0)
```

---

### Векторна алгебра

#### `Vector3.dot(a, b)` - Скалярний добуток

Повертає число, що вказує на «схожість» напрямків векторів.

```typescript
static dot(a: Vector3, b: Vector3): number
```

**Значення:**
- `> 0` — вектори дивляться в одному напрямку
- `= 0` — перпендикулярні
- `< 0` — протилежні напрямки

**Приклад:**

```typescript
const forward = new Vector3(0, 0, 1);
const toTarget = Vector3.subtract(target.position, transform.position).normalize();

const dot = Vector3.dot(forward, toTarget);

if (dot > 0.9) {
    console.log("Ціль прямо перед нами!");
}
```

#### `Vector3.cross(a, b, out?)` - Векторний добуток

Повертає вектор, перпендикулярний до обох вхідних векторів.

```typescript
static cross(a: Vector3, b: Vector3, out?: Vector3): Vector3
```

**Приклад:**

```typescript
const right = Vector3.cross(Vector3.forward, Vector3.up);
// Результат: (1, 0, 0) - вектор праворуч

// Обчислення нормалі трикутника
const edge1 = Vector3.subtract(p2, p1);
const edge2 = Vector3.subtract(p3, p1);
const normal = Vector3.cross(edge1, edge2).normalize();
```

---

### Відстані

#### `Vector3.distance(a, b)`

Евклідова відстань між точками.

```typescript
const dist = Vector3.distance(player.position, enemy.position);

if (dist < attackRange) {
    enemy.attack();
}
```

#### `Vector3.distanceSquared(a, b)`

Квадрат відстані. **Швидше за `distance()`**, оскільки не обчислює корінь.

```typescript
const sqrDist = Vector3.distanceSquared(a, b);
const sqrRange = attackRange * attackRange;

if (sqrDist < sqrRange) {
    // Ціль в зоні атаки (без Math.sqrt!)
}
```

---

### Нормалізація та Обмеження

#### `Vector3.normalized(v, out?)`

Повертає нормалізовану копію вектора (довжина = 1).

```typescript
const direction = Vector3.normalized(velocity);
```

#### `Vector3.clampMagnitude(v, maxLength, out?)`

Обмежує довжину вектора максимальним значенням.

```typescript
const clamped = Vector3.clampMagnitude(velocity, maxSpeed);
```

#### `Vector3.min(a, b, out?)`

Повертає вектор з мінімальними компонентами.

```typescript
const min = Vector3.min(new Vector3(1, 5, 3), new Vector3(4, 2, 6));
// Результат: (1, 2, 3)
```

#### `Vector3.max(a, b, out?)`

Повертає вектор з максимальними компонентами.

```typescript
const max = Vector3.max(a, b);
```

#### `Vector3.clamp(v, min, max, out?)`

Обмежує кожну компоненту вектора між відповідними компонентами min та max.

```typescript
const position = new Vector3(15, 5, -10);
const min = new Vector3(-10, 0, -10);
const max = new Vector3(10, 10, 10);

const clamped = Vector3.clamp(position, min, max);
// Результат: (10, 5, -10) - X обмежено до 10
```

---

### Проєкції та Відображення

#### `Vector3.project(a, b, out?)`

Проєктує вектор `a` на вектор `b`.

```typescript
const velocity = new Vector3(5, 3, 0);
const surface = new Vector3(1, 0, 0); // Горизонтальна поверхня

const projected = Vector3.project(velocity, surface);
// Результат: (5, 0, 0) - швидкість вздовж поверхні
```

#### `Vector3.projectOnPlane(vector, planeNormal, out?)`

Проєктує вектор на площину, задану нормаллю.

```typescript
const movement = new Vector3(1, 1, 0);
const groundNormal = Vector3.up;

const groundMovement = Vector3.projectOnPlane(movement, groundNormal);
// Результат: (1, 0, 0) - рух по землі
```

#### `Vector3.reflect(direction, normal, out?)`

Відображає вектор відносно площини з нормаллю.

```typescript
const incomingRay = new Vector3(1, -1, 0).normalize();
const surfaceNormal = Vector3.up;

const reflected = Vector3.reflect(incomingRay, surfaceNormal);
// Використовується для відбиття променів, фізики відскоків
```

---

### Кути

#### `Vector3.angle(from, to)`

Повертає кут між векторами в **градусах**.

```typescript
const angle = Vector3.angle(Vector3.forward, Vector3.up);
// Результат: 90 (градусів)
```

#### `Vector3.signedAngle(from, to, axis)`

Повертає **знаковий** кут між векторами відносно осі.

```typescript
const from = new Vector3(1, 0, 0);
const to = new Vector3(0, 0, 1);
const axis = Vector3.up;

const angle = Vector3.signedAngle(from, to, axis);
// Результат: 90 (поворот проти годинникової стрілки)
```

---

## Методи Екземпляра

### Модифікація

#### `set(x, y, z)` - Встановити компоненти

```typescript
const v = new Vector3();
v.set(1, 2, 3); // v = (1, 2, 3)
```

#### `setX(x)`, `setY(y)`, `setZ(z)` - Встановити одну компоненту

```typescript
position.setY(0); // Обнулити висоту
```

#### `copy(v)` - Копіювати значення

```typescript
const temp = new Vector3();
temp.copy(otherVector);
```

#### `clone()` - Створити копію

```typescript
const backup = position.clone();
```

---

### Арифметика (Мутуючі методи)

**Увага:** Ці методи **змінюють** поточний вектор!

```typescript
const v = new Vector3(1, 2, 3);

v.add(new Vector3(1, 1, 1));       // v = (2, 3, 4)
v.subtract(new Vector3(0, 1, 0));  // v = (2, 2, 4)
v.multiply(new Vector3(2, 2, 2));  // v = (4, 4, 8)
v.multiplyScalar(0.5);             // v = (2, 2, 4)
v.divideScalar(2);                 // v = (1, 1, 2)
```

**Ланцюгові виклики:**

```typescript
velocity
    .add(acceleration)
    .multiplyScalar(Time.deltaTime)
    .clamp(minVelocity, maxVelocity);
```

---

### Довжина та Нормалізація

#### `magnitude()` - Довжина вектора

```typescript
const speed = velocity.magnitude();
```

#### `sqrMagnitude()` - Квадрат довжини

Швидше за `magnitude()`, використовуйте для порівнянь:

```typescript
if (velocity.sqrMagnitude() > maxSpeed * maxSpeed) {
    velocity.normalize().multiplyScalar(maxSpeed);
}
```

#### `normalize()` - Нормалізувати (мутує!)

Робить довжину вектора рівною 1.

```typescript
const direction = new Vector3(3, 4, 0);
direction.normalize(); // (0.6, 0.8, 0) - одиничний вектор
```

---

### Порівняння

#### `equals(v, epsilon?)`

Перевіряє рівність з урахуванням похибки.

```typescript
const a = new Vector3(1.0000001, 2, 3);
const b = new Vector3(1, 2, 3);

console.log(a.equals(b)); // true (в межах epsilon)
```

---

### Векторна алгебра (методи екземпляра)

```typescript
const dot = v1.dot(v2);                    // Скалярний добуток
v1.cross(v2);                              // Векторний добуток (мутує v1!)
const dist = v1.distanceTo(v2);            // Відстань
const sqrDist = v1.distanceToSquared(v2);  // Квадрат відстані
```

---

### Вивід

#### `toString()`

```typescript
const v = new Vector3(1.234, 5.678, 9.012);
console.log(v.toString()); // "(1.23, 5.68, 9.01)"
```

---

## Типові Приклади Використання

### 1. Рух об'єкта

```typescript
class MoveForward extends Behaviour {
    speed: number = 5;

    update(): void {
        const movement = Vector3.multiplyScalar(
            Vector3.forward, 
            this.speed * Time.deltaTime
        );
        this.transform.position.add(movement);
    }
}
```

### 2. Слідкування за ціллю

```typescript
class FollowTarget extends Behaviour {
    target: GameObject;
    speed: number = 2;

    update(): void {
        if (!this.target) return;

        const direction = Vector3.subtract(
            this.target.transform.position,
            this.transform.position
        );

        const distance = direction.magnitude();
        
        if (distance > 0.1) {
            direction.normalize();
            const movement = Vector3.multiplyScalar(
                direction, 
                this.speed * Time.deltaTime
            );
            this.transform.position.add(movement);
        }
    }
}
```

### 3. Перевірка видимості (Field of View)

```typescript
class FOVCheck extends Behaviour {
    viewAngle: number = 45; // Кут огляду в градусах
    viewDistance: number = 10;

    canSeeTarget(target: GameObject): boolean {
        const direction = Vector3.subtract(
            target.transform.position,
            this.transform.position
        );

        const distance = direction.magnitude();
        if (distance > this.viewDistance) return false;

        direction.normalize();
        const forward = this.transform.forward;

        const angle = Vector3.angle(forward, direction);
        return angle < this.viewAngle;
    }
}
```

### 4. Відскок від стіни

```typescript
class Bouncing extends Behaviour {
    velocity: Vector3 = new Vector3(5, 0, 5);

    onCollision(normal: Vector3): void {
        // Відбити швидкість від нормалі поверхні
        this.velocity = Vector3.reflect(this.velocity, normal);
    }
}
```

### 5. Гравітація

```typescript
class Gravity extends Behaviour {
    velocity: Vector3 = Vector3.zero;
    gravity: number = -9.81;

    update(): void {
        // Додати гравітацію до швидкості
        this.velocity.add(
            Vector3.multiplyScalar(Vector3.up, this.gravity * Time.deltaTime)
        );

        // Застосувати швидкість до позиції
        this.transform.position.add(
            Vector3.multiplyScalar(this.velocity, Time.deltaTime)
        );
    }
}
```

### 6. Обчислення нормалі трикутника

```typescript
function calculateNormal(p1: Vector3, p2: Vector3, p3: Vector3): Vector3 {
    const edge1 = Vector3.subtract(p2, p1);
    const edge2 = Vector3.subtract(p3, p1);
    const normal = Vector3.cross(edge1, edge2);
    normal.normalize();
    return normal;
}
```

---

## Оптимізація Продуктивності

### ❌ ПОГАНО - Створення зайвих об'єктів

```typescript
update(): void {
    // В КОЖНОМУ КАДРІ створюються нові вектори!
    this.transform.position.add(
        Vector3.multiplyScalar(Vector3.forward, this.speed * Time.deltaTime)
    );
}
```

### ✅ ДОБРЕ - Використання out параметра

```typescript
private _tempVector: Vector3 = new Vector3();

update(): void {
    // Використовуємо один і той же вектор
    Vector3.multiplyScalar(Vector3.forward, this.speed * Time.deltaTime, this._tempVector);
    this.transform.position.add(this._tempVector);
}
```

### ✅ ДОБРЕ - Використання sqrMagnitude

```typescript
// ❌ Повільно
if (velocity.magnitude() > maxSpeed) { ... }

// ✅ Швидко (без Math.sqrt)
if (velocity.sqrMagnitude() > maxSpeed * maxSpeed) { ... }
```

---

## Порівняння з Unity

### Відмінності

| Функція | Unity (C#) | ThreeJS Engine (TS) |
|---------|------------|---------------------|
| Нормалізація | `Vector3.Normalize(v)` | `Vector3.normalized(v, out?)` |
| Статичні константи | `Vector3.zero` | `Vector3.zero` ✅ |
| Zero-Allocation | Обмежена підтримка | Повна підтримка через `out` |

### Аналоги Unity методів

```typescript
// Unity: Vector3.Normalize(v)
const normalized = Vector3.normalized(v);

// Unity: Vector3.Lerp(a, b, t)
const lerped = Vector3.lerp(a, b, t);

// Unity: Vector3.Dot(a, b)
const dot = Vector3.dot(a, b);

// Unity: Vector3.Cross(a, b)
const cross = Vector3.cross(a, b);

// Unity: Vector3.Distance(a, b)
const dist = Vector3.distance(a, b);

// Unity: Vector3.ClampMagnitude(v, maxLength)
const clamped = Vector3.clampMagnitude(v, maxLength);
```

---

## Координатна Система

ThreeJS Engine використовує **ліву систему координат** (як Unity):

- **X** — праворуч
- **Y** — вгору
- **Z** — вперед (до екрану)

```typescript
Vector3.right   // (1, 0, 0)
Vector3.up      // (0, 1, 0)
Vector3.forward // (0, 0, 1)
```

---

## Математичні Формули

### Скалярний добуток (Dot Product)

```
dot(a, b) = a.x * b.x + a.y * b.y + a.z * b.z
          = |a| * |b| * cos(θ)
```

### Векторний добуток (Cross Product)

```
cross(a, b) = (
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
)
```

Напрямок: правило правої руки  
Довжина: `|a| * |b| * sin(θ)`

### Відстань

```
distance(a, b) = √((a.x - b.x)² + (a.y - b.y)² + (a.z - b.z)²)
```

---

## Типові Помилки

### 1. ❌ Забути нормалізувати напрямок

```typescript
// ПОГАНО - швидкість залежить від відстані
const direction = Vector3.subtract(target.position, transform.position);
transform.position.add(Vector3.multiplyScalar(direction, speed * Time.deltaTime));

// ДОБРЕ
const direction = Vector3.subtract(target.position, transform.position);
direction.normalize(); // Одиничний вектор!
transform.position.add(Vector3.multiplyScalar(direction, speed * Time.deltaTime));
```

### 2. ❌ Ділення на нуль

```typescript
// Може призвести до NaN
const normalized = Vector3.divideScalar(v, v.magnitude());

// Краще перевірити
const mag = v.magnitude();
if (mag > 0) {
    const normalized = Vector3.divideScalar(v, mag);
}
```

### 3. ❌ Мутація константних векторів

```typescript
// НЕБЕЗПЕЧНО! Змінює глобальну константу
Vector3.forward.multiplyScalar(10);

// ДОБРЕ - створити копію
const forward = Vector3.forward.clone();
forward.multiplyScalar(10);
```

---

## Див. також

- [Vector2](./Vector2.md) - 2D вектори
- [Vector4](./Vector4.md) - 4D вектори  
- [Quaternion](./Quaternion.md) - обертання
- [Transform](./Transform.md) - компонент трансформації
- [Bounds](./Bounds.md) - обмежувальні об'єми

---

**Автор:** ThreeJS Engine Team  
**Дата створення:** 14 січня 2026  
**Версія:** 1.0.0
