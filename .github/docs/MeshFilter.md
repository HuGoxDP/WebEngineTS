# MeshFilter

## 📖 Опис

**MeshFilter** — це компонент який зберігає посилання на геометрію (Mesh). Працює разом з MeshRenderer: фільтр зберігає геометрію, рендерер використовує її для малювання.

Подібно Material, MeshFilter підтримує два режими: **Shared Mesh** і **Instance Mesh**.

**Файл:** `src/engine/core/components/MeshFilter.ts`

---

## 🔧 API

### Конструктор

```typescript
// MeshFilter додається автоматично при додаванні MeshRenderer
// Але можна додати вручну:
const filter = gameObject.addComponent(MeshFilter);
```

### Основні властивості

#### Shared Mesh

```typescript
// Спільний меш (не копіюється)
filter.sharedMesh = Mesh.CreateCube();

// Отримати
const mesh = filter.sharedMesh;

// При встановленні нового — старий Instance скидається
filter.sharedMesh = newMesh;
```

#### Instance Mesh

```typescript
// Instance копія для редагування (копіюється при доступі)
const editableMesh = filter.mesh;

// При першому доступі — автоматично копіюється з sharedMesh
editableMesh.vertices[0].y += 1;
editableMesh.recalculateNormals();  // Обновимо нормалі

// При присвоєнні нового — робиться копія
filter.mesh = Mesh.CreateSphere();
```

### Перевірка наявності меша

```typescript
// Чи є меш?
if (filter.hasMesh()) {
    console.log("Меш присутній");
}
```

---

## 💡 Shared vs Instance Pattern

### Shared Mesh (спільний)

```typescript
// Це дешево! Всі об'єкти посилаються на один меш
const cubeMesh = Mesh.CreateCube();

const obj1 = new GameObject("Cube1");
obj1.addComponent(MeshFilter).sharedMesh = cubeMesh;

const obj2 = new GameObject("Cube2");
obj2.addComponent(MeshFilter).sharedMesh = cubeMesh;

// obj1 і obj2 у пам'яті поділяють один Mesh!
// Якщо змінити одного - både будуть змінюватись

// ПЛОХО! Обидва об'єкти мають червоні куби
cubeMesh.vertices[0] = Vector3.one;
```

### Instance Mesh (копія)

```typescript
// Це дорого за пам'яттю, але безпечно
const cubeMesh = Mesh.CreateCube();

const obj1 = new GameObject("Cube1");
obj1.addComponent(MeshFilter).mesh = cubeMesh;  // Копіюється!

const obj2 = new GameObject("Cube2");
obj2.addComponent(MeshFilter).mesh = cubeMesh;  // Копіюється!

// Тепер у пам'яті 3 mesh'и (оригінал + 2 копії)
// Але кожна копія独立na!

// ДОБРЕ! Тільки Cube2 змінюється
obj2.getComponent(MeshFilter).mesh.vertices[0] = Vector3.one;
obj1.getComponent(MeshFilter).mesh.vertices[0];  // Залишається без змін
```

---

## 🎯 Коли використовувати який режим

### Використовуй Shared Mesh коли:
- ✅ Багато однакових об'єктів (100+ деревьев)
- ✅ Не будеш змінювати геометрію
- ✅ Оптимізація пам'яті критична

