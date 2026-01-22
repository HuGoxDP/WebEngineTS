# 🌍 Solar System Scenario

## 📖 Опис

**Solar System Scenario** — це інтерактивна демонстраційна сцена сонячної системи з реалістичними пропорціями орбіт та планет.

Демонструє:
- ✅ Створення Game Objects з компонентами
- ✅ Mesh primitive (сфери для планет)
- ✅ Материали з різними кольорами та властивостями
- ✅ Камеру для перегляду сцени
- ✅ Освітлення (DirectionalLight)
- ✅ Скрипти для динамічного руху (OrbitalMotion, SelfRotation)

**Файл:** `scenarios/SolarSystem/SolarSystemScenario.ts`

---

## 🎯 Як це працює

### Архітектура сцени

```
Scene
├── Sun (sphere)
│   ├── MeshFilter (geometry: sphere 1.0 radius)
│   ├── MeshRenderer (material: yellow emissive)
│   └── SelfRotation (30°/сек на Y осі)
│
├── Mercury, Venus, Earth, Mars, Jupiter, Saturn
│   ├── MeshFilter (geometry: sphere з різними radius)
│   ├── MeshRenderer (material: різні кольори)
│   ├── OrbitalMotion (рухається по колу)
│   └── SelfRotation (обертається на 90°/сек)
│
├── MainCamera
│   └── Camera (perspective, 60° FOV)
│
└── Sunlight
    └── DirectionalLight (world sun at 10,10,10)
```

---

## 🌎 Компоненти сценарію

### OrbitalMotion - компонент орбітального руху

```typescript
class OrbitalMotion extends ScriptableBehaviour {
    public orbitDistance: number;      // Дистанція від центру (в одиницях)
    public orbitSpeed: number;         // Кутова швидкість (°/сек)
    public centerPosition: Vector3;    // Центр орбіти (для сонця = 0,0,0)

    onUpdate(): void {
        // Обчислює позицію на колі XZ площини
        const angle = this.angle + this.orbitSpeed * Time.deltaTime;
        const x = Math.cos(angle) * this.orbitDistance;
        const z = Math.sin(angle) * this.orbitDistance;
    }
}
```

### SelfRotation - компонент обертання

```typescript
class SelfRotation extends ScriptableBehaviour {
    public rotationSpeed: Vector3;     // Швидкість обертання (°/сек по кожній осі)

    onUpdate(): void {
        // Обертає об'єкт навколо своєї осі
        const deltaQuat = Quaternion.fromEuler(
            deltaRotation.x,
            deltaRotation.y,
            deltaRotation.z
        );
        this.transform.rotation = deltaQuat.multiply(currentRotation);
    }
}
```

---

## 📊 Дані планет

| Планета | Радіус | Дистанція | Швидкість орбіти | Колір |
|---------|--------|-----------|------------------|-------|
| Sun | 1.0 | центр | - | Жовтий |
| Mercury | 0.38 | 3.8 | 1.6 | Сірий |
| Venus | 0.95 | 7.2 | 1.2 | Жовто-оранжевий |
| Earth | 1.0 | 10.0 | 1.0 | Синій |
| Mars | 0.53 | 15.0 | 0.8 | Червоний |
| Jupiter | 2.5 | 25.0 | 0.4 | Помаранчевий |
| Saturn | 2.1 | 35.0 | 0.3 | Палевий |

---

## 🎬 Процес ініціалізації

```typescript
public async init(): Promise<void> {
    // 1️⃣ Створюємо сонце
    this.createSun();
    
    // 2️⃣ Створюємо 6 планет
    for (const planetData of this.planets) {
        this.createPlanet(planetData);
    }
    
    // 3️⃣ Налаштовуємо камеру
    this.setupCamera();
    
    // 4️⃣ Налаштовуємо освітлення
    this.setupLighting();
}
```

---

## 💡 Приклади використання компонентів

### Створення Сонця

