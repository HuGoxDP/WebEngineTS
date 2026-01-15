# Bounds - Документація

## Опис
`Bounds` — математичний клас для роботи з осесіметричними обмежувальними коробками (Axis-Aligned Bounding Box - AABB). Представляє прямокутну область у 3D просторі, грані якої завжди паралельні осям координат.

## Використання

### Основні застосування:
- **Межі мешів** (Mesh bounds)
- **Frustum culling** (оптимізація рендерингу)
- **Перевірка колізій** (collision detection)
- **Просторова оптимізація** (spatial partitioning)

---

## Конструктор

```typescript
new Bounds(center?: Vector3, size?: Vector3)
```

**Приклад:**
```typescript
const bounds = new Bounds(
    new Vector3(0, 0, 0),  // центр
    new Vector3(2, 2, 2)   // розмір
);

const emptyBounds = new Bounds(); // центр (0,0,0), розмір (0,0,0)
```

---

## Властивості

### Основні властивості

#### `center: Vector3`
Центр обмежувальної коробки.

```typescript
bounds.center = new Vector3(5, 10, 15);
console.log(bounds.center); // (5.00, 10.00, 15.00)
```

#### `size: Vector3`
Повний розмір коробки (ширина, висота, глибина).

```typescript
bounds.size = new Vector3(4, 6, 8);
```

#### `extents: Vector3` (getter/setter)
Половина розміру (від центру до краю).

```typescript
bounds.extents = new Vector3(1, 2, 3);
console.log(bounds.size); // (2, 4, 6)
```

#### `min: Vector3` (getter/setter)
Мінімальна точка коробки (лівий нижній дальній кут).

```typescript
const minPoint = bounds.min; // Обчислюється як center - extents
```

#### `max: Vector3` (getter/setter)
Максимальна точка коробки (правий верхній ближній кут).

```typescript
const maxPoint = bounds.max; // Обчислюється як center + extents
```

---

## Статичні методи

### Створення Bounds

#### `Bounds.fromMinMax(min, max)`
Створює Bounds з мінімальної та максимальної точок.

```typescript
const min = new Vector3(-1, -1, -1);
const max = new Vector3(1, 1, 1);
const bounds = Bounds.fromMinMax(min, max);
// center: (0, 0, 0), size: (2, 2, 2)
```

#### `Bounds.fromPoints(points)`
Створює Bounds, що охоплює масив точок.

```typescript
const points = [
    new Vector3(0, 0, 0),
    new Vector3(1, 2, 3),
    new Vector3(-1, -2, -3)
];
const bounds = Bounds.fromPoints(points);
// Автоматично обчислює min/max
```

---

### Операції з Bounds

#### `Bounds.merge(a, b)`
Об'єднує два Bounds в один (включає обидва).

```typescript
const bounds1 = new Bounds(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
const bounds2 = new Bounds(new Vector3(5, 5, 5), new Vector3(2, 2, 2));
const merged = Bounds.merge(bounds1, bounds2);
// Містить обидві коробки
```

#### `Bounds.intersect(a, b)`
Перевіряє перетин двох Bounds (статичний метод).

```typescript
if (Bounds.intersect(bounds1, bounds2)) {
    console.log("Bounds перетинаються!");
}
```

---

## Методи екземпляра

### Встановлення значень

#### `set(center, size)`
Встановлює центр та розмір.

```typescript
bounds.set(
    new Vector3(0, 0, 0),
    new Vector3(10, 10, 10)
);
```

#### `setMinMax(min, max)`
Встановлює bounds через мінімальну та максимальну точки.

```typescript
bounds.setMinMax(
    new Vector3(-5, -5, -5),
    new Vector3(5, 5, 5)
);
```

#### `copy(other)`
Копіює значення з іншого Bounds.

```typescript
const bounds2 = new Bounds();
bounds2.copy(bounds1);
```

#### `clone()`
Створює копію цього Bounds.

```typescript
const boundsCopy = bounds.clone();
```

---

### Методи перевірки

#### `contains(point)`
Перевіряє, чи містить Bounds вказану точку.

```typescript
const point = new Vector3(1, 1, 1);
if (bounds.contains(point)) {
    console.log("Точка всередині!");
}
```

