# Mesh

## 📖 Опис

**Mesh** — це контейнер для геометричних даних 3D моделі. Містить вершини, нормалі, UV координати, кольори та індекси трикутників.

Mesh — це **asset** (ресурс), який може спільно використовуватися багатьма GameObjects через MeshFilter для оптимізації пам'яті.

**Файл:** `src/engine/core/graphics/Mesh.ts`

---

## 🔧 API

### Конструктор

```typescript
// Новий порожний меш
const mesh = new Mesh("MyMesh");

// Клон (копія)
const copy = mesh.clone();
```

### Властивості — Вершинні дані

```typescript
// Масиви даних вершин
mesh.vertices: Vector3[];      // Позиції вершин (обов'язково)
mesh.normals: Vector3[];       // Нормалі (для освітлення)
mesh.tangents: Vector4[];      // Тангенти (для normal mapping)
mesh.colors: Color[];          // Кольори вершин
mesh.uv: Vector2[];            // Основні UV координати
mesh.uv2: Vector2[];           // Другі UV (для lightmap)
mesh.uv3: Vector2[];           // Треті UV
mesh.uv4: Vector2[];           // Четверті UV
```

### Властивості — Індекси

```typescript
mesh.triangles: number[];      // Індекси трикутників
mesh.indexFormat: IndexFormat; // UInt16 або UInt32
```

### Властивості — Інформація

```typescript
mesh.bounds: Bounds;           // Обмежувальна коробка
mesh.vertexCount: number;      // Кількість вершин (readonly)
mesh.triangleCount: number;    // Кількість трикутників (readonly)
mesh.subMeshCount: number;     // Кількість SubMesh (readonly)
```

### Методи — Отримання/Встановлення даних

```typescript
// Вершини
mesh.getVertices(): Vector3[];
mesh.setVertices(vertices: Vector3[]);

// Нормалі
mesh.getNormals(): Vector3[];
mesh.setNormals(normals: Vector3[]);

// Тангенти
mesh.getTangents(): Vector4[];
mesh.setTangents(tangents: Vector4[]);

// UV координати
mesh.getUVs(channel: 0-3): Vector2[];
mesh.setUVs(channel: 0-3, uvs: Vector2[]);

// Кольори
mesh.getColors(): Color[];
mesh.setColors(colors: Color[]);

// Індекси
mesh.getTriangles(): number[];
mesh.setTriangles(triangles: number[]);
```

### Методи — Пересчет

```typescript
// Пересчитати нормалі з вершин
mesh.recalculateNormals();

// Пересчитати обмежувальну коробку
mesh.recalculateBounds();

// Пересчитати тангенти (для normal mapping)
mesh.recalculateTangents();

// Очистити все
mesh.clear();
```

### Методи — SubMesh (мультиматеріал)

```typescript
// Отримати інформацію про SubMesh
mesh.getSubMesh(index: number): SubMesh;

// Встановити SubMesh
mesh.setSubMesh(index: number, submesh: SubMesh);

// SubMesh містить: { indexStart, indexCount, topology }
```

### Методи — Оптимізація

```typescript
// Позначити як динамічний (часто змінюється)
mesh.markDynamic();

// Завантажити дані на GPU
mesh.uploadMeshData(markNoLongerReadable?: boolean);
```

### Методи — Комбінування

```typescript
// Об'єднати кілька мешів в один
Mesh.CombineMeshes(
    meshes: Mesh[],
    mergeSubMeshes?: boolean,
    useMatrices?: boolean
): Mesh;
```

### Методи — Клонування

```typescript
// Копія меша
mesh.clone(): Mesh;
```

### Статичні примітиви

```typescript
// Куб (1x1x1)
Mesh.CreateCube(width?, height?, depth?): Mesh;

// Сфера
Mesh.CreateSphere(radius?, segments?, rings?): Mesh;

// Площина (1x1)
Mesh.CreatePlane(width?, height?): Mesh;

// Циліндр
Mesh.CreateCylinder(radius?, height?, segments?): Mesh;

// Капсула (циліндр з півсферами)
Mesh.CreateCapsule(radius?, height?, segments?): Mesh;

// Квад (для спрайтів, UI)
Mesh.CreateQuad(width?, height?): Mesh;
```

### Enum'и

```typescript
enum MeshTopology {
    Triangles,   // Стандартні трикутники
    Quads,       // Чотирикутники
    Lines,       // Лінії
    LineStrip,   // Зв'язані лінії
    Points       // Точки
}

enum IndexFormat {
    UInt16,      // 16-біт індекси (до 65K вершин)
    UInt32       // 32-біт індекси (до 4B вершин)
}

class SubMesh {
    indexStart: number;    // З якого індексу почати
    indexCount: number;    // Скільки індексів
    topology: MeshTopology; // Як інтерпретувати
}
```

---

## 💡 Приклади

### Приклад 1: Створення простого куба

```typescript
const cube = Mesh.CreateCube();

// Додаємо до GameObject
const obj = new GameObject("Cube");
const filter = obj.addComponent(MeshFilter);
filter.sharedMesh = cube;

const renderer = obj.addComponent(MeshRenderer);
renderer.material = new StandardMaterial();
```

### Приклад 2: Програмне створення меша (трикутник)

```typescript
const mesh = new Mesh("CustomTriangle");

// Вершини: три точки трикутника
mesh.vertices = [
    new Vector3(0, 0, 0),    // Ліва нижня
    new Vector3(1, 0, 0),    // Права нижня
    new Vector3(0.5, 1, 0)   // Верхня
];

// Нормалі: всі в одному напрямку (вверх)
mesh.normals = [
    Vector3.forward,
    Vector3.forward,
    Vector3.forward
];

// Індекси трикутника: вершини 0, 1, 2
mesh.triangles = [0, 1, 2];

// UV: для текстурування
mesh.uv = [
    new Vector2(0, 0),
    new Vector2(1, 0),
    new Vector2(0.5, 1)
];

// Пересчитаємо все
mesh.recalculateBounds();

// Тепер готово до використання
```