```typescript
const sun = this.createGameObject("Sun");

// Додаємо геометрію (сфера)
const meshFilter = sun.addComponent(MeshFilter);
meshFilter.sharedMesh = Mesh.createSphere(1, 32);

// Додаємо матеріал (світиться)
const renderer = sun.addComponent(MeshRenderer);
const material = new StandardMaterial();
material.albedoColor = Color.yellow;
material.emissionColor = Color.yellow;  // Світління
renderer.material = material;

// Додаємо обертання
const selfRotation = sun.addComponent(SelfRotation);
selfRotation.rotationSpeed = new Vector3(0, 30, 0);  // Y-axis 30°/сек
```

### Створення Планети

```typescript
const planet = this.createGameObject("Earth");

// Геометрія
const meshFilter = planet.addComponent(MeshFilter);
meshFilter.sharedMesh = Mesh.createSphere(1.0, 16);

// Матеріал
const renderer = planet.addComponent(MeshRenderer);
const material = new StandardMaterial();
material.albedoColor = new Color(0.2, 0.5, 1, 1);  // Синій
material.metallic = 0.2;
material.smoothness = 0.8;
renderer.material = material;

// Орбітальний рух
const orbital = planet.addComponent(OrbitalMotion);
orbital.orbitDistance = 10;
orbital.orbitSpeed = 1;
orbital.centerPosition = Vector3.zero;

// Самообертання
const selfRotation = planet.addComponent(SelfRotation);
selfRotation.rotationSpeed = new Vector3(0, 90, 0);  // Y-axis 90°/сек
```

---

## 🎥 Налаштування камери

```typescript
const cameraObj = this.createGameObject("MainCamera");
const camera = cameraObj.addComponent(Camera);

// Perspective камера для 3D
camera.orthographic = false;
camera.fieldOfView = 60;
camera.nearClipPlane = 0.1;
camera.farClipPlane = 1000;
camera.backgroundColor = new Color(0.01, 0.01, 0.02, 1);  // Темний космос

// Розташування
cameraObj.transform.position = new Vector3(0, 20, 40);
cameraObj.transform.lookAt(Vector3.zero);
```

---

## 💡 Налаштування освітлення

```typescript
const lightObj = this.createGameObject("Sunlight");
const light = lightObj.addComponent(DirectionalLight);

light.color = Color.white;
light.intensity = 1.5;
light.shadows = 1;  // LightShadows.Hard

// Позиціонуємо як сонце
lightObj.transform.position = new Vector3(10, 10, 10);
lightObj.transform.lookAt(Vector3.zero);
```

---

## 🚀 Як розширити сценарій

### Додати PointLight для планет

```typescript
// Для деяких планет - додати їхні лампи
const light = planet.addComponent(PointLight);
light.color = data.color;
light.intensity = 0.5;
light.range = 20;
light.position = planet.transform.position;
```

### Додати траєкторії орбіт

```typescript
// Line renderer для показу орбіт
const orbitLine = this.createGameObject("Orbit_" + data.name);
const lineRenderer = orbitLine.addComponent(LineRenderer);
// Малюємо коло
for (let i = 0; i < 360; i += 10) {
    const angle = i * Math.PI / 180;
    const pos = new Vector3(
        Math.cos(angle) * data.distance,
        0,
        Math.sin(angle) * data.distance
    );
    // Додаємо точку в лінію
}
```

### Додати текстури

```typescript
const texture = await Texture2D.Load("assets/earth_texture.png");
material.albedoTexture = texture;
```

---

## 📋 Related

- [Scenario.ts](../../src/core/scenario/Scenario.ts) — базовий клас сценарію
- [MeshRenderer.md](../../.github/docs/MeshRenderer.md) — рендеринг мешів
- [Camera.md](../../.github/docs/Camera.md) — камера
- [DirectionalLight.md](../../.github/docs/DirectionalLight.md) — світло

---

**Дата оновлення:** 15 січня 2026  
**Статус:** ✅ ГОТОВО