**Повертає:** `true` якщо точка всередині або на межі коробки.

#### `intersects(other)`
Перевіряє, чи перетинається з іншим Bounds.

```typescript
const bounds1 = new Bounds(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
const bounds2 = new Bounds(new Vector3(1, 1, 1), new Vector3(2, 2, 2));

if (bounds1.intersects(bounds2)) {
    console.log("Є перетин!");
}
```

---

### Методи модифікації

#### `encapsulate(point | bounds)`
Розширює Bounds, щоб включити вказану точку або інший Bounds.

```typescript
// Включення точки
bounds.encapsulate(new Vector3(10, 10, 10));

// Включення іншого Bounds
const otherBounds = new Bounds(new Vector3(5, 5, 5), new Vector3(2, 2, 2));
bounds.encapsulate(otherBounds);
```

**Примітка:** Метод змінює поточний Bounds.

#### `expand(amount)`
Розширює Bounds на вказану величину по всіх осях.

```typescript
// Розширення на число
bounds.expand(1); // size збільшується на 2 по кожній осі

// Розширення по векторі
bounds.expand(new Vector3(1, 2, 3));
```

**Примітка:** Величина додається з **обох** сторін, тому size збільшується вдвічі.

---

### Методи обчислення

#### `closestPoint(point, out?)`
Повертає найближчу точку на поверхні або всередині Bounds.

```typescript
const point = new Vector3(10, 10, 10);
const closest = bounds.closestPoint(point);
// Якщо point поза bounds, повертає точку на поверхні
// Якщо point всередині, повертає сам point
```

**Zero-allocation:**
```typescript
const result = new Vector3();
bounds.closestPoint(point, result); // Результат у result
```

#### `sqrDistance(point)`
Повертає квадрат відстані від точки до найближчої точки Bounds.

```typescript
const distance = bounds.sqrDistance(point);
// Якщо point всередині, повертає 0
```

**Примітка:** Використовуйте для порівняння відстаней (швидше ніж `sqrt`).

#### `intersectRay(origin, direction)`
Перевіряє перетин з променем.

```typescript
const rayOrigin = new Vector3(0, 0, -10);
const rayDirection = new Vector3(0, 0, 1); // має бути нормалізованим

const distance = bounds.intersectRay(rayOrigin, rayDirection);
if (distance >= 0) {
    console.log(`Перетин на відстані ${distance}`);
} else {
    console.log("Немає перетину");
}
```

**Повертає:** Відстань до точки перетину, або `-1` якщо немає перетину.

---

### Утилітарні методи

#### `equals(other, epsilon?)`
Порівнює два Bounds на рівність з похибкою.

```typescript
if (bounds1.equals(bounds2, 0.001)) {
    console.log("Bounds майже однакові");
}
```

**Параметри:**
- `other: Bounds` - Bounds для порівняння
- `epsilon: number = EngineSettings.Math.EPSILON` - похибка порівняння

#### `isEmpty()`
Перевіряє чи Bounds порожній (розмір нуль).

```typescript
if (bounds.isEmpty()) {
    console.log("Bounds порожній");
}
```

#### `reset()`
Скидає Bounds до початкових значень.

```typescript
bounds.reset(); // center: (0,0,0), size: (0,0,0)
```

#### `toString()`
Повертає рядкове представлення Bounds.

```typescript
console.log(bounds.toString());
// "Bounds(Center: (0.00, 0.00, 0.00), Size: (2.00, 2.00, 2.00))"
```

---

## Приклади використання

### Межі меша
```typescript
// Обчислення bounds для меша
const vertices = [
    new Vector3(0, 0, 0),
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1)
];

const meshBounds = Bounds.fromPoints(vertices);
mesh.bounds = meshBounds;
```

### Frustum Culling
```typescript
// Перевірка чи об'єкт у полі зору камери
function isVisible(objectBounds: Bounds, cameraFrustum: Bounds): boolean {
    return cameraFrustum.intersects(objectBounds);
}

// Оптимізація рендерингу
if (isVisible(mesh.bounds, camera.frustumBounds)) {
    renderer.render(mesh);
}
```