### Приклад 3: Модифікація вершин (wave effect)

```typescript
class WaveEffect extends ScriptableBehaviour {
    private originalVertices: Vector3[];
    private mesh: Mesh;
    
    onAwake() {
        this.mesh = this.gameObject
            .getComponent(MeshFilter)
            .mesh;  // Instance копія!
        
        this.originalVertices = this.mesh.getVertices();
    }
    
    onUpdate() {
        const vertices = [...this.originalVertices];
        
        // Хвилі на Z
        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            v.z = Math.sin(v.x * 5 + Time.time) * 0.2;
            vertices[i] = v;
        }
        
        // Встановлюємо нові вершини
        this.mesh.setVertices(vertices);
        this.mesh.recalculateNormals();
        this.mesh.recalculateBounds();
    }
}
```

### Приклад 4: Multi-material меш (SubMesh)

```typescript
const mesh = new Mesh("MultiColorCube");

// ... встановляємо vertices, normals, uv ...

// Індекси для 2 SubMesh'ей (кожен матеріал = 1 submesh)
mesh.triangles = [
    // SubMesh 0 (0-11 індекси = 12 індексів = 4 трикутники)
    0, 1, 2, 2, 3, 0,  // Передня грань
    1, 4, 5, 5, 2, 1,  // Задня грань
    
    // SubMesh 1 (12-23 індекси)
    // ... інші грані ...
];

// Встановлюємо SubMesh'и
mesh.setSubMesh(0, new SubMesh(0, 12, MeshTopology.Triangles));
mesh.setSubMesh(1, new SubMesh(12, 12, MeshTopology.Triangles));

// Тепер MeshRenderer може використовувати різні матеріали!
const renderer = obj.getComponent(MeshRenderer);
renderer.materials = [redMaterial, blueMaterial];
```

### Приклад 5: Комбінування мешів

```typescript
// Багато однакових мешів
const cube1 = Mesh.CreateCube();
const cube2 = Mesh.CreateCube();
const cube3 = Mesh.CreateCube();

// Об'єднуємо в один
const combinedMesh = Mesh.CombineMeshes(
    [cube1, cube2, cube3],
    true  // Об'єднати SubMesh'и
);

// Набагато швидше рендерити один великий меш
// ніж 3 маленьких!
```

### Приклад 6: Динамічне креслення

```typescript
class LineDrawer extends ScriptableBehaviour {
    private mesh: Mesh;
    
    onAwake() {
        this.mesh = new Mesh("Lines");
        
        // Додаємо до GameObject
        const filter = this.gameObject.addComponent(MeshFilter);
        filter.mesh = this.mesh;
        
        const renderer = this.gameObject.addComponent(MeshRenderer);
        renderer.material = new Material(Shader.Unlit);
    }
    
    drawLine(start: Vector3, end: Vector3) {
        const verts = this.mesh.vertices || [];
        const indices = this.mesh.triangles || [];
        
        const idx = verts.length;
        verts.push(start, end);
        
        // Додаємо лінію як пару вершин
        indices.push(idx, idx + 1);
        
        this.mesh.setVertices(verts);
        this.mesh.setTriangles(indices);
        this.mesh.recalculateBounds();
    }
}
```

---

## 📊 Таблиця методів

| Метод | Результат | Приклад |
|-------|-----------|---------|
| getVertices | Vector3[] | Отримати позиції |
| setVertices | void | Встановити позиції |
| recalculateNormals | void | Пересчитати освітлення |
| recalculateBounds | void | Оновити колізійну коробку |
| clone | Mesh | Копія меша |
| CreateCube | Mesh | Новий куб |
| CreateSphere | Mesh | Нова сфера |

---

## ⚠️ Поширені помилки

### ❌ Неправильно: Забуття recalculate

```typescript
// ПЛОХО! Меш буде деформований
mesh.vertices[0] = new Vector3(10, 10, 10);
// Bounds и нормалі не оновлены!
```

### ✅ Правильно: Оновити після змін

```typescript
// ДОБРЕ!
mesh.vertices[0] = new Vector3(10, 10, 10);
mesh.recalculateNormals();
mesh.recalculateBounds();
```

### ❌ Неправильно: Modifying shared mesh

```typescript
// ПЛОХО! Впливає на всі об'єкти
filter.sharedMesh.vertices[0] = Vector3.zero;
```

### ✅ Правильно: Використання instance

```typescript
// ДОБРЕ! Копія для редагування
filter.mesh.vertices[0] = Vector3.zero;
```

---

## 🎯 Використання примітивів

| Примітив | Випадок | Параметри |
|----------|---------|-----------|
| CreateCube | Куб | width, height, depth |
| CreateSphere | Сфера, планета | radius, segments, rings |
| CreatePlane | Площина, земля | width, height |
| CreateCylinder | Циліндр, колона | radius, height, segments |
| CreateCapsule | Капсула, посудина | radius, height, segments |
| CreateQuad | UI, спрайти | width, height |

---

## 📋 Related

- [MeshFilter.md](./MeshFilter.md) — як використовувати меш
- [MeshRenderer.md](./MeshRenderer.md) — рендеринг меша
- [Bounds.md](./Bounds.md) — обмежувальні коробки

---

**Дата оновлення:** 15 січня 2026
