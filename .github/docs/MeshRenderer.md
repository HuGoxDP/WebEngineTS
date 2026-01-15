# MeshRenderer

## 📖 Опис

**MeshRenderer** — це компонент який малює 3D меш на екран. Поєднує:
- **MeshFilter** (геометрія)
- **Material** (матеріал/колір)
- **THREE.Mesh** (внутрішній рендер-ядро)

Це найважливіший компонент для рендерингу 3D об'єктів.

**Файл:** `src/engine/core/components/MeshRenderer.ts`

---

## 🔧 API

### Конструктор та автоматичне налаштування

```typescript
// MeshRenderer автоматично:
// 1. Шукає MeshFilter на тому ж GameObject
// 2. Створює THREE.Mesh
// 3. Додає до сцени

const renderer = gameObject.addComponent(MeshRenderer);

// Важно! MeshFilter повинен вже існувати
const filter = gameObject.addComponent(MeshFilter);
filter.sharedMesh = Mesh.CreateCube();

// Тепер додаємо рендерер
const renderer = gameObject.addComponent(MeshRenderer);
```

### Матеріал (наслідується від Renderer)

```typescript
// Shared матеріал
renderer.sharedMaterial = cubeMaterial;

// Instance матеріал (копія)
const mat = renderer.material;
mat.color = Color.red;
```

### Методи оновлення

```typescript
// Вручну оновити меш (зазвичай не потрібно)
renderer.updateMesh();

// Вручну оновити матеріал
renderer.updateMaterial();

// Оновити все
renderer.forceUpdate();
```

### Lifecycle

```typescript
// Автоматичні методи:
// onAwake()      - створює THREE.Mesh
// onEnable()     - робить видимим
// onDisable()    - приховує
// onDestroy()    - видаляє з GPU
```

---

## 💡 Приклади

### Приклад 1: Простий куб

```typescript
// Створюємо GameObject
const cube = new GameObject("MyCube");

// Додаємо геометрію
const filter = cube.addComponent(MeshFilter);
filter.sharedMesh = Mesh.CreateCube();

// Додаємо матеріал
const renderer = cube.addComponent(MeshRenderer);
const material = new StandardMaterial();
material.albedoColor = Color.red;
renderer.material = material;

// Куб видно на екрані!
```

### Приклад 2: Кілька примітивів

```typescript
class SceneSetup extends ScriptableBehaviour {
    onAwake() {
        // Куб
        const cube = this.createPrimitive(
            "Cube",
            Mesh.CreateCube(),
            Color.red,
            new Vector3(-2, 0, 0)
        );
        
        // Сфера
        const sphere = this.createPrimitive(
            "Sphere",
            Mesh.CreateSphere(),
            Color.green,
            new Vector3(0, 0, 0)
        );
        
        // Площина
        const plane = this.createPrimitive(
            "Plane",
            Mesh.CreatePlane(),
            Color.blue,
            new Vector3(2, 0, 0)
        );
    }
    
    private createPrimitive(name: string, mesh: Mesh, color: Color, pos: Vector3) {
        const obj = new GameObject(name);
        obj.transform.position = pos;
        
        const filter = obj.addComponent(MeshFilter);
        filter.sharedMesh = mesh;
        
        const renderer = obj.addComponent(MeshRenderer);
        const mat = new StandardMaterial();
        mat.albedoColor = color;
        renderer.material = mat;
        
        return obj;
    }
}
```

### Приклад 3: Динамічне оновлення меша

```typescript
class DeformingCube extends ScriptableBehaviour {
    private renderer: MeshRenderer;
    private baseMesh: Mesh;
    
    onAwake() {
        const filter = this.gameObject.getComponent(MeshFilter);
        
        // Копіюємо меш, щоб не впливати на інші куби
        filter.mesh = Mesh.CreateCube();
        
        this.baseMesh = filter.mesh;
        this.renderer = this.gameObject.getComponent(MeshRenderer);
    }
    
    onUpdate() {
        // Деформуємо вершини
        const verts = this.baseMesh.vertices;
        for (let i = 0; i < verts.length; i++) {
            const offset = Math.sin(Time.time + i) * 0.2;
            verts[i].y += offset;
        }
        
        this.baseMesh.setVertices(verts);
        this.baseMesh.recalculateNormals();
        
        // Оновляємо рендерер
        this.renderer.updateMesh();
    }
}
```

### Приклад 4: Спрайтний лист (Atlas)

```typescript
class AtlasSprite extends ScriptableBehaviour {
    onAwake() {
        const filter = this.gameObject.getComponent(MeshFilter);
        filter.sharedMesh = Mesh.CreateQuad();
        
        const renderer = this.gameObject.getComponent(MeshRenderer);
        const material = new StandardMaterial();
        
        // Завантажуємо atlas
        material.albedoTexture = await Texture2D.Load("assets/sprites.png");
        
        // Вирізаємо частину atlas'у (квад на позиції 0,0)
        material.mainTextureOffset = new Vector2(0, 0);
        material.mainTextureScale = new Vector2(0.25, 0.25);  // 1/4 of atlas
        
        renderer.material = material;
    }
}
```