### Використовуй Instance Mesh коли:
- ✅ Будеш змінювати вершини/нормалі
- ✅ Хочеш безпеки (не впливати на інші об'єкти)
- ✅ Один-два об'єкти з цим мешом

---

## 💡 Приклади

### Приклад 1: Приклади з примітивами

```typescript
class CubeSpawner extends ScriptableBehaviour {
    onUpdate() {
        if (Input.GetKeyDown(KeyCode.Space)) {
            const cube = new GameObject("Cube");
            const filter = cube.addComponent(MeshFilter);
            
            // Используем один shared mesh для всех кубов
            filter.sharedMesh = Mesh.CreateCube();
            
            const renderer = cube.addComponent(MeshRenderer);
            renderer.material = new StandardMaterial();
        }
    }
}
```

### Приклад 2: Динамічна деформація

```typescript
class DeformingMesh extends ScriptableBehaviour {
    private filter: MeshFilter;
    private originalVertices: Vector3[];
    
    onAwake() {
        this.filter = this.gameObject.getComponent(MeshFilter);
        
        // Клонуємо, щоб не впливати на інші об'єкти
        this.filter.mesh = this.filter.sharedMesh;
        
        // Зберігаємо оригінальні вершини
        this.originalVertices = this.filter.mesh.getVertices().map(v => v.clone());
    }
    
    onUpdate() {
        const mesh = this.filter.mesh;
        const vertices = mesh.vertices;
        
        // Деформуємо вершини
        for (let i = 0; i < vertices.length; i++) {
            const offset = Math.sin(Time.time + i) * 0.1;
            vertices[i] = this.originalVertices[i].clone().add(
                Vector3.up.multiply(offset)
            );
        }
        
        // Оновлюємо меш
        mesh.setVertices(vertices);
        mesh.recalculateNormals();
    }
}
```

### Приклад 3: Лініїв рендер (не куб)

```typescript
// Створюємо лінію
const lineMesh = new Mesh("LineMesh");
lineMesh.vertices = [
    Vector3.zero,
    Vector3.one * 10
];
lineMesh.triangles = [0, 1];

// Додаємо до об'єкта
const lineObj = new GameObject("Line");
const filter = lineObj.addComponent(MeshFilter);
filter.sharedMesh = lineMesh;

const renderer = lineObj.addComponent(MeshRenderer);
renderer.material = new Material(Shader.Unlit);
```

### Приклад 4: Оптимізація — Shared для статичних об'єктів

```typescript
class LevelBuilder extends ScriptableBehaviour {
    onAwake() {
        // Завантажуємо всі primitive'и один раз
        const cubeMesh = Mesh.CreateCube();
        const sphereMesh = Mesh.CreateSphere();
        const planeMesh = Mesh.CreatePlane();
        
        // Вся будівля використовує один cube mesh
        for (let i = 0; i < 100; i++) {
            const building = new GameObject(`Building_${i}`);
            const filter = building.addComponent(MeshFilter);
            
            // Shared! Не тратимо пам'ять
            filter.sharedMesh = cubeMesh;
            
            // Встановлюємо матеріал (також shared)
            const renderer = building.addComponent(MeshRenderer);
            renderer.sharedMaterial = concreteMatrial;
        }
    }
}
```

### Приклад 5: Заміна меша

```typescript
// Спочатку куб
const filter = gameObject.getComponent(MeshFilter);
filter.sharedMesh = Mesh.CreateCube();

// Пізніше змінюємо на сферу
filter.sharedMesh = Mesh.CreateSphere();

// Відтепер - сфера!
```

---

## ⚙️ Внутрішня реалізація

### Як працює Instance копіювання

```typescript
// Користувач:
const editMesh = filter.mesh;  // Перший доступ

// Внутрішньо:
if (this._meshInstance === null && this._sharedMesh !== null) {
    this._meshInstance = this._sharedMesh.clone();  // Копіюється!
}
return this._meshInstance;
```

### Зв'язок з MeshRenderer

```typescript
// MeshRenderer автоматично шукає MeshFilter
// при onAwake() і використовує його меш
const renderer = gameObject.addComponent(MeshRenderer);
renderer.updateMesh();  // Читає з MeshFilter
```

---

## 🚨 Поширені помилки

### ❌ Неправильно: Мутація Shared

```typescript
// ПЛОХО! Впливає на всі об'єкти що використовують цей меш
filter.sharedMesh.vertices[0] = Vector3.up;
```

### ✅ Правильно: Користування Instance

```typescript
// ДОБРЕ! Безпечно змінювати Instance
filter.mesh.vertices[0] = Vector3.up;
```

### ❌ Неправильно: Забуття recalculate

```typescript
// ПЛОХО! Нормалі не оновлюються
filter.mesh.vertices[0] = Vector3.up;
// Меш використовуватиме старі нормалі!
```

### ✅ Правильно: Оновлення норм

```typescript
// ДОБРЕ!
filter.mesh.vertices[0] = Vector3.up;
filter.mesh.recalculateNormals();  // Оновляємо
filter.mesh.recalculateBounds();   // Оновляємо
```

---

## 📊 Memory Analysis

| Сценарій | Пам'ять | Швидкість |
|----------|---------|----------|
| 1000 кубів з Shared | 1 mesh + 1000 посилань | Швидко |
| 1000 кубів з Instance | 1000 mesh копій | Повільно |
| 10 динамічних об'єктів | 10 mesh копій | Нормально |

---

## 📋 Related

- [Mesh.md](./Mesh.md) — опис Mesh класу
- [MeshRenderer.md](./MeshRenderer.md) — як рендерити меш
- [Material.md](./Material.md) — аналогічний Shared vs Instance для матеріалів

---

**Дата оновлення:** 15 січня 2026