### Перевірка колізій
```typescript
// Проста перевірка AABB колізій
function checkCollision(entity1: GameObject, entity2: GameObject): boolean {
    const bounds1 = entity1.getComponent(MeshRenderer).bounds;
    const bounds2 = entity2.getComponent(MeshRenderer).bounds;
    
    return bounds1.intersects(bounds2);
}
```

### Динамічне розширення
```typescript
// Додавання об'єктів до сцени з автоматичним обчисленням bounds
const sceneBounds = new Bounds();

for (const gameObject of sceneObjects) {
    const renderer = gameObject.getComponent(MeshRenderer);
    if (renderer) {
        sceneBounds.encapsulate(renderer.bounds);
    }
}

console.log("Межі сцени:", sceneBounds.toString());
```

### Ray Casting
```typescript
// Перевірка перетину променя з об'єктом
const rayOrigin = camera.transform.position;
const rayDirection = camera.transform.forward;

const distance = objectBounds.intersectRay(rayOrigin, rayDirection);

if (distance >= 0) {
    const hitPoint = rayOrigin.clone().add(
        rayDirection.clone().multiplyScalar(distance)
    );
    console.log("Влучили в:", hitPoint.toString());
}
```

---

## Продуктивність

### Оптимізації

1. **Використовуйте `sqrDistance()` для порівнянь:**
   ```typescript
   // Погано - викликає sqrt()
   if (bounds.closestPoint(point).distanceTo(point) < maxDistance) { ... }
   
   // Добре - без sqrt()
   if (bounds.sqrDistance(point) < maxDistance * maxDistance) { ... }
   ```

2. **Уникайте створення нових об'єктів:**
   ```typescript
   const temp = new Vector3();
   
   // В циклі
   for (const point of points) {
       bounds.closestPoint(point, temp); // Використовує temp
   }
   ```

3. **Кешуйте bounds де можливо:**
   ```typescript
   class Mesh {
       private _bounds: Bounds;
       private _boundsDirty = true;
       
       get bounds(): Bounds {
           if (this._boundsDirty) {
               this._bounds = Bounds.fromPoints(this.vertices);
               this._boundsDirty = false;
           }
           return this._bounds;
       }
   }
   ```

### Складність алгоритмів

| Метод | Складність | Опис |
|-------|------------|------|
| `contains()` | O(1) | 6 порівнянь |
| `intersects()` | O(1) | 6 порівнянь |
| `closestPoint()` | O(1) | 6 clamp операцій |
| `sqrDistance()` | O(1) | closestPoint + sqrMagnitude |
| `intersectRay()` | O(1) | Алгоритм slab method |
| `fromPoints()` | O(n) | Проходить всі точки один раз |

---

## Зв'язок з Unity

Цей клас повністю імітує Unity `Bounds`:
- Ті ж властивості (`center`, `size`, `extents`, `min`, `max`)
- Ті ж методи (`Contains`, `Intersects`, `Encapsulate`, `Expand`)
- Той же API для перевірки перетинів

**Відмінності:**
- TypeScript замість C#
- Методи з малої літери (`contains` замість `Contains`)
- Параметр `out` для оптимізації в `closestPoint()`
- `intersectRay()` повертає `number` замість `boolean` з `out` параметром

---

## Математична основа

### AABB (Axis-Aligned Bounding Box)
Bounds представляє AABB - найпростіший тип обмежувальної коробки:
- Грані завжди паралельні осям координат
- Швидкі обчислення перетинів
- Не обертається разом з об'єктом (потрібен перерахунок при обертанні)

### Альтернативи:
- **OBB** (Oriented Bounding Box) - обертається, складніші обчислення
- **Bounding Sphere** - ще простіше, але менш точно
- **Convex Hull** - найточніше, найповільніше

---

## Див. також
- [Vector3](./Vector3.md) — 3D вектори
- [Rect](./Rect.md) — 2D прямокутники (аналог для 2D)
- [Mesh](../graphics/Mesh.md) — Геометрія
- [Camera](../components/Camera.md) — Frustum culling
- [Renderer](../components/Renderer.md) — Рендеринг системи