### Приклад 5: Освітлення куба

```typescript
class LitScene extends ScriptableBehaviour {
    onAwake() {
        // Куб з PBR матеріалом
        const cube = new GameObject("Cube");
        const cubeMesh = cube.addComponent(MeshFilter);
        cubeMesh.sharedMesh = Mesh.CreateCube();
        
        const cubeRenderer = cube.addComponent(MeshRenderer);
        const material = new StandardMaterial();
        
        material.albedoColor = new Color(0.8, 0.2, 0.2, 1);  // Червоний
        material.metallic = 0;    // Не метал
        material.smoothness = 0.5;  // Напів-матовий
        
        cubeRenderer.material = material;
        
        // Додаємо світло (буде в ФАЗІ 7)
        // const light = cube.addComponent(DirectionalLight);
    }
}
```

### Приклад 6: Performance - Shared Material для пакетного рендерингу

```typescript
class OptimizedSpawner extends ScriptableBehaviour {
    private sharedMaterial: StandardMaterial;
    
    onAwake() {
        // Один матеріал для всіх
        this.sharedMaterial = new StandardMaterial();
        this.sharedMaterial.albedoColor = Color.white;
    }
    
    onUpdate() {
        if (Input.GetKeyDown(KeyCode.Space)) {
            const cube = new GameObject("Cube");
            
            // Обидва шарять один меш
            const filter = cube.addComponent(MeshFilter);
            filter.sharedMesh = Mesh.CreateCube();  // Спільний меш
            
            // Обидва шарять один матеріал
            const renderer = cube.addComponent(MeshRenderer);
            renderer.sharedMaterial = this.sharedMaterial;  // Спільний матеріал
            
            // Тепер 1000 кубів займають мінімум пам'яті!
            // (1 mesh + 1 material + 1000 instances)
        }
    }
}
```

---

## 🔗 Компонентна система

```
GameObject
├── Transform (позиція, поворот, масштаб)
├── MeshFilter (геометрія)
│   └── mesh: Mesh
└── MeshRenderer (рендеринг)
    ├── material: Material
    └── _threeMesh: THREE.Mesh (внутрішньо)
```

---

## ⚙️ Внутрішній workflow

### При onAwake():

```typescript
1. Шукаємо MeshFilter
2. Створюємо THREE.Mesh()
3. Додаємо до THREE.Group (Transform.object3D)
4. Встановлюємо дефолтний матеріал
5. Включаємо тіні
```

### При setTexture():

```typescript
1. Отримуємо THREE.Texture з Texture2D
2. Встановлюємо на THREE.Material.map
3. Позначаємо needsUpdate = true
```

### При видаленні:

```typescript
1. Видаляємо THREE.Mesh з сцени
2. Звільняємо GPU буфери (dispose)
3. Видаляємо посилання
```

---

## 🚨 Поширені помилки

### ❌ Неправильно: Забуття MeshFilter

```typescript
// ПЛОХО! MeshRenderer не знайде меш
const renderer = gameObject.addComponent(MeshRenderer);
// MeshFilter не додано!
// Результат: невидимий об'єкт
```

### ✅ Правильно: Спочатку MeshFilter

```typescript
// ДОБРЕ!
const filter = gameObject.addComponent(MeshFilter);
filter.sharedMesh = Mesh.CreateCube();

const renderer = gameObject.addComponent(MeshRenderer);
// Тепер все працює!
```

### ❌ Неправильно: Безпосередній доступ до THREE

```typescript
// ЗАБОАРЕНЕНО!
renderer._threeMesh.material = someThreeMaterial;
```

### ✅ Правильно: Використання API

```typescript
// ДОБРЕ!
renderer.material = new StandardMaterial();
```

---

## 📊 Performance Tips

| Операція | Вартість | Рекомендація |
|----------|----------|-------------|
| Створити MeshRenderer | Дешево | Можна динамічно |
| Змінити материал | Дешево | Що завгодно |
| Змінити меш | Середньо | Обережно, багато |
| Деформувати вершини | Дорого | Мінімум |
| Тіні | Дорого | Вибірково |

---

## 📋 Порядок додавання компонентів

```typescript
// Правильний порядок:
1. const obj = new GameObject("MyObject");
2. obj.addComponent(MeshFilter).sharedMesh = mesh;
3. obj.addComponent(MeshRenderer).material = material;
4. obj.addComponent(ScriptableBehaviour).onStart = ...;

// НЕПРАВИЛЬНО:
// 1. MeshRenderer без MeshFilter
// 2. Додання компонентів після рендерингу почався
```

---

## 📋 Related

- [MeshFilter.md](./MeshFilter.md) — геометрія меша
- [Renderer.md](./Renderer.md) — базовий клас рендерера
- [Material.md](./Material.md) — система матеріалів
- [StandardMaterial.md](./StandardMaterial.md) — PBR матеріал
- [Mesh.md](./Mesh.md) — геометрія

---

**Дата оновлення:** 15 січня 2026
